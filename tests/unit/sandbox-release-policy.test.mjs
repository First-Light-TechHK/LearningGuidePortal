import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePromotion, makeSandboxSource, deployWithRollback } from '../../scripts/release/sandbox-promotion.mjs';
const sha='a'.repeat(40), image=`123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/portal@sha256:${'b'.repeat(64)}`;
const prod={Status:'RUNNING',SourceConfiguration:{ImageRepository:{ImageIdentifier:image,ImageRepositoryType:'ECR',ImageConfiguration:{RuntimeEnvironmentVariables:{APP_ENV:'PROD'}}}}};
const sandbox={ServiceName:'learning-guide-sandbox',Status:'RUNNING',SourceConfiguration:{AutoDeploymentsEnabled:false,AuthenticationConfiguration:{AccessRoleArn:'arn:role'},ImageRepository:{ImageIdentifier:image,ImageRepositoryType:'ECR',ImageConfiguration:{Port:'3000',RuntimeEnvironmentVariables:{APP_ENV:'SANDBOX'}}}}};
const valid={sha,workflowSha:'c'.repeat(40),ref:'refs/heads/sandbox',production:prod,sandbox,productionOperation:'SUCCEEDED',attested:true,ci:true};
test('only attested current production image and exact SHA may promote',()=>{
 assert.equal(validatePromotion(valid),image);
 assert.equal(validatePromotion({...valid,attested:false,approvedSha:sha,approvedImage:image}),image);
 assert.throws(()=>validatePromotion({...valid,attested:false,approvedSha:sha,approvedImage:'wrong'}));
 for(const patch of [{ref:'refs/heads/dev'},{workflowSha:'short'},{sha:'bad'},{productionOperation:'FAILED'},{attested:false},{ci:false},{production:{Status:'RUNNING',SourceConfiguration:{CodeRepository:{}}}},{sandbox:{...sandbox,SourceConfiguration:{...sandbox.SourceConfiguration,AutoDeploymentsEnabled:true}}}]) assert.throws(()=>validatePromotion({...valid,...patch}));
});
test('sandbox image update preserves sandbox configuration and rollback source',()=>{
 const next=makeSandboxSource(sandbox.SourceConfiguration,`repo@sha256:${'c'.repeat(64)}`);
 assert.equal(next.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.APP_ENV,'SANDBOX');
 assert.equal(sandbox.SourceConfiguration.ImageRepository.ImageIdentifier,image);
 assert.equal(next.AutoDeploymentsEnabled,false);
});


test('failed verification restores the prior immutable source and stays failed', async () => {
 const previous=sandbox.SourceConfiguration, candidate=makeSandboxSource(previous,`repo@sha256:${'c'.repeat(64)}`,sha), writes=[];
 await assert.rejects(deployWithRollback({image:candidate.ImageRepository.ImageIdentifier,candidate,previous,
  update: async source => {writes.push(source); return {OperationId:String(writes.length)}}, wait:async()=>{},
  describe:async()=>({Status:'RUNNING',SourceConfiguration:candidate}), smoke:async()=>({ok:false,failures:['health']})}));
 assert.equal(writes.length,2); assert.deepEqual(writes[1],previous);
});
test('does not overwrite an independently changed service during rollback', async () => {
 const previous=sandbox.SourceConfiguration, candidate=makeSandboxSource(previous,`repo@sha256:${'c'.repeat(64)}`), writes=[];
 await assert.rejects(deployWithRollback({image:candidate.ImageRepository.ImageIdentifier,candidate,previous,
  update:async source=>{writes.push(source);return {OperationId:'1'}},wait:async()=>{},describe:async()=>{ if (!writes.checked) {writes.checked=true; return {Status:'RUNNING',SourceConfiguration:candidate};} return sandbox; },
  smoke:async()=>({ok:false,failures:['health']})}));
 assert.equal(writes.length,1);
});

test('CLI failures hide arguments, input and stderr containing secrets', async () => {
 const { safeCommand, awsArgs } = await import('../../scripts/release/sandbox-promotion.mjs');
 const secret='SENSITIVE_RUNTIME_SECRET';
 let captured;
 assert.throws(() => safeCommand('aws',awsArgs('update-service'),JSON.stringify({secret}), (_bin,args,opts)=>{captured={args,opts}; throw new Error(`failed ${secret} ${JSON.stringify(args)}`)}), e => !String(e).includes(secret));
 assert(!JSON.stringify(captured.args).includes(secret));
 assert.equal(captured.opts.input,JSON.stringify({secret}));
});

test('rollback preserves concurrent config changes even if image is unchanged', async () => {
 const previous=sandbox.SourceConfiguration, candidate=makeSandboxSource(previous,`repo@sha256:${'c'.repeat(64)}`), writes=[];
 const changed=structuredClone(candidate); changed.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.OTHER='changed';
 await assert.rejects(deployWithRollback({image:candidate.ImageRepository.ImageIdentifier,candidate,previous,
  update:async source=>{writes.push(source);return {OperationId:'1'}},wait:async()=>{},describe:async()=>({Status:'RUNNING',SourceConfiguration:changed}),
  smoke:async()=>({ok:false,failures:['health']})}));
 assert.equal(writes.length,1);
});


test('source comparison ignores object key order but detects config differences', async () => {
 const { sameSource } = await import('../../scripts/release/sandbox-promotion.mjs');
 assert(sameSource({b:{y:2,x:1},a:false},{a:false,b:{x:1,y:2}}));
 assert(!sameSource({a:1,b:2},{a:1}));
});


test('workflow triggers only sandbox pushes and checks ref for dispatch', async () => {
 const {readFile} = await import('node:fs/promises');
 const yaml = await readFile(new URL('../../.github/workflows/sandbox-deploy.yml',import.meta.url),'utf8');
 assert.match(yaml,/push:\s*\n\s*branches:\s*\[sandbox\]/);
 assert.match(yaml,/workflow_dispatch:/);
 assert.match(yaml,/test "\$RELEASE_REF" = refs\/heads\/sandbox/);
 assert.match(yaml,/inputs\.release_sha \|\| vars\.PRODUCTION_RELEASE_SHA/);
 assert(!yaml.includes('refs/heads/ppe'));
});

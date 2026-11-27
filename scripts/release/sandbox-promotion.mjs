import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { evaluateRequiredCI, requiredWorkflows } from './required-ci.mjs';
import { runLiveSmoke } from './liveSmoke.mjs';

const immutable = image => typeof image === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/:~-]*@sha256:[a-f0-9]{64}$/.test(image);
export function validatePromotion({sha, workflowSha, ref, production, sandbox, productionOperation, attested, approvedSha, approvedImage, ci}) {
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^[a-f0-9]{40}$/.test(workflowSha || '') || ref !== 'refs/heads/sandbox') throw new Error('Require exact release and sandbox workflow SHAs');
  const image = production?.SourceConfiguration?.ImageRepository?.ImageIdentifier;
  const previous = sandbox?.SourceConfiguration?.ImageRepository?.ImageIdentifier;
  if (!['PROD','PRODUCTION','PPE','PPE/PROD'].includes(production?.SourceConfiguration?.ImageRepository?.ImageConfiguration?.RuntimeEnvironmentVariables?.APP_ENV) || production?.Status !== 'RUNNING' || productionOperation !== 'SUCCEEDED' || !immutable(image)) throw new Error('Production must have a successful immutable image deployment');
  if (sandbox?.ServiceName !== 'learning-guide-sandbox' || sandbox?.Status !== 'RUNNING' || !immutable(previous) || sandbox.SourceConfiguration.AutoDeploymentsEnabled !== false || sandbox.SourceConfiguration.ImageRepository.ImageConfiguration?.RuntimeEnvironmentVariables?.APP_ENV !== 'SANDBOX') throw new Error('Sandbox must be a RUNNING, manually deployed image service with immutable rollback image and SANDBOX configuration');
  if (sandbox.SourceConfiguration.ImageRepository.ImageRepositoryType !== production.SourceConfiguration.ImageRepository.ImageRepositoryType) throw new Error('Image repository types differ');
  if ((!attested && !(approvedSha === sha && approvedImage === image)) || !ci) throw new Error('Exact source attestation or protected owner confirmation and required CI must pass');
  return image;
}
export function makeSandboxSource(source, image, sha) {
  if (!immutable(image)) throw new Error('Image must be immutable');
  const copy = structuredClone(source);
  copy.ImageRepository.ImageIdentifier = image;
  if (sha) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid release SHA");
    copy.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.APP_VERSION = sha;
  }
  copy.AutoDeploymentsEnabled = false;
  return copy;
}
export function safeCommand(bin,args,input,exec = execFileSync) {
  try { return exec(bin,args,{encoding:'utf8',input,stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024}); }
  catch { throw new Error(`External ${bin === 'aws' ? 'AWS' : 'GitHub'} command failed; details withheld`); }
}
export function awsArgs(commandName) { return ['apprunner',commandName,'--region','ap-southeast-1','--cli-input-json','file:///dev/stdin','--output','json']; }
function command(bin,args) { return safeCommand(bin,args); }
function aws(commandName,payload) { return JSON.parse(safeCommand('aws',awsArgs(commandName),JSON.stringify(payload))); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key,canonical(value[key])]));
  return value;
}
export function sameSource(left,right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function waitOperation(arn,id) {
  for (let n=0;n<100;n++) {
    const result=aws('list-operations',{ServiceArn:arn,MaxResults:20}).OperationSummaryList?.find(op=>op.Id===id);
    if (result?.Status==='SUCCEEDED') return;
    if (['FAILED','ROLLBACK_SUCCEEDED','ROLLBACK_FAILED'].includes(result?.Status)) throw new Error(`Operation ${id}: ${result.Status}`);
    await sleep(15000);
  }
  throw new Error(`Operation ${id} timed out; check service state before retry`);
}
export async function deployWithRollback({update, wait, describe, smoke, image, candidate, previous}) {
  let started = false;
  try {
    const operation = await update(candidate);
    started = true;
    if (!operation.OperationId) throw new Error('No deployment operation ID');
    await wait(operation.OperationId);
    const deployed = await describe();
    if (deployed?.Status !== 'RUNNING' || !sameSource(deployed.SourceConfiguration,candidate)) throw new Error('Sandbox did not settle on the requested immutable image');
    const result = await smoke();
    if (!result.ok) throw new Error(`Sandbox smoke failed: ${result.failures.join('; ')}`);
  } catch (error) {
    if (started) {
      const service = await describe();
      if (service?.Status === 'RUNNING' && sameSource(service.SourceConfiguration,candidate)) {
        const rollback = await update(previous);
        if (!rollback.OperationId) throw new Error(`Release failed and rollback has no operation ID: ${error.message}`);
        await wait(rollback.OperationId);
      } else console.error('Rollback not attempted: Sandbox is busy or source changed; investigate manually.');
    }
    throw error;
  }
}
export async function checkPortalBuildHealth(origin, sha, fetchImpl = fetch) {
  const response = await fetchImpl(new URL('/api/health',origin),{signal:AbortSignal.timeout(15000)});
  const body = await response.json();
  const ok = response.ok && body?.service === 'learning-guide' && body?.environment === 'SANDBOX' && /^[a-f0-9]{40}$/.test(sha || '') && body?.buildCommit === sha;
  return {ok,failures:ok ? [] : ['Portal health, environment or build commit mismatch']};
}
async function main() {
  const { RELEASE_SHA:sha, GITHUB_SHA:workflowSha, GITHUB_REF:ref, GITHUB_REPOSITORY:repo, PROD_SERVICE_ARN:productionArn, SANDBOX_SERVICE_ARN:sandboxArn, SANDBOX_ORIGIN:origin }=process.env;
  if (!productionArn || !sandboxArn || productionArn===sandboxArn || !origin || !repo) throw new Error('Distinct production and Sandbox service ARNs, origin and repository required');
  if (!/^https:\/\//.test(origin)) throw new Error('Sandbox origin must use HTTPS');
  const sourceRef=process.env.PRODUCTION_SOURCE_REF || '';
  if (!/^refs\/heads\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(sourceRef) || sourceRef.includes('..') || sourceRef.includes('//') || sourceRef.endsWith('/') || sourceRef.endsWith('.')) throw new Error('A valid protected production source ref is required');
  const productionBranch=sourceRef.slice('refs/heads/'.length);
  const signer=process.env.PRODUCTION_SIGNER_WORKFLOW || '';
  if (signer && (!signer.startsWith(`${repo}/.github/workflows/`) || !/^[a-zA-Z0-9_./-]+\.ya?ml$/.test(signer) || signer.includes('..'))) throw new Error('Invalid protected signer workflow');
  const production=aws('describe-service',{ServiceArn:productionArn}).Service;
  if (!process.env.PRODUCTION_SERVICE_NAME || production?.ServiceName !== process.env.PRODUCTION_SERVICE_NAME) throw new Error('Production service name must match protected configuration');
  const sandbox=aws('describe-service',{ServiceArn:sandboxArn}).Service;
  const operations=aws('list-operations',{ServiceArn:productionArn,MaxResults:20}).OperationSummaryList || [];
  const latest=operations.sort((a,b)=>new Date(b.StartedAt)-new Date(a.StartedAt))[0];
  // Fail before external provenance commands on malformed inputs or mutable services.
  const image=validatePromotion({sha,workflowSha,ref,production,sandbox,productionOperation:latest?.Status,attested:true,ci:true});
  const gh = endpoint => JSON.parse(command('gh',['api',endpoint]));
  const workflows = {};
  const sandboxRequired = { ...requiredWorkflows, 'study-group-pg-io.yml': ['Study Group PostgreSQL I/O'] };
  for (const workflow of Object.keys(sandboxRequired)) {
    const runs = gh(`repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`).workflow_runs
      .filter(run => run.head_sha === sha && run.head_branch === productionBranch && run.event === 'push')
      .sort((a,b) => b.id-a.id || (b.run_attempt||1)-(a.run_attempt||1));
    if (runs[0]) runs[0].jobs = gh(`repos/${repo}/actions/runs/${runs[0].id}/attempts/${runs[0].run_attempt||1}/jobs?per_page=100`).jobs;
    workflows[workflow] = runs;
  }
  const ci=evaluateRequiredCI({sha,branch:productionBranch,workflows,required:sandboxRequired});
  if (!ci.ok) throw new Error('Exact production SHA CI is missing or failed');
  let attested = false;
  try { if (!signer) throw new Error('No signer configured'); command('gh',['attestation','verify',`oci://${image}`,'--repo',repo,'--source-digest',sha,'--source-ref',sourceRef,'--signer-workflow',signer,'--deny-self-hosted-runners']); attested = true; }
  catch { console.warn('Provenance unavailable; protected owner confirmation is required.'); }
  validatePromotion({sha,workflowSha,ref,production,sandbox,productionOperation:latest?.Status,attested,approvedSha:process.env.PRODUCTION_CONFIRMED_SHA,approvedImage:process.env.PRODUCTION_CONFIRMED_IMAGE,ci:true});
  const previous=structuredClone(sandbox.SourceConfiguration);
  const candidate=makeSandboxSource(previous,image,sha);
  // Recheck production immediately before update; do not silently promote an obsolete image.
  const current=aws('describe-service',{ServiceArn:productionArn}).Service;
  if (current.Status!=='RUNNING' || current.SourceConfiguration?.ImageRepository?.ImageIdentifier!==image) throw new Error('Production changed during verification');
  const currentSandbox=aws('describe-service',{ServiceArn:sandboxArn}).Service;
  if (currentSandbox.Status!=='RUNNING' || !sameSource(currentSandbox.SourceConfiguration,previous)) throw new Error('Sandbox changed during verification');
  await deployWithRollback({
    update: source => aws('update-service',{ServiceArn:sandboxArn,SourceConfiguration:source}),
    wait: id => waitOperation(sandboxArn,id),
    describe: () => aws('describe-service',{ServiceArn:sandboxArn}).Service,
    smoke: async () => {
      const build = await checkPortalBuildHealth(origin,sha);
      if (!build.ok) return build;
      return runLiveSmoke({origin,appEnv:'SANDBOX',sha,requireDependencyChecks:true,requireVersionMatch:true});
    },
    image,candidate,previous,
  });
  console.log(JSON.stringify({ok:true,sha,image}));
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(()=>{console.error('Sandbox promotion failed; check the service and protected release records.');process.exitCode=1;});

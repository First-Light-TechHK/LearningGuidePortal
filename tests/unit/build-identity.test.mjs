import assert from 'node:assert/strict';
import {test} from 'node:test';
import { resolveBuildCommit } from '../../scripts/write-build-identity.mjs';
import { checkPortalBuildHealth } from '../../scripts/release/sandbox-promotion.mjs';
const sha='a'.repeat(40);
test('build identity accepts only an exact build SHA matching available checkout',()=>{
 assert.equal(resolveBuildCommit({requested:sha,gitHead:sha,dirty:false}),sha);
 assert.equal(resolveBuildCommit({requested:'',gitHead:null,dirty:false}),null);
 assert.throws(()=>resolveBuildCommit({requested:'abc',gitHead:null,dirty:false}));
 assert.throws(()=>resolveBuildCommit({requested:sha,gitHead:'b'.repeat(40),dirty:false}));
 assert.throws(()=>resolveBuildCommit({requested:sha,gitHead:sha,dirty:true}));
});
test('sandbox rejects runtime version impersonation without matching build identity',async()=>{
 const response=buildCommit=>({ok:true,json:async()=>({service:'learning-guide',environment:'SANDBOX',version:sha,buildCommit})});
 assert.equal((await checkPortalBuildHealth('https://sandbox.example.test',sha,async()=>response(sha))).ok,true);
 const wrongService={ok:true,json:async()=>({service:'wrong',environment:'SANDBOX',version:sha,buildCommit:sha})};
 assert.equal((await checkPortalBuildHealth('https://sandbox.example.test',sha,async()=>wrongService)).ok,false);
 for (const value of [null,'b'.repeat(40),sha.slice(0,7)]) assert.equal((await checkPortalBuildHealth('https://sandbox.example.test',sha,async()=>response(value))).ok,false);
});

test('generated artifact does not take its identity from runtime APP_VERSION', async () => {
 const { mkdtempSync, readFileSync, rmSync }=await import('node:fs');
 const { tmpdir }=await import('node:os');
 const { join }=await import('node:path');
 const { spawnSync }=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'lg-build-id-'));
 try {
  const script=new URL('../../scripts/write-build-identity.mjs',import.meta.url).pathname;
  const env={...process.env,APP_VERSION:sha,BUILD_COMMIT:''};
  let run=spawnSync(process.execPath,[script],{cwd:dir,env,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(readFileSync(join(dir,'.next/build-identity.json'),'utf8')).buildCommit,null);
  run=spawnSync(process.execPath,[script],{cwd:dir,env:{...env,BUILD_COMMIT:sha},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(readFileSync(join(dir,'.next/build-identity.json'),'utf8')).buildCommit,sha);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

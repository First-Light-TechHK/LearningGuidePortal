import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluateRequiredCI,requiredWorkflows} from '../../scripts/release/required-ci.mjs';
const sha='a'.repeat(40), branch='release-source';
const required={...requiredWorkflows,'study-group-pg-io.yml':['Study Group PostgreSQL I/O']};
const make=(id,conclusion='success')=>({id,head_sha:sha,head_branch:branch,event:'push',status:'completed',conclusion,jobs:[{name:'Study Group PostgreSQL I/O',status:'completed',conclusion}]});
test('sandbox requires latest exact-SHA PG job and rejects missing or failed reruns',()=>{
 const base=Object.fromEntries(Object.entries(requiredWorkflows).map(([workflow,names])=>[workflow,[{...make(1),jobs:names.map(name=>({name,status:'completed',conclusion:'success'}))}]]));
 assert(!evaluateRequiredCI({sha,branch,workflows:base,required}).ok);
 assert(evaluateRequiredCI({sha,branch,workflows:{...base,'study-group-pg-io.yml':[make(1)]},required}).ok);
 assert(!evaluateRequiredCI({sha,branch,workflows:{...base,'study-group-pg-io.yml':[make(1),make(2,'failure')]},required}).ok);
});

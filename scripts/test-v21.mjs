import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {diagnose,diagnoseFatal} from './diagnostics.mjs';
import {buildRetry} from './prepare-retry.mjs';
import {prepareContract} from './prepare-task.mjs';
import {stateContext,claimRetry} from './task-lifecycle.mjs';

const ready={preflightRun:{status:0},preflight:{status:'READY'},workerRun:{status:0},
  workerParsed:{status:'SUCCESS'},outputValid:true,workerSuccess:true,status:'READY_FOR_REVIEW'};
test('diagnostics separate preflight, worker, output, acceptance and verification failures',()=>{
  const cases=[
    [{preflightRun:{status:null,error:{code:'ETIMEDOUT'}}},'PREFLIGHT_TIMEOUT'],
    [{preflightRun:{status:1,stderr:'agy executable was not found'}},'CLI_NOT_FOUND'],
    [{preflightRun:{status:1,stderr:'Proxy is not reachable'}},'PROXY_UNREACHABLE'],
    [{preflightRun:{status:1,stderr:'Invalid proxy URL'}},'PROXY_INVALID'],
    [{preflight:{}},'PREFLIGHT_OUTPUT_INVALID'],
    [{preflightRun:{status:1,stderr:'unexpected'}},'PREFLIGHT_FAILED'],
    [{workerRun:{status:null,error:{code:'ETIMEDOUT'}}},'WORKER_TIMEOUT'],
    [{workerRun:{status:null,error:{code:'ENOENT'}}},'WORKER_PROCESS_ERROR'],
    [{workerRun:{status:1},workerSuccess:false},'WORKER_EXIT_FAILED'],
    [{outputValid:false},'WORKER_OUTPUT_INVALID'],
    [{workerSuccess:false},'WORKER_REPORTED_FAILURE'],
    [{acceptance:[{status:'FAIL',process_error:'ETIMEDOUT'}],scopePassed:false},'ACCEPTANCE_TIMEOUT'],
    [{acceptance:[{status:'FAIL'}]},'ACCEPTANCE_FAILED'],
    [{scopePassed:false},'SCOPE_NOT_VERIFIED'],
    [{artifactsPassed:false},'ARTIFACT_NOT_VERIFIED'],
    [{status:'NEEDS_REVIEW'},'REVIEW_REQUIRED']
  ];
  for(const [overrides,code] of cases) assert.equal(diagnose({...ready,...overrides}).code,code);
  assert.equal(diagnose(ready),null);
});
test('failure-text hints do not echo raw data or classify successful prose',()=>{
  const secret='PRIVATE_TEST_MARKER';
  for(const [response,code] of [['token exchange failed','AUTH_FAILED'],['unknown model','MODEL_UNAVAILABLE']]) {
    const workerParsed={status:'FAILED',response:response+' '+secret};
    const d=diagnose({...ready,workerSuccess:false,workerParsed});
    assert.equal(d.code,code);assert.equal(d.evidence,'failure_text');
    assert.ok(!JSON.stringify(d).includes(secret));
    assert.equal(diagnose({...ready,workerParsed:{...workerParsed,status:'SUCCESS'}}),null);
    assert.equal(diagnose({...ready,workerSuccess:false,outputValid:false,
      workerParsed:{...workerParsed,status:'SUCCESS'}}).code,'WORKER_OUTPUT_INVALID');
  }
});
test('fatal diagnostics distinguish coordination and receipt writing',()=>{
  assert.equal(diagnoseFatal('setup',Error('Workspace busy')).code,'WORKSPACE_BUSY');
  assert.equal(diagnoseFatal('coordination',Error('Retry budget exhausted')).code,'RETRY_EXHAUSTED');
  assert.equal(diagnoseFatal('receipt',Error('private path')).code,'RECEIPT_WRITE_FAILED');
  assert.equal(diagnoseFatal('verification',Error('unknown')).code,'RUNNER_ERROR');
});
test('normalized failed manifests retain auth hints regardless of transport shape',()=>{
  const workerManifest={status:'failed',summary:'authentication failed: token exchange failed'};
  for(const workerParsed of [{status:'SUCCESS',response:workerManifest},
    {status:'SUCCESS',response:JSON.stringify(workerManifest)},
    {status:'SUCCESS',structured_output:workerManifest}]) {
    assert.equal(diagnose({...ready,workerSuccess:false,workerParsed,workerManifest}).code,'AUTH_FAILED');
  }
});
function fixture(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agy-v21-'));
  const previous=process.env.AGY_STATE_DIR;
  process.env.AGY_STATE_DIR=path.join(root,'state');
  const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
  const c=prepareContract({workspace,task_id:'test',task_type:'documentation',goal:'Revise supplied facts',
    task_details:'Preserve quotations.',timeout:'2m',acceptance_timeout:'30s',restrict_tools:true,mode:'plan'});
  const receipt={runner_version:'2.1.0',contract_snapshot:c,contract_scope:{
    allowed_files:c.allowed_files,read_scope:c.read_scope,max_changed_files:c.max_changed_files,
    model:c.model||'gemini-3.8-flash-high',restrict_tools:c.restrict_tools||false,
    forbidden_actions:c.forbidden_actions,acceptance_commands:c.acceptance_commands,
    required_artifacts:c.required_artifacts||[],task_type:c.task_type,mode:c.mode||'accept-edits'},
    workspace:c.workspace,task_id:c.task_id,goal:c.goal,retry_count:0,conversation_id:'conv',attempt_id:'attempt-1',
    status:'READY_FOR_REVIEW',failure_category:null,artifacts:{attempt_dir:path.join(c.artifact_dir,'attempt-1')}};
  try {fn({root,c,receipt});} finally {
    if(previous===undefined) delete process.env.AGY_STATE_DIR;else process.env.AGY_STATE_DIR=previous;
    fs.rmSync(root,{recursive:true,force:true});
  }
}
test('retry preparation preserves all original fields and does not create state',()=>fixture(({root,c,receipt})=>{
  const file=path.join(root,'receipt.json');
  const retry=buildRetry(receipt,file,'Shorten the introduction.');
  for(const [key,value] of Object.entries(c)) if(key!=='task_details') assert.deepEqual(retry[key],value,key);
  assert.match(retry.task_details,/Preserve quotations\./);assert.match(retry.task_details,/Shorten the introduction\./);
  assert.equal(retry.conversation_id,'conv');assert.equal(retry.retry_of,file);
  assert.deepEqual(buildRetry(receipt,file,'Shorten the introduction.'),retry);
  assert.ok(!fs.existsSync(path.join(root,'state')));assert.deepEqual(fs.readdirSync(c.workspace),[]);
}));
test('retry preparation refuses missing evidence, changed scope, blocked failures and exhausted claims',()=>fixture(({root,c,receipt})=>{
  const build=r=>buildRetry(r,path.join(root,'receipt.json'),'Correct wording.');
  assert.throws(()=>build({...receipt,contract_snapshot:undefined}),/V2.1/);
  assert.throws(()=>build({...receipt,retry_count:1}),/exhausted/);
  assert.throws(()=>build({...receipt,conversation_id:null}),/evidence/);
  for(const failure_category of ['auth','environment','model']) assert.throws(()=>build({...receipt,failure_category}),/takeover/);
  const altered=structuredClone(receipt);altered.contract_snapshot.allowed_files=['extra.txt'];
  assert.throws(()=>build(altered),/do not agree/);
  assert.throws(()=>buildRetry(receipt,'receipt.json','x'.repeat(12001)),/task_details/);
  claimRetry(stateContext(c.workspace),receipt,'retry-1');
  assert.throws(()=>build(receipt),/persistent claim/);
}));
test('retry CLI only writes a contract and refuses overwrite',()=>fixture(({root,receipt})=>{
  const input=path.join(root,'receipt.json'),feedback=path.join(root,'feedback.txt'),out=path.join(root,'retry.json');
  fs.writeFileSync(input,JSON.stringify(receipt));fs.writeFileSync(feedback,'Keep it concrete.');
  const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'prepare-retry.mjs');
  const run=()=>spawnSync(process.execPath,[script,'--receipt',input,'--feedback-file',feedback,'--out',out],{encoding:'utf8',windowsHide:true});
  const first=run();assert.equal(first.status,0,first.stderr);
  const metadata=JSON.parse(first.stdout);assert.equal(metadata.executes_worker,false);assert.equal(metadata.consumes_retry,false);
  const contents=fs.readFileSync(out,'utf8');assert.equal(run().status,1);assert.equal(fs.readFileSync(out,'utf8'),contents);
  assert.ok(!fs.existsSync(path.join(root,'state')));
}));

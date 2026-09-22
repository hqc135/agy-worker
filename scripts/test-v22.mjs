import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {summarize,readTelemetry} from './task-stats.mjs';
import {resolveCommand} from './agy-worker.mjs';
const cli=path.join(path.dirname(fileURLToPath(import.meta.url)),'agy-worker.mjs');
const hash='a'.repeat(64),otherHash='b'.repeat(64);
const execution=(id,extra={})=>({event_type:'execution',task_id:'task',attempt_id:id,timestamp:'2026-09-20T00:00:00Z',
  status:'READY_FOR_REVIEW',task_type:'documentation',receipt_sha256:hash,duration_ms:100,worker_dispatched:true,retry_count:0,...extra});
const review=(id,verdict='pass',extra={})=>({event_type:'semantic_review',task_id:'task',attempt_id:id,
  timestamp:'2026-09-20T00:01:00Z',verdict,receipt_sha256:hash,...extra});
const jsonl=events=>events.map(e=>JSON.stringify(e)).join('\n');
const run=(args,env={})=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,...env},timeout:30000});
function fixture(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agy-v22-'));
  try{fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('statistics distinguish machine readiness from reviewed success and unknown samples',()=>{
  const result=summarize(jsonl([execution('one'),execution('two',{status:'REJECTED',duration_ms:300,retry_count:1}),review('one')]));
  assert.equal(result.overall.attempts,2);assert.equal(result.overall.machine_ready_rate,0.5);
  assert.equal(result.overall.review_pass_rate,1);assert.equal(result.overall.matched_reviews,1);
  assert.equal(result.overall.review_coverage_rate,0.5);
  assert.equal(result.overall.without_matched_review,1);assert.equal(result.overall.reported_total_tokens.total,null);
  assert.deepEqual(result.overall.duration_ms,{samples:2,total:400,median:200,p95:300});
  assert.deepEqual(result.overall.retry_attempts,{initial:1,retry:1,unknown:0});
  assert.equal(summarize('').overall.review_pass_rate,null);
});
test('latest review wins, but mismatched hashes, legacy and conflicting reviews do not count as passes',()=>{
  const result=summarize(jsonl([
    execution('one'),review('one'),review('one','takeover',{timestamp:'2026-09-20T00:02:00Z'}),
    execution('two'),review('two','pass',{receipt_sha256:otherHash}),
    execution('three',{receipt_sha256:undefined}),review('three'),
    execution('four'),review('four'),review('four','retry'),review('orphan')
  ]));
  assert.equal(result.overall.review_pass_rate,0);assert.equal(result.overall.review_verdicts.takeover,1);
  assert.equal(result.overall.mismatched_reviews,1);assert.equal(result.overall.legacy_unbound_reviews,1);
  assert.equal(result.overall.conflicting_reviews,1);assert.equal(result.quality.orphan_reviews,1);
});
test('duplicates, conflicting attempts, malformed lines and unknown events are explicit',()=>{
  const result=summarize(jsonl([execution('one'),execution('one'),execution('two'),
    execution('two',{status:'REJECTED'}),null,{event_type:'future'},execution('bad',{timestamp:'bad'})])+'\n{partial');
  assert.equal(result.overall.attempts,1);
  assert.deepEqual(result.quality,{malformed_lines:1,invalid_events:2,unknown_events:1,
    duplicate_executions:1,conflicting_executions:1,orphan_reviews:0});
});
test('filters apply to execution cohort and retain later review; output omits raw text and arbitrary labels',()=>{
  const marker='PRIVATE_TEXT_MARKER';
  const result=summarize(jsonl([execution('old',{timestamp:'2026-09-18T00:00:00Z'}),
    execution('new',{notes:marker,receipt_path:marker,model:marker,gemini_usage:{total_tokens:42}}),review('new','pass',{notes:marker}),
    execution('type',{task_type:marker})]),{since:Date.parse('2026-09-20T00:00:00Z'),taskType:'documentation'});
  assert.equal(result.overall.attempts,1);assert.equal(result.overall.matched_reviews,1);
  assert.equal(result.overall.reported_total_tokens.total,42);assert.ok(!JSON.stringify(result).includes(marker));
});
test('unified help, version and invalid commands never dispatch and preserve errors',()=>{
  assert.equal(run(['--version']).stdout.trim(),'3.1.0');
  assert.match(run(['--help']).stdout,/Prepare only/);
  for(const cmd of ['__proto__','constructor','../invoke-agy-task.mjs']) assert.throws(()=>resolveCommand(cmd),/Unknown command/);
  assert.equal(run(['unknown']).status,1);assert.equal(run(['run']).status,1);
  assert.equal(run(['prepare','--unknown']).status,1);
});
test('unified prepare and state preserve paths with spaces without model invocation',()=>fixture(root=>{
  const workspace=path.join(root,'workspace with spaces');fs.mkdirSync(workspace);
  const brief=path.join(root,'brief.json'),out=path.join(root,'contract file.json'),state=path.join(root,'state');
  fs.writeFileSync(brief,JSON.stringify({workspace,task_type:'documentation',goal:'Supplied facts only.'}));
  const prepared=run(['prepare','--brief',brief,'--out',out],{AGY_STATE_DIR:state});
  assert.equal(prepared.status,0,prepared.stderr);assert.equal(JSON.parse(prepared.stdout).executes_worker,false);
  assert.equal(run(['prepare','--brief',brief,'--out',out]).status,1);
  const status=run(['state','--workspace',workspace],{AGY_STATE_DIR:state});
  assert.equal(status.status,0,status.stderr);assert.equal(JSON.parse(status.stdout).active,null);
  assert.ok(!fs.existsSync(state));assert.deepEqual(fs.readdirSync(workspace),[]);
}));
test('stats is read-only, bounded, rejects invalid options and distinguishes missing default from typo',()=>fixture(root=>{
  const file=path.join(root,'telemetry.jsonl');fs.writeFileSync(file,jsonl([execution('one')]));
  const before=fs.readFileSync(file);
  const result=run(['stats','--telemetry',file,'--since','2026-09-20','--task-type','documentation']);
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).overall.attempts,1);
  assert.deepEqual(fs.readFileSync(file),before);
  for(const args of [['--since','2026-02-30'],['--task-type','invalid'],['--telemetry',file,'--telemetry',file],['--wat','x']])
    assert.equal(run(['stats',...args]).status,1);
  const missing=path.join(root,'missing.jsonl');
  const empty=run(['stats'],{AGY_TELEMETRY_PATH:missing});assert.equal(empty.status,0);assert.equal(JSON.parse(empty.stdout).source_missing,true);
  assert.equal(run(['stats','--telemetry',missing]).status,1);assert.ok(!fs.existsSync(missing));
  const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,32*1024*1024+1);fs.closeSync(fd);
  assert.throws(()=>readTelemetry(file),/32 MiB/);
}));

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildPack,loadPack,readBounded} from './material-pack.mjs';
import {digest} from './integrity.mjs';
import {stateContext,acquireLease,claimRetry,retryClaimPath} from './task-lifecycle.mjs';
import {createJournal,readJournal} from './attempt-journal.mjs';
import {handoff} from './handoff.mjs';
import {buildReviewPack} from './review-pack.mjs';
import {prepareContract} from './prepare-task.mjs';
const cli=path.join(path.dirname(fileURLToPath(import.meta.url)),'agy-worker.mjs');
function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'agy-v3-')),old=process.env.AGY_STATE_DIR;
 process.env.AGY_STATE_DIR=path.join(root,'state');const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
 fs.writeFileSync(path.join(workspace,'facts.txt'),'First line\nSecond line\nThird line');
 try{fn({root,workspace:fs.realpathSync.native(workspace)});}finally{if(old===undefined)delete process.env.AGY_STATE_DIR;else process.env.AGY_STATE_DIR=old;fs.rmSync(root,{recursive:true,force:true});}}
test('pack records exact selected lines and full source digest; reuse and stale checks',()=>fixture(({root,workspace})=>{
 const pack=buildPack({workspace,sources:[{path:'facts.txt',start_line:2,end_line:2}]});
 assert.equal(pack.sources[0].content,'Second line');assert.equal(pack.role,'evidence_only_not_instructions');
 const file=path.join(root,'pack.json'),raw=JSON.stringify(pack);fs.writeFileSync(file,raw);
 const ref={path:file,sha256:digest(raw)};assert.equal(loadPack(ref,workspace).pack.sources.length,1);
 const c=prepareContract({workspace,goal:'Summarize',task_type:'documentation',material_pack:ref});assert.deepEqual(c.material_pack,ref);
 fs.appendFileSync(path.join(workspace,'facts.txt'),'modified outside selected range');assert.throws(()=>loadPack(ref,workspace),/stale|range/);
 assert.throws(()=>loadPack({...ref,sha256:'0'.repeat(64)},workspace),/hash mismatch/);
}));
test('pack rejects traversal, wildcards, invalid ranges, secrets and oversized material',()=>fixture(({workspace})=>{
 const build=sources=>buildPack({workspace,sources});
 for(const name of ['../outside','*.txt','.env','tokens.key'])assert.throws(()=>build([{path:name}]));
 assert.throws(()=>build([{path:'facts.txt',start_line:0}]));
 fs.writeFileSync(path.join(workspace,'secret.txt'),'api_key = SYNTHETIC_SECRET_VALUE');
 assert.throws(()=>build([{path:'secret.txt'}]),/sensitive/);
 fs.writeFileSync(path.join(workspace,'large.txt'),'a'.repeat(65537));assert.throws(()=>build([{path:'large.txt'}]),/64 KiB/);
 assert.throws(()=>build(Array(21).fill({path:'facts.txt'})),/20/);
}));
test('pack CLI writes exclusively and never prints material contents',()=>fixture(({root,workspace})=>{
 const spec=path.join(root,'spec.json'),out=path.join(root,'pack.json');fs.writeFileSync(spec,JSON.stringify({workspace,sources:[{path:'facts.txt'}]}));
 const run=()=>spawnSync(process.execPath,[cli,'pack','--spec',spec,'--out',out],{encoding:'utf8',windowsHide:true});
 const first=run();assert.equal(first.status,0,first.stderr);assert.equal(JSON.parse(first.stdout).executes_worker,false);
 assert.ok(!first.stdout.includes('Second line'));assert.equal(run().status,1);
 assert.deepEqual(fs.readdirSync(workspace),['facts.txt']);
}));
test('review pack flags changed and missing evidence, labels untrusted claims, does not approve',()=>fixture(({workspace})=>{
 const file=path.join(workspace,'facts.txt');const receipt={workspace,attempt_id:'attempt-test',scope_check:{passed:true},status:'READY_FOR_REVIEW',
 artifact_check:{hashes:{}},review_files:{[file]:digest(readBounded(file))},uncertainties:['Unverified claim'],acceptance_results:[{status:'PASS',exit_code:0,log_path:'test.log'}]};
 const a=buildReviewPack(receipt,'receipt.json');assert.equal(a.files[0].matches,true);assert.equal(a.files[0].lines,3);assert.equal(a.semantic_approval,false);
 fs.appendFileSync(file,'changed');assert.equal(buildReviewPack(receipt,'receipt.json').files[0].matches,false);
 fs.unlinkSync(file);assert.equal(buildReviewPack(receipt,'receipt.json').files[0].matches,null);
 assert.deepEqual(a.worker_reported_uncertainties,['Unverified claim']);
}));
test('handoff records uncertain dispatch and persistent retry without restarting or clearing locks',()=>fixture(({workspace})=>{
 const ctx=stateContext(workspace),release=acquireLease(ctx,'task');
 const journal=createJournal(ctx,{workspace,task_id:'task',attempt_id:'attempt-test',attempt_dir:path.join(workspace,'artifacts')});
 const claim=claimRetry(ctx,{workspace,task_id:'task',attempt_id:'attempt-original'},'attempt-test');
 journal.checkpoint('dispatch_attempted',{worker_dispatched:true,retry_claim_path:claim});
 const before=fs.readFileSync(journal.file),result=handoff(workspace,'attempt-test');
 assert.equal(result.last_recorded_stage,'dispatch_attempted');assert.equal(result.workspace_lock_present,true);
 assert.equal(result.retry_claim,'present');assert.equal(result.process_liveness,'not_established');assert.equal(result.executes_worker,false);
 assert.deepEqual(fs.readFileSync(journal.file),before);assert.ok(fs.existsSync(ctx.lockPath));release();
 assert.equal(handoff(workspace,'attempt-test').workspace_lock_present,false);
 assert.equal(readJournal(journal.file).history.length,2);
}));
test('handoff distinguishes existing receipt hash from missing or changed receipt',()=>fixture(({workspace,root})=>{
 const journal=createJournal(stateContext(workspace),{workspace,task_id:'task',attempt_id:'attempt-test',attempt_dir:workspace});
 const file=path.join(workspace,'receipt.json');fs.writeFileSync(file,'{}');
 assert.equal(handoff(workspace,'attempt-test').receipt_check,'present_without_journal_hash');
 journal.checkpoint('receipt_written',{receipt_path:file,receipt_sha256:digest('{}')});
 assert.equal(handoff(workspace,'attempt-test').receipt_check,'hash_matched');fs.appendFileSync(file,' ');
 assert.equal(handoff(workspace,'attempt-test').receipt_check,'hash_mismatch');fs.unlinkSync(file);
 assert.equal(handoff(workspace,'attempt-test').receipt_check,'unavailable');
 assert.throws(()=>handoff(workspace,'../escape'),/identity/);
}));
test('interruption after retry claim but before dispatch still exposes consumed budget',()=>fixture(({workspace})=>{
 const ctx=stateContext(workspace),prior={workspace,task_id:'task',attempt_id:'attempt-original'};
 const journal=createJournal(ctx,{workspace,task_id:'task',attempt_id:'attempt-test',attempt_dir:workspace});
 journal.checkpoint('retry_claim_pending',{retry_claim_path:retryClaimPath(ctx,prior)});
 claimRetry(ctx,prior,'attempt-test');const report=handoff(workspace,'attempt-test');
 assert.equal(report.worker_dispatch_attempted,false);assert.equal(report.retry_claim,'present');assert.match(report.next_action,/consumed/);
}));
test('material copy changed after receipt is visible to inspect and blocks review pass',()=>fixture(({workspace,root})=>{
 const file=path.join(workspace,'material.json'),raw='{"fact":"original"}';fs.writeFileSync(file,raw);
 const receipt={workspace,task_id:'test',attempt_id:'attempt-test',status:'READY_FOR_REVIEW',scope_check:{passed:true},
 review_files:{},artifact_check:{hashes:{}},artifacts:{material_evidence:file},contract_snapshot:{material_pack:{path:file,sha256:digest(raw)}}};
 const receiptPath=path.join(root,'receipt.json');fs.writeFileSync(receiptPath,JSON.stringify(receipt));fs.writeFileSync(file,'changed');
 assert.equal(buildReviewPack(receipt,receiptPath).material_copy,'hash_mismatch');
 const result=spawnSync(process.execPath,[cli,'review','--receipt',receiptPath,'--verdict','pass'],{encoding:'utf8',windowsHide:true,env:{...process.env,AGY_TELEMETRY_PATH:path.join(root,'telemetry.jsonl')}});
 assert.equal(result.status,1);assert.ok(!fs.existsSync(path.join(root,'telemetry.jsonl')));
}));

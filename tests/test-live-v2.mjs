#!/usr/bin/env node
// Explicit opt-in live smoke test: uses the user's existing agy login and quota.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareContract} from '../scripts/prepare-task.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'agy-v2-live-'));
const workspace=path.join(temp,'workspace');
fs.mkdirSync(workspace);
const git=(...args)=>{
  const r=spawnSync('git',['-C',workspace,...args],{encoding:'utf8',windowsHide:true});
  assert.equal(r.status,0,r.stderr);
};
try{
  fs.writeFileSync(path.join(workspace,'facts.txt'),'The required verification marker is AGY_V2_OK.\n');
  fs.writeFileSync(path.join(workspace,'.gitignore'),'.agy-artifacts/\n');
  git('init','-q');git('config','user.name','AGY Smoke Test');git('config','user.email','test@example.invalid');
  git('add','.');git('commit','-qm','fixture');
  const contract=prepareContract({workspace,task_type:'documentation',goal:
    'Read facts.txt and create the required draft.md artifact containing only AGY_V2_OK and a newline. Do not modify project files.',
    read_scope:['facts.txt'],timeout:'2m'});
  const contractPath=path.join(temp,'contract.json');
  fs.writeFileSync(contractPath,JSON.stringify(contract));
  const start=Date.now();
  const run=spawnSync(process.execPath,[path.join(repo,'scripts','agy-worker.mjs'),'run','--contract',contractPath],{
    encoding:'utf8',windowsHide:true,timeout:180000,
    env:{...process.env,AGY_STATE_DIR:path.join(temp,'state'),AGY_PREFLIGHT_CACHE:path.join(temp,'preflight'),AGY_TELEMETRY_PATH:path.join(temp,'telemetry.jsonl')}
  });
  if(run.status!==0) throw new Error('Live run failed: '+run.status+' '+run.stderr+' '+run.stdout);
  const compact=JSON.parse(run.stdout);
  const receipt=JSON.parse(fs.readFileSync(compact.receipt_path,'utf8'));
  assert.equal(receipt.runner_version,'3.1.0');
  assert.equal(compact.diagnostic,null);
  assert.equal(compact.worker_dispatched,true);
  assert.ok(receipt.timings.worker_ms>0);
  assert.equal(receipt.contract_snapshot.goal,contract.goal);
  assert.ok(fs.existsSync(receipt.artifacts.raw_preflight_output));
  assert.equal(receipt.scope_check.passed,true);
  const draft=path.join(path.dirname(compact.receipt_path),'draft.md');
  assert.equal(fs.readFileSync(draft,'utf8').trim(),'AGY_V2_OK');
  console.log(JSON.stringify({live_test:'PASS',runner_version:receipt.runner_version,model:contract.model||'gemini-3.8-flash-high',
    duration_ms:Date.now()-start,timings:receipt.timings,scope_passed:true,artifact_verified:true}));
}finally{
  // This test owns only this freshly allocated temporary fixture.
  fs.rmSync(temp,{recursive:true,force:true});
}

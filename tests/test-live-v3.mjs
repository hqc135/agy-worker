#!/usr/bin/env node
// Explicit opt-in: three bounded real model tasks; never run in CI.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareContract} from '../scripts/prepare-task.mjs';
import {buildPack} from '../scripts/material-pack.mjs';
import {digest} from '../scripts/integrity.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agy-live-v3-'));
const env={...process.env,AGY_STATE_DIR:path.join(root,'state'),AGY_PREFLIGHT_CACHE:path.join(root,'preflight'),AGY_TELEMETRY_PATH:path.join(root,'telemetry.jsonl')};
try{
 for(const type of ['documentation','mechanical_edit','investigation'].filter(t=>!process.env.AGY_LIVE_TYPE||process.env.AGY_LIVE_TYPE===t)){
  const workspace=path.join(root,type);fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace,'facts.txt'),'AGY delegates bounded work to Gemini. Codex reviews the result. Browser tasks stay with Codex. Test counts: apples=7, pears=5.\n');
  fs.writeFileSync(path.join(workspace,'target.txt'),'color=blue\n');
  fs.writeFileSync(path.join(workspace,'.gitignore'),'.agy-artifacts/\n');
  for(const args of [['init','-q'],['config','user.name','AGY Test'],['config','user.email','test@example.invalid'],['add','.'],['commit','-qm','fixture']]){
   const r=spawnSync('git',['-C',workspace,...args],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);
  }
  const pack=buildPack({workspace,sources:[{path:'facts.txt'}]}),packFile=path.join(root,type+'-pack.json'),raw=JSON.stringify(pack);
  fs.writeFileSync(packFile,raw);
  const goals={documentation:'Read the pinned material evidence. Write draft.md in Chinese, 3 natural sentences explaining the delegation workflow using only those facts. Mention Gemini, Codex, and browser responsibility. No invented experience.',
   mechanical_edit:'Read material evidence. Change target.txt from color=blue to color=green exactly, retaining the newline. Modify no other project file.',
   investigation:'Read pinned material evidence. Write evidence.md reporting apples=7, pears=5, total=12 and cite facts.txt line 1. Clearly separate source observations from the calculated total (7+5=12); do not claim the source literally reports the total. Do not invent additional facts.'};
  const c=prepareContract({workspace,task_type:type,goal:goals[type],read_scope:['facts.txt','target.txt'],
   allowed_files:type==='mechanical_edit'?['target.txt']:[],material_pack:{path:packFile,sha256:digest(raw)},timeout:'2m'});
  const file=path.join(root,type+'-contract.json');fs.writeFileSync(file,JSON.stringify(c));
  const start=Date.now();const run=spawnSync(process.execPath,[path.join(repo,'scripts','agy-worker.mjs'),'run','--contract',file],{encoding:'utf8',windowsHide:true,timeout:180000,env});
  assert.equal(run.status,0,run.stderr+' '+run.stdout);
  const compact=JSON.parse(run.stdout),receipt=JSON.parse(fs.readFileSync(compact.receipt_path,'utf8'));
  assert.equal(receipt.runner_version,'3.1.0');assert.equal(receipt.scope_check.passed,true);
  const summary=JSON.parse(fs.readFileSync(compact.review_pack_path,'utf8'));assert.equal(summary.semantic_approval,false);
  assert.ok(summary.files.every(f=>f.matches===true));
  let output;
  if(type==='mechanical_edit'){output=fs.readFileSync(path.join(workspace,'target.txt'),'utf8');assert.equal(output,'color=green\n');}
  else {output=fs.readFileSync(path.join(receipt.artifacts.attempt_dir,type==='documentation'?'draft.md':'evidence.md'),'utf8');
   if(type==='documentation'){assert.match(output,/Gemini/);assert.match(output,/Codex/);assert.match(output,/浏览器/);}
   else{for(const token of ['7','5','12','facts.txt'])assert.ok(output.includes(token));}}
  const h=spawnSync(process.execPath,[path.join(repo,'scripts','agy-worker.mjs'),'handoff','--workspace',workspace,'--attempt',receipt.attempt_id],{encoding:'utf8',windowsHide:true,env});
  assert.equal(h.status,0,h.stderr);const report=JSON.parse(h.stdout);assert.equal(report.receipt_check,'hash_matched');assert.equal(report.workspace_lock_present,false);
  console.log(JSON.stringify({type,result:'PASS',duration_ms:Date.now()-start,output:output.slice(0,1500)}));
 }
}finally{fs.rmSync(root,{recursive:true,force:true});}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {stateContext, acquireLease, claimRetry, inspectState} from './task-lifecycle.mjs';
import {prepareContract} from './prepare-task.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
function fixture(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agy-v2-'));
  const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
  const context=stateContext(workspace,path.join(root,'state'));
  return Promise.resolve().then(()=>fn({root,workspace,context})).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
}
test('brief creates compatible bounded contract and writing deliverable',()=>fixture(({workspace})=>{
  const c=prepareContract({workspace,task_type:'documentation',goal:'Write supplied facts'});
  assert.equal(c.version,'v1');assert.deepEqual(c.allowed_files,[]);
  assert.equal(c.max_changed_files,0);assert.deepEqual(c.required_artifacts,['draft.md']);
  assert.equal(c.artifact_dir,path.join(workspace,'.agy-artifacts',c.task_id));
  const edit=prepareContract({workspace,task_type:'mechanical_edit',goal:'Change exact files',allowed_files:['a.txt','b.txt']});
  assert.equal(edit.max_changed_files,2);
  assert.throws(()=>prepareContract({workspace,task_type:'implementation',goal:'x',allowed_files:['src/**']}),/max_changed_files/);
  assert.throws(()=>prepareContract({workspace,task_type:'implementation',goal:'x',allowed_files:['../x']}),/escape/);
  assert.throws(()=>prepareContract({workspace,task_type:'documentation',goal:'x',unexpected:true}),/Unknown/);
}));
test('prepare command is non-executing and refuses output overwrite',()=>fixture(({root,workspace})=>{
  const brief=path.join(root,'brief.json'), out=path.join(root,'contract.json');
  fs.writeFileSync(brief,JSON.stringify({workspace,task_type:'documentation',goal:'Write a paragraph'}));
  const run=()=>spawnSync(process.execPath,[path.join(scripts,'prepare-task.mjs'),'--brief',brief,'--out',out],{encoding:'utf8',windowsHide:true});
  const first=run();assert.equal(first.status,0,first.stderr);
  assert.equal(JSON.parse(first.stdout).executes_worker,false);
  const before=fs.readFileSync(out,'utf8');
  assert.equal(run().status,1);assert.equal(fs.readFileSync(out,'utf8'),before);
  assert.deepEqual(fs.readdirSync(workspace),[]);
}));
test('exclusive lease and observable state; release works after exception',()=>fixture(({context})=>{
  const release=acquireLease(context,'task');
  assert.equal(inspectState(context).active.task_id,'task');
  assert.throws(()=>acquireLease(context,'other'),/busy/);
  release();assert.equal(inspectState(context).active,null);
  const again=acquireLease(context,'again');
  try {throw Error('simulated');}catch{}finally{again();}
  assert.equal(inspectState(context).active,null);
}));
test('subdirectories share Git lock and state inside workspace is rejected',()=>fixture(({workspace,root})=>{
  const init=spawnSync('git',['init','-q',workspace],{encoding:'utf8',windowsHide:true});
  assert.equal(init.status,0,init.stderr);
  const sub=path.join(workspace,'sub');fs.mkdirSync(sub);
  const a=stateContext(workspace,path.join(root,'state')), b=stateContext(sub,path.join(root,'state'));
  assert.equal(a.lockPath,b.lockPath);
  const release=acquireLease(a,'a');
  try {assert.throws(()=>acquireLease(b,'b'),/busy/);}finally{release();}
  assert.throws(()=>stateContext(workspace,path.join(workspace,'state')),/outside/);
}));
test('copied original receipt cannot obtain another persistent retry claim',()=>fixture(({context,workspace})=>{
  const prior={workspace,task_id:'task',attempt_id:'original',retry_count:0};
  const release=acquireLease(context,'task');
  try {claimRetry(context,prior,'retry-1');}finally{release();}
  const next=stateContext(workspace,path.dirname(context.directory));
  assert.throws(()=>claimRetry(next,JSON.parse(JSON.stringify(prior)),'retry-2'),/budget exhausted/);
  assert.equal(inspectState(next).retry_claims,1);
}));
test('two processes racing to claim one retry yield exactly one winner',()=>fixture(async({context,workspace})=>{
  const moduleUrl=pathToFileURL(path.join(scripts,'task-lifecycle.mjs')).href;
  const prior={workspace,task_id:'task',attempt_id:'original'};
  const code='import {claimRetry} from '+JSON.stringify(moduleUrl)+';try{claimRetry('+JSON.stringify(context)+','+JSON.stringify(prior)+',process.argv[1]);}catch{process.exitCode=1}';
  const run=id=>new Promise(resolve=>{
    const child=spawn(process.execPath,['--input-type=module','-e',code,id],{stdio:'ignore',windowsHide:true});
    child.on('error',()=>resolve(-1));child.on('exit',resolve);
  });
  const results=await Promise.all([run('one'),run('two')]);
  assert.deepEqual(results.sort(),[0,1]);
}));
test('interrupted or malformed lock is fail-closed, never auto-cleared',()=>fixture(({context})=>{
  fs.mkdirSync(context.directory,{recursive:true});fs.writeFileSync(context.lockPath,'incomplete');
  assert.equal(inspectState(context).active.unreadable,true);
  assert.throws(()=>acquireLease(context,'x'),/busy/);
  assert.equal(fs.readFileSync(context.lockPath,'utf8'),'incomplete');
}));

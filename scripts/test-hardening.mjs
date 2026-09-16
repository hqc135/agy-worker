#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fileDigest} from './integrity.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hardening-'));
const originalEnv = {...process.env};
const output = (label, fn) => { fn(); console.log('PASS ' + label); };
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-C',cwd,...args], {encoding:'utf8',windowsHide:true});
  assert.equal(r.status,0,r.stderr);
};
let serial=0;
function fixture() {
  const dir=path.join(root,'case-'+(++serial)); fs.mkdirSync(dir);
  git(dir,'init','-q'); git(dir,'config','user.name','Test'); git(dir,'config','user.email','test@example.invalid');
  fs.writeFileSync(path.join(dir,'source.txt'),'baseline\n');
  fs.writeFileSync(path.join(dir,'.gitignore'),'.agy-artifacts/\n');
  git(dir,'add','.'); git(dir,'commit','-qm','fixture');
  return {
    version:'v1', task_id:'case-'+serial, task_type:'investigation', goal:'Inspect source',
    workspace:dir, allowed_files:[], read_scope:['source.txt'], acceptance_commands:[],
    forbidden_actions:[], max_changed_files:0, artifact_dir:path.join(dir,'.agy-artifacts','task'),
    return_mode:'compact', timeout:'30s'
  };
}
function run(c, action='OK', extra={}) {
  const contract=path.join(root,'contract-'+serial+'.json'); fs.writeFileSync(contract,JSON.stringify(c));
  const r=spawnSync(process.execPath,[path.join(scripts,'invoke-agy-task.mjs'),'--contract',contract,'--agy-path',path.join(root,'fake.ps1')],
    {encoding:'utf8',windowsHide:true,timeout:60000,env:{...process.env,AGY_HARDENING_ACTION:action,...extra}});
  let receipt;try{receipt=JSON.parse(r.stdout);}catch{}
  return {...r,receipt,full:receipt?.receipt_path?JSON.parse(fs.readFileSync(receipt.receipt_path,'utf8')):null};
}
const fake = "\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport {spawn} from 'node:child_process';\nconst args=process.argv.slice(2);\nconst prompt=args[args.indexOf('--print')+1];\nconst workspace=args[args.indexOf('--add-dir')+1];\nconst attempt=prompt.match(/Artifact Directory: ([^\\r\\n]+)/)[1];\nconst action=process.env.AGY_HARDENING_ACTION;\nconst artifacts=[];\nif(action==='UNAUTHORIZED'||action==='HIDDEN') fs.writeFileSync(path.join(workspace,action==='HIDDEN'?'source.txt':'illegal.txt'),'changed');\nif(action==='OLD') fs.writeFileSync(path.join(path.dirname(attempt),'old','evidence.md'),'tampered');\nif(action==='MISSING') artifacts.push(path.join(attempt,'missing.md'));\nif(action==='ESCAPE') artifacts.push(path.join(workspace,'source.txt'));\nif(action==='ARTIFACT'||action==='RESTRICT'||action==='TEMPLATE') {\n fs.writeFileSync(path.join(attempt,'report.md'),'verified evidence'); artifacts.push(path.join(attempt,'report.md'));\n}\nif(action==='RESTRICT' && args.includes('--dangerously-skip-permissions')) throw Error('RestrictTools was not forwarded');\nif(action==='TEMPLATE' && (!prompt.includes('Do not invent experience') || !prompt.includes('Audience: beginners'))) throw Error('Missing template or task_details');\nif(action==='TREE') {\n const late=path.join(workspace,'late.txt');\n spawn(process.execPath,['-e', 'setTimeout(()=>require(\"fs\").writeFileSync('+JSON.stringify(late)+',\"late\"),8000)'],{detached:true,stdio:'ignore'}).unref();\n fs.writeFileSync(path.join(workspace,'started.txt'),'started');\n setInterval(()=>{},1000);\n} else console.log(JSON.stringify({\n status:'SUCCESS', conversation_id:'fake-conversation',\n response:'{}', structured_output:{\n status:'completed',summary:'Completed bounded task',changed_files:[],commands_run:[],artifacts,uncertainties:[],needs_review:false\n }}));\n";
try {
 process.env.AGY_TELEMETRY_PATH=path.join(root,'telemetry.jsonl');
 process.env.AGY_PREFLIGHT_CACHE=path.join(root,'preflight');
 process.env.AGY_STATE_DIR=path.join(root,'state');
 fs.writeFileSync(path.join(root,'fake.mjs'),fake);
 fs.writeFileSync(path.join(root,'fake.ps1'),'& node "$PSScriptRoot/fake.mjs" @args\n');
 let c=fixture();
 const sentinel=path.join(c.workspace,'test-executed.txt');
 c.acceptance_commands=[{executable:process.execPath,args:['-e','require("fs").writeFileSync('+JSON.stringify(sentinel)+',"ran")']}];
 let r=run(c,'UNAUTHORIZED');
 output('out-of-scope worker cannot execute acceptance',()=>{
 assert.equal(r.status,3,r.stderr); assert.equal(r.receipt.status,'REJECTED');
 assert.equal(r.receipt.acceptance_results[0].status,'SKIP'); assert.ok(!fs.existsSync(sentinel));});
 c=fixture();
 const first=path.join(c.workspace,'first-illegal.txt'), second=path.join(c.workspace,'second-ran.txt');
 c.acceptance_commands=[
   {executable:process.execPath,args:['-e','require("fs").writeFileSync('+JSON.stringify(first)+',"illegal")']},
   {executable:process.execPath,args:['-e','require("fs").writeFileSync('+JSON.stringify(second)+',"ran")']}
 ];
 r=run(c);
 output('acceptance side effect prevents subsequent command',()=>{assert.equal(r.status,3);assert.equal(r.receipt.acceptance_results[1].status,'SKIP');assert.ok(!fs.existsSync(second));});
 c=fixture();r=run(c,'UNAUTHORIZED',{HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1'});
 output('failed proxy preflight stops worker',()=>{assert.equal(r.status,3,r.stderr);assert.equal(r.full.failure_category,'environment');assert.ok(!fs.existsSync(path.join(c.workspace,'illegal.txt')));});
 c=fixture();git(c.workspace,'update-index','--assume-unchanged','source.txt');
 r=run(c,'HIDDEN');
 output('assume-unchanged content modification detected',()=>{assert.equal(r.status,3,r.stderr);assert.ok(r.receipt.scope_check.touched_files.includes('source.txt'));});
 c=fixture();git(c.workspace,'update-index','--skip-worktree','source.txt');r=run(c,'HIDDEN');
 output('skip-worktree content modification detected',()=>{assert.equal(r.status,3,r.stderr);assert.ok(r.receipt.scope_check.touched_files.includes('source.txt'));});
 c=fixture();fs.mkdirSync(path.join(c.artifact_dir,'old'),{recursive:true});fs.writeFileSync(path.join(c.artifact_dir,'old','evidence.md'),'original');
 r=run(c,'OLD');
 output('old evidence tamper detected',()=>{assert.equal(r.status,3);assert.match(r.full.scope_check.violations.join(' '),/Historical/);});
 for(const action of ['MISSING','ESCAPE']) {
 c=fixture(); r=run(c,action);
 output('artifact validation '+action,()=>{assert.equal(r.status,3,r.stderr);assert.equal(r.receipt.artifact_check.passed,false);});
 }
 c=fixture();c.required_artifacts=['report.md'];r=run(c,'OK');
 output('required deliverable cannot be omitted',()=>{assert.equal(r.status,3,r.stderr);});
 c=fixture();fs.renameSync(path.join(c.workspace,'.git'),path.join(root,'saved-git-'+serial));c.required_artifacts=['report.md'];r=run(c,'OK');
 output('missing artifact cannot downgrade to needs-review outside Git',()=>{assert.equal(r.status,3,r.stderr);assert.equal(r.receipt.status,'REJECTED');});
 c=fixture();c.required_artifacts=['report.md'];c.restrict_tools=true;r=run(c,'RESTRICT');
 output('restricted tools pass through and artifact verified',()=>{assert.equal(r.status,0,r.stderr);assert.equal(r.full.artifact_check.passed,true);});
 const review=()=>spawnSync(process.execPath,[path.join(scripts,'record-review.mjs'),'--receipt',r.receipt.receipt_path,'--verdict','pass'],{encoding:'utf8',windowsHide:true});
 output('review binds to exact attempt',()=>{const v=review();assert.equal(v.status,0,v.stderr);assert.equal(JSON.parse(v.stdout).attempt_id,r.receipt.attempt_id);});
 fs.appendFileSync(path.join(r.full.artifacts.attempt_dir,'report.md'),'modified');
 output('stale artifact review rejected',()=>{assert.equal(review().status,1);});
 c=fixture();c.task_type='documentation';c.task_details='Audience: beginners';c.required_artifacts=['report.md'];r=run(c,'TEMPLATE');
 output('task-specific guidance reaches worker',()=>{assert.equal(r.status,0,r.stderr);});
 c=fixture();r=run(c);
 c.retry_of=r.receipt.receipt_path;c.conversation_id=r.receipt.conversation_id;
 const originalRetryParent=c.retry_of;
 r=run(c);
 output('one exact retry is allowed',()=>{assert.equal(r.status,0,r.stderr);assert.equal(r.full.retry_count,1);});
 const repeated=run({...c,retry_of:originalRetryParent});
 output('same original receipt cannot be retried twice',()=>{assert.equal(repeated.status,1);assert.match(repeated.stderr,/budget exhausted/);});
 c.retry_of=r.receipt.receipt_path;r=run(c);
 output('second retry stops before worker',()=>{assert.equal(r.status,1);assert.match(r.stderr,/budget exhausted/);});
 c=fixture();r=run(c);c.retry_of=r.receipt.receipt_path;c.conversation_id=r.receipt.conversation_id;c.allowed_files=['source.txt'];r=run(c);
 output('retry cannot broaden scope',()=>{assert.equal(r.status,1);assert.match(r.stderr,/may not change scope/);});
 c=fixture();r=run(c);c.retry_of=r.receipt.receipt_path;c.conversation_id=r.receipt.conversation_id;c.mode='plan';r=run(c);
 output('retry cannot change execution mode',()=>{assert.equal(r.status,1);assert.match(r.stderr,/may not change scope/);});
 c=fixture();r=run(c);r=run(c);
 output('local CLI preflight cache is reused',()=>{assert.equal(r.status,0,r.stderr);assert.equal(r.full.preflight.cache_hit,true);});
 c=fixture();c.timeout='5s';r=run(c,'TREE');
 output('worker timeout reports rejection',()=>{assert.equal(r.status,3,r.stderr);assert.equal(r.full.failure_category,'timeout');assert.ok(fs.existsSync(path.join(c.workspace,'started.txt')));});
 await new Promise(resolve=>setTimeout(resolve,9000));
 output('timed-out detached child cannot write later',()=>{assert.ok(!fs.existsSync(path.join(c.workspace,'late.txt')));});
 c=fixture();const childStarted=path.join(c.workspace,'started.txt');const late=path.join(c.workspace,'late.txt');
 const childCode='setTimeout(()=>require("fs").writeFileSync('+JSON.stringify(late)+',"late"),8000)';
 const parentCode='require("child_process").spawn(process.execPath,["-e",'+JSON.stringify(childCode)+'],{detached:true,stdio:"ignore"}).unref();require("fs").writeFileSync('+JSON.stringify(childStarted)+',"started");setInterval(()=>{},1000)';
 c.acceptance_commands=[{executable:process.execPath,args:['-e',parentCode],timeout:'5s'}];
 r=run(c);
 output('acceptance timeout is a failure',()=>{assert.equal(r.status,3);assert.equal(r.receipt.acceptance_results[0].status,'FAIL');assert.ok(fs.existsSync(childStarted));});
 await new Promise(resolve=>setTimeout(resolve,9000));
 output('timed-out acceptance child cannot write later',()=>assert.ok(!fs.existsSync(late)));
 const hard=path.join(c.workspace,'hard.txt');
 fs.linkSync(path.join(c.workspace,'source.txt'),hard);
 output('hard links fail closed',()=>assert.throws(()=>fileDigest(hard,c.workspace),/hard link/));
 console.log('All hardening tests passed.');
} finally {
 process.env=originalEnv;
 fs.rmSync(root,{recursive:true,force:true});
}

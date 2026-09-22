#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stateContext,inspectState} from './task-lifecycle.mjs';
import {journalPath,readJournal} from './attempt-journal.mjs';
import {readBounded} from './material-pack.mjs';
import {digest,inside,plainPath} from './integrity.mjs';

export function handoff(workspace,attempt) {
  const context=stateContext(workspace),file=journalPath(context,attempt),j=readJournal(file);
  if(j.workspace!==context.workspace||j.attempt_id!==attempt||j.version!==1)throw new Error('Journal identity mismatch.');
  if(typeof j.attempt_dir!=='string'||!inside(j.attempt_dir,context.workspace))throw new Error('Attempt directory mismatch.');
  plainPath(j.attempt_dir,context.workspace);
  const state=inspectState(context);
  const candidate=path.join(j.attempt_dir,'receipt.json');
  if(j.receipt_path&&path.resolve(j.receipt_path)!==candidate)throw new Error('Receipt path mismatch.');
  let receipt='not_recorded';
  if(j.receipt_path){try{receipt=digest(readBounded(j.receipt_path,8*1024*1024))===j.receipt_sha256?'hash_matched':'hash_mismatch';}catch{receipt='unavailable';}}
  else if(fs.existsSync(candidate))receipt='present_without_journal_hash';
  const evidence_files=['preflight-output.json','raw-agy-output.json','worker-manifest.json','material-evidence.json','review-diff.patch','review-pack.json','receipt.json']
    .map(name=>{const file=path.join(j.attempt_dir,name);try{const stat=fs.lstatSync(file);return {name,present:true,regular:stat.isFile()&&!stat.isSymbolicLink(),bytes:stat.size};}catch{return {name,present:false};}});
  return {attempt_id:attempt,journal_path:file,last_recorded_stage:j.stage,history:j.history,
    machine_status:j.machine_status??null,error_stage:j.error_stage??null,
    worker_dispatch_attempted:j.worker_dispatched===true,process_liveness:'not_established',
    workspace_lock_present:state.active!==null,retry_claim:j.retry_claim_path?fs.existsSync(j.retry_claim_path)?'present':'missing_or_removed':'not_recorded',
    attempt_dir:j.attempt_dir,receipt_path:j.receipt_path??(receipt==='present_without_journal_hash'?candidate:null),receipt_check:receipt,
    evidence_files,review:j.review??null,executes_worker:false,clears_lock:false,
    next_action:state.active?'Confirm the runner and descendants have stopped. Do not clear a lock or redispatch based on this report.':
      j.retry_claim_path&&fs.existsSync(j.retry_claim_path)&&receipt!=='hash_matched'?'Retry claim is consumed; Codex must inspect existing evidence, not redispatch.':
      receipt==='hash_matched'?'Run inspect on the receipt and review existing files; no model rerun is needed for inspection.':
      j.worker_dispatched?'Codex must inspect partial files and logs. Dispatch outcome may be uncertain; do not automatically rerun.':
      'Inspect local prerequisites and evidence before deciding a new action; no automatic execution.'};
}
function main(){const a=process.argv.slice(2);if(a.length!==4||a[0]!=='--workspace'||a[2]!=='--attempt')throw new Error('Usage: handoff --workspace <directory> --attempt <attempt-id>');
  const output=JSON.stringify(handoff(a[1],a[3]),null,2);
  if(Buffer.byteLength(output)>16*1024)throw new Error('Handoff exceeds 16 KiB; inspect the journal locally.');
  process.stdout.write(output+'\n');}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
}

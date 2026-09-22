#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateContract} from './invoke-agy-task.mjs';
import {stateContext, retryClaimPath} from './task-lifecycle.mjs';
import {loadPack} from './material-pack.mjs';

export function buildRetry(receipt, receiptPath, feedback) {
  if(!receipt || !receipt.contract_snapshot || !receipt.contract_scope?.mode)
    throw new Error('Retry helper requires a V2.1 receipt with a complete contract snapshot.');
  if(!Number.isInteger(receipt.retry_count) || receipt.retry_count!==0)
    throw new Error('Retry budget exhausted or missing retry-count evidence.');
  if(['auth','environment','model'].includes(receipt.failure_category))
    throw new Error('Authentication, environment and model failures require Codex takeover.');
  if(!receipt.conversation_id || typeof receipt.conversation_id!=='string' || !receipt.attempt_id)
    throw new Error('Receipt lacks conversation/attempt evidence.');
  if(!['READY_FOR_REVIEW','NEEDS_REVIEW','REJECTED'].includes(receipt.status)) throw new Error('Unknown receipt status.');
  if(typeof feedback!=='string' || !feedback.trim()) throw new Error('Non-empty correction feedback is required.');
  const original=structuredClone(receipt.contract_snapshot);
  validateContract(original);
  if(original.material_pack)loadPack(original.material_pack,original.workspace);
  const scope={
    allowed_files:original.allowed_files,read_scope:original.read_scope,max_changed_files:original.max_changed_files,
    model:original.model || 'gemini-3.8-flash-high',restrict_tools:original.restrict_tools || false,
    forbidden_actions:original.forbidden_actions,acceptance_commands:original.acceptance_commands,
    required_artifacts:original.required_artifacts || [],task_type:original.task_type,mode:original.mode || 'accept-edits'
  };
  if(JSON.stringify(scope)!==JSON.stringify(receipt.contract_scope) || original.workspace!==receipt.workspace ||
    original.task_id!==receipt.task_id || original.goal!==receipt.goal)
    throw new Error('Receipt snapshot and task evidence do not agree.');
  if(!receipt.artifacts?.attempt_dir || path.resolve(original.artifact_dir)!==path.dirname(path.resolve(receipt.artifacts.attempt_dir)))
    throw new Error('Receipt artifact directory does not match snapshot.');
  if(original.retry_of || original.conversation_id) throw new Error('A retry cannot be retried.');
  const context=stateContext(original.workspace);
  if(fs.existsSync(retryClaimPath(context,receipt))) throw new Error('Retry budget exhausted: a persistent claim already exists.');
  const contract={...original,conversation_id:receipt.conversation_id,retry_of:path.resolve(receiptPath),
    task_details:[original.task_details || '', 'Codex correction for the same task:',feedback.trim()].filter(Boolean).join('\n\n')};
  validateContract(contract); // Includes the task_details size cap; never silently truncate feedback.
  return contract;
}
function main(){
  const args=process.argv.slice(2);
  if(args.length!==6 || args[0]!=='--receipt' || args[2]!=='--feedback-file' || args[4]!=='--out')
    throw new Error('Usage: node prepare-retry.mjs --receipt receipt.json --feedback-file correction.txt --out retry.json');
  const receiptPath=path.resolve(args[1]);
  const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  const contract=buildRetry(receipt,receiptPath,fs.readFileSync(args[3],'utf8'));
  const output=path.resolve(args[5]);
  fs.writeFileSync(output,JSON.stringify(contract,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({contract_path:output,task_id:contract.task_id,
    parent_attempt_id:receipt.attempt_id,executes_worker:false,consumes_retry:false})+'\n');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}

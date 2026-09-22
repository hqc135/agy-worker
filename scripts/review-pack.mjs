#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,inside} from './integrity.mjs';
import {readBounded,loadPack} from './material-pack.mjs';

export function buildReviewPack(receipt,receiptPath) {
  if(!receipt?.workspace||!receipt.attempt_id||!receipt.scope_check||!receipt.artifact_check)throw new Error('Receipt lacks review evidence.');
  const all=Object.entries({...receipt.review_files,...receipt.artifact_check.hashes,...receipt.review_evidence});
  const files=all.slice(0,20).map(([file,expected])=>{
    const entry={path:file,expected_sha256:expected};
    try {
      if(!inside(file,receipt.workspace))throw new Error('outside workspace');
      const raw=readBounded(file);entry.bytes=raw.length;entry.matches=digest(raw)===expected;
      if(/\.(md|txt|js|ts|json|py|html|css)$/i.test(file)){
        const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
        entry.characters=[...text].length;entry.lines=text.split(/\r?\n/).length;
      }
    }catch{entry.matches=null;entry.inspection='missing_or_unsupported_or_oversized';}
    return entry;
  });
  const deleted=(receipt.review_deleted||[]).slice(0,20).map(file=>({path:file,still_absent:inside(file,receipt.workspace)&&!fs.existsSync(file)}));
  let materialCheck='not_used';
  if(receipt.contract_snapshot?.material_pack){try{loadPack(receipt.contract_snapshot.material_pack,receipt.workspace);materialCheck='current';}catch{materialCheck='stale_or_unavailable';}}
  let materialCopy='not_used';
  if(receipt.contract_snapshot?.material_pack){try{
    const file=receipt.artifacts?.material_evidence;
    if(!file||!inside(file,receipt.workspace))throw new Error('Missing material evidence.');
    materialCopy=digest(readBounded(file,128*1024))===receipt.contract_snapshot.material_pack.sha256?'hash_matched':'hash_mismatch';
  }catch{materialCopy='unavailable';}}
  return {version:1,attempt_id:receipt.attempt_id,receipt_path:receiptPath,status:receipt.status,
    semantic_approval:false,material_check:materialCheck,material_copy:materialCopy,scope:receipt.scope_check.passed,diagnostic:receipt.diagnostic??null,
    files,total_files:all.length,files_omitted:Math.max(0,all.length-files.length),deleted,
    deleted_omitted:Math.max(0,(receipt.review_deleted||[]).length-deleted.length),
    acceptance:(receipt.acceptance_results||[]).slice(0,8).map(r=>({status:r.status,exit_code:r.exit_code,log_path:r.log_path})),
    acceptance_omitted:Math.max(0,(receipt.acceptance_results||[]).length-8),diff:receipt.diff,
    tracked_diff:{path:receipt.artifacts?.review_diff??null,complete:receipt.artifacts?.review_diff_complete??false,
      scope:'HEAD to worktree for touched paths; includes pre-existing edits; untracked files require direct inspection'},
    worker_reported_uncertainties:(receipt.uncertainties||[]).slice(0,5).map(v=>String(v).slice(0,240)),
    next_action:'Inspect actual draft/diff and evidence. Counts and worker claims are not factual or editorial approval.'};
}
function main(){
  const a=process.argv.slice(2);if(a.length!==2||a[0]!=='--receipt')throw new Error('Usage: inspect --receipt <receipt.json>');
  const file=path.resolve(a[1]),raw=readBounded(file,8*1024*1024);
  const pack=buildReviewPack(JSON.parse(raw),file);pack.receipt_sha256=digest(raw);
  const output=JSON.stringify(pack,null,2);
  if(Buffer.byteLength(output)>16*1024)throw new Error('Review summary exceeds 16 KiB; inspect receipt locally.');
  process.stdout.write(output+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
}

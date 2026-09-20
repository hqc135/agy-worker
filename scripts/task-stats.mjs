#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const TYPES=['implementation','test_generation','mechanical_edit','documentation','investigation'];
const STATUSES=['READY_FOR_REVIEW','NEEDS_REVIEW','REJECTED'];
const VERDICTS=['pass','retry','takeover'];
const HASH=/^[a-f0-9]{64}$/;
const MAX_BYTES=32*1024*1024;
const number=value=>Number.isSafeInteger(value) && value>=0 ? value : null;
const timestamp=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const identity=e=>JSON.stringify([e.task_id,e.attempt_id]);
const label=value=>typeof value==='string' && value.length>0 && value.length<=200;
const ratio=(n,d)=>d?Math.round(n/d*10000)/10000:null;
function metric(values) {
  values.sort((a,b)=>a-b);
  const n=values.length;
  return {samples:n,total:n?values.reduce((a,b)=>a+b,0):null,
    median:n?(values[Math.floor((n-1)/2)]+values[Math.floor(n/2)])/2:null,
    p95:n?values[Math.ceil(n*0.95)-1]:null};
}
function group(rows) {
  const statuses=Object.fromEntries(STATUSES.map(s=>[s,0]));
  const reviews=Object.fromEntries(VERDICTS.map(s=>[s,0]));
  let legacy=0,mismatch=0,conflict=0,dispatched=0,notDispatched=0,initial=0,retries=0;
  const durations=[],tokens=[],workerTimes=[];
  for(const {execution:e,review:r,binding} of rows) {
    statuses[e.status]++;
    if(binding==='matched') reviews[r.verdict]++;
    if(binding==='legacy') legacy++;
    if(binding==='mismatch') mismatch++;
    if(binding==='conflict') conflict++;
    if(e.worker_dispatched===true) dispatched++;
    if(e.worker_dispatched===false) notDispatched++;
    if(e.retry_count===0) initial++;
    if(e.retry_count===1) retries++;
    if(e.duration_ms!==null) durations.push(e.duration_ms);
    if(e.total_tokens!==null) tokens.push(e.total_tokens);
    if(e.worker_ms!==null) workerTimes.push(e.worker_ms);
  }
  const reviewed=Object.values(reviews).reduce((a,b)=>a+b,0);
  return {attempts:rows.length,machine_status:statuses,machine_ready_rate:ratio(statuses.READY_FOR_REVIEW,rows.length),
    matched_reviews:reviewed,review_coverage_rate:ratio(reviewed,rows.length),review_verdicts:reviews,review_pass_rate:ratio(reviews.pass,reviewed),
    without_matched_review:rows.length-reviewed,legacy_unbound_reviews:legacy,mismatched_reviews:mismatch,conflicting_reviews:conflict,
    dispatch:{attempted:dispatched,not_attempted:notDispatched,unknown:rows.length-dispatched-notDispatched},
    retry_attempts:{initial,retry:retries,unknown:rows.length-initial-retries},
    duration_ms:metric(durations),worker_ms:metric(workerTimes),reported_total_tokens:metric(tokens)};
}

export function summarize(text,{since=null,taskType=null}={}) {
  const executions=new Map(),reviews=new Map(),conflictingExecutions=new Set();
  const quality={malformed_lines:0,invalid_events:0,unknown_events:0,duplicate_executions:0,conflicting_executions:0,orphan_reviews:0};
  for(const line of text.split(/\r?\n/)) {
    if(!line.trim()) continue;
    let e;try{e=JSON.parse(line);}catch{quality.malformed_lines++;continue;}
    if(!e || typeof e!=='object' || Array.isArray(e)) {quality.invalid_events++;continue;}
    if(!['execution','semantic_review'].includes(e.event_type)) {quality.unknown_events++;continue;}
    if(!label(e.task_id)||!label(e.attempt_id)||timestamp(e.timestamp)===null) {quality.invalid_events++;continue;}
    const key=identity(e);
    if(e.event_type==='execution') {
      if(!STATUSES.includes(e.status)) {quality.invalid_events++;continue;}
      const record={timestamp:timestamp(e.timestamp),status:e.status,
        task_type:TYPES.includes(e.task_type)?e.task_type:'unknown',
        receipt_sha256:typeof e.receipt_sha256==='string'&&HASH.test(e.receipt_sha256)?e.receipt_sha256:null,
        worker_dispatched:typeof e.worker_dispatched==='boolean'?e.worker_dispatched:null,
        retry_count:[0,1].includes(e.retry_count)?e.retry_count:null,
        duration_ms:number(e.duration_ms),worker_ms:number(e.timings?.worker_ms),total_tokens:number(e.gemini_usage?.total_tokens)};
      if(executions.has(key)) {
        if(JSON.stringify(executions.get(key))===JSON.stringify(record)) quality.duplicate_executions++;
        else conflictingExecutions.add(key);
      } else executions.set(key,record);
    } else {
      if(!VERDICTS.includes(e.verdict)||typeof e.receipt_sha256!=='string'||!HASH.test(e.receipt_sha256)) {quality.invalid_events++;continue;}
      const record={timestamp:timestamp(e.timestamp),verdict:e.verdict,receipt_sha256:e.receipt_sha256};
      const previous=reviews.get(key);
      if(!previous || record.timestamp>previous.timestamp) reviews.set(key,record);
      else if(record.timestamp===previous.timestamp &&
        (record.verdict!==previous.verdict||record.receipt_sha256!==previous.receipt_sha256)) previous.conflict=true;
    }
  }
  quality.conflicting_executions=conflictingExecutions.size;
  for(const key of reviews.keys()) if(!executions.has(key)) quality.orphan_reviews++;
  const rows=[];
  for(const [key,execution] of executions) {
    if(conflictingExecutions.has(key) || (since!==null&&execution.timestamp<since) ||
      (taskType!==null&&execution.task_type!==taskType)) continue;
    const review=reviews.get(key);
    const binding=!review?'none':review.conflict?'conflict':!execution.receipt_sha256?'legacy':
      review.receipt_sha256!==execution.receipt_sha256 || review.timestamp<execution.timestamp ||
      (review.verdict==='pass'&&execution.status==='REJECTED') ? 'mismatch':'matched';
    rows.push({execution,review,binding});
  }
  return {schema_version:'1',filters:{since:since===null?null:new Date(since).toISOString(),task_type:taskType},
    quality,overall:group(rows),by_task_type:Object.fromEntries([...TYPES,'unknown']
      .filter(type=>rows.some(r=>r.execution.task_type===type))
      .map(type=>[type,group(rows.filter(r=>r.execution.task_type===type))]))};
}

export function readTelemetry(file) {
  let fd;
  try {fd=fs.openSync(file,'r');} catch(error) {if(error.code==='ENOENT')return {text:'',missing:true};throw error;}
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()) throw new Error('Telemetry must be a regular JSONL file.');
    if(stat.size>MAX_BYTES) throw new Error('Telemetry exceeds 32 MiB; select a smaller archived JSONL file explicitly.');
    // Read only the initial bounded size: concurrent appends cannot create an unbounded read.
    const data=Buffer.alloc(stat.size);let offset=0;
    while(offset<data.length) {const n=fs.readSync(fd,data,offset,data.length-offset,offset);if(!n)break;offset+=n;}
    return {text:data.subarray(0,offset).toString('utf8'),missing:false};
  } finally {fs.closeSync(fd);}
}
function main() {
  const args=process.argv.slice(2),options={},seen=new Set();
  let file=process.env.AGY_TELEMETRY_PATH||path.join(os.homedir(),'.config','agy-worker','telemetry.jsonl');
  for(let i=0;i<args.length;i+=2) {
    const key=args[i],value=args[i+1];
    if(!['--telemetry','--since','--task-type'].includes(key)||!value||seen.has(key)) throw new Error('Usage: stats [--telemetry <jsonl>] [--since YYYY-MM-DD] [--task-type <type>]');
    seen.add(key);
    if(key==='--telemetry')file=value;
    if(key==='--task-type') {if(!TYPES.includes(value))throw new Error('Unknown task type.');options.taskType=value;}
    if(key==='--since') {
      const parsed=Date.parse(value+'T00:00:00Z');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==value) throw new Error('--since must be a valid YYYY-MM-DD UTC date.');
      options.since=parsed;
    }
  }
  const input=readTelemetry(path.resolve(file));
  if(input.missing&&seen.has('--telemetry')) throw new Error('The selected telemetry file does not exist.');
  process.stdout.write(JSON.stringify({source_missing:input.missing,...summarize(input.text,options)},null,2)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{main();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { digest, fileDigest } from './integrity.mjs';
import {stateContext} from './task-lifecycle.mjs';
import {journalPath,readJournal,saveJournal} from './attempt-journal.mjs';

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--receipt') {
      parsed.receipt = args[++i];
      if (!parsed.receipt) throw new Error('Missing value for --receipt.');
    } else if (arg === '--task-id') {
      parsed.taskId = args[++i];
      if (!parsed.taskId) throw new Error('Missing value for --task-id.');
    } else if (arg.startsWith('--task-id=')) {
      parsed.taskId = arg.slice('--task-id='.length);
    } else if (arg === '--verdict') {
      parsed.verdict = args[++i];
      if (!parsed.verdict) throw new Error('Missing value for --verdict.');
    } else if (arg.startsWith('--verdict=')) {
      parsed.verdict = arg.slice('--verdict='.length);
    } else if (arg === '--notes') {
      parsed.notes = args[++i];
      if (parsed.notes === undefined) throw new Error('Missing value for --notes.');
    } else if (arg.startsWith('--notes=')) {
      parsed.notes = arg.slice('--notes='.length);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}

if (args.taskId && (typeof args.taskId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(args.taskId.trim()))) {
  process.stderr.write('Error: --task-id must use only letters, numbers, dash, and underscore.\n');
  process.exit(1);
}

const validVerdicts = ['pass', 'retry', 'takeover'];
if (!args.verdict || !validVerdicts.includes(args.verdict.toLowerCase())) {
  process.stderr.write(`Error: Invalid or missing --verdict. Must be one of: ${validVerdicts.join(', ')}.\n`);
  process.exit(1);
}

let receipt, receiptBytes, receiptPath;
try {
  if (!args.receipt) throw new Error('--receipt is required to bind the review to an attempt.');
  receiptPath = path.resolve(args.receipt);
  receiptBytes = fs.readFileSync(receiptPath);
  receipt = JSON.parse(receiptBytes);
  if (!receipt.task_id || !receipt.attempt_id || !receipt.workspace || !receipt.review_files || !receipt.artifact_check)
    throw new Error('Receipt lacks attempt evidence; use runner 1.3 or later.');
  if (args.taskId && args.taskId !== receipt.task_id) throw new Error('Task ID does not match receipt.');
  if (args.verdict.toLowerCase() === 'pass') {
    if (!['READY_FOR_REVIEW','NEEDS_REVIEW'].includes(receipt.status))
      throw new Error('A rejected attempt cannot be marked pass.');
    for (const [file, expected] of Object.entries({...receipt.review_files, ...receipt.artifact_check.hashes,...receipt.review_evidence,
      ...(receipt.contract_snapshot?.material_pack?{[receipt.artifacts?.material_evidence]:receipt.contract_snapshot.material_pack.sha256}:{})})) {
      if (!expected || fileDigest(file, receipt.workspace) !== expected)
        throw new Error('Reviewed file changed since receipt: ' + file);
    }
    for (const file of receipt.review_deleted || []) {
      if (fs.existsSync(file)) throw new Error('Deleted file was recreated: ' + file);
    }
  }
} catch (err) {
  process.stderr.write('Review rejected: ' + err.message + '\n');
  process.exit(1);
}
const taskId = receipt.task_id;
const verdict = args.verdict.toLowerCase();

// Cap notes to 200 chars and enforce single-line
let sanitizedNotes = '';
if (args.notes && typeof args.notes === 'string') {
  sanitizedNotes = args.notes
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 200);
}

const telemetryEvent = {
  timestamp: new Date().toISOString(),
  event_type: 'semantic_review',
  attempt_id: receipt.attempt_id,
  receipt_path: receiptPath,
  receipt_sha256: digest(receiptBytes),
  task_id: taskId,
  verdict: verdict,
  notes: sanitizedNotes
};

try {
  const telemetryPath = process.env.AGY_TELEMETRY_PATH || path.join(os.homedir(), '.config', 'agy-worker', 'telemetry.jsonl');
  const telemetryDir = path.dirname(telemetryPath);
  if (!fs.existsSync(telemetryDir)) {
    fs.mkdirSync(telemetryDir, { recursive: true });
  }
  fs.appendFileSync(telemetryPath, JSON.stringify(telemetryEvent) + '\n', 'utf-8');
  if(receipt.journal_path){
    try{
      const expected=journalPath(stateContext(receipt.workspace),receipt.attempt_id);
      if(path.resolve(receipt.journal_path)!==expected)throw new Error('Journal path mismatch.');
      const j=readJournal(expected);
      if(j.receipt_sha256!==digest(receiptBytes)||j.attempt_id!==receipt.attempt_id)throw new Error('Journal receipt mismatch.');
      saveJournal(expected,{...j,review:{verdict,at:telemetryEvent.timestamp,receipt_sha256:digest(receiptBytes)}});
    }catch{process.stderr.write('Review recorded in telemetry; journal review update unavailable.\n');}
  }

  process.stdout.write(JSON.stringify({
    recorded: true,
    attempt_id: receipt.attempt_id,
    task_id: taskId,
    verdict: verdict
  }, null, 2) + '\n');
} catch (err) {
  process.stderr.write(`Error recording review: ${err.message}\n`);
  process.exit(1);
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--task-id') {
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

if (!args.taskId || typeof args.taskId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(args.taskId.trim())) {
  process.stderr.write('Error: --task-id must use only letters, numbers, dash, and underscore.\n');
  process.exit(1);
}

const validVerdicts = ['pass', 'retry', 'takeover'];
if (!args.verdict || !validVerdicts.includes(args.verdict.toLowerCase())) {
  process.stderr.write(`Error: Invalid or missing --verdict. Must be one of: ${validVerdicts.join(', ')}.\n`);
  process.exit(1);
}

const taskId = args.taskId.trim();
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

  process.stdout.write(JSON.stringify({
    recorded: true,
    task_id: taskId,
    verdict: verdict
  }, null, 2) + '\n');
} catch (err) {
  process.stderr.write(`Error recording review: ${err.message}\n`);
  process.exit(1);
}

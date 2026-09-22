#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {VERSION} from './version.mjs';

const commands = Object.freeze({
  prepare:'prepare-task.mjs', run:'invoke-agy-task.mjs', retry:'prepare-retry.mjs',
  state:'task-state.mjs', review:'record-review.mjs', stats:'task-stats.mjs',
  pack:'material-pack.mjs', inspect:'review-pack.mjs', handoff:'handoff.mjs'
});
export function resolveCommand(command) {
  if (!Object.hasOwn(commands,command)) throw new Error('Unknown command. Use --help.');
  return path.join(path.dirname(fileURLToPath(import.meta.url)),commands[command]);
}
const help = `AGY Worker ${VERSION}
Usage: node agy-worker.mjs <command> <arguments>

  pack --spec <sources.json> --out <pack.json>            Collect explicit local evidence
  inspect --receipt <receipt.json>                       Read bounded review summary
  handoff --workspace <directory> --attempt <attempt-id>  Read interruption evidence; no resume
  prepare --brief <brief.json> --out <contract.json>       Prepare only
  run --contract <contract.json> [--agy-path <CLI>]       Executes Gemini
  retry --receipt <receipt.json> --feedback-file <txt> --out <retry.json>
                                                         Prepare only; no retry consumed
  state --workspace <directory>                         Read coordination state
  review --receipt <receipt.json> --verdict pass|retry|takeover [--notes <text>]
                                                         Record Codex review, no dispatch
  stats [--telemetry <jsonl>] [--since YYYY-MM-DD] [--task-type <type>]
                                                         Read local aggregates, no model

Run exits: 0 ready for review, 2 needs review, 3 rejected, 1 runner error.
Other commands: 0 completed, 1 error. Code 0 is not semantic approval.
All existing scripts remain usable. No shell, global installation or settings changes.
`;
async function main() {
  const [command,...args] = process.argv.slice(2);
  if ((!command || command==='--help' || command==='help') && !args.length) {
    process.stdout.write(help); return;
  }
  if (command==='--version' && !args.length) {process.stdout.write(VERSION+'\n'); return;}
  const target = resolveCommand(command);
  // Execute in the same Node process, preserving the runner's Job Object and lock
  // lifecycle. No shell quoting, extra supervisor, output buffering or exit remap.
  process.argv = [process.execPath,target,...args];
  await import(pathToFileURL(target).href);
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}

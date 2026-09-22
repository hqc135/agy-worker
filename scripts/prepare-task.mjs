#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateContract} from './invoke-agy-task.mjs';

export function prepareContract(brief) {
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) throw new Error('Brief must be a JSON object.');
  const fields = ['workspace','task_id','task_type','goal','allowed_files','read_scope','acceptance_commands',
    'forbidden_actions','max_changed_files','required_artifacts','task_details','model','timeout','acceptance_timeout','restrict_tools','mode','material_pack'];
  for (const key of Object.keys(brief)) if (!fields.includes(key)) throw new Error('Unknown brief field: ' + key);
  if (typeof brief.workspace !== 'string' || !path.isAbsolute(brief.workspace)) throw new Error('Brief workspace must be absolute.');
  const workspace = fs.realpathSync.native(brief.workspace);
  const taskId = brief.task_id ?? ('task-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
  const allowed = brief.allowed_files ?? [];
  if (!Array.isArray(allowed) || !allowed.every(item => typeof item === 'string' && item.length))
    throw new Error('allowed_files must be a string array.');
  const broad = allowed.some(item => /[*?[]/.test(item) || (fs.existsSync(path.resolve(workspace,item)) && fs.statSync(path.resolve(workspace,item)).isDirectory()));
  if (broad && brief.max_changed_files === undefined) throw new Error('Directory/glob scope requires explicit max_changed_files.');
  const contract = {
    ...brief, version:'v1', task_id:taskId, workspace,
    allowed_files:allowed, read_scope:brief.read_scope ?? [...allowed],
    acceptance_commands:brief.acceptance_commands ?? [],
    forbidden_actions:brief.forbidden_actions ?? ['Do not commit, reset, push, install software or modify global settings.'],
    max_changed_files:brief.max_changed_files ?? allowed.length,
    required_artifacts:brief.required_artifacts ?? (brief.task_type === 'documentation' ? ['draft.md'] : brief.task_type === 'investigation' ? ['evidence.md'] : []),
    artifact_dir:path.join(workspace,'.agy-artifacts',taskId), return_mode:'compact'
  };
  validateContract(contract);
  return contract;
}
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--brief' || args[2] !== '--out')
    throw new Error('Usage: node prepare-task.mjs --brief brief.json --out contract.json');
  const contract = prepareContract(JSON.parse(fs.readFileSync(args[1],'utf8')));
  const output = path.resolve(args[3]);
  // Never overwrite an existing contract or create project settings implicitly.
  fs.writeFileSync(output, JSON.stringify(contract,null,2)+'\n', {flag:'wx'});
  process.stdout.write(JSON.stringify({contract_path:output, task_id:contract.task_id, task_type:contract.task_type,
    allowed_files:contract.allowed_files, required_artifacts:contract.required_artifacts,
    model:contract.model ?? 'gemini-3.8-flash-high', executes_worker:false})+'\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {main();} catch (error) {process.stderr.write(error.message+'\n');process.exitCode=1;}
}

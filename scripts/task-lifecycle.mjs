import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
function canonicalFuture(target) {
  let cursor=path.resolve(target);
  const suffix=[];
  while (!fs.existsSync(cursor)) {
    const parent=path.dirname(cursor);
    if (parent===cursor) break;
    suffix.unshift(path.basename(cursor)); cursor=parent;
  }
  return path.resolve(fs.realpathSync.native(cursor),...suffix);
}
export function stateContext(workspace, stateRoot = process.env.AGY_STATE_DIR || path.join(os.homedir(), '.config', 'agy-worker', 'state')) {
  const realWorkspace = fs.realpathSync.native(workspace);
  const result = spawnSync('git', ['-C', realWorkspace, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    {encoding:'utf8', windowsHide:true, timeout:10000});
  const identity = result.status === 0 ? fs.realpathSync.native(result.stdout.trim()) : realWorkspace;
  const top = spawnSync('git', ['-C',realWorkspace,'rev-parse','--show-toplevel'],
    {encoding:'utf8',windowsHide:true,timeout:10000});
  const repoRoot = top.status===0 ? fs.realpathSync.native(top.stdout.trim()) : realWorkspace;
  const directory = path.join(canonicalFuture(stateRoot), digest(normalize(identity)));
  // State is not worker evidence: never put it inside the workspace or Git metadata.
  for (const base of [realWorkspace, identity, repoRoot]) {
    const relative = path.relative(base, directory);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)))
      throw new Error('AGY_STATE_DIR must be outside the workspace and Git metadata.');
  }
  return {workspace:realWorkspace, identity, directory, lockPath:path.join(directory, 'active.lock')};
}
function createExclusive(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
export function acquireLease(context, taskId) {
  fs.mkdirSync(context.directory, {recursive:true});
  const token = crypto.randomUUID();
  try {
    createExclusive(context.lockPath, {token, pid:process.pid, task_id:taskId,
      workspace:context.workspace, started_at:new Date().toISOString()});
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Workspace busy or interrupted run: ' + context.lockPath +
      '. Use task-state.mjs to inspect; never auto-delete a lock or run a second worker.');
    throw error;
  }
  return () => {
    // Do not remove a lock that has been replaced by someone else.
    const active = JSON.parse(fs.readFileSync(context.lockPath, 'utf8'));
    if (active.token !== token) throw new Error('Workspace lock changed; manual inspection required.');
    fs.unlinkSync(context.lockPath);
  };
}
export function claimRetry(context, prior, attemptId) {
  if (!prior.attempt_id || !prior.task_id || !prior.workspace) throw new Error('Retry receipt lacks original attempt identity.');
  const retryKey = digest(JSON.stringify([normalize(fs.realpathSync.native(prior.workspace)), prior.task_id, prior.attempt_id]));
  const directory = path.join(context.directory, 'retries');
  fs.mkdirSync(directory, {recursive:true});
  const file = path.join(directory, retryKey + '.json');
  try {
    createExclusive(file, {parent_attempt_id:prior.attempt_id, attempt_id:attemptId,
      task_id:prior.task_id, claimed_at:new Date().toISOString()});
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Retry budget exhausted: original attempt already has a retry claim.');
    throw error;
  }
  return file;
}
export function inspectState(context) {
  let active = null;
  try { active = JSON.parse(fs.readFileSync(context.lockPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') active = {unreadable:true}; }
  const directory = path.join(context.directory, 'retries');
  const retryClaims = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).length : 0;
  return {workspace:context.workspace, lock_path:context.lockPath, active, retry_claims:retryClaims};
}

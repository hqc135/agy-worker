#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--contract') {
      parsed.contract = args[++i];
      if (!parsed.contract) throw new Error('Missing value for --contract.');
    } else if (arg.startsWith('--contract=')) {
      parsed.contract = arg.slice('--contract='.length);
    } else if (arg === '--agy-path') {
      parsed.agyPath = args[++i];
      if (!parsed.agyPath) throw new Error('Missing value for --agy-path.');
    } else if (arg.startsWith('--agy-path=')) {
      parsed.agyPath = arg.slice('--agy-path='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function normalizePath(p) {
  const normalized = path.resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInsideDir(child, parent) {
  const nChild = normalizePath(child);
  const nParent = normalizePath(parent).replace(/\/+$/, '');
  return nChild === nParent || nChild.startsWith(nParent + '/');
}

function resolveForContainment(targetPath) {
  let cursor = path.resolve(targetPath);
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const realBase = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
  return path.resolve(realBase, ...suffix);
}

function tokenizeCommandLine(cmdLine) {
  const tokens = [];
  let current = '';
  let tokenStarted = false;
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escaped = false;

  for (let i = 0; i < cmdLine.length; i++) {
    const char = cmdLine[i];

    if (escaped) {
      current += char;
      tokenStarted = true;
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      if (i + 1 < cmdLine.length && (cmdLine[i + 1] === '"' || cmdLine[i + 1] === '\\')) {
        escaped = true;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      tokenStarted = true;
      continue;
    }

    if (char === '\'' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char) && !inDoubleQuote && !inSingleQuote) {
      if (tokenStarted) {
        tokens.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (escaped || inDoubleQuote || inSingleQuote) {
    throw new Error('Unterminated quote or escape in command string.');
  }
  if (tokenStarted) {
    tokens.push(current);
  }

  return tokens;
}

function normalizeAcceptanceCommand(value, defaultTimeout) {
  if (typeof value === 'string') {
    const tokens = tokenizeCommandLine(value);
    return { display: value, executable: tokens[0] || '', args: tokens.slice(1), timeout: defaultTimeout };
  }
  return {
    display: [value.executable, ...value.args].join(' '),
    executable: value.executable,
    args: value.args,
    timeout: value.timeout || defaultTimeout
  };
}

function resolveExecutable(cmd, cwd) {
  if (path.isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) {
    const absPath = path.resolve(cwd, cmd);
    if (fs.existsSync(absPath)) return absPath;
    if (process.platform === 'win32') {
      const pathext = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';');
      for (const ext of pathext) {
        const withExt = absPath + ext;
        if (fs.existsSync(withExt)) return withExt;
      }
    }
    return absPath;
  }

  if (process.platform === 'win32') {
    const pathext = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.toLowerCase());
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    const hasExt = pathext.some(ext => cmd.toLowerCase().endsWith(ext));

    for (const dir of pathDirs) {
      if (!dir) continue;
      if (hasExt) {
        const full = path.join(dir, cmd);
        if (fs.existsSync(full)) return full;
      } else {
        for (const ext of pathext) {
          const full = path.join(dir, cmd + ext);
          if (fs.existsSync(full)) return full;
        }
      }
    }
  }

  return cmd;
}

function getPowerShellExecutable() {
  const pwsh = resolveExecutable('pwsh', process.cwd());
  if (pwsh !== 'pwsh' && fs.existsSync(pwsh)) {
    return pwsh;
  }
  if (process.platform === 'win32') {
    const powershell = resolveExecutable('powershell', process.cwd());
    if (powershell !== 'powershell' && fs.existsSync(powershell)) {
      return powershell;
    }
  }
  return 'pwsh';
}

function spawnAcceptance(executable, commandArgs, options) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const psLiteral = value => `'${String(value).replace(/'/g, "''")}'`;
    const script = `& ${psLiteral(executable)} ${commandArgs.map(psLiteral).join(' ')}; exit $LASTEXITCODE`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return spawnSync(getPowerShellExecutable(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], options);
  }
  return spawnSync(executable, commandArgs, options);
}

function validateContract(contract) {
  if (!contract || typeof contract !== 'object') {
    throw new Error('Contract must be a valid JSON object.');
  }

  if (contract.version !== 'v1') {
    throw new Error(`Contract version must be 'v1', got '${contract.version}'.`);
  }

  if (!contract.task_id || typeof contract.task_id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(contract.task_id)) {
    throw new Error(`Invalid task_id: '${contract.task_id}'. Must be non-empty alphanumeric with dash/underscore.`);
  }

  const validTypes = ['implementation', 'test_generation', 'mechanical_edit', 'documentation', 'investigation'];
  if (!validTypes.includes(contract.task_type)) {
    throw new Error(`Invalid task_type: '${contract.task_type}'. Must be one of: ${validTypes.join(', ')}.`);
  }

  if (!contract.goal || typeof contract.goal !== 'string') {
    throw new Error('Contract goal must be a non-empty string.');
  }

  if (!contract.workspace || typeof contract.workspace !== 'string') {
    throw new Error('Contract workspace must be a non-empty string.');
  }

  const resolvedWs = path.resolve(contract.workspace);
  if (!fs.existsSync(resolvedWs) || !fs.statSync(resolvedWs).isDirectory()) {
    throw new Error(`Contract workspace does not exist or is not a directory: ${resolvedWs}`);
  }

  if (!Array.isArray(contract.allowed_files) || !contract.allowed_files.every(item => typeof item === 'string' && item.length > 0)) {
    throw new Error('Contract allowed_files must be an array of strings.');
  }

  if (!Array.isArray(contract.read_scope) || !contract.read_scope.every(item => typeof item === 'string' && item.length > 0)) {
    throw new Error('Contract read_scope must be an array of strings.');
  }

  if (!Array.isArray(contract.acceptance_commands)) {
    throw new Error('Contract acceptance_commands must be an array.');
  }
  for (const item of contract.acceptance_commands) {
    if (typeof item === 'string') {
      if (item.trim().length === 0) throw new Error('Acceptance command strings may not be empty.');
      try { tokenizeCommandLine(item); } catch (err) { throw new Error(`Invalid acceptance command: ${err.message}`); }
      continue;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Each acceptance command must be a string or an object.');
    }
    const unknown = Object.keys(item).filter(key => !['executable', 'args', 'timeout'].includes(key));
    if (unknown.length > 0) throw new Error(`Unknown acceptance command fields: ${unknown.join(', ')}`);
    if (typeof item.executable !== 'string' || item.executable.trim().length === 0) throw new Error('Acceptance command executable must be non-empty.');
    if (!Array.isArray(item.args) || !item.args.every(arg => typeof arg === 'string')) throw new Error('Acceptance command args must be an array of strings.');
    if (item.timeout !== undefined && (typeof item.timeout !== 'string' || !/^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/.test(item.timeout))) {
      throw new Error('Acceptance command timeout must be a valid duration string.');
    }
  }

  if (!Array.isArray(contract.forbidden_actions) || !contract.forbidden_actions.every(item => typeof item === 'string' && item.length > 0)) {
    throw new Error('Contract forbidden_actions must be an array of strings.');
  }

  if (typeof contract.max_changed_files !== 'number' || contract.max_changed_files < 0 || !Number.isInteger(contract.max_changed_files)) {
    throw new Error('Contract max_changed_files must be a non-negative integer.');
  }

  if (!contract.artifact_dir || typeof contract.artifact_dir !== 'string') {
    throw new Error('Contract artifact_dir must be a non-empty string.');
  }

  if (contract.return_mode !== 'compact') {
    throw new Error(`Contract return_mode must be 'compact', got '${contract.return_mode}'.`);
  }

  if (contract.mode && !['accept-edits', 'plan'].includes(contract.mode)) {
    throw new Error(`Invalid mode: '${contract.mode}'. Must be 'accept-edits' or 'plan'.`);
  }
  if (contract.model !== undefined && (typeof contract.model !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(contract.model))) {
    throw new Error('Contract model must be a valid model slug.');
  }
  if (contract.timeout !== undefined && (typeof contract.timeout !== 'string' || !/^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/.test(contract.timeout))) {
    throw new Error('Contract timeout must be a valid duration string.');
  }
  if (contract.acceptance_timeout !== undefined && (typeof contract.acceptance_timeout !== 'string' || !/^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/.test(contract.acceptance_timeout))) {
    throw new Error('Contract acceptance_timeout must be a valid duration string.');
  }
  if (contract.conversation_id !== undefined && (typeof contract.conversation_id !== 'string' || contract.conversation_id.length === 0)) {
    throw new Error('Contract conversation_id must be a non-empty string.');
  }

  const allowedKeys = new Set([
    'version', 'task_id', 'task_type', 'goal', 'workspace', 'allowed_files',
    'read_scope', 'acceptance_commands', 'forbidden_actions',
    'max_changed_files', 'artifact_dir', 'return_mode', 'model', 'mode',
    'timeout', 'acceptance_timeout', 'conversation_id'
  ]);
  const unknownKeys = Object.keys(contract).filter(key => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown contract fields: ${unknownKeys.join(', ')}`);
  }

  const realWs = resolveForContainment(resolvedWs);
  for (const [field, values] of [['allowed_files', contract.allowed_files], ['read_scope', contract.read_scope]]) {
    for (const value of values) {
      const resolved = resolveForContainment(path.resolve(resolvedWs, value));
      if (!isInsideDir(resolved, realWs)) {
        throw new Error(`${field} entry escapes the workspace: ${value}`);
      }
    }
  }

  const resolvedArtifactDir = resolveForContainment(path.resolve(contract.artifact_dir));
  if (!isInsideDir(resolvedArtifactDir, realWs) || normalizePath(resolvedArtifactDir) === normalizePath(realWs)) {
    throw new Error('artifact_dir must be a strict descendant of the workspace, not the workspace root.');
  }
  if (isInsideDir(resolvedArtifactDir, resolveForContainment(path.join(realWs, '.git')))) {
    throw new Error('artifact_dir may not be inside the workspace .git directory.');
  }
}

function validateWorkerManifest(manifest) {
  const errors = [];
  const allowedKeys = new Set(['status', 'summary', 'changed_files', 'commands_run', 'artifacts', 'uncertainties', 'needs_review']);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest must be an object'];
  if (!['completed', 'blocked', 'failed'].includes(manifest.status)) errors.push('invalid status');
  if (typeof manifest.summary !== 'string' || manifest.summary.length > 600) errors.push('summary must be a string of at most 600 characters');
  for (const field of ['changed_files', 'commands_run', 'artifacts', 'uncertainties']) {
    if (!Array.isArray(manifest[field]) || !manifest[field].every(item => typeof item === 'string')) errors.push(`${field} must be an array of strings`);
  }
  if (typeof manifest.needs_review !== 'boolean') errors.push('needs_review must be boolean');
  const unknown = Object.keys(manifest).filter(key => !allowedKeys.has(key));
  if (unknown.length > 0) errors.push(`unknown fields: ${unknown.join(', ')}`);
  return errors;
}

function durationToMs(value) {
  const units = { ns: 1e-6, us: 1e-3, 'µs': 1e-3, ms: 1, s: 1000, m: 60000, h: 3600000 };
  let total = 0;
  const regex = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g;
  let match;
  while ((match = regex.exec(value)) !== null) total += Number(match[1]) * units[match[2]];
  return total > 0 ? Math.ceil(total) : 15 * 60 * 1000;
}

function getFileHash(absPath) {
  try {
    if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
      return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
    }
  } catch {
    return null;
  }
  return null;
}

function getGitSnapshot(repoRoot) {
  const result = spawnSync('git', ['-C', repoRoot, 'status', '--porcelain=v1', '-z', '-uall'], {
    windowsHide: true,
    maxBuffer: 50 * 1024 * 1024
  });

  const snapshot = new Map();
  if (result.status !== 0) {
    return {
      snapshot,
      complete: false,
      reason: `git status failed with exit code ${result.status ?? -1}: ${(result.stderr || '').toString('utf-8').trim().slice(0, 300)}`
    };
  }

  const buf = result.stdout;
  let i = 0;
  while (i < buf.length) {
    const nextNull = buf.indexOf(0, i);
    if (nextNull === -1) break;
    const entryStr = buf.slice(i, nextNull).toString('utf-8');
    i = nextNull + 1;
    if (!entryStr || entryStr.length < 4) continue;

    const statusCode = entryStr.slice(0, 2);
    const filePath = entryStr.slice(3);

    if (statusCode.includes('R') || statusCode.includes('C')) {
      const secondNull = buf.indexOf(0, i);
      if (secondNull !== -1) {
        const sourcePath = buf.slice(i, secondNull).toString('utf-8');
        const sourceAbsPath = path.resolve(repoRoot, sourcePath);
        snapshot.set(normalizePath(sourceAbsPath), {
          relPath: sourcePath,
          absPath: sourceAbsPath,
          statusCode: 'D ',
          hash: null
        });
        i = secondNull + 1;
      }
    }

    const absPath = path.resolve(repoRoot, filePath);
    const fileHash = getFileHash(absPath);

    snapshot.set(normalizePath(absPath), {
      relPath: filePath,
      absPath: absPath,
      statusCode: statusCode,
      hash: fileHash
    });
  }

  return { snapshot, complete: true, reason: null };
}

function getGitHead(repoRoot) {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf-8',
    windowsHide: true
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function getGitHistoryFingerprint(repoRoot) {
  const commands = [
    ['for-each-ref', '--format=%(refname)%00%(objectname)'],
    ['reflog', 'show', '--all', '--format=%H%x00%gD%x00%gs']
  ];
  const hash = crypto.createHash('sha256');
  for (const args of commands) {
    const result = spawnSync('git', ['-C', repoRoot, ...args], {
      windowsHide: true,
      maxBuffer: 50 * 1024 * 1024
    });
    if (result.status !== 0) return null;
    hash.update(result.stdout);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function getIgnoredSnapshot(repoRoot, artifactDir) {
  const result = spawnSync('git', ['-C', repoRoot, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard'], {
    windowsHide: true,
    maxBuffer: 100 * 1024 * 1024
  });
  const snapshot = new Map();
  if (result.status !== 0) {
    return { snapshot, complete: false, reason: 'Git ignored-file enumeration failed.' };
  }

  const items = result.stdout.toString('utf-8').split('\0').filter(item => {
    if (!item) return false;
    const absPath = path.resolve(repoRoot, item);
    return !isInsideDir(absPath, artifactDir) && !isInsideDir(absPath, path.join(repoRoot, '.git'));
  });
  const configuredMaxFiles = Number(process.env.AGY_MAX_IGNORED_FILES);
  const configuredMaxBytes = Number(process.env.AGY_MAX_IGNORED_BYTES);
  const maxFiles = Number.isInteger(configuredMaxFiles) && configuredMaxFiles > 0 ? configuredMaxFiles : 10000;
  const maxBytes = Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0 ? configuredMaxBytes : 256 * 1024 * 1024;
  if (items.length >= maxFiles) {
    return { snapshot, complete: false, reason: `Ignored-file snapshot reached the ${maxFiles}-file safety limit.` };
  }

  let totalBytes = 0;
  for (const item of items) {
    const absPath = path.resolve(repoRoot, item);
    try {
      const stat = fs.statSync(absPath);
      if (stat.isFile()) totalBytes += stat.size;
    } catch {
      return { snapshot, complete: false, reason: `Ignored file could not be inspected: ${item}` };
    }
    if (totalBytes > maxBytes) {
      return { snapshot: new Map(), complete: false, reason: `Ignored-file snapshot exceeded the ${maxBytes}-byte safety limit.` };
    }
  }

  for (const item of items) {
    const absPath = path.resolve(repoRoot, item);
    const hash = getFileHash(absPath);
    if (hash === null) {
      return { snapshot: new Map(), complete: false, reason: `Ignored file could not be hashed: ${item}` };
    }
    snapshot.set(normalizePath(absPath), {
      relPath: item,
      absPath,
      statusCode: '!!',
      hash
    });
  }
  return { snapshot, complete: true, reason: null };
}

function getDiffStats(repoRoot, touchedFiles) {
  let insertions = 0;
  let deletions = 0;
  if (touchedFiles.length > 0) {
    const relativePaths = touchedFiles.map(file => path.relative(repoRoot, file));
    const result = spawnSync('git', ['-C', repoRoot, 'diff', 'HEAD', '--numstat', '--', ...relativePaths], {
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024
    });
    if (result.status === 0) {
      for (const line of result.stdout.split(/\r?\n/)) {
        const [added, removed] = line.split(/\s+/, 2);
        if (/^\d+$/.test(added)) insertions += Number(added);
        if (/^\d+$/.test(removed)) deletions += Number(removed);
      }
    }
    for (const relativePath of relativePaths) {
      const tracked = spawnSync('git', ['-C', repoRoot, 'ls-files', '--error-unmatch', '--', relativePath], {
        windowsHide: true,
        stdio: 'ignore'
      });
      const absPath = path.resolve(repoRoot, relativePath);
      if (tracked.status !== 0 && fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
        const content = fs.readFileSync(absPath);
        if (!content.includes(0)) {
          const text = content.toString('utf-8');
          insertions += text.length === 0 ? 0 : text.split(/\r?\n/).length;
        }
      }
    }
  }
  return { files_changed: touchedFiles.length, insertions, deletions };
}

function minimatchSimple(str, pattern) {
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const normalizedStr = str.replace(/\\/g, '/');
  let regexStr = '^';
  for (let i = 0; i < normalizedPattern.length; i++) {
    const char = normalizedPattern[i];
    if (char === '*') {
      if (normalizedPattern[i + 1] === '*') {
        if (normalizedPattern[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 2;
        } else {
          regexStr += '.*';
          i++;
        }
      } else {
        regexStr += '[^/]*';
      }
    } else {
      regexStr += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  regexStr += '$';
  try {
    return new RegExp(regexStr, process.platform === 'win32' ? 'i' : '').test(normalizedStr);
  } catch {
    return false;
  }
}

function isPathAllowed(absFile, allowedList, workspace) {
  const normFile = normalizePath(absFile);
  for (const item of allowedList) {
    const resolvedItem = path.isAbsolute(item) ? path.resolve(item) : path.resolve(workspace, item);
    const normItem = normalizePath(resolvedItem);

    if (normFile === normItem) return true;

    if (normFile.startsWith(normItem.endsWith('/') ? normItem : normItem + '/')) return true;

    if (item.includes('*')) {
      const rel = path.relative(workspace, absFile).replace(/\\/g, '/');
      if (minimatchSimple(rel, item)) return true;
    }
  }
  return false;
}

function extractJsonManifest(responseText) {
  if (!responseText || typeof responseText !== 'string') return null;
  const trimmed = responseText.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  return null;
}

function appendTelemetry(telemetryEvent) {
  try {
    const telemetryPath = process.env.AGY_TELEMETRY_PATH || path.join(os.homedir(), '.config', 'agy-worker', 'telemetry.jsonl');
    const telemetryDir = path.dirname(telemetryPath);
    if (!fs.existsSync(telemetryDir)) {
      fs.mkdirSync(telemetryDir, { recursive: true });
    }
    fs.appendFileSync(telemetryPath, JSON.stringify(telemetryEvent) + '\n', 'utf-8');
  } catch (err) {
    process.stderr.write(`[agy-worker] Warning: Failed to record telemetry: ${err.message}\n`);
  }
}

function truncateText(value, maxLength) {
  const text = String(value ?? '');
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function compactList(items, maxItems, maxLength = 240) {
  return {
    items: items.slice(0, maxItems).map(item => typeof item === 'string' ? truncateText(item, maxLength) : item),
    omitted: Math.max(0, items.length - maxItems)
  };
}

function emitCompactReceipt(receipt, fallback) {
  const encoded = JSON.stringify(receipt, null, 2) + '\n';
  if (Buffer.byteLength(encoded, 'utf-8') <= 16 * 1024) {
    process.stdout.write(encoded);
    return;
  }
  process.stdout.write(JSON.stringify(fallback, null, 2) + '\n');
}

async function main() {
  const startTime = Date.now();
  const args = parseArgs(process.argv.slice(2));

  if (!args.contract) {
    process.stderr.write('Error: Missing required --contract <path> parameter.\n');
    process.exit(1);
  }

  const contractPath = path.resolve(process.cwd(), args.contract);
  if (!fs.existsSync(contractPath)) {
    process.stderr.write(`Error: Contract file not found: ${contractPath}\n`);
    process.exit(1);
  }

  let contract;
  try {
    const rawContract = fs.readFileSync(contractPath, 'utf-8');
    contract = JSON.parse(rawContract);
    validateContract(contract);
  } catch (err) {
    process.stderr.write(`Error parsing contract: ${err.message}\n`);
    process.exit(1);
  }

  const workspace = path.resolve(contract.workspace);
  contract.workspace = workspace;
  const artifactBaseDir = path.resolve(contract.artifact_dir);
  const attemptId = `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const artifactDir = path.join(artifactBaseDir, attemptId);
  fs.mkdirSync(artifactDir, { recursive: true });

  // 1. Snapshot Git Worktree state before worker run
  let isGitRepo = false;
  let repoRoot = null;
  const gitCheck = spawnSync('git', ['-C', workspace, 'rev-parse', '--is-inside-work-tree'], {
    windowsHide: true,
    encoding: 'utf-8'
  });
  if (gitCheck.status === 0 && gitCheck.stdout.trim() === 'true') {
    isGitRepo = true;
    const toplevel = spawnSync('git', ['-C', workspace, 'rev-parse', '--show-toplevel'], {
      windowsHide: true,
      encoding: 'utf-8'
    });
    if (toplevel.status === 0) {
      repoRoot = path.resolve(toplevel.stdout.trim());
    } else {
      repoRoot = workspace;
    }
  }

  let snapshotBefore = new Map();
  let snapshotBeforeComplete = true;
  let snapshotBeforeReason = null;
  let ignoredSnapshotBefore = new Map();
  let ignoredSnapshotBeforeComplete = true;
  let ignoredSnapshotBeforeReason = null;
  let headBefore = null;
  let historyFingerprintBefore = null;
  if (isGitRepo && repoRoot) {
    const visibleBeforeResult = getGitSnapshot(repoRoot);
    snapshotBefore = visibleBeforeResult.snapshot;
    snapshotBeforeComplete = visibleBeforeResult.complete;
    snapshotBeforeReason = visibleBeforeResult.reason;
    const ignoredBeforeResult = getIgnoredSnapshot(repoRoot, artifactBaseDir);
    ignoredSnapshotBefore = ignoredBeforeResult.snapshot;
    ignoredSnapshotBeforeComplete = ignoredBeforeResult.complete;
    ignoredSnapshotBeforeReason = ignoredBeforeResult.reason;
    headBefore = getGitHead(repoRoot);
    historyFingerprintBefore = getGitHistoryFingerprint(repoRoot);
  }

  // 2. Build worker prompt
  const allowedListDisplay = contract.allowed_files.length > 0
    ? contract.allowed_files.map(f => `  - ${f}`).join('\n')
    : '  (None - Read-only task)';
  const readScopeDisplay = contract.read_scope.length > 0
    ? contract.read_scope.map(f => `  - ${f}`).join('\n')
    : '  (None specified)';
  const forbiddenDisplay = contract.forbidden_actions.map(f => `  - ${f}`).join('\n');

  const promptText = `TASK CONTRACT V1 EXECUTION
Task ID: ${contract.task_id}
Task Type: ${contract.task_type}
Goal: ${contract.goal}

Workspace: ${contract.workspace}

Allowed Files to modify:
${allowedListDisplay}

Read Scope:
${readScopeDisplay}

Forbidden Actions:
${forbiddenDisplay}
- Never create a replacement project/repo, commit, push, reset, clean, revert user changes, or install global software.

Artifact Directory: ${artifactDir}

OUTPUT INSTRUCTIONS:
1. Complete the task goal within the specified allowed files and read scope.
2. Write any verbose logs, investigation analysis, diffs, research data, or intermediate outputs into files inside the artifact directory: ${artifactDir}
3. Do NOT output verbose text, full files, or long logs in your response.
4. Return ONLY a compact JSON manifest conforming to the worker manifest schema.`;
  const workerPrompt = promptText;

  // 3. Call invoke-agy.ps1 without shell interpolation
  const invokeAgyPs1Path = path.resolve(__dirname, 'invoke-agy.ps1');
  const manifestSchemaPath = path.resolve(__dirname, '..', 'references', 'worker-manifest.schema.json');
  const psExe = getPowerShellExecutable();

  const psArgs = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', invokeAgyPs1Path,
    '-Workspace', contract.workspace,
    '-Prompt', workerPrompt,
    '-JsonSchema', manifestSchemaPath
  ];

  if (contract.model) {
    psArgs.push('-Model', contract.model);
  }
  if (contract.mode) {
    psArgs.push('-Mode', contract.mode);
  }
  if (contract.timeout) {
    psArgs.push('-Timeout', contract.timeout);
  }
  if (contract.conversation_id) {
    psArgs.push('-ConversationId', contract.conversation_id);
  }

  const effectiveAgyPath = args.agyPath || process.env.AGY_PATH;
  if (effectiveAgyPath) {
    psArgs.push('-AgyPath', path.resolve(effectiveAgyPath));
  }

  const agyRun = spawnSync(psExe, psArgs, {
    cwd: contract.workspace,
    encoding: 'utf-8',
    windowsHide: true,
    maxBuffer: 50 * 1024 * 1024,
    timeout: durationToMs(contract.timeout || '15m') + 30000,
    killSignal: 'SIGTERM'
  });

  // 4. Save raw agy JSON result under artifact directory
  const rawAgyArtifactPath = path.join(artifactDir, 'raw-agy-output.json');
  fs.writeFileSync(rawAgyArtifactPath, JSON.stringify({
    exit_code: agyRun.status,
    signal: agyRun.signal,
    stdout: agyRun.stdout || '',
    stderr: agyRun.stderr || ''
  }, null, 2), 'utf-8');

  let agyParsed = null;
  let workerManifest = null;
  let conversationId = contract.conversation_id || null;
  let agySuccess = false;

  try {
    agyParsed = JSON.parse(agyRun.stdout);
    if (agyParsed.conversation_id) {
      conversationId = agyParsed.conversation_id;
    }
    agySuccess = agyRun.status === 0 && agyParsed.status === 'SUCCESS';

    if (agyParsed.structured_output && typeof agyParsed.structured_output === 'object' && !Array.isArray(agyParsed.structured_output)) {
      // Official agy may add its own toolAction/toolSummary fields to the raw
      // textual response while exposing the schema-clean object here.
      workerManifest = agyParsed.structured_output;
    } else if (agyParsed.response) {
      if (typeof agyParsed.response === 'string') {
        workerManifest = extractJsonManifest(agyParsed.response);
        if (!workerManifest) {
          workerManifest = {
            status: 'failed',
            summary: 'Worker response could not be parsed as JSON manifest.',
            changed_files: [],
            commands_run: [],
            artifacts: [],
            uncertainties: ['Malformed response from worker model.'],
            needs_review: true
          };
        }
      } else if (typeof agyParsed.response === 'object') {
        workerManifest = agyParsed.response;
      }
    }
    const manifestErrors = validateWorkerManifest(workerManifest);
    if (manifestErrors.length > 0) {
      workerManifest = {
        status: 'failed',
        summary: 'Worker returned a manifest that failed local schema validation.',
        changed_files: [],
        commands_run: [],
        artifacts: [],
        uncertainties: manifestErrors.map(error => `Manifest validation: ${error}`),
        needs_review: true
      };
      agySuccess = false;
    }
  } catch (parseErr) {
    agySuccess = false;
    workerManifest = {
      status: 'failed',
      summary: `Agy wrapper failed or returned invalid JSON (exit code ${agyRun.status ?? -1}). See the raw output artifact.`,
      changed_files: [],
      commands_run: [],
      artifacts: [],
      uncertainties: ['Agy execution failed or returned invalid JSON.'],
      needs_review: true
    };
  }

  if (workerManifest) {
    const workerManifestPath = path.join(artifactDir, 'worker-manifest.json');
    fs.writeFileSync(workerManifestPath, JSON.stringify(workerManifest, null, 2), 'utf-8');
  }

  // 5. Snapshot Git Worktree state after worker and verify scope
  const touchedFiles = [];
  const preExistingDirty = [];
  const preExistingDirtyTouched = [];
  const scopeViolations = [];
  let scopeDeterministic = true;

  const isWriteTask = contract.allowed_files.length > 0 || contract.task_type !== 'investigation';

  const recomputeScope = () => {
    touchedFiles.length = 0;
    preExistingDirty.length = 0;
    preExistingDirtyTouched.length = 0;
    scopeViolations.length = 0;
    scopeDeterministic = true;

    if (!isGitRepo || !repoRoot) {
      scopeDeterministic = false;
      scopeViolations.push(`Workspace is not a Git repository; deterministic scope verification unavailable for ${isWriteTask ? 'write' : 'read-only'} tasks.`);
      return;
    }

    const visibleAfterResult = getGitSnapshot(repoRoot);
    const snapshotAfter = visibleAfterResult.snapshot;
    const ignoredAfterResult = getIgnoredSnapshot(repoRoot, artifactBaseDir);
    const ignoredSnapshotAfter = ignoredAfterResult.snapshot;
    const combinedBefore = new Map();
    const combinedAfter = new Map();
    if (snapshotBeforeComplete && visibleAfterResult.complete) {
      for (const entry of snapshotBefore) combinedBefore.set(...entry);
      for (const entry of snapshotAfter) combinedAfter.set(...entry);
    }
    if (ignoredSnapshotBeforeComplete && ignoredAfterResult.complete) {
      for (const entry of ignoredSnapshotBefore) combinedBefore.set(...entry);
      for (const entry of ignoredSnapshotAfter) combinedAfter.set(...entry);
    }
    const headAfter = getGitHead(repoRoot);
    const historyFingerprintAfter = getGitHistoryFingerprint(repoRoot);

    if (!snapshotBeforeComplete || !visibleAfterResult.complete) {
      scopeDeterministic = false;
      const reason = snapshotBeforeReason || visibleAfterResult.reason || 'Git-visible snapshot was incomplete.';
      scopeViolations.push(`Full deterministic scope verification unavailable: ${reason}`);
    }
    if (!ignoredSnapshotBeforeComplete || !ignoredAfterResult.complete) {
      scopeDeterministic = false;
      const reason = ignoredSnapshotBeforeReason || ignoredAfterResult.reason || 'Ignored-file snapshot was incomplete.';
      scopeViolations.push(`Full deterministic scope verification unavailable: ${reason}`);
    }
    if (historyFingerprintBefore === null || historyFingerprintAfter === null) {
      scopeDeterministic = false;
      scopeViolations.push('Full deterministic scope verification unavailable: Git refs/reflog could not be fingerprinted.');
    }

    if (headBefore !== headAfter) {
      scopeViolations.push('Git HEAD changed during execution; commits and history changes are forbidden.');
    }
    if (historyFingerprintBefore !== historyFingerprintAfter) {
      scopeViolations.push('Git refs or reflog changed during execution; commit, reset, branch, tag, stash, and history operations are forbidden.');
    }

    for (const [normPath, afterEntry] of combinedAfter.entries()) {
      if (isInsideDir(afterEntry.absPath, artifactBaseDir)) continue;
      const beforeEntry = combinedBefore.get(normPath);
      if (!beforeEntry) {
        touchedFiles.push(afterEntry.absPath);
      } else if (beforeEntry.hash !== afterEntry.hash || beforeEntry.statusCode !== afterEntry.statusCode) {
        touchedFiles.push(afterEntry.absPath);
        if (snapshotBefore.has(normPath)) preExistingDirtyTouched.push(afterEntry.absPath);
      } else if (snapshotBefore.has(normPath)) {
        preExistingDirty.push(afterEntry.absPath);
      }
    }

    for (const [normPath, beforeEntry] of combinedBefore.entries()) {
      if (isInsideDir(beforeEntry.absPath, artifactBaseDir)) continue;
      if (!combinedAfter.has(normPath)) {
        touchedFiles.push(beforeEntry.absPath);
        if (snapshotBefore.has(normPath)) preExistingDirtyTouched.push(beforeEntry.absPath);
      }
    }

    const uniqueTouched = [...new Map(touchedFiles.map(file => [normalizePath(file), file])).values()];
    touchedFiles.splice(0, touchedFiles.length, ...uniqueTouched);
    const uniqueDirtyTouched = [...new Map(preExistingDirtyTouched.map(file => [normalizePath(file), file])).values()];
    preExistingDirtyTouched.splice(0, preExistingDirtyTouched.length, ...uniqueDirtyTouched);

    for (const touched of touchedFiles) {
      if (!isPathAllowed(touched, contract.allowed_files, contract.workspace)) {
        const displayPath = path.relative(contract.workspace, touched).replace(/\\/g, '/');
        scopeViolations.push(`Unauthorized file modified: ${displayPath}`);
      }
    }

    if (touchedFiles.length > contract.max_changed_files) {
      scopeViolations.push(`Changed files count (${touchedFiles.length}) exceeds max_changed_files (${contract.max_changed_files}).`);
    }
  };

  // 6. Independently run acceptance_commands after worker
  const acceptanceResults = [];
  let acceptanceAllPassed = true;

  for (let idx = 0; idx < contract.acceptance_commands.length; idx++) {
    const commandSpec = normalizeAcceptanceCommand(contract.acceptance_commands[idx], contract.acceptance_timeout || '5m');
    const cmdStr = commandSpec.display;
    const logPath = path.join(artifactDir, `acceptance-cmd-${idx + 1}.log`);

    if (!commandSpec.executable) {
      acceptanceResults.push({
        command: cmdStr,
        exit_code: -1,
        status: 'FAIL',
        log_path: logPath
      });
      acceptanceAllPassed = false;
      fs.writeFileSync(logPath, `Command: ${cmdStr}\nExit Code: -1\nError: Empty command string.\n`, 'utf-8');
      continue;
    }

    const cmdExe = resolveExecutable(commandSpec.executable, contract.workspace);
    const cmdArgs = commandSpec.args;

    const cmdStart = Date.now();
    const cmdRun = spawnAcceptance(cmdExe, cmdArgs, {
      cwd: contract.workspace,
      encoding: 'utf-8',
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      timeout: durationToMs(commandSpec.timeout)
    });
    const cmdDuration = Date.now() - cmdStart;

    const exitCode = cmdRun.status !== null ? cmdRun.status : -1;
    const passed = exitCode === 0;
    if (!passed) {
      acceptanceAllPassed = false;
    }

    const logContent = [
      `Command: ${cmdStr}`,
      `Resolved Executable: ${cmdExe}`,
      `Exit Code: ${exitCode}`,
      `Duration: ${cmdDuration}ms`,
      '--- STDOUT ---',
      cmdRun.stdout || '',
      '--- STDERR ---',
      cmdRun.stderr || '',
      cmdRun.error ? `--- PROCESS ERROR ---\n${cmdRun.error.code || cmdRun.error.message}` : ''
    ].join('\n');

    fs.writeFileSync(logPath, logContent, 'utf-8');

    acceptanceResults.push({
      command: cmdStr,
      exit_code: exitCode,
      status: passed ? 'PASS' : 'FAIL',
      log_path: logPath
    });
  }

  // Acceptance commands are part of the execution boundary. Re-snapshot after
  // they finish so their side effects cannot bypass allowed_files or history gates.
  recomputeScope();

  // 7. Determine overall status
  const scopePassed = scopeViolations.length === 0 && scopeDeterministic;
  const manifestCompleted = workerManifest && workerManifest.status === 'completed';

  let overallStatus = 'READY_FOR_REVIEW';
  let needsReview = false;

  if (!agySuccess || !manifestCompleted || !scopePassed || !acceptanceAllPassed) {
    overallStatus = 'REJECTED';
    if (agySuccess && manifestCompleted && acceptanceAllPassed && !scopeDeterministic && scopeViolations.length > 0 && scopeViolations.every(v => v.includes('deterministic scope verification unavailable'))) {
      overallStatus = 'NEEDS_REVIEW';
      needsReview = true;
    }
  } else if (workerManifest.needs_review || (workerManifest.uncertainties && workerManifest.uncertainties.length > 0)) {
    overallStatus = 'NEEDS_REVIEW';
    needsReview = true;
  }

  if (overallStatus === 'READY_FOR_REVIEW' && preExistingDirtyTouched.length > 0) {
    overallStatus = 'NEEDS_REVIEW';
    needsReview = true;
  }

  if (workerManifest && workerManifest.needs_review) {
    needsReview = true;
  }

  const diffStats = isGitRepo && repoRoot
    ? getDiffStats(repoRoot, [...new Set(touchedFiles)])
    : { files_changed: touchedFiles.length, insertions: 0, deletions: 0 };

  // 8. Write full receipt JSON artifact
  const receiptArtifactPath = path.join(artifactDir, 'receipt.json');
  const fullReceipt = {
    version: 'v1',
    task_id: contract.task_id,
    attempt_id: attemptId,
    task_type: contract.task_type,
    status: overallStatus,
    goal: contract.goal,
    conversation_id: conversationId,
    summary: workerManifest ? workerManifest.summary : 'No summary available',
    scope_check: {
      passed: scopePassed,
      deterministic: scopeDeterministic,
      touched_files: touchedFiles.map(f => path.relative(contract.workspace, f).replace(/\\/g, '/')),
      pre_existing_dirty: preExistingDirty.map(f => path.relative(contract.workspace, f).replace(/\\/g, '/')),
      pre_existing_dirty_touched: preExistingDirtyTouched.map(f => path.relative(contract.workspace, f).replace(/\\/g, '/')),
      allowed_files: contract.allowed_files,
      max_changed_files: contract.max_changed_files,
      violations: scopeViolations
    },
    acceptance_results: acceptanceResults,
    diff: diffStats,
    worker_manifest: workerManifest,
    artifacts: {
      attempt_dir: artifactDir,
      raw_agy_output: rawAgyArtifactPath,
      worker_manifest: path.join(artifactDir, 'worker-manifest.json'),
      receipt: receiptArtifactPath,
      acceptance_logs: acceptanceResults.map(r => r.log_path)
    },
    uncertainties: workerManifest && workerManifest.uncertainties ? workerManifest.uncertainties : [],
    needs_review: needsReview
  };

  fs.writeFileSync(receiptArtifactPath, JSON.stringify(fullReceipt, null, 2), 'utf-8');
  const latestReceiptPath = path.join(artifactBaseDir, 'latest.json');
  fs.writeFileSync(latestReceiptPath, JSON.stringify({
    task_id: contract.task_id,
    attempt_id: attemptId,
    status: overallStatus,
    receipt_path: receiptArtifactPath
  }, null, 2), 'utf-8');

  // 9. Append execution telemetry event (privacy-conscious)
  const durationMs = Date.now() - startTime;
  appendTelemetry({
    timestamp: new Date().toISOString(),
    event_type: 'execution',
    task_id: contract.task_id,
    attempt_id: attemptId,
    task_type: contract.task_type,
    status: overallStatus,
    model: contract.model || 'gemini-3.8-flash-high',
    mode: contract.mode || 'accept-edits',
    duration_ms: durationMs,
    gemini_usage: agyParsed && agyParsed.usage ? {
      input_tokens: agyParsed.usage.input_tokens ?? null,
      output_tokens: agyParsed.usage.output_tokens ?? null,
      thinking_tokens: agyParsed.usage.thinking_tokens ?? null,
      total_tokens: agyParsed.usage.total_tokens ?? null
    } : null,
    changed_files_count: touchedFiles.length,
    acceptance_all_passed: acceptanceAllPassed,
    scope_passed: scopePassed,
    needs_review: needsReview,
    conversation_id: conversationId,
    receipt_path: receiptArtifactPath
  });

  // 10. Write compact receipt to stdout ONLY (never full response)
  const touchedCompact = compactList(touchedFiles.map(f => path.relative(contract.workspace, f).replace(/\\/g, '/')), 20);
  const dirtyTouchedCompact = compactList(preExistingDirtyTouched.map(f => path.relative(contract.workspace, f).replace(/\\/g, '/')), 10);
  const violationsCompact = compactList(scopeViolations, 10, 320);
  const acceptanceCompact = acceptanceResults.slice(0, 8).map(result => ({
    ...result,
    command: truncateText(result.command, 200),
    log_path: truncateText(result.log_path, 500)
  }));
  const compactReceipt = {
    task_id: contract.task_id,
    attempt_id: attemptId,
    status: overallStatus,
    conversation_id: conversationId,
    summary: workerManifest ? workerManifest.summary : 'No summary available',
    scope_check: {
      passed: scopePassed,
      deterministic: scopeDeterministic,
      touched_files: touchedCompact.items,
      touched_files_omitted: touchedCompact.omitted,
      pre_existing_dirty_touched: dirtyTouchedCompact.items,
      pre_existing_dirty_touched_omitted: dirtyTouchedCompact.omitted,
      violations: violationsCompact.items,
      violations_omitted: violationsCompact.omitted
    },
    acceptance_results: acceptanceCompact,
    acceptance_results_omitted: Math.max(0, acceptanceResults.length - acceptanceCompact.length),
    diff: diffStats,
    receipt_path: receiptArtifactPath,
    needs_review: needsReview
  };

  emitCompactReceipt(compactReceipt, {
    task_id: contract.task_id,
    attempt_id: attemptId,
    status: overallStatus,
    summary: truncateText(workerManifest ? workerManifest.summary : 'No summary available', 300),
    receipt_path: receiptArtifactPath,
    compact_receipt_truncated: true,
    needs_review: needsReview
  });
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err.stack || err.message}\n`);
  process.exit(1);
});

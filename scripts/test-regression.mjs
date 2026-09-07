#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DISTINCTIVE_MARKER = 'DISTINCTIVE_LONG_WORKER_RESPONSE_MARKER_987654321_ABCXYZ_SECRET_PAYLOAD';

function runGit(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function getAttemptDir(artifactBaseDir) {
  const latest = JSON.parse(fs.readFileSync(path.join(artifactBaseDir, 'latest.json'), 'utf-8'));
  return path.dirname(latest.receipt_path);
}

async function main() {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-worker-regression-'));
  console.log(`[Test] Using temp directory: ${testDir}`);

  try {
    const fakeAgyScript = path.join(testDir, 'fake-agy.mjs');
    const fakeAgyPs1 = path.join(testDir, 'fake-agy.ps1');
    const telemetryPath = path.join(testDir, 'telemetry.jsonl');
    process.env.AGY_TELEMETRY_PATH = telemetryPath;

    // 1. Create fake agy implementation
    const fakeAgyCode = `
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DISTINCTIVE_MARKER = '${DISTINCTIVE_MARKER}';

let workspace = null;
let printPrompt = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--add-dir' && i + 1 < args.length) {
    workspace = args[i + 1];
  }
  if (args[i] === '--print' && i + 1 < args.length) printPrompt = args[i + 1];
}

const action = process.env.FAKE_AGY_ACTION || 'ALLOWED_EDIT';

if (action === 'ALLOWED_EDIT') {
  if (workspace) {
    const allowedPath = path.join(workspace, 'allowed.txt');
    fs.appendFileSync(allowedPath, '\\n// worker edit', 'utf-8');
  }
  const manifest = {
    status: 'completed',
    summary: 'Successfully updated allowed.txt with verified edits.',
    changed_files: ['allowed.txt'],
    commands_run: ['npm test'],
    artifacts: [],
    uncertainties: [],
    needs_review: false
  };
  const rawResponse = \`Verbose worker reasoning and analysis trace: \${DISTINCTIVE_MARKER}\\n\\n\` + JSON.stringify(manifest);
  console.log(JSON.stringify({
    conversation_id: 'conv-test-123',
    status: 'SUCCESS',
    response: rawResponse
  }));
} else if (action === 'UNEXPECTED_EDIT') {
  if (workspace) {
    const unexpectedPath = path.join(workspace, 'unexpected.txt');
    fs.writeFileSync(unexpectedPath, 'unexpected modification', 'utf-8');
  }
  const manifest = {
    status: 'completed',
    summary: 'Modified unexpected file.',
    changed_files: ['unexpected.txt'],
    commands_run: [],
    artifacts: [],
    uncertainties: [],
    needs_review: false
  };
  console.log(JSON.stringify({
    conversation_id: 'conv-test-123',
    status: 'SUCCESS',
    response: JSON.stringify(manifest)
  }));
} else if (action === 'FAIL_WORKER') {
  console.log(JSON.stringify({
    conversation_id: 'conv-test-123',
    status: 'ERROR',
    response: 'Worker failed to execute task'
  }));
} else if (action === 'COMMIT_CHANGE') {
  fs.appendFileSync(path.join(workspace, 'allowed.txt'), '\\ncommitted worker edit', 'utf-8');
  spawnSync('git', ['add', 'allowed.txt'], { cwd: workspace });
  spawnSync('git', ['commit', '-m', 'forbidden worker commit'], { cwd: workspace });
  console.log(JSON.stringify({
    conversation_id: 'conv-test-commit',
    status: 'SUCCESS',
    response: JSON.stringify({
      status: 'completed', summary: 'Committed an edit.', changed_files: ['allowed.txt'],
      commands_run: [], artifacts: [], uncertainties: [], needs_review: false
    })
  }));
} else if (action === 'COMMIT_RESET') {
  fs.appendFileSync(path.join(workspace, 'allowed.txt'), '\\ncommit-reset worker edit', 'utf-8');
  spawnSync('git', ['add', 'allowed.txt'], { cwd: workspace });
  spawnSync('git', ['commit', '-m', 'temporary forbidden commit'], { cwd: workspace });
  spawnSync('git', ['reset', '--mixed', 'HEAD^'], { cwd: workspace });
  console.log(JSON.stringify({
    conversation_id: 'conv-test-commit-reset',
    status: 'SUCCESS',
    response: JSON.stringify({
      status: 'completed', summary: 'Committed and reset an edit.', changed_files: ['allowed.txt'],
      commands_run: [], artifacts: [], uncertainties: [], needs_review: false
    })
  }));
} else if (action === 'IGNORED_EDIT') {
  fs.appendFileSync(path.join(workspace, 'ignored-state.txt'), '\\nignored worker edit', 'utf-8');
  console.log(JSON.stringify({
    conversation_id: 'conv-test-ignored',
    status: 'SUCCESS',
    response: JSON.stringify({
      status: 'completed', summary: 'Modified an ignored file.', changed_files: ['ignored-state.txt'],
      commands_run: [], artifacts: [], uncertainties: [], needs_review: false
    })
  }));
} else if (action === 'STRUCTURED_OUTPUT') {
  const cleanManifest = {
    status: 'completed', summary: 'Used schema-clean structured output.', changed_files: [],
    commands_run: [], artifacts: [], uncertainties: [], needs_review: false
  };
  console.log(JSON.stringify({
    conversation_id: 'conv-test-structured',
    status: 'SUCCESS',
    response: JSON.stringify({ ...cleanManifest, toolAction: 'extra', toolSummary: 'extra' }),
    structured_output: cleanManifest
  }));
} else if (action === 'GLOB_ROOT_EDIT') {
  fs.appendFileSync(path.join(workspace, 'src', 'a.js'), '\\n// glob root edit', 'utf-8');
  console.log(JSON.stringify({
    conversation_id: 'conv-test-glob', status: 'SUCCESS',
    structured_output: {
      status: 'completed', summary: 'Edited root-level glob match.', changed_files: ['src/a.js'],
      commands_run: [], artifacts: [], uncertainties: [], needs_review: false
    }, response: '{}'
  }));
} else if (action === 'MANY_FILES') {
  const dir = path.join(workspace, 'generated');
  fs.mkdirSync(dir, { recursive: true });
  const changed = [];
  for (let i = 0; i < 40; i++) {
    const rel = 'generated/file-' + String(i).padStart(2, '0') + '.txt';
    fs.writeFileSync(path.join(workspace, rel), 'generated ' + i, 'utf-8');
    changed.push(rel);
  }
  console.log(JSON.stringify({
    conversation_id: 'conv-test-many', status: 'SUCCESS',
    structured_output: {
      status: 'completed', summary: 'Generated forty bounded files.', changed_files: changed,
      commands_run: [], artifacts: [], uncertainties: [], needs_review: false
    }, response: '{}'
  }));
} else if (action === 'HIDE_GIT') {
  fs.renameSync(path.join(workspace, '.git'), path.join(workspace, '.git-hidden'));
  console.log(JSON.stringify({
    conversation_id: 'conv-test-snapshot-failure', status: 'SUCCESS',
    structured_output: {
      status: 'completed', summary: 'Made Git inspection unavailable.', changed_files: [],
      commands_run: [], artifacts: [], uncertainties: [], needs_review: false
    }, response: '{}'
  }));
} else if (action === 'MALFORMED_MANIFEST') {
  console.log(JSON.stringify({
    conversation_id: 'conv-test-malformed',
    status: 'SUCCESS',
    response: JSON.stringify({ status: 'completed', summary: DISTINCTIVE_MARKER, changed_files: [] })
  }));
}
`;
    fs.writeFileSync(fakeAgyScript, fakeAgyCode, 'utf-8');
    fs.writeFileSync(fakeAgyPs1, `node "$PSScriptRoot/fake-agy.mjs" @args\n`, 'utf-8');

    // 2. Set up git workspace
    const gitWorkspace = path.join(testDir, 'workspace-git');
    fs.mkdirSync(gitWorkspace, { recursive: true });
    runGit(['init'], gitWorkspace);
    runGit(['config', 'user.name', 'TestRunner'], gitWorkspace);
    runGit(['config', 'user.email', 'test@example.com'], gitWorkspace);

    const allowedFile = path.join(gitWorkspace, 'allowed.txt');
    fs.writeFileSync(allowedFile, 'initial content', 'utf-8');
    runGit(['add', 'allowed.txt'], gitWorkspace);
    runGit(['commit', '-m', 'initial commit'], gitWorkspace);

    const invokeTaskScript = path.resolve(__dirname, 'invoke-agy-task.mjs');
    const recordReviewScript = path.resolve(__dirname, 'record-review.mjs');

    // =========================================================================
    // Test 1: Allowed edit + passing acceptance command => READY_FOR_REVIEW
    // =========================================================================
    console.log('[Test 1] Testing allowed edit + passing acceptance command...');
    process.env.FAKE_AGY_ACTION = 'ALLOWED_EDIT';
    const artifactDir1 = path.join(gitWorkspace, '.agy-artifacts', 'task-1');

    const contract1 = {
      version: 'v1',
      task_id: 'task-1-pass',
      task_type: 'implementation',
      goal: 'Update allowed.txt properly',
      workspace: gitWorkspace,
      allowed_files: ['allowed.txt'],
      read_scope: ['allowed.txt'],
      acceptance_commands: ['node -e "process.exit(0)"'],
      forbidden_actions: ['modifying files outside allowed_files'],
      max_changed_files: 1,
      artifact_dir: artifactDir1,
      return_mode: 'compact'
    };
    const contractPath1 = path.join(testDir, 'contract-1.json');
    fs.writeFileSync(contractPath1, JSON.stringify(contract1, null, 2), 'utf-8');

    const run1 = spawnSync('node', [invokeTaskScript, '--contract', contractPath1, '--agy-path', fakeAgyPs1], {
      encoding: 'utf-8',
      windowsHide: true
    });

    if (run1.status !== 0) {
      throw new Error(`Test 1 runner failed with exit code ${run1.status}: ${run1.stderr}`);
    }

    let receipt1;
    try {
      receipt1 = JSON.parse(run1.stdout);
    } catch (e) {
      throw new Error(`Test 1 stdout was not valid JSON: ${run1.stdout}`);
    }

    if (receipt1.status !== 'READY_FOR_REVIEW') {
      console.error('Test 1 receipt:', JSON.stringify(receipt1, null, 2));
      throw new Error(`Test 1 expected status READY_FOR_REVIEW, got: ${receipt1.status}`);
    }
    if (!receipt1.scope_check.passed) {
      throw new Error(`Test 1 expected scope_check.passed to be true, got: ${JSON.stringify(receipt1.scope_check)}`);
    }
    if (receipt1.acceptance_results[0].status !== 'PASS') {
      throw new Error(`Test 1 expected acceptance_results[0].status PASS, got: ${receipt1.acceptance_results[0].status}`);
    }

    // Check stdout does NOT contain distinctive long worker marker
    if (run1.stdout.includes(DISTINCTIVE_MARKER)) {
      throw new Error('Test 1 failed: stdout contains the distinctive long worker-response marker! Full response must not leak to stdout.');
    }

    // Check raw agy output artifact exists and DOES contain distinctive marker
    const attemptDir1 = getAttemptDir(artifactDir1);
    const rawOutput1 = path.join(attemptDir1, 'raw-agy-output.json');
    if (!fs.existsSync(rawOutput1)) {
      throw new Error(`Test 1 failed: raw-agy-output.json does not exist at ${rawOutput1}`);
    }
    const rawContent1 = fs.readFileSync(rawOutput1, 'utf-8');
    if (!rawContent1.includes(DISTINCTIVE_MARKER)) {
      throw new Error('Test 1 failed: raw-agy-output.json does not contain the distinctive worker marker.');
    }

    // Check acceptance log artifact exists
    const acceptLog1 = path.join(attemptDir1, 'acceptance-cmd-1.log');
    if (!fs.existsSync(acceptLog1)) {
      throw new Error(`Test 1 failed: acceptance command log does not exist at ${acceptLog1}`);
    }
    const receiptArtifact1 = path.join(attemptDir1, 'receipt.json');
    if (!fs.existsSync(receiptArtifact1)) {
      throw new Error(`Test 1 failed: receipt.json does not exist at ${receiptArtifact1}`);
    }

    console.log('  -> Test 1 PASSED.');

    // =========================================================================
    // Test 2: Unexpected file edit => scope FAIL / REJECTED
    // =========================================================================
    console.log('[Test 2] Testing unexpected file edit => REJECTED...');
    process.env.FAKE_AGY_ACTION = 'UNEXPECTED_EDIT';
    const artifactDir2 = path.join(gitWorkspace, '.agy-artifacts', 'task-2');

    const contract2 = {
      version: 'v1',
      task_id: 'task-2-unexpected',
      task_type: 'implementation',
      goal: 'Update allowed.txt',
      workspace: gitWorkspace,
      allowed_files: ['allowed.txt'],
      read_scope: ['allowed.txt'],
      acceptance_commands: ['node -e "process.exit(0)"'],
      forbidden_actions: ['modifying files outside allowed_files'],
      max_changed_files: 1,
      artifact_dir: artifactDir2,
      return_mode: 'compact'
    };
    const contractPath2 = path.join(testDir, 'contract-2.json');
    fs.writeFileSync(contractPath2, JSON.stringify(contract2, null, 2), 'utf-8');

    const run2 = spawnSync('node', [invokeTaskScript, '--contract', contractPath2, '--agy-path', fakeAgyPs1], {
      encoding: 'utf-8',
      windowsHide: true
    });

    let receipt2;
    try {
      receipt2 = JSON.parse(run2.stdout);
    } catch (e) {
      throw new Error(`Test 2 stdout was not valid JSON: ${run2.stdout}\nStderr: ${run2.stderr}`);
    }

    if (receipt2.status !== 'REJECTED') {
      throw new Error(`Test 2 expected status REJECTED, got: ${receipt2.status}`);
    }
    if (receipt2.scope_check.passed) {
      throw new Error('Test 2 expected scope_check.passed to be false.');
    }
    const hasViolation = receipt2.scope_check.violations.some(v => v.includes('unexpected.txt'));
    if (!hasViolation) {
      throw new Error(`Test 2 expected scope violations to include unexpected.txt: ${JSON.stringify(receipt2.scope_check.violations)}`);
    }

    console.log('  -> Test 2 PASSED.');

    // Clean up unexpected file in git workspace for next test
    const unexpectedFilePath = path.join(gitWorkspace, 'unexpected.txt');
    if (fs.existsSync(unexpectedFilePath)) {
      fs.unlinkSync(unexpectedFilePath);
    }

    // =========================================================================
    // Test 3: Failing acceptance command => REJECTED
    // =========================================================================
    console.log('[Test 3] Testing failing acceptance command => REJECTED...');
    process.env.FAKE_AGY_ACTION = 'ALLOWED_EDIT';
    const artifactDir3 = path.join(gitWorkspace, '.agy-artifacts', 'task-3');

    const contract3 = {
      version: 'v1',
      task_id: 'task-3-failing-cmd',
      task_type: 'implementation',
      goal: 'Update allowed.txt',
      workspace: gitWorkspace,
      allowed_files: ['allowed.txt'],
      read_scope: ['allowed.txt'],
      acceptance_commands: ['node -e "process.exit(42)"'],
      forbidden_actions: ['modifying files outside allowed_files'],
      max_changed_files: 1,
      artifact_dir: artifactDir3,
      return_mode: 'compact'
    };
    const contractPath3 = path.join(testDir, 'contract-3.json');
    fs.writeFileSync(contractPath3, JSON.stringify(contract3, null, 2), 'utf-8');

    const run3 = spawnSync('node', [invokeTaskScript, '--contract', contractPath3, '--agy-path', fakeAgyPs1], {
      encoding: 'utf-8',
      windowsHide: true
    });

    let receipt3;
    try {
      receipt3 = JSON.parse(run3.stdout);
    } catch (e) {
      throw new Error(`Test 3 stdout was not valid JSON: ${run3.stdout}\nStderr: ${run3.stderr}`);
    }

    if (receipt3.status !== 'REJECTED') {
      throw new Error(`Test 3 expected status REJECTED, got: ${receipt3.status}`);
    }
    if (receipt3.acceptance_results[0].status !== 'FAIL') {
      throw new Error(`Test 3 expected acceptance status FAIL, got: ${receipt3.acceptance_results[0].status}`);
    }
    if (receipt3.acceptance_results[0].exit_code !== 42) {
      throw new Error(`Test 3 expected exit_code 42, got: ${receipt3.acceptance_results[0].exit_code}`);
    }

    const acceptLog3 = path.join(getAttemptDir(artifactDir3), 'acceptance-cmd-1.log');
    if (!fs.existsSync(acceptLog3)) {
      throw new Error(`Test 3 failed: acceptance command log missing at ${acceptLog3}`);
    }
    const logContent3 = fs.readFileSync(acceptLog3, 'utf-8');
    if (!logContent3.includes('Exit Code: 42')) {
      throw new Error(`Test 3 failed: log file does not record exit code 42.`);
    }

    console.log('  -> Test 3 PASSED.');

    // =========================================================================
    // Test 4: Write task outside Git => NEEDS_REVIEW (fail closed)
    // =========================================================================
    console.log('[Test 4] Testing write task outside Git => NEEDS_REVIEW...');
    const nonGitWorkspace = path.join(testDir, 'workspace-nongit');
    fs.mkdirSync(nonGitWorkspace, { recursive: true });
    const nonGitAllowed = path.join(nonGitWorkspace, 'allowed.txt');
    fs.writeFileSync(nonGitAllowed, 'initial', 'utf-8');

    const artifactDir4 = path.join(nonGitWorkspace, '.agy-artifacts', 'task-4');
    const contract4 = {
      version: 'v1',
      task_id: 'task-4-nongit',
      task_type: 'implementation',
      goal: 'Write task outside git',
      workspace: nonGitWorkspace,
      allowed_files: ['allowed.txt'],
      read_scope: ['allowed.txt'],
      acceptance_commands: ['node -e "process.exit(0)"'],
      forbidden_actions: [],
      max_changed_files: 1,
      artifact_dir: artifactDir4,
      return_mode: 'compact'
    };
    const contractPath4 = path.join(testDir, 'contract-4.json');
    fs.writeFileSync(contractPath4, JSON.stringify(contract4, null, 2), 'utf-8');

    const run4 = spawnSync('node', [invokeTaskScript, '--contract', contractPath4, '--agy-path', fakeAgyPs1], {
      encoding: 'utf-8',
      windowsHide: true
    });

    let receipt4;
    try {
      receipt4 = JSON.parse(run4.stdout);
    } catch (e) {
      throw new Error(`Test 4 stdout was not valid JSON: ${run4.stdout}\nStderr: ${run4.stderr}`);
    }

    if (receipt4.status !== 'NEEDS_REVIEW') {
      throw new Error(`Test 4 expected status NEEDS_REVIEW for write task outside git, got: ${receipt4.status}`);
    }
    if (receipt4.scope_check.deterministic) {
      throw new Error('Test 4 expected scope_check.deterministic to be false outside git.');
    }

    console.log('  -> Test 4 PASSED.');

    // =========================================================================
    // Test 5: Semantic review event recording
    // =========================================================================
    console.log('[Test 5] Testing semantic review event recording...');
    const reviewRun = spawnSync('node', [
      recordReviewScript,
      '--task-id', 'task-1-pass',
      '--verdict', 'pass',
      '--notes', 'Verified changes and test outputs manually.'
    ], {
      encoding: 'utf-8',
      windowsHide: true
    });

    if (reviewRun.status !== 0) {
      throw new Error(`Test 5 record-review failed: ${reviewRun.stderr}`);
    }

    const reviewRes = JSON.parse(reviewRun.stdout);
    if (!reviewRes.recorded || reviewRes.task_id !== 'task-1-pass' || reviewRes.verdict !== 'pass') {
      throw new Error(`Test 5 unexpected review output: ${reviewRun.stdout}`);
    }

    // Verify telemetry.jsonl content
    if (!fs.existsSync(telemetryPath)) {
      throw new Error(`Test 5 failed: telemetry file was not created at ${telemetryPath}`);
    }
    const telemetryLines = fs.readFileSync(telemetryPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    const execEvents = telemetryLines.filter(e => e.event_type === 'execution');
    const reviewEvents = telemetryLines.filter(e => e.event_type === 'semantic_review');

    if (execEvents.length < 4) {
      throw new Error(`Expected at least 4 execution telemetry events, found: ${execEvents.length}`);
    }
    if (reviewEvents.length !== 1) {
      throw new Error(`Expected 1 semantic_review telemetry event, found: ${reviewEvents.length}`);
    }
    const reviewEvent = reviewEvents[0];
    if (reviewEvent.task_id !== 'task-1-pass' || reviewEvent.verdict !== 'pass' || !reviewEvent.notes.includes('Verified')) {
      throw new Error(`Semantic review event mismatch: ${JSON.stringify(reviewEvent)}`);
    }

    // Verify no secrets or distinctive marker leaked into telemetry
    for (const ev of telemetryLines) {
      const serialized = JSON.stringify(ev);
      if (serialized.includes(DISTINCTIVE_MARKER)) {
        throw new Error('Telemetry leaked distinctive response marker!');
      }
    }

    console.log('  -> Test 5 PASSED.');

    // =========================================================================
    // Test 6: Forbidden git commit => REJECTED even when worktree is clean
    // =========================================================================
    console.log('[Test 6] Testing forbidden git commit => REJECTED...');
    runGit(['checkout', '--', 'allowed.txt'], gitWorkspace);
    process.env.FAKE_AGY_ACTION = 'COMMIT_CHANGE';
    const artifactDir6 = path.join(gitWorkspace, '.agy-artifacts', 'task-6');
    const contract6 = {
      version: 'v1', task_id: 'task-6-commit', task_type: 'implementation',
      goal: 'Attempt a forbidden commit', workspace: gitWorkspace,
      allowed_files: ['allowed.txt'], read_scope: ['allowed.txt'], acceptance_commands: [],
      forbidden_actions: ['commit'], max_changed_files: 1,
      artifact_dir: artifactDir6, return_mode: 'compact'
    };
    const contractPath6 = path.join(testDir, 'contract-6.json');
    fs.writeFileSync(contractPath6, JSON.stringify(contract6, null, 2), 'utf-8');
    const run6 = spawnSync('node', [invokeTaskScript, '--contract', contractPath6, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt6 = JSON.parse(run6.stdout);
    if (receipt6.status !== 'REJECTED' || !receipt6.scope_check.violations.some(v => v.includes('Git HEAD changed'))) {
      throw new Error(`Test 6 failed to reject commit: ${run6.stdout}`);
    }
    console.log('  -> Test 6 PASSED.');

    // =========================================================================
    // Test 7: Malformed manifest is rejected without compact-output leakage
    // =========================================================================
    console.log('[Test 7] Testing malformed manifest compact-output isolation...');
    process.env.FAKE_AGY_ACTION = 'MALFORMED_MANIFEST';
    const artifactDir7 = path.join(gitWorkspace, '.agy-artifacts', 'task-7');
    const contract7 = {
      version: 'v1', task_id: 'task-7-malformed', task_type: 'investigation',
      goal: 'Return malformed manifest', workspace: gitWorkspace,
      allowed_files: [], read_scope: ['allowed.txt'], acceptance_commands: [],
      forbidden_actions: [], max_changed_files: 0,
      artifact_dir: artifactDir7, return_mode: 'compact', mode: 'plan'
    };
    const contractPath7 = path.join(testDir, 'contract-7.json');
    fs.writeFileSync(contractPath7, JSON.stringify(contract7, null, 2), 'utf-8');
    const run7 = spawnSync('node', [invokeTaskScript, '--contract', contractPath7, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt7 = JSON.parse(run7.stdout);
    if (receipt7.status !== 'REJECTED' || receipt7.needs_review !== true) throw new Error(`Test 7 expected REJECTED with review flag: ${run7.stdout}`);
    if (run7.stdout.includes(DISTINCTIVE_MARKER)) throw new Error('Test 7 leaked malformed worker content to compact stdout.');
    if (!fs.readFileSync(path.join(getAttemptDir(artifactDir7), 'raw-agy-output.json'), 'utf-8').includes(DISTINCTIVE_MARKER)) {
      throw new Error('Test 7 raw artifact did not retain worker evidence.');
    }
    console.log('  -> Test 7 PASSED.');

    // =========================================================================
    // Test 8: Touching a pre-existing dirty allowed file => NEEDS_REVIEW
    // =========================================================================
    console.log('[Test 8] Testing pre-existing dirty file escalation...');
    runGit(['checkout', '--', 'allowed.txt'], gitWorkspace);
    fs.appendFileSync(allowedFile, '\nuser-owned dirty change', 'utf-8');
    process.env.FAKE_AGY_ACTION = 'ALLOWED_EDIT';
    const artifactDir8 = path.join(gitWorkspace, '.agy-artifacts', 'task-8');
    const contract8 = {
      version: 'v1', task_id: 'task-8-dirty', task_type: 'implementation',
      goal: 'Edit an already dirty allowed file', workspace: gitWorkspace,
      allowed_files: ['allowed.txt'], read_scope: ['allowed.txt'], acceptance_commands: [],
      forbidden_actions: [], max_changed_files: 1,
      artifact_dir: artifactDir8, return_mode: 'compact'
    };
    const contractPath8 = path.join(testDir, 'contract-8.json');
    fs.writeFileSync(contractPath8, JSON.stringify(contract8, null, 2), 'utf-8');
    const run8 = spawnSync('node', [invokeTaskScript, '--contract', contractPath8, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt8 = JSON.parse(run8.stdout);
    if (receipt8.status !== 'NEEDS_REVIEW' || !receipt8.scope_check.pre_existing_dirty_touched.includes('allowed.txt')) {
      throw new Error(`Test 8 did not escalate dirty-file touch: ${run8.stdout}`);
    }
    console.log('  -> Test 8 PASSED.');

    // =========================================================================
    // Test 9: Non-Git read-only task cannot claim deterministic PASS
    // =========================================================================
    console.log('[Test 9] Testing non-Git read-only task fails closed...');
    process.env.FAKE_AGY_ACTION = 'ALLOWED_EDIT';
    const artifactDir9 = path.join(nonGitWorkspace, '.agy-artifacts', 'task-9');
    const contract9 = {
      version: 'v1', task_id: 'task-9-nongit-read', task_type: 'investigation',
      goal: 'Inspect without edits', workspace: nonGitWorkspace,
      allowed_files: [], read_scope: ['allowed.txt'], acceptance_commands: [],
      forbidden_actions: [], max_changed_files: 0,
      artifact_dir: artifactDir9, return_mode: 'compact', mode: 'plan'
    };
    const contractPath9 = path.join(testDir, 'contract-9.json');
    fs.writeFileSync(contractPath9, JSON.stringify(contract9, null, 2), 'utf-8');
    const run9 = spawnSync('node', [invokeTaskScript, '--contract', contractPath9, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt9 = JSON.parse(run9.stdout);
    if (receipt9.scope_check.deterministic || receipt9.status !== 'NEEDS_REVIEW') {
      throw new Error(`Test 9 incorrectly claimed deterministic success: ${run9.stdout}`);
    }
    console.log('  -> Test 9 PASSED.');

    // =========================================================================
    // Test 10: Acceptance side effects are included in the final scope gate
    // =========================================================================
    console.log('[Test 10] Testing acceptance-command side effect => REJECTED...');
    runGit(['checkout', '--', 'allowed.txt'], gitWorkspace);
    process.env.FAKE_AGY_ACTION = 'ALLOWED_EDIT';
    const artifactDir10 = path.join(gitWorkspace, '.agy-artifacts', 'task-10');
    const contract10 = {
      version: 'v1', task_id: 'task-10-acceptance-side-effect', task_type: 'implementation',
      goal: 'Detect acceptance side effects', workspace: gitWorkspace,
      allowed_files: ['allowed.txt'], read_scope: ['allowed.txt'],
      acceptance_commands: ['node -e "require(\'fs\').writeFileSync(\'acceptance-side-effect.txt\',\'x\')"'],
      forbidden_actions: [], max_changed_files: 1,
      artifact_dir: artifactDir10, return_mode: 'compact'
    };
    const contractPath10 = path.join(testDir, 'contract-10.json');
    fs.writeFileSync(contractPath10, JSON.stringify(contract10, null, 2), 'utf-8');
    const run10 = spawnSync('node', [invokeTaskScript, '--contract', contractPath10, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt10 = JSON.parse(run10.stdout);
    if (receipt10.status !== 'REJECTED' || !receipt10.scope_check.violations.some(v => v.includes('acceptance-side-effect.txt'))) {
      throw new Error(`Test 10 missed acceptance side effect: ${run10.stdout}`);
    }
    fs.unlinkSync(path.join(gitWorkspace, 'acceptance-side-effect.txt'));
    console.log('  -> Test 10 PASSED.');

    // =========================================================================
    // Test 11: Ignored-file edits are visible to the scope gate
    // =========================================================================
    console.log('[Test 11] Testing ignored-file edit => REJECTED...');
    runGit(['checkout', '--', 'allowed.txt'], gitWorkspace);
    fs.writeFileSync(path.join(gitWorkspace, '.gitignore'), 'ignored-state.txt\n.agy-artifacts/\n', 'utf-8');
    fs.writeFileSync(path.join(gitWorkspace, 'ignored-state.txt'), 'ignored baseline', 'utf-8');
    runGit(['add', '.gitignore'], gitWorkspace);
    runGit(['commit', '-m', 'add ignore rules'], gitWorkspace);
    process.env.FAKE_AGY_ACTION = 'IGNORED_EDIT';
    const artifactDir11 = path.join(gitWorkspace, '.agy-artifacts', 'task-11');
    const contract11 = {
      version: 'v1', task_id: 'task-11-ignored', task_type: 'implementation',
      goal: 'Detect ignored-file modification', workspace: gitWorkspace,
      allowed_files: ['allowed.txt'], read_scope: ['allowed.txt'], acceptance_commands: [],
      forbidden_actions: [], max_changed_files: 1,
      artifact_dir: artifactDir11, return_mode: 'compact'
    };
    const contractPath11 = path.join(testDir, 'contract-11.json');
    fs.writeFileSync(contractPath11, JSON.stringify(contract11, null, 2), 'utf-8');
    const run11 = spawnSync('node', [invokeTaskScript, '--contract', contractPath11, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt11 = JSON.parse(run11.stdout);
    if (receipt11.status !== 'REJECTED' || !receipt11.scope_check.violations.some(v => v.includes('ignored-state.txt'))) {
      throw new Error(`Test 11 missed ignored-file edit: ${run11.stdout}`);
    }
    console.log('  -> Test 11 PASSED.');

    // =========================================================================
    // Test 12: Commit followed by reset is detected through refs/reflog
    // =========================================================================
    console.log('[Test 12] Testing commit-reset history mutation => REJECTED...');
    runGit(['checkout', '--', 'allowed.txt'], gitWorkspace);
    process.env.FAKE_AGY_ACTION = 'COMMIT_RESET';
    const artifactDir12 = path.join(gitWorkspace, '.agy-artifacts', 'task-12');
    const contract12 = {
      version: 'v1', task_id: 'task-12-commit-reset', task_type: 'implementation',
      goal: 'Detect commit followed by reset', workspace: gitWorkspace,
      allowed_files: ['allowed.txt'], read_scope: ['allowed.txt'], acceptance_commands: [],
      forbidden_actions: ['commit', 'reset'], max_changed_files: 1,
      artifact_dir: artifactDir12, return_mode: 'compact'
    };
    const contractPath12 = path.join(testDir, 'contract-12.json');
    fs.writeFileSync(contractPath12, JSON.stringify(contract12, null, 2), 'utf-8');
    const run12 = spawnSync('node', [invokeTaskScript, '--contract', contractPath12, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt12 = JSON.parse(run12.stdout);
    if (receipt12.status !== 'REJECTED' || !receipt12.scope_check.violations.some(v => v.includes('refs or reflog changed'))) {
      throw new Error(`Test 12 missed commit-reset mutation: ${run12.stdout}`);
    }
    console.log('  -> Test 12 PASSED.');

    // =========================================================================
    // Test 13: Workspace root cannot be used as artifact_dir
    // =========================================================================
    console.log('[Test 13] Testing artifact_dir workspace-root rejection...');
    process.env.FAKE_AGY_ACTION = 'ALLOWED_EDIT';
    const contract13 = {
      version: 'v1', task_id: 'task-13-artifact-root', task_type: 'implementation',
      goal: 'Reject unsafe artifact root', workspace: gitWorkspace,
      allowed_files: ['allowed.txt'], read_scope: ['allowed.txt'], acceptance_commands: [],
      forbidden_actions: [], max_changed_files: 1,
      artifact_dir: gitWorkspace, return_mode: 'compact'
    };
    const contractPath13 = path.join(testDir, 'contract-13.json');
    fs.writeFileSync(contractPath13, JSON.stringify(contract13, null, 2), 'utf-8');
    const run13 = spawnSync('node', [invokeTaskScript, '--contract', contractPath13, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    if (run13.status === 0 || !run13.stderr.includes('strict descendant')) {
      throw new Error(`Test 13 accepted workspace-root artifact_dir: stdout=${run13.stdout} stderr=${run13.stderr}`);
    }
    console.log('  -> Test 13 PASSED.');

    // =========================================================================
    // Test 14: Oversized ignored trees fail closed without full hashing
    // =========================================================================
    console.log('[Test 14] Testing ignored-snapshot safety-limit downgrade...');
    runGit(['checkout', '--', 'allowed.txt'], gitWorkspace);
    process.env.FAKE_AGY_ACTION = 'ALLOWED_EDIT';
    process.env.AGY_MAX_IGNORED_FILES = '1';
    const artifactDir14 = path.join(gitWorkspace, '.agy-artifacts', 'task-14');
    const contract14 = {
      version: 'v1', task_id: 'task-14-ignored-limit', task_type: 'implementation',
      goal: 'Fail closed when ignored snapshot is too large', workspace: gitWorkspace,
      allowed_files: ['allowed.txt'], read_scope: ['allowed.txt'], acceptance_commands: [],
      forbidden_actions: [], max_changed_files: 1,
      artifact_dir: artifactDir14, return_mode: 'compact'
    };
    const contractPath14 = path.join(testDir, 'contract-14.json');
    fs.writeFileSync(contractPath14, JSON.stringify(contract14, null, 2), 'utf-8');
    const run14 = spawnSync('node', [invokeTaskScript, '--contract', contractPath14, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    delete process.env.AGY_MAX_IGNORED_FILES;
    const receipt14 = JSON.parse(run14.stdout);
    if (receipt14.status !== 'NEEDS_REVIEW' || receipt14.scope_check.deterministic !== false ||
        !receipt14.scope_check.violations.some(v => v.includes('safety limit'))) {
      throw new Error(`Test 14 did not fail closed at ignored snapshot limit: ${run14.stdout}`);
    }
    if (receipt14.scope_check.violations.some(v => v.includes('Unauthorized file modified: ignored-state.txt'))) {
      throw new Error(`Test 14 falsely reported unchanged ignored file as modified: ${run14.stdout}`);
    }
    console.log('  -> Test 14 PASSED.');

    // =========================================================================
    // Test 15: Prefer official agy structured_output over decorated response
    // =========================================================================
    console.log('[Test 15] Testing official structured_output compatibility...');
    process.env.FAKE_AGY_ACTION = 'STRUCTURED_OUTPUT';
    const artifactDir15 = path.join(gitWorkspace, '.agy-artifacts', 'task-15');
    const contract15 = {
      version: 'v1', task_id: 'task-15-structured-output', task_type: 'investigation',
      goal: 'Use structured output', workspace: gitWorkspace,
      allowed_files: [], read_scope: ['allowed.txt'], acceptance_commands: [],
      forbidden_actions: [], max_changed_files: 0,
      artifact_dir: artifactDir15, return_mode: 'compact', mode: 'plan'
    };
    const contractPath15 = path.join(testDir, 'contract-15.json');
    fs.writeFileSync(contractPath15, JSON.stringify(contract15, null, 2), 'utf-8');
    const run15 = spawnSync('node', [invokeTaskScript, '--contract', contractPath15, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt15 = JSON.parse(run15.stdout);
    if (receipt15.status !== 'READY_FOR_REVIEW' || receipt15.summary !== 'Used schema-clean structured output.') {
      throw new Error(`Test 15 did not prefer structured_output: ${run15.stdout}`);
    }
    console.log('  -> Test 15 PASSED.');

    // =========================================================================
    // Test 16: Structured acceptance command executes Windows command shims
    // =========================================================================
    console.log('[Test 16] Testing structured npm acceptance command...');
    process.env.FAKE_AGY_ACTION = 'STRUCTURED_OUTPUT';
    const artifactDir16 = path.join(gitWorkspace, '.agy-artifacts', 'task-16');
    const contract16 = {
      version: 'v1', task_id: 'task-16-npm', task_type: 'investigation',
      goal: 'Run npm shim as acceptance', workspace: gitWorkspace,
      allowed_files: [], read_scope: ['allowed.txt'],
      acceptance_commands: [{ executable: 'npm', args: ['--version'], timeout: '30s' }],
      forbidden_actions: [], max_changed_files: 0,
      artifact_dir: artifactDir16, return_mode: 'compact', mode: 'plan'
    };
    const contractPath16 = path.join(testDir, 'contract-16.json');
    fs.writeFileSync(contractPath16, JSON.stringify(contract16, null, 2), 'utf-8');
    const run16 = spawnSync('node', [invokeTaskScript, '--contract', contractPath16, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt16 = JSON.parse(run16.stdout);
    if (receipt16.status !== 'READY_FOR_REVIEW' || receipt16.acceptance_results[0]?.status !== 'PASS') {
      throw new Error(`Test 16 failed structured npm execution: ${run16.stdout}\n${run16.stderr}`);
    }
    console.log('  -> Test 16 PASSED.');

    // =========================================================================
    // Test 17: Retry attempts preserve previous evidence
    // =========================================================================
    console.log('[Test 17] Testing attempt evidence preservation...');
    const firstAttempt15 = getAttemptDir(artifactDir15);
    const rerun15 = spawnSync('node', [invokeTaskScript, '--contract', contractPath15, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const secondAttempt15 = getAttemptDir(artifactDir15);
    if (rerun15.status !== 0 || firstAttempt15 === secondAttempt15 || !fs.existsSync(path.join(firstAttempt15, 'receipt.json')) || !fs.existsSync(path.join(secondAttempt15, 'receipt.json'))) {
      throw new Error('Test 17 did not preserve separate attempt receipts.');
    }
    console.log('  -> Test 17 PASSED.');

    // =========================================================================
    // Test 18: **/ glob matches zero or more directory levels
    // =========================================================================
    console.log('[Test 18] Testing root-level doublestar glob match...');
    runGit(['checkout', '--', 'allowed.txt'], gitWorkspace);
    fs.mkdirSync(path.join(gitWorkspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(gitWorkspace, 'src', 'a.js'), 'initial', 'utf-8');
    runGit(['add', 'src/a.js'], gitWorkspace);
    runGit(['commit', '-m', 'add glob fixture'], gitWorkspace);
    process.env.FAKE_AGY_ACTION = 'GLOB_ROOT_EDIT';
    const artifactDir18 = path.join(gitWorkspace, '.agy-artifacts', 'task-18');
    const contract18 = {
      version: 'v1', task_id: 'task-18-glob', task_type: 'implementation',
      goal: 'Edit root-level glob target', workspace: gitWorkspace,
      allowed_files: ['src/**/*.js'], read_scope: ['src'], acceptance_commands: [],
      forbidden_actions: [], max_changed_files: 1,
      artifact_dir: artifactDir18, return_mode: 'compact'
    };
    const contractPath18 = path.join(testDir, 'contract-18.json');
    fs.writeFileSync(contractPath18, JSON.stringify(contract18, null, 2), 'utf-8');
    const run18 = spawnSync('node', [invokeTaskScript, '--contract', contractPath18, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt18 = JSON.parse(run18.stdout);
    if (receipt18.status !== 'READY_FOR_REVIEW' || !receipt18.scope_check.touched_files.includes('src/a.js')) {
      throw new Error(`Test 18 rejected valid root glob target: ${run18.stdout}`);
    }
    console.log('  -> Test 18 PASSED.');

    // =========================================================================
    // Test 19: Compact receipt caps large file lists
    // =========================================================================
    console.log('[Test 19] Testing compact receipt list budget...');
    runGit(['checkout', '--', 'src/a.js'], gitWorkspace);
    process.env.FAKE_AGY_ACTION = 'MANY_FILES';
    const artifactDir19 = path.join(gitWorkspace, '.agy-artifacts', 'task-19');
    const contract19 = {
      version: 'v1', task_id: 'task-19-compact', task_type: 'test_generation',
      goal: 'Generate bounded fixture files', workspace: gitWorkspace,
      allowed_files: ['generated/**/*.txt'], read_scope: [], acceptance_commands: [],
      forbidden_actions: [], max_changed_files: 40,
      artifact_dir: artifactDir19, return_mode: 'compact'
    };
    const contractPath19 = path.join(testDir, 'contract-19.json');
    fs.writeFileSync(contractPath19, JSON.stringify(contract19, null, 2), 'utf-8');
    const run19 = spawnSync('node', [invokeTaskScript, '--contract', contractPath19, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt19 = JSON.parse(run19.stdout);
    const full19 = JSON.parse(fs.readFileSync(receipt19.receipt_path, 'utf-8'));
    if (receipt19.status !== 'READY_FOR_REVIEW' || receipt19.scope_check.touched_files.length !== 20 || receipt19.scope_check.touched_files_omitted !== 20 || full19.scope_check.touched_files.length !== 40 || Buffer.byteLength(run19.stdout) > 16 * 1024) {
      throw new Error(`Test 19 compact receipt budget failed: ${run19.stdout}`);
    }
    console.log('  -> Test 19 PASSED.');

    // =========================================================================
    // Test 20: Legacy command strings preserve explicit empty arguments
    // =========================================================================
    console.log('[Test 20] Testing empty argument preservation...');
    process.env.FAKE_AGY_ACTION = 'STRUCTURED_OUTPUT';
    const artifactDir20 = path.join(gitWorkspace, '.agy-artifacts', 'task-20');
    const contract20 = {
      version: 'v1', task_id: 'task-20-empty-arg', task_type: 'investigation',
      goal: 'Preserve an explicit empty argument', workspace: gitWorkspace,
      allowed_files: [], read_scope: [],
      acceptance_commands: ['node -e "process.exit(process.argv[1] === \'\' ? 0 : 9)" ""'],
      forbidden_actions: [], max_changed_files: 0,
      artifact_dir: artifactDir20, return_mode: 'compact', mode: 'plan'
    };
    const contractPath20 = path.join(testDir, 'contract-20.json');
    fs.writeFileSync(contractPath20, JSON.stringify(contract20, null, 2), 'utf-8');
    const run20 = spawnSync('node', [invokeTaskScript, '--contract', contractPath20, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt20 = JSON.parse(run20.stdout);
    if (receipt20.status !== 'READY_FOR_REVIEW' || receipt20.acceptance_results[0]?.status !== 'PASS') {
      throw new Error(`Test 20 lost an explicit empty argument: ${run20.stdout}`);
    }
    console.log('  -> Test 20 PASSED.');

    // =========================================================================
    // Test 21: Git snapshot failure cannot produce a green receipt
    // =========================================================================
    console.log('[Test 21] Testing Git snapshot failure fail-closed behavior...');
    fs.rmSync(path.join(gitWorkspace, 'generated'), { recursive: true, force: true });
    process.env.FAKE_AGY_ACTION = 'HIDE_GIT';
    const artifactDir21 = path.join(gitWorkspace, '.agy-artifacts', 'task-21');
    const contract21 = {
      version: 'v1', task_id: 'task-21-git-failure', task_type: 'investigation',
      goal: 'Ensure failed Git inspection cannot pass', workspace: gitWorkspace,
      allowed_files: [], read_scope: [], acceptance_commands: [],
      forbidden_actions: [], max_changed_files: 0,
      artifact_dir: artifactDir21, return_mode: 'compact', mode: 'plan'
    };
    const contractPath21 = path.join(testDir, 'contract-21.json');
    fs.writeFileSync(contractPath21, JSON.stringify(contract21, null, 2), 'utf-8');
    const run21 = spawnSync('node', [invokeTaskScript, '--contract', contractPath21, '--agy-path', fakeAgyPs1], { encoding: 'utf-8', windowsHide: true });
    const receipt21 = JSON.parse(run21.stdout);
    if (receipt21.status === 'READY_FOR_REVIEW' || receipt21.scope_check.deterministic !== false) {
      throw new Error(`Test 21 incorrectly passed failed Git snapshots: ${run21.stdout}`);
    }
    console.log('  -> Test 21 PASSED.');

    console.log('\n[SUCCESS] All regression tests passed!');
  } finally {
    // Exact cleanup of temp directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
      console.log(`[Test] Cleaned temp directory: ${testDir}`);
    } catch (cleanErr) {
      console.error(`[Test] Warning: Failed to clean temp dir: ${cleanErr.message}`);
    }
  }
}

main().catch(err => {
  console.error(`[Test FAIL] ${err.stack || err.message}`);
  process.exit(1);
});

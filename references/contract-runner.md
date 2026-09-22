
# Full V1 Contract Reference

Use the official `agy` CLI as a junior worker. Keep Codex responsible for scope, review, testing, and the final answer.

## Delegation Boundaries

1. Only delegate tasks that are narrow, independent, and locally verifiable. Never delegate credentials, tokens, personal data, production operations, security sign-off, destructive cleanup, or broad architecture.
2. Inspect the current worktree and define an explicit file scope. Never run concurrent workers against overlapping files.
3. Protocol constraints vs OS security: `allowed_files` is checked against observable filesystem changes. `read_scope` and free-form `forbidden_actions` guide the worker but cannot prove which files or tools it accessed. None of these fields is a hard OS security boundary while `--dangerously-skip-permissions` is enabled.
4. Never create a replacement project/repo, commit, push, reset, clean, revert user changes, or install global software.

---

## Primary Route: V1 Task Contract Runner (implementation 3.1)

Prefer the deterministic V1 contract runner for all implementation, mechanical edit, documentation, and test generation chores.

V3.0 adds optional pinned `material_pack` evidence and bounded review summaries; V3.1 adds external attempt journals and read-only handoff. See [materials-and-handoff.md](materials-and-handoff.md) for preparation, limits, review and interruption behavior. Old contracts remain supported.

### 1. Create a V1 Task Contract JSON

Create a contract file conforming to `references/task-contract.schema.json`:

```json
{
  "version": "v1",
  "task_id": "chore-fix-helpers-001",
  "task_type": "implementation",
  "goal": "Add missing error handling to src/helpers.js",
  "workspace": "C:/path/to/project",
  "allowed_files": ["src/helpers.js"],
  "read_scope": ["src/helpers.js", "tests/helpers.test.js"],
  "acceptance_commands": [
    { "executable": "npm", "args": ["test", "--", "tests/helpers.test.js"], "timeout": "5m" }
  ],
  "forbidden_actions": ["modifying files outside allowed_files"],
  "max_changed_files": 1,
  "artifact_dir": "C:/path/to/project/.artifacts/chore-fix-helpers-001",
  "return_mode": "compact"
}
```

- **Task Types**: `implementation`, `test_generation`, `mechanical_edit`, `documentation`, `investigation`.
- `workspace` must be the real project root. `artifact_dir` must be a strict descendant of that workspace (never the workspace root or `.git`); keep it in a dedicated ignored directory such as `.agy-artifacts/<task_id>`.
- Every `allowed_files` and `read_scope` entry is workspace-relative and may not escape the workspace. A plain directory entry covers its descendants; glob entries are allowed. Only `allowed_files` is machine-checked after execution.
- Prefer structured `acceptance_commands` with separate `executable`, `args`, and optional `timeout`; this handles Windows `.cmd`/`.bat` shims and empty arguments correctly. Legacy command strings remain supported but do not accept shell syntax such as pipes, `&&`, redirection, aliases, environment assignments, or built-ins. Put complex checks in a project script and invoke that script.
- `timeout` limits the worker call and defaults to `15m`. `acceptance_timeout` optionally sets the default per-command limit and defaults to `5m`; a command-specific timeout overrides it.
- **Conversation Policy**:
  - **New independent task**: Start a new conversation (omit `conversation_id`).
  - **Precise retry**: Supply both `conversation_id` and `retry_of` (the previous receipt path). Only one retry is permitted, keeping scope, acceptance checks, model, and permissions unchanged. Authentication, environment, and model failures go directly to Codex. A new independent task omits both fields.
  - Every execution creates a distinct `attempt-*` artifact directory. `latest.json` points to the newest receipt without overwriting prior evidence.

For writing or investigation, read [task-types.md](task-types.md) and apply the relevant evidence contract.

Do not delegate browser or website interaction to agy. A local browser trial succeeded with setup assistance, but a subsequent trial took 190 seconds and failed to expose browser tools; this is a local routing decision, not a general claim about Gemini capability. Browser work stays with Codex's own browser/computer-use route.

### Task details and failure policy

The runner inserts lightweight guidance from `references/task-templates.json` for all five task types. Use optional `task_details` for:
- documentation: audience, tone, structure, supplied facts and sources;
- mechanical_edit: transformation rules, before/after examples and exceptions;
- test_generation: target behaviors and edge cases; keep production files out of allowed scope unless requested;
- investigation: questions, exact evidence locations and uncertainty;
- implementation: requested behavior, constraints and acceptance criteria.

For writing and investigations, set `required_artifacts: ["draft.md"]` or `["evidence.md"]` so a missing deliverable cannot pass. These are paths relative to the current attempt. A project-file deliverable should be in `allowed_files` and checked by an acceptance command; manifest `artifacts` are reserved for current-attempt files.

Optional `restrict_tools: true` is forwarded to the wrapper. Default unrestricted execution remains unchanged.

The preflight validates the local CLI and configured proxy reachability, caching CLI version information for 24h by executable path/size/mtime. It makes no model request. Account and model access are verified by the worker call; do not describe cached local readiness as confirmed login. Stop on auth/model/environment failure; do not let Gemini repair global settings.

### 2. Execute the Contract Runner

Run `invoke-agy-task.mjs` on Windows with Node.js and PowerShell. The managed runner uses Windows Job Objects; other platforms must use the legacy wrapper with manual supervision.

Exit codes: `0` ready for review, `2` needs review, `3` rejected, `1` runner/contract error. Always read the receipt; code 0 is not semantic approval.

```powershell
node "$HOME/.agents/skills/agy-worker/scripts/invoke-agy-task.mjs" `
  --contract "C:/path/to/contract.json"
```

### 3. Machine Gates and Evidence

The runner enforces strict deterministic verification:
- Hashes tracked files (including assume-unchanged/skip-worktree paths), Git-visible changes and ignored files. Captures index metadata. Checks scope before acceptance and after each command; a failed or incomplete initial gate skips acceptance. Previously dirty files remain distinguishable.
- Rejects history operations by comparing final `HEAD`, refs, and reflog state, including commit-then-reset attempts.
- Excludes artifact files from project scope counts but separately protects all historical attempts and `latest.json`; only the current attempt is writable. Manifest artifacts must be existing regular files inside this attempt.
- Machine-checks touched paths against `allowed_files` and `max_changed_files`.
- Escalates to `NEEDS_REVIEW` if the worker touches an already-dirty allowed file, because worker changes cannot be separated reliably from the user's pre-existing edit.
- Independently runs `acceptance_commands` with a timeout, captures full output into per-command artifact logs (`acceptance-cmd-*.log`), then repeats the scope/history gate so test side effects cannot bypass it.
- Runs worker and acceptance processes under separate Windows Job Objects. Closing or killing the supervisor terminates its descendants, including detached children. This does not contain external services already running before the task.
- Tracked snapshots cap at 50,000 entries/256 MiB. Submodules, links/junctions, hard links, or unreadable files downgrade deterministic verification rather than silently passing.
- Routes all verbose logs, reasoning, and raw agy output into `artifact_dir`.
- Fails closed or returns `NEEDS_REVIEW` whenever deterministic Git scope verification is unavailable, including read-only work outside Git. Never claims PASS without evidence.
- To avoid pathological scans, ignored-file hashing is capped at 10,000 files or 256 MiB. Crossing either cap skips the expensive hash and downgrades an otherwise successful task to `NEEDS_REVIEW`; it never returns a deterministic green light for a partially inspected ignored tree.
- Records task duration, exit status, diff statistics, artifact paths, and reported Gemini input/output/thinking token usage in append-only JSONL telemetry.
- Emits **only a single compact JSON receipt** to stdout. Lists are capped and the serialized receipt has a 16 KiB hard budget; complete evidence remains in `receipt.json`:
  ```json
  {
    "task_id": "chore-fix-helpers-001",
    "attempt_id": "attempt-...",
    "status": "READY_FOR_REVIEW",
    "conversation_id": "conv-uuid",
    "summary": "Updated error handling in src/helpers.js.",
    "scope_check": { "passed": true, "touched_files": ["src/helpers.js"] },
    "acceptance_results": [{ "command": "npm test...", "exit_code": 0, "status": "PASS", "log_path": "..." }],
    "receipt_path": "C:/.../receipt.json"
  }
  ```

### 4. Codex Semantic Review and Telemetry

Machine checks are gates, not final approval:
1. When status is `READY_FOR_REVIEW`, Codex inspects the git diff and verifies semantic correctness.
2. If issues are found, send a precise retry or take over directly.
3. Record the review outcome in telemetry:
   ```powershell
   node "$HOME/.agents/skills/agy-worker/scripts/record-review.mjs" `
     --receipt "C:/path/to/current-attempt/receipt.json" `
     --verdict pass `
     --notes "Verified error handling and tests"
   ```
   Verdicts: `pass`, `retry`, `takeover`. Reviews bind to `attempt_id` and the receipt SHA-256. A `pass` rechecks changed files and artifacts against recorded hashes and rejects stale evidence. Notes are capped and kept single-line.
   Keep review notes non-sensitive because telemetry is stored on disk.

---

## Compatibility Route: Legacy Free-Prompt Wrapper

Retained for quick read-only questions, broad exploration, or backwards compatibility:

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -Workspace (Get-Location).Path `
  -Prompt $prompt `
  -JsonSchema "references/worker-manifest.schema.json"
```

- Defaults to `gemini-3.8-flash-high` with `--dangerously-skip-permissions`.
- Use `-Mode plan` for read-only investigation.
- Windows proxy auto-detection is active unless `-NoSystemProxy` or `-ProxyUrl` is supplied.
- Always inspect the worktree and run tests directly when using the legacy wrapper.

## V2.1 diagnostics and retry preparation

The contract schema remains `v1`. Since V2.1, full receipts record the installed `runner_version`, a validated `contract_snapshot`, and `artifacts.raw_preflight_output`. The snapshot and raw logs remain in the local full receipt/attempt directory; they are not reinjected into the compact response. V2.2 adds a receipt SHA-256 and retry count to execution telemetry for [local statistics](usage-and-stats.md), without changing the task contract.

Compact receipts and execution telemetry include:

- `diagnostic`: `null` for a clean machine result, otherwise `stage`, `code`, `next_action`, and `evidence`. This is the primary actionable issue, not an exhaustive list: inspect the existing scope, artifact and acceptance gates too.
- `timings`: `setup_ms`, `preflight_ms`, `worker_ms`, `acceptance_ms`, `verification_ms`, and `total_before_receipt_ms`. Durations are local wall-clock milliseconds, not model inference time. Verification includes output parsing and local evidence writes but excludes acceptance process durations. Receipt/telemetry writing is excluded from `total_before_receipt_ms`; telemetry's existing `duration_ms` includes receipt writing.
- `worker_dispatched`: whether worker-process launch was attempted after preflight. It does not prove a model request reached Google or consumed tokens. A false value and zero worker time distinguish local preflight failure.

Executed acceptance commands also record `duration_ms` and `process_error` in the full receipt. Skipped commands have no process duration. Before a receipt is available, fatal errors emit a compact diagnostic JSON line on stderr followed by the local error details; exit code remains 1.

Typical codes: `PREFLIGHT_TIMEOUT`, `CLI_NOT_FOUND`, `PROXY_UNREACHABLE`, `PROXY_INVALID`, `PREFLIGHT_FAILED`, `PREFLIGHT_OUTPUT_INVALID`, `WORKER_TIMEOUT`, `WORKER_PROCESS_ERROR`, `WORKER_EXIT_FAILED`, `WORKER_OUTPUT_INVALID`, `WORKER_REPORTED_FAILURE`, `AUTH_FAILED`, `MODEL_UNAVAILABLE`, `ACCEPTANCE_TIMEOUT`, `ACCEPTANCE_FAILED`, `SCOPE_NOT_VERIFIED`, `ARTIFACT_NOT_VERIFIED`, `REVIEW_REQUIRED`, `VERIFICATION_FAILED`, `WORKSPACE_BUSY`, `RETRY_EXHAUSTED`, `RECEIPT_WRITE_FAILED`, and fallback `RUNNER_ERROR`.

Text-derived auth/model/wrapper hints are explicitly marked `failure_text` or `wrapper_text`; they are heuristics, not typed upstream API guarantees. Their messages never echo raw failure text. Unknown failures remain generic. Successful prose mentioning authentication is not an auth failure. No diagnostic repairs login, changes proxies/models, or runs an automatic retry.

For a semantic correction, save specific feedback in a UTF-8 text file, then run:

```powershell
node scripts/prepare-retry.mjs --receipt "C:/tasks/attempt/receipt.json" --feedback-file "C:/tasks/correction.txt" --out "C:/tasks/retry.json"
```

The helper copies the complete V2.1 contract snapshot, preserving scope, permissions, model, execution mode, timeouts, artifact base and acceptance checks. It adds the verified conversation ID and receipt path, and appends feedback to `task_details`. The total task-details cap still applies; oversized feedback is rejected, never truncated. It refuses output overwrite, missing/inconsistent evidence, blocked auth/environment/model failures, second retries, and an existing persistent retry claim.

Preparation does not start Gemini, write coordination state, or reserve/consume a retry. Multiple draft contracts do not grant multiple attempts. Codex must inspect the generated contract, then invoke `invoke-agy-task.mjs` normally; that runner validates the parent again, acquires the shared lock, and claims the retry after successful preflight. Another process can consume the claim between preparation and execution, in which case dispatch is refused.

V2.0 receipts lack a complete snapshot, so this helper refuses them. The existing manual V2 same-scope retry route remains available for receipts with mode evidence; do not guess missing fields. Receipt and state validation are cooperative integrity checks, not protection against an unrestricted process deliberately tampering with evidence.

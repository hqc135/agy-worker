# AGY Worker for Codex

[简体中文](README.zh-CN.md) · English

Delegate small, verifiable coding chores from Codex to Google's official Antigravity CLI, then bring the result back to Codex for review and testing.

This project is a Codex Skill and a deterministic PowerShell wrapper. It is **not** an OpenAI-compatible reverse proxy and it does not add Gemini to the Codex model picker.

## V2: less setup, durable execution coordination

Runner 2.0 keeps the existing `version: "v1"` protocol compatible. New tasks can use a short brief via `scripts/prepare-task.mjs`; it validates and expands defaults without starting Gemini, changing settings or overwriting contracts. See [SKILL.md](SKILL.md) for an example and [the full contract reference](references/contract-runner.md) for advanced fields.

- No implicit edit scope: project writes still require `allowed_files`; directories/globs require an explicit change-count limit.
- Managed runs sharing a Git common directory are serialized, including linked worktrees. Busy invocations stop immediately; legacy wrapper/direct CLI runs are not coordinated.
- One persistent retry claim per original attempt prevents repeated reuse of an old receipt. Claims survive interrupted dispatch; local preflight failure does not consume a claim.
- V2 retries bind execution mode too. Old full contracts still run, but pre-V2 receipts cannot authorize a precise retry because they lack mode evidence; Codex must review the result before choosing a new independent task.
- `node scripts/task-state.mjs --workspace <path>` inspects active-lock metadata and retry-claim count without running a model.
- State lives under `~/.config/agy-worker/state`. `AGY_STATE_DIR` can isolate tests but must remain stable for normal use and stay outside the repo. Crash locks require confirming associated workers have stopped before removing that exact lock; no automatic stale-lock deletion.

These are cooperative correctness guards, not a sandbox or scheduler. V2 does not add browser delegation, automatic Git operations, parallel execution, automatic login repair or different default permissions. The managed runner remains Windows-only. Run `node --test scripts/test-v2.mjs` alongside existing regression/hardening tests.

## Why this exists

Coding agents are often overqualified for mechanical work: repetitive edits, test scaffolding, documentation cleanup, narrow code searches, and similar chores. AGY Worker lets Codex remain the lead agent while using an available Antigravity model as a junior worker.

```text
You → Codex → $agy-worker → official agy CLI → Gemini/Antigravity
                         ← JSON result + workspace changes ←
      Codex reviews the diff, runs tests, and reports the verified result
```

The important part is the review boundary. Antigravity's prose is never treated as the final deliverable; Codex checks the actual files and test results.

## Features

- Uses the official `agy` CLI and its cached Google authentication.
- Defaults to `gemini-3.8-flash-high`; any model slug reported by `agy models` can be selected.
- Provides a versioned task-contract runner with machine-enforced file scope, independent acceptance commands, per-attempt evidence, compact receipts, and review telemetry.
- Supports edit mode and read-only planning mode.
- Returns machine-readable JSON; a non-zero `agy` result raises a clear PowerShell error without terminating the caller's host process.
- Supports exact continuation with `conversation_id`.
- Separates stdout JSON from stderr diagnostics.
- Automatically inherits the current Windows manual proxy when terminal proxy variables are absent.
- Adds an existing Windows Node.js installation to the child PATH when an Antigravity plugin hook requires `node` but the host PATH omits it.
- Supports an explicit proxy, custom `agy` path, sandbox mode, and reasoning effort.
- Uses unrestricted Antigravity tools by default for this personal-worker workflow; `-RestrictTools` opts back into approval restrictions.
- Includes static CI validation for Windows PowerShell 5.1 and PowerShell 7.

## Tested environment

- Windows 11
- Antigravity CLI 1.1.27 (live contract smoke on 2026-09-08)
- Codex desktop/CLI skill discovery
- `gemini-3.8-flash-high`
- Windows PowerShell 5.1 and PowerShell 7 syntax

The managed task runner requires Windows Job Objects, Node.js, and PowerShell. The legacy free-prompt wrapper can be used elsewhere with `pwsh`, but it has no managed process-tree guarantee and is not covered by CI on other platforms.

## Requirements

- Codex desktop, Codex CLI, or the Codex IDE extension with local Skills support.
- Google's official Antigravity CLI.
- A Google account or another authentication method supported by `agy`.
- PowerShell 5.1+ on Windows, or PowerShell 7 (`pwsh`) elsewhere.

Model availability and quotas depend on the signed-in Antigravity account. This project does not provide, proxy, or resell model access.

## 1. Install and authenticate `agy`

On Windows, install the official WinGet package:

```powershell
winget install --exact --id Google.AntigravityCLI
```

Restart the terminal if `agy` is not immediately found, then start the interactive onboarding flow:

```powershell
agy
```

Complete Google sign-in, review the Terms of Service and data-use choice yourself, and trust only workspaces you intend Antigravity to access.

Verify the login and inspect the model slugs available to your account:

```powershell
agy --version
agy models
```

For other installation methods, see the [official Antigravity CLI installation guide](https://antigravity.google/docs/cli/install/).

## 2. Configure networking when needed

If the browser can reach Google but `agy` reports a token-exchange timeout, the terminal probably is not using your proxy.

The wrapper uses proxies in this order:

1. `-ProxyUrl` passed to the wrapper;
2. existing `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY` process variables;
3. the active manual proxy in Windows Internet Settings;
4. direct connection.

Explicit per-run proxy:

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -ProxyUrl "http://127.0.0.1:7897" `
  -Prompt "Reply with OK"
```

Or configure the current terminal yourself:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7897"
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:ALL_PROXY = "http://127.0.0.1:7897"
```

Use `-NoSystemProxy` to stop the wrapper from reading Windows Internet Settings. PAC files are not parsed automatically; use `-ProxyUrl` or environment variables for those setups.

## 3. Install the Codex Skill

### With Codex Skill Installer

Ask Codex:

```text
Use $skill-installer to install https://github.com/hqc135/agy-worker
```

### Manual installation

Clone the repository into your personal Skills directory:

```powershell
New-Item -ItemType Directory -Force "$HOME/.agents/skills" | Out-Null
git clone https://github.com/hqc135/agy-worker "$HOME/.agents/skills/agy-worker"
```

Do not clone over an existing directory with uncommitted changes. Codex detects Skills automatically; restart Codex if `$agy-worker` does not appear.

Repository-scoped installation is also supported:

```powershell
git clone https://github.com/hqc135/agy-worker ".agents/skills/agy-worker"
```

## 4. Use it from Codex

Explicit invocation is the most predictable:

```text
Use $agy-worker to add focused unit tests for the parser. Limit changes to tests/parser,
do not commit, and run the relevant test command. Review the resulting diff yourself.
```

Natural-language matching is enabled as well:

```text
Give this mechanical documentation cleanup to agy, then verify every changed file.
```

Good tasks:

- mechanical refactors with clear acceptance criteria;
- unit-test scaffolding for a narrow module;
- documentation, comments, types, or naming cleanup;
- small migrations with an obvious diff;
- focused repository investigation in `plan` mode.

Poor tasks:

- production operations or destructive cleanup;
- secrets, credentials, tokens, or private personal data;
- final security or compliance decisions;
- large architectural changes;
- changes that cannot be tested or reviewed locally;
- overlapping edits from multiple agents in the same files.
- browser or website interaction: one local assisted run succeeded, while a subsequent run took 190 seconds and could not expose browser tools. This project keeps browser tasks with Codex; this is not a general benchmark of Gemini.

## Recommended: V1 task-contract runner

The free-prompt wrapper remains available, but normal delegated work should use `scripts/invoke-agy-task.mjs`. A contract makes the scope and acceptance checks explicit and gives Codex a small receipt instead of feeding the worker's full response back into the main context.

```json
{
  "version": "v1",
  "task_id": "parser-tests-001",
  "task_type": "test_generation",
  "goal": "Add tests for empty and malformed parser input",
  "workspace": "C:/path/to/project",
  "allowed_files": ["tests/parser.test.ts"],
  "read_scope": ["src/parser.ts", "tests/parser.test.ts"],
  "acceptance_commands": [
    {
      "executable": "npm",
      "args": ["test", "--", "tests/parser.test.ts"],
      "timeout": "5m"
    }
  ],
  "forbidden_actions": ["modifying files outside allowed_files"],
  "max_changed_files": 1,
  "artifact_dir": "C:/path/to/project/.agy-artifacts/parser-tests-001",
  "return_mode": "compact",
  "model": "gemini-3.8-flash-high",
  "mode": "accept-edits"
}
```

Run it from Codex or a terminal:

```powershell
node "$HOME/.agents/skills/agy-worker/scripts/invoke-agy-task.mjs" `
  --contract "C:/path/to/contract.json"
```

Supported task types are `implementation`, `test_generation`, `mechanical_edit`, `documentation`, and `investigation`. Browser tasks are intentionally rejected.

The runner:

- hashes tracked files including assume-unchanged/skip-worktree paths, visible changes and ignored files; gates before acceptance and after each command;
- rejects changes outside `allowed_files`, excessive file counts, Git history mutation, and acceptance failures;
- downgrades ambiguous states such as pre-existing dirty files or incomplete snapshots to `NEEDS_REVIEW`;
- stores raw output, command logs, manifests, and full receipts in a unique `attempt-*` directory;
- detects changes to previous attempts and `latest.json`, then updates the pointer itself;
- emits a compact JSON receipt capped at 16 KiB;
- permits one precise retry using both `conversation_id` and `retry_of` (the prior receipt path), while retaining scope, model, permissions and acceptance checks.

`allowed_files` is machine-checked, but `read_scope` and free-form `forbidden_actions` are instructions rather than an OS sandbox. Codex must still inspect the diff and decide whether the result is correct.

After semantic review, record the outcome:

```powershell
node "$HOME/.agents/skills/agy-worker/scripts/record-review.mjs" `
  --receipt "C:/path/to/current-attempt/receipt.json" `
  --verdict pass `
  --notes "Diff and focused tests verified"
```

Valid verdicts are `pass`, `retry`, and `takeover`.

## Versions 1.2 and 1.3: acceptance and delegation

The contract protocol remains `version: "v1"`; receipts identify implementation `runner_version: "1.3.0"`.

New optional contract fields:

| Field | Purpose |
|---|---|
| `required_artifacts` | Existing regular files required inside the current attempt, e.g. `["draft.md"]`. Each must be declared in the worker manifest. |
| `task_details` | Audience, tone, source facts, transformation examples, or test behaviors (up to 12,000 characters). |
| `restrict_tools` | `true` forwards `-RestrictTools`; default remains unrestricted. |
| `retry_of` | Previous receipt path, supplied together with `conversation_id`. One same-scope retry at most. |

The runner inserts lightweight type-specific instructions from `references/task-templates.json`. Gemini should report blocked on environment, authentication or model errors and leave remediation to Codex. These failures cannot be retried through the same retry chain; a second ordinary retry is rejected before calling Gemini.

Local preflight checks the executable and configured proxy endpoint. CLI version metadata is cached for 24 hours by executable path, size, and modification time. It does **not** make a model-list request or certify authentication; account/model access is checked by the real worker call.

Worker scope and evidence must pass before tests execute. Each acceptance command is followed by another scope check; later commands are skipped after a violation. Historical attempts are inspected separately. Declared artifacts are verified and hashed; a nonexistent draft cannot pass by summary alone. Submodules, links/junctions, hard links, unreadable files or snapshot size limits prevent a deterministic green receipt. Tracked snapshots cap at 50,000 entries/256 MiB; historical evidence caps at 10,000 files/256 MiB.

Each managed process runs in a Windows Job Object. Timeout or supervisor exit terminates descendants, including detached children. Existing external services are outside that process tree. This is lifecycle management, not a filesystem or network sandbox.

Exit codes are `0` for `READY_FOR_REVIEW`, `2` for `NEEDS_REVIEW`, `3` for `REJECTED`, and `1` for runner/contract errors. Callers must parse the receipt even when exit code is nonzero. Code 0 still requires Codex semantic review.

Review commands now require `--receipt`. They record the attempt ID and receipt hash, and a `pass` verifies changed files/artifacts have not changed since that receipt. Old receipts without hashes must be rerun; task-ID-only review is no longer accepted.

`allowed_files`, snapshots and receipts remain checks on observed state, not a security boundary against a malicious process with the same OS permissions. Temporary changes reverted before inspection, writes outside the inspected repository and external side effects cannot be certified by these gates.

## Direct wrapper usage

Basic edit task:

```powershell
$prompt = @'
Update only src/parser.ts and tests/parser.test.ts.
Add coverage for empty and malformed input.
Do not commit, push, install global software, or modify unrelated files.
Finish with changed files, tests run, and remaining uncertainty.
'@

& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -Workspace (Get-Location).Path `
  -Prompt $prompt
```

Read-only investigation:

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -Workspace (Get-Location).Path `
  -Mode plan `
  -Prompt "Find where retry backoff is configured. Do not modify files."
```

Use another model and a longer timeout:

```powershell
agy models

& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -Model "gemini-3.8-flash-high" `
  -Effort high `
  -Timeout 30m `
  -Prompt $prompt
```

Continue the exact same task:

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -ConversationId "<conversation_id-from-the-first-run>" `
  -Prompt "Address only the failing edge-case test and report what changed."
```

The wrapper rejects a continuation response whose returned `conversation_id` does not match the requested ID.

## Wrapper parameters

| Parameter | Default | Purpose |
|---|---:|---|
| `-Prompt` | required | Task sent to Antigravity. |
| `-Workspace` | current directory | Working directory and `--add-dir` scope. |
| `-Model` | `gemini-3.8-flash-high` | Exact slug from `agy models`. |
| `-Mode` | `accept-edits` | `accept-edits` or `plan`. |
| `-Effort` | unset | Optional `low`, `medium`, or `high`. |
| `-Timeout` | `15m` | Go-style duration such as `90s`, `15m`, or `1h30m`. |
| `-ConversationId` | unset | Continue one exact conversation. |
| `-AgyPath` | auto-detected | Explicit path to the official CLI executable. |
| `-ProxyUrl` | auto-detected | HTTP/HTTPS proxy for the child process only. |
| `-NoSystemProxy` | off | Disable Windows manual-proxy discovery. |
| `-Sandbox` | off | Enable Antigravity terminal sandbox restrictions. |
| `-RestrictTools` | off | Disable the default `--dangerously-skip-permissions` behavior. |
| `-AllowAllTools` | compatibility | Retained for older callers; unrestricted tools are already the default. |

## Permissions

This personal-worker configuration passes `--dangerously-skip-permissions` by default. Use it only in a trusted workspace with a tightly scoped contract. Pass `-RestrictTools` when working with sensitive or unfamiliar code. Antigravity also supports scoped permissions in `~/.gemini/antigravity-cli/settings.json`, for example:

```json
{
  "permissions": {
    "allow": [
      "command(git)",
      "command(npm run (build|lint|test))",
      "write_file(src/)"
    ]
  }
}
```

To explicitly select the restricted route:

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -RestrictTools `
  -Prompt $prompt
```

See the [official headless-mode documentation](https://antigravity.google/docs/cli/headless/) and [permissions guide](https://antigravity.google/docs/cli/permissions/) before changing permission policy.

## Output contract

The wrapper emits one JSON object to stdout. Diagnostics and permission notices remain on stderr.

```json
{
  "conversation_id": "178d54e6-2a79-4447-be44-0a83d7d30760",
  "status": "SUCCESS",
  "response": "AGY_OK\n",
  "duration_seconds": 2.2,
  "num_turns": 1,
  "usage": {
    "input_tokens": 17601,
    "output_tokens": 34,
    "thinking_tokens": 30,
    "cache_read_tokens": 0,
    "total_tokens": 17635
  }
}
```

Do not trust `response` as proof that files were changed correctly. Review the worktree and run tests independently.

## Troubleshooting

### `Please sign in to view available models`

Run `agy` interactively once and finish authentication.

### `token exchange failed` or a Google endpoint times out

Confirm that your local proxy is listening, then use `-ProxyUrl` or set the three proxy environment variables. Browser proxy settings do not automatically apply to every CLI.

### Unknown model or non-zero exit

Run `agy models` and pass an exact current slug. Headless mode fails rather than silently substituting an unknown model.

### A command was soft-denied

Let Codex run the verification command, add a narrow Antigravity permission rule, or explicitly authorize `-AllowAllTools` for that run.

### Every file tool fails in a `PreToolUse` hook because `node` is not found

The wrapper now discovers common Windows Node.js installations and temporarily adds one to the child PATH. If the failing hook belongs to an unused Antigravity/Gemini plugin, disable or uninstall that plugin in its own configuration rather than enabling unrestricted tool permissions. A hook failure is unrelated to the selected Gemini model.

### `SUCCESS` with an empty response

Inspect actual workspace changes first. Retry at most once with a smaller prompt; do not start an unbounded retry loop.

### Codex cannot find `$agy-worker`

Confirm that `SKILL.md` is directly under `$HOME/.agents/skills/agy-worker`, then restart Codex. The official Codex Skills documentation describes user and repository discovery paths.

## Validation and development

Static validation requires no Antigravity account:

```powershell
./tests/test-static.ps1
```

The contract runner has a deterministic regression suite:

```powershell
node ./scripts/test-regression.mjs
node ./scripts/test-hardening.mjs
```

The live smoke test uses your signed-in account and makes one model request without editing files:

```powershell
./tests/test-live.ps1
```

The repository's GitHub Actions workflow runs static validation under Windows PowerShell 5.1 and PowerShell 7, followed by the regression and hardening suites. Hardening tests exercise skipped acceptance, hidden tracked changes, historical evidence, artifacts, stale reviews, retry limits and delayed writes from timed-out child processes.

## Updating and uninstalling

If installed with Git:

```powershell
git -C "$HOME/.agents/skills/agy-worker" pull --ff-only
```

To uninstall, remove only the specific `agy-worker` Skill directory after verifying the path. Removing the Skill does not uninstall `agy` or delete Antigravity credentials.

## Security and privacy

- Prompts and any files Antigravity reads are handled under Google's applicable terms and settings.
- Do not delegate secrets or sensitive production data.
- Review model-produced changes before accepting them.
- The default is unrestricted tools. Use a trusted workspace and explicit scope; select `restrict_tools: true` or the legacy wrapper's `-RestrictTools` when you need approval restrictions.
- This Skill does not read, store, or publish Antigravity credentials.

## License and trademarks

MIT licensed. This project is not affiliated with, endorsed by, or sponsored by Google or OpenAI. Antigravity, Gemini, Codex, Google, and OpenAI are trademarks of their respective owners.

# AGY Worker for Codex

[简体中文](README.zh-CN.md) · English

Delegate small, verifiable coding chores from Codex to Google's official Antigravity CLI, then bring the result back to Codex for review and testing.

This project is a Codex Skill and a deterministic PowerShell wrapper. It is **not** an OpenAI-compatible reverse proxy and it does not add Gemini to the Codex model picker.

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
- Defaults to `gemini-3.7-flash-medium`; any model slug reported by `agy models` can be selected.
- Supports edit mode and read-only planning mode.
- Returns machine-readable JSON and preserves `agy`'s exit code.
- Supports exact continuation with `conversation_id`.
- Separates stdout JSON from stderr diagnostics.
- Automatically inherits the current Windows manual proxy when terminal proxy variables are absent.
- Supports an explicit proxy, custom `agy` path, sandbox mode, and reasoning effort.
- Keeps unrestricted permissions opt-in.
- Includes static CI validation for Windows PowerShell 5.1 and PowerShell 7.

## Tested environment

- Windows 11
- Antigravity CLI 1.1.24
- Codex desktop/CLI skill discovery
- `gemini-3.7-flash-medium`
- Windows PowerShell 5.1 and PowerShell 7 syntax

Other platforms should work when `pwsh` and `agy` are on `PATH`, but automatic system-proxy discovery is Windows-specific and non-Windows platforms are not yet tested in CI.

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
  -Model "gemini-3.7-flash-high" `
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
| `-Model` | `gemini-3.7-flash-medium` | Exact slug from `agy models`. |
| `-Mode` | `accept-edits` | `accept-edits` or `plan`. |
| `-Effort` | unset | Optional `low`, `medium`, or `high`. |
| `-Timeout` | `15m` | Go-style duration such as `90s`, `15m`, or `1h30m`. |
| `-ConversationId` | unset | Continue one exact conversation. |
| `-AgyPath` | auto-detected | Explicit path to the official CLI executable. |
| `-ProxyUrl` | auto-detected | HTTP/HTTPS proxy for the child process only. |
| `-NoSystemProxy` | off | Disable Windows manual-proxy discovery. |
| `-Sandbox` | off | Enable Antigravity terminal sandbox restrictions. |
| `-AllowAllTools` | off | Pass `--dangerously-skip-permissions`. |

## Permissions

In headless mode, workspace file reads and writes are normally allowed. Commands that require approval are soft-denied unless they are allowed in Antigravity settings. Prefer scoped permissions in `~/.gemini/antigravity-cli/settings.json`, for example:

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

Use `-AllowAllTools` only for a trusted prompt in a trusted workspace:

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -AllowAllTools `
  -Prompt $prompt
```

That switch allows all Antigravity tool calls, including file writes and command execution. It is not required merely to edit files in the active workspace. See the [official headless-mode documentation](https://antigravity.google/docs/cli/headless/) and [permissions guide](https://antigravity.google/docs/cli/permissions/).

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

### `SUCCESS` with an empty response

Inspect actual workspace changes first. Retry at most once with a smaller prompt; do not start an unbounded retry loop.

### Codex cannot find `$agy-worker`

Confirm that `SKILL.md` is directly under `$HOME/.agents/skills/agy-worker`, then restart Codex. The official Codex Skills documentation describes user and repository discovery paths.

## Validation and development

Static validation requires no Antigravity account:

```powershell
./tests/test-static.ps1
```

The live smoke test uses your signed-in account and makes one model request without editing files:

```powershell
./tests/test-live.ps1
```

The repository's GitHub Actions workflow runs static validation under Windows PowerShell 5.1 and PowerShell 7.

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
- Keep unrestricted tool permission off by default.
- This Skill does not read, store, or publish Antigravity credentials.

## License and trademarks

MIT licensed. This project is not affiliated with, endorsed by, or sponsored by Google or OpenAI. Antigravity, Gemini, Codex, Google, and OpenAI are trademarks of their respective owners.

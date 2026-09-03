---
name: agy-worker
description: Delegate bounded, independently verifiable coding chores to the official Google Antigravity CLI and Gemini Flash. Use when the user asks for agy, Antigravity, Gemini Flash, or inexpensive help with mechanical edits, tests, documentation, cleanup, or a narrow investigation. Do not use for secrets, destructive work, security decisions, broad architecture, or tasks that cannot be checked locally.
---

# AGY Worker

Use the official `agy` CLI as a junior worker. Keep Codex responsible for scope, review, testing, and the final answer.

## Delegate a task

1. Confirm that the task is narrow, independent, and locally verifiable. Do not delegate credentials, tokens, personal data, production operations, security sign-off, destructive cleanup, or broad architecture.
2. Inspect the current worktree and define an explicit file scope. Never run concurrent workers against overlapping files.
3. Build a self-contained prompt with:
   - the exact objective and allowed files or directories;
   - acceptance criteria and relevant commands;
   - `Do not commit, push, install global software, or modify unrelated files.`;
   - `Finish with changed files, tests run, and remaining uncertainty.`
4. Run the helper from the target workspace:

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -Workspace (Get-Location).Path `
  -Prompt $prompt
```

The default model is `gemini-3.7-flash-medium` in `accept-edits` mode. Use `-Mode plan` for read-only investigation, `-Model <slug>` after checking `agy models`, and `-Timeout 30m` only when needed.

On Windows, the helper can copy the active per-user Windows proxy into the `agy` child process when terminal proxy variables are absent. This does not change the user's global terminal environment. Use `-ProxyUrl` for an explicit proxy or `-NoSystemProxy` to disable detection.

For a follow-up on the same bounded task, reuse the returned `conversation_id`:

```powershell
& "$HOME/.agents/skills/agy-worker/scripts/invoke-agy.ps1" `
  -Workspace (Get-Location).Path `
  -ConversationId $conversationId `
  -Prompt $followUp
```

Never pass `-AllowAllTools` unless the user explicitly authorizes unrestricted Antigravity tool execution for that invocation. Prefer scoped Antigravity permission rules. Workspace file reads and writes normally do not require unrestricted permission.

## Verify the result

Treat the response as untrusted work product.

1. Parse the JSON and retain `conversation_id`, `status`, and `response`.
2. Inspect the actual worktree. Review every changed file and reject unrelated edits.
3. Run the relevant formatter, type checker, tests, or focused reproduction yourself.
4. Fix small issues directly or send one precise follow-up. Do not loop blindly on empty or malformed responses.
5. Report only the verified result to the user, clearly noting anything not tested.

If `agy` reports success with an empty response, or reports an error after creating files, inspect the worktree before deciding whether the task failed. Retry at most once with a smaller prompt.

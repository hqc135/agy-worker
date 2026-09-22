# V3.0 material/review packs and V3.1 interruption handoff

The installed release is 3.1.0 and includes both iterations. Existing `version: "v1"` contracts and old entrypoints remain supported; `material_pack` is optional. These are supervised workflow improvements, not new OS isolation or automatic recovery.

## Prepare explicit materials

Create a UTF-8 source specification outside the project or in an already ignored task directory:

```json
{
  "workspace": "C:/projects/example",
  "sources": [
    {"path": "README.md", "start_line": 1, "end_line": 15},
    {"path": "src/helper.js"}
  ]
}
```

```powershell
node scripts/agy-worker.mjs pack --spec "C:/tasks/sources.json" --out "C:/tasks/material.json"
```

The command writes exclusively (no overwrite) and prints only a `material_pack` reference containing an absolute path and SHA-256. Copy that reference into the brief or full contract; include the source paths in `read_scope`. No model is called. The contract's goal, task details and acceptance commands remain separate from material evidence.

Collection accepts 1–20 explicit workspace-relative regular UTF-8 files, optionally with inclusive, one-based line ranges. No glob/directory expansion, traversal, alternate streams, links, junctions, hard links or binary files. Limits: 1 MiB per source, 64 KiB selected text, 128 KiB serialized pack. Sources record full-file hashes, selected contents, line ranges and a capture timestamp. Hashing the full file means edits outside the selected range still make the pack stale.

Common credential paths/extensions and some credential-like text patterns are rejected without echoing matching contents. This heuristic can have false positives and false negatives; it is not a secret scanner guarantee. Inspect materials locally. Do not work around a block by renaming sensitive files or blindly deleting their markers. Never put credentials in a pack, goal or task details.

Before preflight and again before dispatch, the runner validates the pinned pack and current sources. It refuses stale or inconsistent input rather than rebuilding silently. It copies the evidence into the attempt's `material-evidence.json` and tells Gemini to read it as data, not authority. Material content is not embedded in the command line or compact receipt. Scope checks detect modified/missing material copies before acceptance and after tests. Unrestricted workers are still not prevented from accessing other files: `read_scope` and quoted-evidence labels are guidance, not an OS sandbox.

Retries preserve the same pack reference and validate freshness. Prefer stable reference files, not the files being edited; if a previous attempt changed a source, the helper refuses the stale pack. Codex must review/take over instead of altering the retry's materials or renaming the task to bypass the retry budget.

## Review with bounded evidence

Each completed receipt is accompanied by `review-pack.json` (path in the compact receipt). To regenerate a read-only current view:

```powershell
node scripts/agy-worker.mjs inspect --receipt "C:/project/.agy-artifacts/task/attempt/receipt.json"
```

The summary records receipt SHA-256, machine status, scope gate, diagnostic, file hashes/sizes, character/line counts for selected text types, test outcomes/log paths and a tracked diff reference. It does not print the draft or raw logs. Worker uncertainties are separately labeled worker-reported, limited to five short items, and are not factual verification. There is no automatic tone, fact or editorial score; Codex reads the draft/source and decides.

At most 20 file entries, 20 deleted paths and eight acceptance results are summarized; omitted counts are explicit. Files over 1 MiB or unsupported/missing files are uninspected rather than green. JSON output is capped at 16 KiB; oversized saved summaries become a pointer, and `inspect` asks for local receipt inspection if its output would exceed the cap. Receipt input is capped at 8 MiB.

`review-diff.patch` contains tracked HEAD-to-worktree changes for up to 100 touched paths (10-second / 128 KiB collection bounds). It can include pre-existing edits, is not a worker-only patch, and does not contain untracked file contents. An incomplete/unavailable diff is marked as such. Inspect the actual files as necessary. The material copy and saved diff are hash-bound in `review_evidence`; `review --verdict pass` rechecks them alongside existing file/artifact evidence. Material source freshness and copy integrity are distinct summary fields. A saved summary is historical; rerun `inspect` after changes. Even an entirely green summary is not semantic approval or a complete rescan of all project files.

## Read an interruption handoff without resuming

The runner writes atomic per-attempt journals under its existing external state directory, not inside the worker project. Stderr announces the attempt ID/journal path early; completed receipts also reference the journal. No full prompt, material content or raw error text is journaled.

```powershell
node scripts/agy-worker.mjs handoff --workspace "C:/projects/example" --attempt "attempt-..."
```

Stages include prepared, preflight_completed, retry_claim_pending, dispatch_attempted, output_saved, verified, receipt_written and runner_error. They describe recorded local checkpoints, not remote completion. History is retained (bounded to 20 checkpoints); a successful review adds a separate review record. Review telemetry remains authoritative if its journal update fails, and the command reports that warning.

Before consuming a retry, the expected claim path is journaled. Handoff checks whether it exists, so an interruption between the persistent claim and worker launch still exposes the consumed budget. A claimed retry stays consumed even when dispatch outcome is uncertain.

Handoff reports the last checkpoint, workspace lock presence, retry claim presence, receipt path/hash state, attempt directory, recorded review, and presence/size of seven known evidence files. It does not enumerate arbitrary deliverables or read raw log contents; inspect the indicated attempt directory for other artifacts. Its output is capped at 16 KiB. A receipt written just before a journal update can be shown as `present_without_journal_hash`, never as verified. A corrupt/missing journal is an error; older runs have no fabricated history. Missing claim records are not proof of an unused budget if records were removed. Changing `AGY_STATE_DIR` changes the coordination domain; do not switch it to get a new attempt.

The command does not establish process liveness, enumerate or kill processes, clear locks, consume/reset retries, rewrite artifacts, or call Gemini. Check existing files/logs, confirm relevant processes have stopped, and decide the next action with Codex. A matching receipt hash does not revalidate current files: use `inspect`. No automatic replay of acceptance commands is provided because tests can have side effects. Local inspection is separate from another model execution.

These records are cooperative evidence. An unrestricted process can deliberately alter local state; journals and hashes are not tamper-proof attestations. Abrupt interruption before the first journal write cannot be reconstructed. Temporary journal files from interrupted atomic replacement are not automatically removed; no broad cache/state cleanup is performed.

## Validation

Run the original regression/hardening suites plus `node --test scripts/test-v3.mjs`. Opt-in `node tests/test-live-v3.mjs` exercises a small Chinese draft, an exact mechanical edit and source-backed arithmetic investigation using real Flash High, with material packs, summaries and handoff. It uses only temporary fixtures and consumes model quota; it is excluded from CI. These tests establish workflow behavior, not general writing quality or measured GPT token savings.

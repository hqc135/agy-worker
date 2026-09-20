# V2.2 entrypoint and local statistics

## One entrypoint, unchanged authority

From the skill checkout, run `node scripts/agy-worker.mjs --help` or `--version`. From a project, use the absolute path to the installed script. This is a local Node entrypoint, not a newly installed global `agy-worker` command. Node must be available as before; no additional dependencies or configuration are required.

| Command | Existing script | Effect |
| --- | --- | --- |
| `prepare` | `prepare-task.mjs` | Write a new contract; no model request |
| `run` | `invoke-agy-task.mjs` | Execute the inspected contract and verify results |
| `retry` | `prepare-retry.mjs` | Write a same-scope retry contract; no model request or retry claim |
| `state` | `task-state.mjs` | Read lock and retry state; no creation or cleanup |
| `review` | `record-review.mjs` | Record a Codex verdict; never execute a retry |
| `stats` | `task-stats.mjs` | Read aggregate local telemetry; no model or settings changes |

Arguments are unchanged from the original scripts. The entrypoint loads the selected module in the same Node process, without a shell or extra supervisor. It retains the runner's exit codes, stdout/stderr separation, locks and Windows Job Objects. `run`: 0 ready for review, 2 needs review, 3 rejected, 1 error. Other commands: 0 completed, 1 error. A successful preparation or review command does not mean a new worker ran. Direct scripts remain supported.

```powershell
node scripts/agy-worker.mjs prepare --brief "C:/tasks/brief.json" --out "C:/tasks/contract.json"
# Inspect contract before this step:
node scripts/agy-worker.mjs run --contract "C:/tasks/contract.json"
# Inspect actual artifacts/diff before recording a pass:
node scripts/agy-worker.mjs review --receipt "C:/tasks/attempt/receipt.json" --verdict pass --notes "Verified facts and style"
# If correction is needed instead:
node scripts/agy-worker.mjs retry --receipt "C:/tasks/attempt/receipt.json" --feedback-file "C:/tasks/correction.txt" --out "C:/tasks/retry.json"
```

## Read statistics without spending model tokens

```powershell
node scripts/agy-worker.mjs stats
node scripts/agy-worker.mjs stats --since 2026-09-01 --task-type documentation
node scripts/agy-worker.mjs stats --telemetry "C:/tasks/archived-telemetry.jsonl"
```

The default source is `AGY_TELEMETRY_PATH`, otherwise `~/.config/agy-worker/telemetry.jsonl`. No telemetry directory/file is created by reading. A missing default log returns `source_missing: true` with empty counts and null rates; an explicitly selected missing file is an error.

The output contains fixed aggregate fields only: no prompts, review notes, task IDs, conversation IDs, receipt paths, arbitrary model labels or raw logs. Rates are fractions from 0 to 1, or `null` when the denominator is zero. Totals and per-task-type groups include:

- `attempts` and machine statuses. `machine_ready_rate` is READY_FOR_REVIEW / selected attempts, not final task success.
- `matched_reviews`, `review_coverage_rate`, `review_verdicts`, `review_pass_rate`. Only the latest timestamped review per task/attempt with the matching execution `receipt_sha256` counts. Coverage is matched reviews / selected attempts. Pass rate is pass / matched reviews (including retry and takeover), not pass / all attempts. Always report coverage alongside pass rate: one pass and two unreviewed attempts means 100% of the one matched review passed, not 100% of all attempts. Equal-time conflicting reviews are excluded; a later review can supersede them. Reviews predating the execution or marking a rejected attempt pass are mismatches.
- `without_matched_review`, legacy/unbound, mismatched and conflicting review counts. V2.2 execution events add a receipt hash; older execution events often lack it. Older reviews are reported separately, never silently promoted to matched reviews.
- Known/unknown dispatch and initial/retry counts. These count attempts, not tasks. They do not establish that a remote model request reached Google, and retry means the runner's known retry count, not a guessed relationship between similar tasks.
- Duration and worker-time sample counts, totals, median and nearest-rank p95 in milliseconds. Unknown fields are excluded, not converted to zero; preflight failures can have a known zero worker time. A one-sample p95 is just that observation, not a performance guarantee.
- Reported total-token sample counts/totals/median/p95. Missing usage is unknown; only nonnegative safe integers are accepted. These are CLI-reported tokens, not billing data, GPT tokens saved, or independently audited usage.

`--since` selects executions at or after midnight UTC; matching later reviews are still considered. `--task-type` accepts the five contract task types. Unknown historical types are grouped as `unknown` when no filter is applied. `quality` counters describe the whole input log before filters.

Exact duplicate normalized execution records count once. Conflicting records sharing a task/attempt identity are excluded and reported. Malformed/partial lines, invalid events, unknown event types and orphan reviews are counted explicitly. This is a local operational report, not an audit boundary: the log is mutable and hashes are correlated from recorded events, not rechecked against current receipt/files. Runs that never emitted telemetry are absent, including early runner errors; missing logs cannot be inferred as successful runs.

Reads are bounded to the file's initial size and at most 32 MiB. Concurrent appends after that snapshot are not included; a partial final line is reported malformed. Larger inputs fail with a request to select a smaller archived JSONL file. No log truncation, rotation, deletion or network upload happens automatically.

Use the report to find work worth inspecting: repeated takeovers, sparse reviews, or expensive retries. Codex still makes the delegation decision; no model switching, permission expansion, automatic retry or scheduling is attached to the statistics.

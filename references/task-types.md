# Task-Type Evidence Contracts

Use the smallest contract that lets Codex verify the outcome. Git cleanliness proves filesystem state only; it does not prove writing quality, factual accuracy, or successful browser interaction.

## Writing and Documentation

- Put the requested draft in an allowed artifact or project file instead of returning it only in the manifest summary.
- Ask the worker to list factual claims that still need checking under `uncertainties`.
- Codex must read the resulting draft and review voice, structure, factual support, and user constraints. A passing scope gate is not editorial approval.

## Investigation

- Use `mode: plan` and an empty `allowed_files` list unless the task explicitly requests a durable report.
- Ask for a concise conclusion in the manifest and full evidence in an artifact file.
- Treat `read_scope` as worker guidance. It cannot prove that no other local file or external source was accessed.
- Codex should verify decisive claims directly when the result affects implementation or user decisions.

## Browser Tasks

Do not send browser or website interaction through this skill. One local run succeeded with manual setup assistance; a subsequent run took 190 seconds and failed to expose browser tools. This does not establish a general Gemini capability limitation. Keep browser work on Codex's own browser/computer-use path; use agy only for bounded non-browser follow-up such as drafting text from evidence Codex has already collected.

## Task templates

The runner includes type-specific guidance automatically from `task-templates.json`. Put concrete audience/tone/source facts, transformation examples, or test behaviors in `task_details`. For artifact-only work, set `required_artifacts` to paths relative to the current attempt. No missing file can be accepted merely because the summary claims success.

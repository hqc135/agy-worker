[CmdletBinding()]
param(
    [string]$Model = 'gemini-3.8-flash-high'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$wrapperPath = Join-Path $repoRoot 'scripts/invoke-agy.ps1'
$powerShellCommand = Get-Command pwsh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $powerShellCommand) {
    $powerShellCommand = Get-Command powershell -CommandType Application -ErrorAction Stop | Select-Object -First 1
}

$childArguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $wrapperPath,
    '-Workspace', $repoRoot,
    '-Model', $Model,
    '-Mode', 'plan',
    '-Timeout', '2m',
    '-Prompt', 'Reply with exactly AGY_OK. Do not call tools and do not modify files.'
)
$raw = & $powerShellCommand.Path @childArguments
$wrapperExitCode = $LASTEXITCODE

if ($wrapperExitCode -ne 0) {
    throw "agy smoke test exited with $wrapperExitCode."
}

$result = $raw | ConvertFrom-Json
if ($result.status -ne 'SUCCESS') {
    throw "agy smoke test status was '$($result.status)'."
}
if ([string]$result.response -notmatch '^AGY_OK\s*$') {
    throw "Unexpected response: $($result.response)"
}

"Live validation passed with $Model."

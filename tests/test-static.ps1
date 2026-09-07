[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$requiredFiles = @(
    'SKILL.md',
    'agents/openai.yaml',
    'scripts/invoke-agy.ps1',
    'scripts/invoke-agy-task.mjs',
    'scripts/record-review.mjs',
    'scripts/test-regression.mjs',
    'references/task-contract.schema.json',
    'references/worker-manifest.schema.json',
    'references/task-types.md',
    'README.md',
    'README.zh-CN.md',
    'LICENSE'
)

foreach ($relativePath in $requiredFiles) {
    $fullPath = Join-Path $repoRoot $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Required file is missing: $relativePath"
    }
}

$tokens = $null
$parseErrors = $null
$wrapperPath = Join-Path $repoRoot 'scripts/invoke-agy.ps1'
[System.Management.Automation.Language.Parser]::ParseFile($wrapperPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) {
    $messages = $parseErrors | ForEach-Object { $_.Message }
    throw "PowerShell parse errors:`n$($messages -join [Environment]::NewLine)"
}

$wrapperText = Get-Content -Raw -LiteralPath $wrapperPath
if ($wrapperText -match '(?m)^\s*exit\s+\$agyExitCode\s*$') {
    throw 'The wrapper must not terminate its PowerShell host with exit $agyExitCode.'
}
if ($wrapperText -notmatch "nodejs\\node\.exe") {
    throw 'The wrapper must preserve automatic Node.js discovery for child hooks.'
}
if ($wrapperText -notmatch "ProxyEnable" -or $wrapperText -notmatch "ProxyServer") {
    throw 'The wrapper must preserve Windows system-proxy discovery.'
}

$skillText = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'SKILL.md')
if ($skillText -notmatch '(?m)^name: agy-worker\r?$') {
    throw 'SKILL.md does not declare name: agy-worker.'
}
if ($skillText -match '\bTODO\b|\[TODO') {
    throw 'SKILL.md contains an unfinished TODO.'
}

$openAiYaml = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'agents/openai.yaml')
if ($openAiYaml -notmatch '\$agy-worker') {
    throw 'agents/openai.yaml default prompt must mention $agy-worker.'
}

foreach ($schemaName in @('task-contract.schema.json', 'worker-manifest.schema.json')) {
    $schemaPath = Join-Path $repoRoot "references/$schemaName"
    Get-Content -Raw -LiteralPath $schemaPath | ConvertFrom-Json | Out-Null
}

$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($node) {
    foreach ($scriptName in @('invoke-agy-task.mjs', 'record-review.mjs', 'test-regression.mjs')) {
        & $node.Path --check (Join-Path $repoRoot "scripts/$scriptName")
        if ($LASTEXITCODE -ne 0) {
            throw "Node syntax validation failed: scripts/$scriptName"
        }
    }
}

'Static validation passed.'

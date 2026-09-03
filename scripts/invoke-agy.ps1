[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Prompt,

    [string]$Workspace = (Get-Location).Path,

    [ValidatePattern('^[a-z0-9][a-z0-9._-]*$')]
    [string]$Model = 'gemini-3.7-flash-medium',

    [ValidateSet('accept-edits', 'plan')]
    [string]$Mode = 'accept-edits',

    [ValidateSet('low', 'medium', 'high')]
    [string]$Effort,

    [ValidatePattern('^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$')]
    [string]$Timeout = '15m',

    [string]$ConversationId,

    [string]$AgyPath,

    [ValidatePattern('^https?://')]
    [string]$ProxyUrl,

    [switch]$NoSystemProxy,

    [switch]$Sandbox,

    [switch]$AllowAllTools
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedWorkspace = (Resolve-Path -LiteralPath $Workspace).Path
if (-not (Test-Path -LiteralPath $resolvedWorkspace -PathType Container)) {
    throw "Workspace is not a directory: $resolvedWorkspace"
}

if ($AgyPath) {
    $resolvedAgyPath = (Resolve-Path -LiteralPath $AgyPath).Path
    if (-not (Test-Path -LiteralPath $resolvedAgyPath -PathType Leaf)) {
        throw "agy executable was not found: $resolvedAgyPath"
    }
} else {
    $agyCommand = Get-Command agy -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($agyCommand) {
        $resolvedAgyPath = $agyCommand.Path
    } else {
        $installedAgy = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe' } else { $null }
        if ($installedAgy -and (Test-Path -LiteralPath $installedAgy -PathType Leaf)) {
            $resolvedAgyPath = $installedAgy
        } else {
            throw 'Official Antigravity CLI was not found. Install it, sign in, or pass -AgyPath.'
        }
    }
}

$agyArguments = @(
    '--add-dir', $resolvedWorkspace,
    '--model', $Model,
    '--mode', $Mode,
    '--output-format', 'json',
    '--print-timeout', $Timeout
)

if ($Effort) {
    $agyArguments += @('--effort', $Effort)
}
if ($ConversationId) {
    $agyArguments += @('--conversation', $ConversationId)
}
if ($Sandbox) {
    $agyArguments += '--sandbox'
}
if ($AllowAllTools) {
    $agyArguments += '--dangerously-skip-permissions'
}
$agyArguments += @('--print', $Prompt)

$runningOnWindows = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
$originalPathValue = [Environment]::GetEnvironmentVariable('PATH', 'Process')
$pathWasInjected = $false
if ($runningOnWindows -and -not (Get-Command node -CommandType Application -ErrorAction SilentlyContinue)) {
    $nodeCandidates = @(
        $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'nodejs\node.exe' }),
        $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe' }),
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe' }),
        $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' })
    ) | Where-Object { $_ }

    foreach ($nodeCandidate in $nodeCandidates) {
        if (Test-Path -LiteralPath $nodeCandidate -PathType Leaf) {
            $nodeDirectory = Split-Path -Parent $nodeCandidate
            $env:PATH = "$nodeDirectory$([IO.Path]::PathSeparator)$env:PATH"
            $pathWasInjected = $true
            break
        }
    }
}

$originalProxyValues = @{}
$proxyWasInjected = $false
foreach ($proxyName in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')) {
    $originalProxyValues[$proxyName] = [Environment]::GetEnvironmentVariable($proxyName, 'Process')
}

$effectiveProxyUrl = $ProxyUrl
if (-not $effectiveProxyUrl -and -not $NoSystemProxy -and -not $env:HTTP_PROXY -and -not $env:HTTPS_PROXY -and -not $env:ALL_PROXY -and $runningOnWindows) {
    $internetSettings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if ($internetSettings -and $internetSettings.ProxyEnable -eq 1 -and $internetSettings.ProxyServer) {
        $proxyAddress = [string]$internetSettings.ProxyServer
        if ($proxyAddress -match '=') {
            $proxyMap = @{}
            foreach ($entry in ($proxyAddress -split ';')) {
                $pair = $entry -split '=', 2
                if ($pair.Count -eq 2) {
                    $proxyMap[$pair[0].Trim().ToLowerInvariant()] = $pair[1].Trim()
                }
            }
            if ($proxyMap.ContainsKey('https')) {
                $proxyAddress = $proxyMap['https']
            } elseif ($proxyMap.ContainsKey('http')) {
                $proxyAddress = $proxyMap['http']
            }
        }
        if ($proxyAddress -notmatch '^https?://') {
            $proxyAddress = "http://$proxyAddress"
        }
        $effectiveProxyUrl = $proxyAddress
    }
}

if ($effectiveProxyUrl) {
    $env:HTTP_PROXY = $effectiveProxyUrl
    $env:HTTPS_PROXY = $effectiveProxyUrl
    $env:ALL_PROXY = $effectiveProxyUrl
    $proxyWasInjected = $true
}

$stderrFile = New-TemporaryFile
try {
    Push-Location -LiteralPath $resolvedWorkspace
    try {
        $stdoutLines = & $resolvedAgyPath @agyArguments 2> $stderrFile.FullName
        $agyExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    $stderrText = Get-Content -Raw -LiteralPath $stderrFile.FullName -ErrorAction SilentlyContinue
} finally {
    if (Test-Path -LiteralPath $stderrFile.FullName -PathType Leaf) {
        Remove-Item -LiteralPath $stderrFile.FullName -Force
    }
    if ($proxyWasInjected) {
        foreach ($proxyName in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')) {
            $originalValue = $originalProxyValues[$proxyName]
            if ($null -eq $originalValue) {
                Remove-Item -LiteralPath "Env:$proxyName" -ErrorAction SilentlyContinue
            } else {
                Set-Item -LiteralPath "Env:$proxyName" -Value $originalValue
            }
        }
    }
    if ($pathWasInjected) {
        [Environment]::SetEnvironmentVariable('PATH', $originalPathValue, 'Process')
    }
}

if ($stderrText) {
    [Console]::Error.Write($stderrText)
}

$stdoutText = $stdoutLines -join [Environment]::NewLine
if ([string]::IsNullOrWhiteSpace($stdoutText)) {
    throw "agy returned no JSON output (exit code $agyExitCode)."
}

try {
    $result = $stdoutText | ConvertFrom-Json
} catch {
    [Console]::Error.WriteLine('agy returned malformed JSON. Raw stdout follows:')
    [Console]::Error.WriteLine($stdoutText)
    throw
}

if ($ConversationId -and $result.conversation_id -ne $ConversationId) {
    throw "Conversation mismatch: requested '$ConversationId', received '$($result.conversation_id)'."
}
if ($result.status -eq 'SUCCESS' -and [string]::IsNullOrWhiteSpace([string]$result.response)) {
    [Console]::Error.WriteLine('Warning: agy reported SUCCESS with an empty response. Inspect workspace changes before retrying.')
}

if ($agyExitCode -ne 0) {
    throw "agy exited with code $agyExitCode."
}

$result | ConvertTo-Json -Depth 100

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Prompt,

    [string]$Workspace = (Get-Location).Path,

    [ValidatePattern('^[a-z0-9][a-z0-9._-]*$')]
    [string]$Model = 'gemini-3.8-flash-high',

    [ValidateSet('accept-edits', 'plan')]
    [string]$Mode = 'accept-edits',

    [ValidateSet('low', 'medium', 'high')]
    [string]$Effort,

    [ValidatePattern('^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$')]
    [string]$Timeout = '15m',

    [string]$ConversationId,

    [string]$JsonSchema,

    [string]$AgyPath,

    [ValidatePattern('^https?://')]
    [string]$ProxyUrl,

    [switch]$NoSystemProxy,

    [switch]$PreflightOnly,

    [switch]$Sandbox,

    # This installation defaults to unrestricted Antigravity tool execution at
    # the owner's explicit request. Use -RestrictTools for sensitive tasks.
    [switch]$RestrictTools,

    # Retained for compatibility with existing callers; unrestricted execution
    # is already the default.
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

$resolvedJsonSchema = $null
if ($JsonSchema) {
    $resolvedJsonSchema = (Resolve-Path -LiteralPath $JsonSchema).Path
    if (-not (Test-Path -LiteralPath $resolvedJsonSchema -PathType Leaf)) {
        throw "JSON schema file was not found: $resolvedJsonSchema"
    }
}

if ($Effort) {
    $agyArguments += @('--effort', $Effort)
}
if ($ConversationId) {
    $agyArguments += @('--conversation', $ConversationId)
}
if ($resolvedJsonSchema) {
    $agyArguments += @('--json-schema', $resolvedJsonSchema)
}
if ($Sandbox) {
    $agyArguments += '--sandbox'
}
if (-not $RestrictTools) {
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
        if ($PreflightOnly) {
            # Validate only local prerequisites. Account/model access is determined
            # by the actual call, avoiding a second network request per task.
            $proxyValue = if ($effectiveProxyUrl) { $effectiveProxyUrl } elseif ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } elseif ($env:HTTP_PROXY) { $env:HTTP_PROXY } else { $env:ALL_PROXY }
            if ($proxyValue) {
                $proxyUri = [Uri]$proxyValue
                if (-not $proxyUri.IsAbsoluteUri -or -not $proxyUri.Host) { throw 'Invalid proxy URL.' }
                $proxyPort = $proxyUri.Port
                if ($proxyPort -lt 1) { $proxyPort = 1080 }
                $client = New-Object Net.Sockets.TcpClient
                try {
                    $pending = $client.BeginConnect($proxyUri.Host, $proxyPort, $null, $null)
                    if (-not $pending.AsyncWaitHandle.WaitOne(1500)) { throw 'Configured proxy is not reachable.' }
                    $client.EndConnect($pending)
                } finally { $client.Dispose() }
            }
            $cacheRoot = if ($env:AGY_PREFLIGHT_CACHE) { $env:AGY_PREFLIGHT_CACHE } else { Join-Path $env:USERPROFILE '.config\agy-worker\preflight' }
            $cliFile = Get-Item -LiteralPath $resolvedAgyPath
            $cacheKey = "$resolvedAgyPath|$($cliFile.Length)|$($cliFile.LastWriteTimeUtc.Ticks)"
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $keyHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($cacheKey))).Replace('-','') } finally { $sha.Dispose() }
            $cachePath = Join-Path $cacheRoot "$keyHash.json"
            $versionInfo = $null
            if (Test-Path -LiteralPath $cachePath) {
                try {
                    $cached = Get-Content -LiteralPath $cachePath -Raw | ConvertFrom-Json
                    if ([DateTime]::UtcNow -lt [DateTime]::Parse($cached.expires_utc)) { $versionInfo = $cached.version }
                } catch { $versionInfo = $null }
            }
            $cacheHit = $null -ne $versionInfo
            if (-not $versionInfo) {
                if ([IO.Path]::GetExtension($resolvedAgyPath) -eq '.ps1') {
                    $versionInfo = 'custom-wrapper'
                } else {
                    $versionInfo = (& $resolvedAgyPath --version 2> $stderrFile.FullName) -join ' '
                    if ($LASTEXITCODE -ne 0 -or -not $versionInfo) { throw 'agy version check failed.' }
                }
                New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
                @{ version = $versionInfo; expires_utc = [DateTime]::UtcNow.AddHours(24).ToString('o') } |
                    ConvertTo-Json | Set-Content -LiteralPath $cachePath -Encoding UTF8
            }
            @{status='READY'; cli_version=$versionInfo; cache_hit=$cacheHit; proxy_configured=[bool]$proxyValue; account_check='deferred-to-worker'; model=$Model} | ConvertTo-Json -Compress
            return
        }
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

# Preserve structured failure evidence for the managed runner before raising.
# The caller still receives a failing process/terminating error, never success.
$result | ConvertTo-Json -Depth 100
if ($agyExitCode -ne 0) {
    throw "agy exited with code $agyExitCode."
}

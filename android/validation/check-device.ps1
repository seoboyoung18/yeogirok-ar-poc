param(
    [ValidateSet('Prepare', 'Launch', 'Capture')][string]$Mode = 'Prepare',
    [string]$Serial = '',
    [string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk",
    [switch]$RestartMetro
)

# Run in the user's normal PowerShell. Installs with -r; never clears app data.
# Logs stay under the repository's ignored validation-records directory.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'metro-response.ps1')
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$androidRoot = Split-Path $PSScriptRoot -Parent
$projectRoot = Split-Path $androidRoot -Parent
$packageName = 'com.yeogirokarpoc'
$adbPath = Join-Path $SdkRoot 'platform-tools\adb.exe'
if (!(Test-Path -LiteralPath $adbPath)) { throw 'adb.exe not found. Pass -SdkRoot with the Android SDK directory.' }
$recordRoot = Join-Path $projectRoot 'validation-records'
$runDirectory = Join-Path $recordRoot ('device-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
$runLog = Join-Path $runDirectory 'commands.log'
$lastPrepare = Join-Path $recordRoot 'last-device-prepare.json'
$session = $null

# Only load the two known local credentials for redaction, never print them.
$redactions = [System.Collections.Generic.List[string]]::new()
$localProperties = Join-Path $androidRoot 'local.properties'
if (Test-Path -LiteralPath $localProperties) {
    foreach ($line in Get-Content -LiteralPath $localProperties -Encoding utf8) {
        if ($line -match '^\s*(ARCORE_API_KEY|KAKAO_NATIVE_APP_KEY)\s*=\s*(.+)$') {
            $redactions.Add($Matches[2].Trim())
        }
    }
}
foreach ($name in @('ARCORE_API_KEY', 'KAKAO_NATIVE_APP_KEY')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $redactions.Add($value) }
}
function Protect-Text([string]$Value) {
    foreach ($secret in $redactions) { if ($secret) { $Value = $Value.Replace($secret, '[KEY REDACTED]') } }
    return ($Value -replace 'AIza[A-Za-z0-9_-]{35}', '[KEY REDACTED]')
}
function Invoke-Checked([string]$FilePath, [string[]]$CommandArgs) {
    $lines = [System.Collections.Generic.List[string]]::new()
    # Native stderr is diagnostic text; judge success from the exit code.
    $ErrorActionPreference = 'Continue'
    & $FilePath @CommandArgs 2>&1 | ForEach-Object {
        $safe = Protect-Text $_.ToString()
        $lines.Add($safe)
        Add-Content -LiteralPath $runLog -Value $safe -Encoding utf8
        Write-Host $safe
    }
    $code = $LASTEXITCODE
    if ($code -ne 0) { throw "Command failed (exit $code). See $runLog" }
    return $lines.ToArray()
}

try {
    $deviceLines = @(Invoke-Checked $adbPath @('devices', '-l'))
    $connected = @($deviceLines | Where-Object { $_ -match '^\S+\s+device(?:\s|$)' } |
        ForEach-Object { ($_ -split '\s+')[0] })
    if (!$Serial) {
        if ($connected.Count -ne 1) {
            throw 'Exactly one authorized device is required. Unlock the phone and allow USB debugging, or pass -Serial.'
        }
        $Serial = $connected[0]
    }
    if ($Serial -notin $connected) { throw 'The selected device is not in the authorized device list.' }
    function Invoke-Device([string[]]$CommandArgs) { Invoke-Checked $adbPath (@('-s', $Serial) + $CommandArgs) }

    $model = (@(Invoke-Device @('shell', 'getprop', 'ro.product.model')) -join '').Trim()
    $abi = (@(Invoke-Device @('shell', 'getprop', 'ro.product.cpu.abi')) -join '').Trim()
    if ($abi -notin @('arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86')) { throw "Unsupported ABI: $abi" }
    $session = [ordered]@{ mode = $Mode; model = $model; abi = $abi; startedAt = (Get-Date).ToString('o');
        serial = $Serial; buildSucceeded = $null; installed = $null; launched = $false; physicalAccuracyVerified = $false }

    if ($Mode -in @('Prepare', 'Launch')) {
        if ($Mode -eq 'Prepare') {
            $session.buildSucceeded = $false
            Push-Location $androidRoot
            try {
                Invoke-Checked (Join-Path $androidRoot 'gradlew.bat') @(':app:assembleDebug', '--offline', "-PreactNativeArchitectures=$abi") | Out-Null
            } finally { Pop-Location }
            $session.buildSucceeded = $true
        }
        $apk = Join-Path $androidRoot 'app\build\outputs\apk\debug\app-debug.apk'
        if (!(Test-Path -LiteralPath $apk)) { throw 'The debug APK is missing. Run Prepare first.' }
        $session.apkSha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
        $session.apkLastWriteTime = (Get-Item -LiteralPath $apk).LastWriteTime.ToString('o')
        if ($Mode -eq 'Prepare') {
            $session.installed = $false
            Invoke-Device @('install', '-r', $apk) | Out-Null
            $session.installed = $true
        } else {
            # Resume only when the device has the exact APK produced by the prior build.
            $paths = @(Invoke-Device @('shell', 'pm', 'path', $packageName))
            $base = @($paths | Where-Object { $_ -match '^package:/data/app/[A-Za-z0-9_./+=~-]+/base\.apk$' })
            if ($base.Count -ne 1) { throw 'Cannot identify the installed base APK. Run Prepare instead.' }
            $remotePath = $base[0].Substring('package:'.Length)
            $remoteHash = @(Invoke-Device @('shell', 'sha256sum', $remotePath))
            $hashMatch = [regex]::Match(($remoteHash -join "`n"), '^([A-Fa-f0-9]{64})\s')
            if (!$hashMatch.Success -or $hashMatch.Groups[1].Value -ne $session.apkSha256) {
                throw 'Installed APK differs from the local build. Run Prepare instead.'
            }
            $session.installedApkMatchesLocal = $true
        }

        $script:metroDiagnostic = ''
        $script:metroServerDetected = $false
        function Test-Metro {
            try {
                $response = Invoke-WebRequest 'http://127.0.0.1:8081/status' -UseBasicParsing -TimeoutSec 2
                $readiness = Get-MetroReadiness $response $projectRoot
            } catch {
                $readiness = [pscustomobject]@{ Ready = $false; ServerRunning = $false;
                    Detail = "Metro HTTP check failed: $($_.Exception.GetType().Name)" }
            }
            $script:metroServerDetected = $readiness.ServerRunning
            if ($script:metroDiagnostic -ne $readiness.Detail) {
                $script:metroDiagnostic = $readiness.Detail
                Add-Content -LiteralPath $runLog -Value (Protect-Text $readiness.Detail) -Encoding utf8
                Write-Host (Protect-Text $readiness.Detail)
            }
            return $readiness.Ready
        }
        $metroReady = Test-Metro
        $cliPath = Join-Path $projectRoot 'node_modules\react-native\cli.js'
        if ($RestartMetro -and $script:metroServerDetected) {
            if (!$metroReady) { throw 'Metro restart refused: this project could not be verified on port 8081.' }
            $ownerIds = @(Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction Stop |
                Select-Object -ExpandProperty OwningProcess -Unique)
            if ($ownerIds.Count -ne 1) { throw 'Metro restart refused: cannot identify one port 8081 owner.' }
            $metroOwnerId = [int]$ownerIds[0]
            $metroOwner = Get-CimInstance Win32_Process -Filter "ProcessId = $metroOwnerId" -ErrorAction Stop
            if (!(Test-MetroProcessIdentity $metroOwner $cliPath)) {
                throw 'Metro restart refused: port owner is not this project CLI. Stop its Metro terminal with Ctrl+C, then retry Launch -RestartMetro.'
            }
            Stop-Process -Id $metroOwnerId -ErrorAction Stop
            Wait-Process -Id $metroOwnerId -Timeout 10 -ErrorAction SilentlyContinue
            if (Get-Process -Id $metroOwnerId -ErrorAction SilentlyContinue) { throw 'Metro process did not exit.' }
            Add-Content -LiteralPath $runLog -Value 'Stopped only the verified project Metro for cache reset.' -Encoding utf8
            $session.metroRestarted = $true
            $metroReady = $false
            $script:metroServerDetected = $false
        }
        if (!$metroReady) {
            if ($script:metroServerDetected) { throw $script:metroDiagnostic }
            $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
            if (!(Test-Path -LiteralPath $cliPath)) { throw 'React Native CLI is missing. Install the existing lockfile dependencies first.' }
            $metroArguments = @(('"{0}"' -f $cliPath), 'start', '--port', '8081')
            if ($RestartMetro) { $metroArguments += '--reset-cache'; $session.metroCacheResetRequested = $true }
            $metroProcess = Start-Process -FilePath $nodePath -ArgumentList $metroArguments `
                -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput (Join-Path $runDirectory 'metro.stdout.log') `
                -RedirectStandardError (Join-Path $runDirectory 'metro.stderr.log')
            $session.metroPid = $metroProcess.Id
            $deadline = (Get-Date).AddSeconds(30)
            while (!(Test-Metro) -and (Get-Date) -lt $deadline -and !$metroProcess.HasExited) { Start-Sleep -Seconds 1 }
            if (!(Test-Metro)) { throw "Metro not ready: $script:metroDiagnostic See metro.stdout.log and metro.stderr.log." }
        }
        # An unrelated Metro server must not silently supply an older/different app.
        try {
            $bundle = Invoke-WebRequest 'http://127.0.0.1:8081/index.bundle?platform=android&dev=true&minify=false' -UseBasicParsing -TimeoutSec 180
        } catch {
            $bundleFailure = Protect-Text (Get-MetroFailureBody $_)
            if ($bundleFailure.Length -gt 16000) { $bundleFailure = $bundleFailure.Substring(0, 16000) }
            $errorFile = Join-Path $runDirectory 'metro-bundle-error.txt'
            $bundleFailure | Set-Content -LiteralPath $errorFile -Encoding utf8
            Add-Content -LiteralPath $runLog -Value $bundleFailure -Encoding utf8
            Write-Host $bundleFailure
            throw "Metro could not build the JS bundle. Details: $errorFile. If Graph._recursivelyCommitModule reports undefined, retry with -Mode Launch -RestartMetro."
        }
        $bundleText = ConvertFrom-MetroContent $bundle.Content
        if ($bundleText -notmatch 'CloudValidationPanel' -or $bundleText -notmatch 'yeogirok-cloud-anchor') {
            throw 'The Metro bundle does not contain this Cloud experiment. Check which project owns port 8081.'
        }
        $session.cloudBundleConfirmed = $true
        if ($bundleText -notmatch 'TipExperience' -or $bundleText -notmatch 'openTipPlacement') {
            throw 'Metro returned an older JS bundle without the new home and tip content flow. Retry -Mode Launch -RestartMetro.'
        }
        $session.tipExperienceBundleConfirmed = $true
        Invoke-Device @('reverse', 'tcp:8081', 'tcp:8081') | Out-Null
        $deviceClock = (@(Invoke-Device @('shell', 'date', '+%m-%dT%H:%M:%S')) -join '').Trim()
        if ($deviceClock -notmatch '^\d\d-\d\dT\d\d:\d\d:\d\d$') { throw 'Cannot establish the device log start time.' }
        $session.deviceLogStart = $deviceClock.Replace('T', ' ') + '.000'
        $session.serial = $Serial
        # Relaunch only this app; its preferences and saved records are preserved.
        Invoke-Device @('shell', 'am', 'force-stop', $packageName) | Out-Null
        $launch = @(Invoke-Device @('shell', 'am', 'start', '-W', '-n', "$packageName/.MainActivity"))
        if (($launch -join "`n") -notmatch 'Status:\s*ok') { throw 'Android did not confirm Activity launch.' }
        $session.launched = $true
        $session | ConvertTo-Json | Set-Content -LiteralPath $lastPrepare -Encoding utf8
        Write-Host 'READY: Open the Yeogirok home, save a tip, then find it in AR and tap the restored pin.'
        Write-Host 'After testing, run this script again with -Mode Capture.'
    } else {
        $timeArguments = @('-t', '1500')
        if (Test-Path -LiteralPath $lastPrepare) {
            $previous = Get-Content -LiteralPath $lastPrepare -Raw -Encoding utf8 | ConvertFrom-Json
            if ($previous.serial -eq $Serial -and $previous.deviceLogStart -match '^\d\d-\d\d \d\d:\d\d:\d\d\.000$') {
                $timeArguments = @('-T', [string]$previous.deviceLogStart)
                $session.preparedApkSha256 = $previous.apkSha256
            }
        }
        $packageInfo = @(Invoke-Device @('shell', 'cmd', 'package', 'list', 'packages', '-U', $packageName))
        $match = [regex]::Match(($packageInfo -join "`n"), 'package:com\.yeogirokarpoc\s+uid:(\d+)')
        if (!$match.Success) { throw 'App UID was not found. Install the new APK with Prepare first.' }
        $uidFilter = '--uid=' + $match.Groups[1].Value
        $logs = @(Invoke-Device (@('logcat', '-d', '-v', 'threadtime', $uidFilter) + $timeArguments +
            @('YeogirokGeo:I', 'YeogirokCloud:I', 'YeogirokMap:I', 'AndroidRuntime:E', 'ReactNativeJS:W', '*:S')))
        $logs | Set-Content -LiteralPath (Join-Path $runDirectory 'app-runtime.log') -Encoding utf8
        Invoke-Device @('shell', 'dumpsys', 'activity', 'exit-info', $packageName) |
            Set-Content -LiteralPath (Join-Path $runDirectory 'app-exit-info.txt') -Encoding utf8
        $session.runtimeLogsCollected = $true
        Write-Host 'Captured app-scoped logs. Cloud success messages do not prove physical placement accuracy.'
    }
    $session | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDirectory 'summary.json') -Encoding utf8
    Write-Host "Results: $runDirectory"
} catch {
    $failure = Protect-Text $_.Exception.Message
    $failure | Set-Content -LiteralPath (Join-Path $runDirectory 'failure.txt') -Encoding utf8
    if ($null -ne $session) { $session | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDirectory 'summary.json') -Encoding utf8 }
    Write-Host "STOPPED: $failure"
    Write-Host "Results: $runDirectory"
    exit 1
}

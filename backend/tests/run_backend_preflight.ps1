param(
    [string]$BaseUrl = $(if ($env:ADMIN_BASE_URL) { $env:ADMIN_BASE_URL } else { "http://127.0.0.1:8081" }),
    [string]$PythonBaseUrl = $(if ($env:PYTHON_BASE_URL) { $env:PYTHON_BASE_URL } else { "http://127.0.0.1:8001" }),
    [string]$AdminEmail = "yh@qs.al",
    [string]$AdminPassword = $env:ADMIN_PASSWORD,
    [string]$AdminToken = $env:ADMIN_TOKEN,
    [string[]]$Include = @(),
    [switch]$FailFast,
    [switch]$KeepServer
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$BackendRoot = Join-Path $RepoRoot "backend"
$GoRoot = Join-Path $RepoRoot "go-backend"
$PythonExe = Join-Path $BackendRoot "venv\Scripts\python.exe"
$SmokeSuite = Join-Path $BackendRoot "tests\run_backend_smoke_suite.py"
$GoSmokeScript = Join-Path $GoRoot "scripts\smoke_orchestrated_routes.py"
$GoPort = [string]([System.Uri]$BaseUrl).Port
$PythonPort = [string]([System.Uri]$PythonBaseUrl).Port

$PythonStdoutLog = Join-Path $BackendRoot "tmp_preflight_python_${PythonPort}_stdout.log"
$PythonStderrLog = Join-Path $BackendRoot "tmp_preflight_python_${PythonPort}_stderr.log"
$GoStdoutLog = Join-Path $BackendRoot "tmp_preflight_go_${GoPort}_stdout.log"
$GoStderrLog = Join-Path $BackendRoot "tmp_preflight_go_${GoPort}_stderr.log"
$GoSmokeStdoutLog = Join-Path $BackendRoot "tmp_preflight_go_smoke_${GoPort}_stdout.log"
$GoSmokeStderrLog = Join-Path $BackendRoot "tmp_preflight_go_smoke_${GoPort}_stderr.log"
$SmokeStdoutLog = Join-Path $BackendRoot "tmp_preflight_smoke_${GoPort}_stdout.log"
$SmokeStderrLog = Join-Path $BackendRoot "tmp_preflight_smoke_${GoPort}_stderr.log"

function Test-Health {
    param([string]$Url)
    try {
        $resp = Invoke-RestMethod -Method Get -Uri "$Url/health" -TimeoutSec 5
        return ($resp.code -eq 200)
    } catch {
        return $false
    }
}

function Wait-Health {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 60
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Health -Url $Url) {
            return $true
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Show-LogTail {
    param(
        [string]$Path,
        [int]$Tail = 120
    )
    if (Test-Path $Path) {
        Get-Content $Path -Tail $Tail
    }
}

function Remove-TempLogs {
    $paths = @(
        $PythonStdoutLog,
        $PythonStderrLog,
        $GoStdoutLog,
        $GoStderrLog,
        $GoSmokeStdoutLog,
        $GoSmokeStderrLog,
        $SmokeStdoutLog,
        $SmokeStderrLog
    )
    foreach ($path in $paths) {
        if (Test-Path $path) {
            Remove-Item -Force $path -ErrorAction SilentlyContinue
        }
    }
}

function Resolve-GoCommand {
    $command = Get-Command go -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        "C:\Program Files\Go\bin\go.exe",
        "C:\Go\bin\go.exe"
    )
    if ($env:GOROOT) {
        $candidates += (Join-Path $env:GOROOT "bin\go.exe")
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }
    return $null
}

$startedPythonProcess = $null
$startedGoProcess = $null
$startedPythonHere = $false
$startedGoHere = $false

try {
    if (-not $AdminToken -and -not $AdminPassword) {
        Write-Host "MISSING_ADMIN_CREDENTIALS email=$AdminEmail"
        exit 1
    }

    if (-not (Test-Health -Url $PythonBaseUrl)) {
        Write-Host "PYTHON_BACKEND_START begin"
        if (Test-Path $PythonStdoutLog) { Remove-Item -Force $PythonStdoutLog }
        if (Test-Path $PythonStderrLog) { Remove-Item -Force $PythonStderrLog }

        $startedPythonProcess = Start-Process `
            -FilePath $PythonExe `
            -ArgumentList "main.py" `
            -WorkingDirectory $BackendRoot `
            -RedirectStandardOutput $PythonStdoutLog `
            -RedirectStandardError $PythonStderrLog `
            -PassThru
        $startedPythonHere = $true

        if (-not (Wait-Health -Url $PythonBaseUrl -TimeoutSeconds 60)) {
            Write-Host "PYTHON_BACKEND_START_FAIL"
            Show-LogTail -Path $PythonStderrLog
            exit 1
        }
        Write-Host "PYTHON_BACKEND_START_OK pid=$($startedPythonProcess.Id)"
    } else {
        Write-Host "PYTHON_BACKEND_REUSE existing_service=true"
    }

    if (-not (Test-Health -Url $BaseUrl)) {
        $goCommand = Resolve-GoCommand
        if (-not $goCommand) {
            Write-Host "GO_COMMAND_NOT_FOUND"
            exit 1
        }

        Write-Host "GO_GATEWAY_START begin"
        if (Test-Path $GoStdoutLog) { Remove-Item -Force $GoStdoutLog }
        if (Test-Path $GoStderrLog) { Remove-Item -Force $GoStderrLog }

        $env:API_PORT = [string]([System.Uri]$BaseUrl).Port
        $env:PYTHON_BACKEND_BASE_URL = $PythonBaseUrl

        $startedGoProcess = Start-Process `
            -FilePath $goCommand `
            -ArgumentList @("run", "./cmd/api") `
            -WorkingDirectory $GoRoot `
            -RedirectStandardOutput $GoStdoutLog `
            -RedirectStandardError $GoStderrLog `
            -PassThru
        $startedGoHere = $true

        if (-not (Wait-Health -Url $BaseUrl -TimeoutSeconds 90)) {
            Write-Host "GO_GATEWAY_START_FAIL"
            Show-LogTail -Path $GoStderrLog
            Show-LogTail -Path $GoStdoutLog
            exit 1
        }
        Write-Host "GO_GATEWAY_START_OK pid=$($startedGoProcess.Id)"
    } else {
        Write-Host "GO_GATEWAY_REUSE existing_service=true"
    }

    $env:ADMIN_BASE_URL = $BaseUrl
    $env:GO_BASE_URL = $BaseUrl
    $env:PYTHON_BASE_URL = $PythonBaseUrl
    if ($AdminEmail) { $env:ADMIN_EMAIL = $AdminEmail }
    if ($AdminPassword) { $env:ADMIN_PASSWORD = $AdminPassword }
    if ($AdminToken) { $env:ADMIN_TOKEN = $AdminToken }

    $goSmokeArgs = @($GoSmokeScript, "--go-base-url", $BaseUrl, "--require-orchestrator-connected")
    if ($AdminToken) {
        $goSmokeArgs += "--token"
        $goSmokeArgs += $AdminToken
    } elseif ($AdminEmail -and $AdminPassword) {
        $goSmokeArgs += "--admin-email"
        $goSmokeArgs += $AdminEmail
        $goSmokeArgs += "--admin-password"
        $goSmokeArgs += $AdminPassword
    }

    Write-Host "GO_SMOKE begin"
    if (Test-Path $GoSmokeStdoutLog) { Remove-Item -Force $GoSmokeStdoutLog }
    if (Test-Path $GoSmokeStderrLog) { Remove-Item -Force $GoSmokeStderrLog }

    $goSmokeProcess = Start-Process `
        -FilePath $PythonExe `
        -ArgumentList $goSmokeArgs `
        -WorkingDirectory $GoRoot `
        -RedirectStandardOutput $GoSmokeStdoutLog `
        -RedirectStandardError $GoSmokeStderrLog `
        -PassThru `
        -Wait

    if (Test-Path $GoSmokeStdoutLog) {
        Get-Content $GoSmokeStdoutLog
    }
    if (Test-Path $GoSmokeStderrLog) {
        $stderrLines = Get-Content $GoSmokeStderrLog
        if ($stderrLines) {
            Write-Host "[go_smoke_stderr]"
            $stderrLines
        }
    }

    $goSmokeExitCode = $goSmokeProcess.ExitCode
    Write-Host "GO_SMOKE end exit_code=$goSmokeExitCode"
    if ($goSmokeExitCode -ne 0) {
        exit $goSmokeExitCode
    }

    $suiteArgs = @($SmokeSuite)
    foreach ($name in $Include) {
        $suiteArgs += "--include"
        $suiteArgs += $name
    }
    if ($FailFast) {
        $suiteArgs += "--fail-fast"
    }

    Write-Host "SMOKE_SUITE begin"
    if (Test-Path $SmokeStdoutLog) { Remove-Item -Force $SmokeStdoutLog }
    if (Test-Path $SmokeStderrLog) { Remove-Item -Force $SmokeStderrLog }

    $smokeProcess = Start-Process `
        -FilePath $PythonExe `
        -ArgumentList $suiteArgs `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $SmokeStdoutLog `
        -RedirectStandardError $SmokeStderrLog `
        -PassThru `
        -Wait

    if (Test-Path $SmokeStdoutLog) {
        Get-Content $SmokeStdoutLog
    }
    if (Test-Path $SmokeStderrLog) {
        $stderrLines = Get-Content $SmokeStderrLog
        if ($stderrLines) {
            Write-Host "[stderr]"
            $stderrLines
        }
    }

    $suiteExitCode = $smokeProcess.ExitCode
    Write-Host "SMOKE_SUITE end exit_code=$suiteExitCode"
    exit $suiteExitCode
} finally {
    if ($startedGoHere -and -not $KeepServer -and $startedGoProcess) {
        try {
            Stop-Process -Id $startedGoProcess.Id -Force -ErrorAction SilentlyContinue
        } catch {
        }
        Start-Sleep -Milliseconds 500
    }

    if ($startedPythonHere -and -not $KeepServer -and $startedPythonProcess) {
        try {
            Stop-Process -Id $startedPythonProcess.Id -Force -ErrorAction SilentlyContinue
        } catch {
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $KeepServer) {
        Remove-TempLogs
    }
}

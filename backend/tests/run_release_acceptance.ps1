param(
    [string]$BaseUrl = $(if ($env:ADMIN_BASE_URL) { $env:ADMIN_BASE_URL } elseif ($env:GO_BASE_URL) { $env:GO_BASE_URL } else { "http://127.0.0.1:8081" }),
    [string]$AdminEmail = $(if ($env:ADMIN_EMAIL) { $env:ADMIN_EMAIL } else { "yh@qs.al" }),
    [string]$AdminPassword = $env:ADMIN_PASSWORD,
    [string]$AdminToken = $env:ADMIN_TOKEN,
    [string]$E2ESpec = $(if ($env:E2E_SPEC) { $env:E2E_SPEC } else { "business-docqa-flow.spec.ts" }),
    [string]$PerfPreset = $(if ($env:PERF_PROBE_PRESET) { $env:PERF_PROBE_PRESET } else { "release" }),
    [int]$PerfRequests = $(if ($env:PERF_PROBE_REQUESTS) { [int]$env:PERF_PROBE_REQUESTS } else { 20 }),
    [int]$PerfConcurrency = $(if ($env:PERF_PROBE_CONCURRENCY) { [int]$env:PERF_PROBE_CONCURRENCY } else { 4 }),
    [double]$MaxErrorRate = $(if ($env:PERF_PROBE_MAX_ERROR_RATE) { [double]$env:PERF_PROBE_MAX_ERROR_RATE } else { 0.0 }),
    [double]$MaxP95Ms = $(if ($env:PERF_PROBE_MAX_P95_MS) { [double]$env:PERF_PROBE_MAX_P95_MS } else { 0.0 }),
    [string[]]$BackendInclude = @(),
    [string]$ArtifactsDir = $(if ($env:RELEASE_ACCEPTANCE_ARTIFACTS_DIR) { $env:RELEASE_ACCEPTANCE_ARTIFACTS_DIR } else { "" }),
    [switch]$SkipMigrationRollbackSmoke,
    [switch]$SkipBackendSmoke,
    [switch]$SkipFrontendE2E,
    [switch]$SkipPerfProbe,
    [switch]$FailFast
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$BackendRoot = Join-Path $RepoRoot "backend"
$FrontendRoot = Join-Path $RepoRoot "frontend"
$MigrationRollbackSmoke = Join-Path $BackendRoot "tests\run_migration_rollback_smoke.py"
$SmokeSuite = Join-Path $BackendRoot "tests\run_backend_smoke_suite.py"
$PerfProbe = Join-Path $BackendRoot "tests\run_perf_probe.py"
$FrontendE2E = Join-Path $FrontendRoot "tests\run_admin_e2e.ps1"

function Resolve-PythonExe {
    $candidates = @(
        (Join-Path $BackendRoot ".venv/bin/python"),
        (Join-Path $BackendRoot ".venv\Scripts\python.exe"),
        (Join-Path $BackendRoot "venv/bin/python"),
        (Join-Path $BackendRoot "venv\Scripts\python.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }
    return $null
}

$PythonExe = Resolve-PythonExe

if (-not $ArtifactsDir) {
    $ArtifactsDir = Join-Path $RepoRoot "artifacts\release-acceptance"
}

function Test-GatewayReady {
    param([string]$Url)

    try {
        $resp = Invoke-RestMethod -Method Get -Uri "$($Url.TrimEnd('/'))/health" -TimeoutSec 10
        if ($resp.code -ne 200) {
            return $false
        }
        $data = $resp.data
        return (
            $data -and
            $data.neo4j -and $data.neo4j.connected -eq $true -and
            $data.python_backend -and $data.python_backend.connected -eq $true -and
            $data.orchestrator -and $data.orchestrator.connected -eq $true
        )
    } catch {
        return $false
    }
}

function Invoke-AcceptanceStep {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$Arguments
    )

    Write-Host "ACCEPTANCE_STEP_BEGIN name=$Name"
    $started = Get-Date
    & $FilePath @Arguments
    $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    $duration = [int]((Get-Date) - $started).TotalSeconds

    if ($exitCode -eq 0) {
        Write-Host "ACCEPTANCE_STEP_OK name=$Name duration_seconds=$duration"
    } else {
        Write-Host "ACCEPTANCE_STEP_FAIL name=$Name exit_code=$exitCode duration_seconds=$duration"
    }

    return $exitCode
}

if (-not (Test-Path $PythonExe)) {
    Write-Host "PYTHON_EXE_NOT_FOUND path=$PythonExe"
    exit 1
}

if (-not (Test-GatewayReady -Url $BaseUrl)) {
    Write-Host "GATEWAY_HEALTH_FAIL url=$BaseUrl"
    Write-Host "Start the Python capability backend and Go gateway first, then rerun release acceptance."
    exit 1
}

New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

$env:ADMIN_BASE_URL = $BaseUrl
$env:GO_BASE_URL = $BaseUrl
$env:E2E_API_BASE_URL = $BaseUrl
if (-not $env:VITE_API_BASE_URL) {
    $env:VITE_API_BASE_URL = "same-origin"
}
$env:ADMIN_EMAIL = $AdminEmail
if ($AdminPassword) { $env:ADMIN_PASSWORD = $AdminPassword }
if ($AdminToken) { $env:ADMIN_TOKEN = $AdminToken }

$failures = 0

if (-not $SkipMigrationRollbackSmoke) {
    $code = Invoke-AcceptanceStep -Name "migration-rollback-smoke" -FilePath $PythonExe -Arguments @($MigrationRollbackSmoke)
    if ($code -ne 0) {
        $failures += 1
        if ($FailFast) { exit $code }
    }
}

if (-not $SkipBackendSmoke) {
    $args = @($SmokeSuite, "--base-url", $BaseUrl)
    foreach ($name in $BackendInclude) {
        $args += "--include"
        $args += $name
    }
    if ($FailFast) {
        $args += "--fail-fast"
    }
    $code = Invoke-AcceptanceStep -Name "backend-smoke" -FilePath $PythonExe -Arguments $args
    if ($code -ne 0) {
        $failures += 1
        if ($FailFast) { exit $code }
    }
}

if (-not $SkipFrontendE2E) {
    $args = @(
        "-ExecutionPolicy", "Bypass",
        "-File", $FrontendE2E,
        "-AdminBaseUrl", $BaseUrl,
        "-AdminEmail", $AdminEmail,
        "-E2ESpec", $E2ESpec
    )
    $code = Invoke-AcceptanceStep -Name "frontend-e2e" -FilePath "powershell.exe" -Arguments $args
    if ($code -ne 0) {
        $failures += 1
        if ($FailFast) { exit $code }
    }
}

if (-not $SkipPerfProbe) {
    $perfJson = Join-Path $ArtifactsDir "perf-probe.json"
    $perfMarkdown = Join-Path $ArtifactsDir "perf-probe.md"
    $args = @(
        $PerfProbe,
        "--base-url", $BaseUrl,
        "--preset", $PerfPreset,
        "--requests", [string]$PerfRequests,
        "--concurrency", [string]$PerfConcurrency,
        "--max-error-rate", [string]$MaxErrorRate,
        "--max-p95-ms", [string]$MaxP95Ms,
        "--output-json", $perfJson,
        "--output-markdown", $perfMarkdown
    )
    $code = Invoke-AcceptanceStep -Name "perf-probe" -FilePath $PythonExe -Arguments $args
    if ($code -ne 0) {
        $failures += 1
        if ($FailFast) { exit $code }
    }
}

Write-Host "ACCEPTANCE_SUMMARY failures=$failures artifacts_dir=$ArtifactsDir"
exit $(if ($failures -eq 0) { 0 } else { 1 })

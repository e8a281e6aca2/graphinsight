param(
    [string]$AdminBaseUrl = $(if ($env:ADMIN_BASE_URL) { $env:ADMIN_BASE_URL } else { "http://127.0.0.1:8081" }),
    [string]$E2EBaseUrl = $(if ($env:E2E_BASE_URL) { $env:E2E_BASE_URL } else { "http://127.0.0.1:4173" }),
    [string]$AdminEmail = $(if ($env:E2E_ADMIN_EMAIL) { $env:E2E_ADMIN_EMAIL } elseif ($env:ADMIN_EMAIL) { $env:ADMIN_EMAIL } else { "yh@qs.al" }),
    [string]$AdminPassword = $(if ($env:E2E_ADMIN_PASSWORD) { $env:E2E_ADMIN_PASSWORD } else { $env:ADMIN_PASSWORD }),
    [string]$AdminToken = $(if ($env:E2E_ADMIN_TOKEN) { $env:E2E_ADMIN_TOKEN } else { $env:ADMIN_TOKEN }),
    [string]$CheckUiLogin = $(if ($env:E2E_CHECK_UI_LOGIN) { $env:E2E_CHECK_UI_LOGIN } else { "0" }),
    [string]$RequireBackendDependencies = $(if ($env:E2E_REQUIRE_BACKEND_DEPENDENCIES) { $env:E2E_REQUIRE_BACKEND_DEPENDENCIES } else { "1" }),
    [string]$E2ESpec = $(if ($env:E2E_SPEC) { $env:E2E_SPEC } else { "" }),
    [string]$NodeVersion = "22.22.2",
    [string]$NodeExe = $(if ($env:NODE_EXE) { $env:NODE_EXE } else { "" }),
    [string]$NpmCmd = $(if ($env:NPM_CMD) { $env:NPM_CMD } else { "" })
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$FrontendRoot = Join-Path $RepoRoot "frontend"
$BackendRoot = Join-Path $RepoRoot "backend"
$BackendPythonExe = Join-Path $BackendRoot "venv\Scripts\python.exe"
$IssueAdminTokenScript = Join-Path $BackendRoot "tests\issue_admin_token.py"

function Test-BackendReady {
    param([string]$Url)
    try {
        $resp = Invoke-RestMethod -Method Get -Uri "$Url/health" -TimeoutSec 5
        if ($resp.code -ne 200) {
            return $false
        }
        if ($RequireBackendDependencies -ne "1") {
            return $true
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

function Show-BackendHealth {
    param([string]$Url)
    try {
        $resp = Invoke-RestMethod -Method Get -Uri "$Url/health" -TimeoutSec 5
        $resp | ConvertTo-Json -Depth 8
    } catch {
        Write-Host $_.Exception.Message
    }
}

function Resolve-NodeCommand {
    $nodeVersionCmd = Get-Command node -ErrorAction SilentlyContinue
    $npmVersionCmd = Get-Command npm -ErrorAction SilentlyContinue
    $npmCmdVersionCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($nodeVersionCmd -and $npmCmdVersionCmd) {
        return @{
            Node = "node"
            Npm  = "npm.cmd"
        }
    }

    if ($NodeExe -and $NpmCmd -and (Test-Path $NodeExe) -and (Test-Path $NpmCmd)) {
        return @{
            Node = $NodeExe
            Npm  = $NpmCmd
        }
    }

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($nodeCmd -and $npmCmd -and $nodeCmd.Source -and $npmCmd.Source) {
        return @{
            Node = $nodeCmd.Source
            Npm  = $npmCmd.Source
        }
    }

    $nvmCmd = Get-Command nvm -ErrorAction SilentlyContinue
    if ($nvmCmd) {
        & $nvmCmd.Source use $NodeVersion | Out-Null
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
        if ($nodeCmd -and $npmCmd) {
            return @{
                Node = $nodeCmd.Source
                Npm  = $npmCmd.Source
            }
        }
    }

    $appData = [Environment]::GetFolderPath("ApplicationData")
    $candidates = @(
        @{
            Node = "C:\Program Files\nodejs\node.exe"
            Npm  = "C:\Program Files\nodejs\npm.cmd"
        },
        @{
            Node = Join-Path $appData "nvm\v$NodeVersion\node.exe"
            Npm  = Join-Path $appData "nvm\v$NodeVersion\npm.cmd"
        },
        @{
            Node = Join-Path $appData "nvm\nodejs\node.exe"
            Npm  = Join-Path $appData "nvm\nodejs\npm.cmd"
        }
    )

    foreach ($candidate in $candidates) {
        if ((Test-Path $candidate.Node) -and (Test-Path $candidate.Npm)) {
            return $candidate
        }
    }

    return $null
}

function Resolve-AdminToken {
    param(
        [string]$BaseUrl,
        [string]$Email,
        [string]$Password
    )
    if (-not $Password) {
        return $null
    }

    try {
        $response = Invoke-RestMethod -Method Post `
            -Uri "$($BaseUrl.TrimEnd('/'))/api/v1/admin/auth/login" `
            -ContentType "application/json" `
            -Body (@{
                username = $Email
                password = $Password
            } | ConvertTo-Json -Compress) `
            -TimeoutSec 15

        if ($response.code -eq 200 -and $response.data.token) {
            return [string]$response.data.token
        }
    } catch {
        Write-Host "ADMIN_LOGIN_PREFLIGHT_FAIL base_url=$BaseUrl email=$Email"
        if ($_.ErrorDetails.Message) {
            Write-Host $_.ErrorDetails.Message
        } else {
            Write-Host $_.Exception.Message
        }
        throw
    }

    throw "ADMIN_LOGIN_PREFLIGHT_FAIL missing token in login response"
}

function Resolve-LocalAdminToken {
    param([string]$Email)

    if (-not (Test-Path $BackendPythonExe) -or -not (Test-Path $IssueAdminTokenScript)) {
        return $null
    }

    $args = @($IssueAdminTokenScript)
    if ($Email) {
        $args += "--email"
        $args += $Email
    }

    try {
        $output = & $BackendPythonExe @args 2>$null
        if ($LASTEXITCODE -eq 0 -and $output) {
            return [string]($output | Select-Object -Last 1)
        }
    } catch {
        return $null
    }

    return $null
}

if (-not (Test-BackendReady -Url $AdminBaseUrl)) {
    Write-Host "BACKEND_HEALTH_FAIL url=$AdminBaseUrl require_dependencies=$RequireBackendDependencies"
    Show-BackendHealth -Url $AdminBaseUrl
    Write-Host "Please start Python capability backend and Go gateway first, then rerun frontend E2E."
    exit 1
}

$nodeTools = Resolve-NodeCommand
if (-not $nodeTools) {
    Write-Host "NODE_COMMAND_NOT_FOUND expected_version=$NodeVersion"
    Write-Host "Please install Node.js $NodeVersion or make nvm-windows available on PATH."
    exit 1
}

if (-not $nodeTools.Npm) {
    Write-Host "NPM_COMMAND_NOT_FOUND"
    exit 1
}

$env:ADMIN_EMAIL = $AdminEmail
if ($AdminPassword) { $env:ADMIN_PASSWORD = $AdminPassword }
$env:E2E_BASE_URL = $E2EBaseUrl
$env:VITE_API_BASE_URL = $AdminBaseUrl
$env:E2E_CHECK_UI_LOGIN = $CheckUiLogin

if (-not $AdminToken -and $AdminPassword) {
    $AdminToken = Resolve-AdminToken -BaseUrl $AdminBaseUrl -Email $AdminEmail -Password $AdminPassword
}
if (-not $AdminToken) {
    $AdminToken = Resolve-LocalAdminToken -Email $AdminEmail
    if ($AdminToken) {
        Write-Host "ADMIN_TOKEN_READY source=local"
    }
}
if (-not $AdminToken) {
    Write-Host "Missing ADMIN_PASSWORD or ADMIN_TOKEN for frontend E2E, and local token issue failed."
    exit 1
}
if ($AdminToken) { $env:ADMIN_TOKEN = $AdminToken }

Push-Location $FrontendRoot
try {
    $npmArgs = @("run", "e2e")
    if ($E2ESpec) {
        $npmArgs += "--"
        $npmArgs += $E2ESpec
    }
    if ($nodeTools.Npm -eq "npm.cmd") {
        & npm.cmd @npmArgs
    } else {
        $escapedArgs = ($npmArgs | ForEach-Object { "`"$_`"" }) -join " "
        & cmd.exe /c "`"$($nodeTools.Npm)`" $escapedArgs"
    }
    exit $LASTEXITCODE
} finally {
    Pop-Location
}

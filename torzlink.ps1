#Requires -Version 5.1
# Keep in sync with torzlink.sh — see docs/follow-ups-launchers.md
param(
    [switch]$Native,
    [switch]$Docker
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Stop-Launcher {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [int]$ExitCode = 1
    )

    Write-Host $Message -ForegroundColor Red
    exit $ExitCode
}

function Show-Menu {
    Write-Host 'TorZlink — launcher'
    Write-Host '  1) Native (Node.js, local development)'
    Write-Host '  2) Docker (interactive container)'
    Write-Host '  q) Exit'
}

function Resolve-ModeFromMenu {
    while ($true) {
        Show-Menu
        $pick = Read-Host 'Choose [1/2/q]'
        switch ($pick) {
            '1' { return 'native' }
            '2' { return 'docker' }
            { $_ -in 'q', 'Q' } { exit 0 }
            default {
                Write-Host 'Invalid option. Use 1, 2, or q.' -ForegroundColor Yellow
            }
        }
    }
}

function Resolve-ModeFromArgs {
    param([string[]]$ArgsList)

    if ($Native) { return 'native' }
    if ($Docker) { return 'docker' }

    foreach ($arg in $ArgsList) {
        switch ($arg) {
            { $_ -in '--native', '-Native', '-n', '1' } { return 'native' }
            { $_ -in '--docker', '-Docker', '-d', '2' } { return 'docker' }
        }
    }

    return $null
}

$mode = Resolve-ModeFromArgs -ArgsList $args

if (-not $mode) {
    if ([Console]::IsInputRedirected -eq $false) {
        $mode = Resolve-ModeFromMenu
    }
    else {
        Stop-Launcher 'No TTY. Use -Native or -Docker.'
    }
}

if (-not $mode) {
    Stop-Launcher 'No launch mode selected.'
}

function Require-Command {
    param(
        [string]$Name,
        [string]$Message
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Stop-Launcher $Message
    }
}

function Warn-EnvPlaceholders {
    $envPath = Join-Path $PSScriptRoot '.env'
    if (-not (Test-Path -LiteralPath $envPath)) {
        return
    }

    $content = Get-Content -LiteralPath $envPath -Raw -ErrorAction SilentlyContinue
    if ($content -match 'your-bot-token|123456789:ABCdefGHI|@mi_canal|@your_channel') {
        Write-Host 'Warning: .env contains placeholder values from .env.example.' -ForegroundColor Yellow
        Write-Host 'Replace TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID with real credentials.'
        Write-Host 'Do not enable Telegram with example or placeholder tokens.'
        Write-Host ''
    }
}

function Invoke-Native {
    Require-Command -Name 'node' -Message 'Node.js not found. Install Node 22+ (see README).'
    Require-Command -Name 'npm' -Message 'npm not found. Install Node 22+ (see README).'
    Warn-EnvPlaceholders
    npm run launch
}

function Ensure-DockerEnvFile {
    $envPath = Join-Path $PSScriptRoot '.env'
    if (Test-Path -LiteralPath $envPath) {
        return
    }

    $examplePath = Join-Path $PSScriptRoot '.env.example'
    Write-Host ''
    Write-Host '.env not found (optional — only needed for Telegram notifications).'
    Write-Host 'Docker Compose requires the file to exist.'

    if ([Console]::IsInputRedirected -eq $false) {
        $answer = Read-Host 'Create empty .env and continue? [Y/n]'
        if ($answer -match '^(n|N)$') {
            Stop-Launcher 'Docker launch cancelled. Copy .env.example to .env or create an empty .env file.'
        }
    }
    else {
        Write-Host 'Creating empty .env (non-interactive mode).' -ForegroundColor Yellow
    }

    New-Item -ItemType File -Path $envPath -Force | Out-Null
    Write-Host "Created empty .env at $envPath"
    if (Test-Path -LiteralPath $examplePath) {
        Write-Host 'Tip: copy settings from .env.example, then replace every placeholder with real values.'
        Write-Host 'Never enable Telegram with the example bot token or channel name.'
    }
    Write-Host ''
}

function Invoke-Docker {
    Require-Command -Name 'docker' -Message 'Docker not found. Install Docker Desktop (see README).'
    & docker compose version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Stop-Launcher 'docker compose not found. Install Docker Compose v2 (see README).'
    }
    Ensure-DockerEnvFile
    Warn-EnvPlaceholders
    $composeFile = Join-Path $PSScriptRoot 'packaging/docker/docker-compose.yml'
    & docker compose -f $composeFile build --quiet torzlink
    & docker compose -f $composeFile run --rm -it torzlink
}

if ($mode -eq 'docker') {
    Invoke-Docker
}
else {
    Invoke-Native
}

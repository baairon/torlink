# Deploy TorZlink from this Windows dev machine to a Docker NAS (no GHCR required).
# Build local image → scp tar → docker load → compose up on NAS.
#
# Reads NAS_* from the project .env when present:
#   NAS_HOST, NAS_USER, NAS_PASSWORD, PROXY_NET_NAME, TORZLINK_DEPLOY_DIR, TORZLINK_NETWORK_MODE
#
# Usage:
#   .\tools\deploy-from-dev.ps1
#   .\tools\deploy-from-dev.ps1 -SkipBuild
#   .\tools\deploy-from-dev.ps1 -NasUser puper -NasHost 192.168.1.5
#   .\tools\deploy-from-dev.ps1 -NasPassword (Read-Host -AsSecureString)

[CmdletBinding()]
param(
  [string]$NasHost = "",
  [string]$NasUser = "",
  [SecureString]$NasPassword,
  [string]$DeployDir = "",
  [string]$NetworkMode = "",
  [string]$ProxyNetName = "",
  [string]$ImageName = "torzlink",
  [string]$ImageTag = "",
  [switch]$SkipBuild,
  [switch]$SkipTelegramSync
)

$ErrorActionPreference = "Stop"

function Info([string]$msg) { Write-Host "-> $msg" }
function Die([string]$msg) { Write-Error "error: $msg"; exit 1 }

function Read-DotEnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path) {
    if ($line -match "^\s*#") { continue }
    if ($line -match "^\s*$Key=(.*)$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

function Coalesce([string]$Primary, [string]$Fallback) {
  if ($Primary -and $Primary.Trim().Length -gt 0) { return $Primary.Trim() }
  if ($Fallback -and $Fallback.Trim().Length -gt 0) { return $Fallback.Trim() }
  return ""
}

function ConvertTo-PlainText([SecureString]$Secure) {
  if ($null -eq $Secure -or $Secure.Length -eq 0) { return "" }
  return [System.Net.NetworkCredential]::new("", $Secure).Password
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$LocalEnv = Join-Path $RepoRoot ".env"
$Dockerfile = Join-Path $RepoRoot "packaging\docker\Dockerfile"
$ComposeSrc = Join-Path $RepoRoot "packaging\docker\docker-compose.nas.yml"
$EnvExample = Join-Path $RepoRoot "packaging\docker\.env.nas.example"
$LabelsSrc = Join-Path $RepoRoot "packaging\docker\traefik-gluetun-torzlink.labels.md"

# Priority: CLI param > process env > project .env > default
$NasHost = Coalesce $NasHost (Coalesce $env:NAS_HOST (Coalesce (Read-DotEnvValue $LocalEnv "NAS_HOST") "192.168.1.5"))
$NasUser = Coalesce $NasUser (Coalesce $env:NAS_USER (Coalesce (Read-DotEnvValue $LocalEnv "NAS_USER") "puper"))
# CLI: SecureString; env/.env: plain (PuTTY -pw needs plaintext at call site)
if ($null -ne $NasPassword -and $NasPassword.Length -gt 0) {
  $NasPasswordPlain = ConvertTo-PlainText $NasPassword
} else {
  $NasPasswordPlain = Coalesce $env:NAS_PASSWORD (Read-DotEnvValue $LocalEnv "NAS_PASSWORD")
}
$DeployDir = Coalesce $DeployDir (Coalesce $env:TORZLINK_DEPLOY_DIR (Coalesce (Read-DotEnvValue $LocalEnv "TORZLINK_DEPLOY_DIR") "/volume2/Docker_Configs/torzlink-deploy"))
$NetworkMode = Coalesce $NetworkMode (Coalesce $env:TORZLINK_NETWORK_MODE (Coalesce (Read-DotEnvValue $LocalEnv "TORZLINK_NETWORK_MODE") "direct"))
$ProxyNetName = Coalesce $ProxyNetName (Coalesce $env:PROXY_NET_NAME (Coalesce (Read-DotEnvValue $LocalEnv "PROXY_NET_NAME") "0-nas_proxy_net"))
$NasHostKey = Coalesce $env:NAS_SSH_HOSTKEY (Coalesce (Read-DotEnvValue $LocalEnv "NAS_SSH_HOSTKEY") "SHA256:hSaoxpgiKbS84xk9OkJQ/f6Z2/j6tmnVk8o0TwWb3l0")

if (-not $NasUser) {
  Die "set NAS_USER in .env or pass -NasUser"
}
if ($NetworkMode -notin @("direct", "vpn")) {
  Die "TORZLINK_NETWORK_MODE / -NetworkMode must be 'direct' or 'vpn'"
}

if (-not $ImageTag) {
  $pkg = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
  $ImageTag = "v$($pkg.version)"
}
$ImageRef = "${ImageName}:${ImageTag}"
$Remote = "${NasUser}@${NasHost}"

$sshExtra = @()
if ($env:TORZLINK_SSH_OPTS) {
  $sshExtra = $env:TORZLINK_SSH_OPTS.Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)
}
# Bypass broken Windows ssh config ACLs when present
if (Test-Path "$env:USERPROFILE\.ssh\config") {
  $sshExtra = @("-F", "NUL") + $sshExtra
}

# Prefer PuTTY plink/pscp when NAS_PASSWORD is set (OpenSSH ASKPASS is unreliable on Windows).
$askPassCmd = $null
$askPassPs1 = $null
$usePassword = -not [string]::IsNullOrWhiteSpace($NasPasswordPlain)
$plink = $null
$pscp = $null
if ($usePassword) {
  $plinkCand = @(
    "${env:ProgramFiles}\PuTTY\plink.exe",
    "${env:ProgramFiles(x86)}\PuTTY\plink.exe",
    "plink"
  )
  foreach ($c in $plinkCand) {
    if ($c -eq "plink") {
      $cmd = Get-Command plink -ErrorAction SilentlyContinue
      if ($cmd) { $plink = $cmd.Source; break }
    } elseif (Test-Path $c) { $plink = $c; break }
  }
  $pscpCand = @(
    "${env:ProgramFiles}\PuTTY\pscp.exe",
    "${env:ProgramFiles(x86)}\PuTTY\pscp.exe",
    "pscp"
  )
  foreach ($c in $pscpCand) {
    if ($c -eq "pscp") {
      $cmd = Get-Command pscp -ErrorAction SilentlyContinue
      if ($cmd) { $pscp = $cmd.Source; break }
    } elseif (Test-Path $c) { $pscp = $c; break }
  }
  if (-not $plink -or -not $pscp) {
    Die "NAS_PASSWORD set but PuTTY plink/pscp not found. Install PuTTY or use an SSH key."
  }
  Info "using NAS_PASSWORD via PuTTY plink/pscp"
}

function Invoke-PuttyProcess {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string]$Arguments
  )
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.Arguments = $Arguments
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $proc = [Diagnostics.Process]::Start($psi)
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  # Accept PuTTY host-key prompt if shown
  try { $proc.StandardInput.WriteLine("y") } catch {}
  try { $proc.StandardInput.Close() } catch {}
  $proc.WaitForExit()
  $stdout = $outTask.Result
  $stderr = $errTask.Result
  if ($stdout) { Write-Host $stdout.TrimEnd() }
  if ($stderr) { Write-Host $stderr.TrimEnd() }
  return @{ Code = $proc.ExitCode; Err = [string]$stderr; Out = [string]$stdout }
}

function ConvertTo-QuotedWinArg([string]$s) {
  if ($null -eq $s) { return '""' }
  return '"' + ($s -replace '"', '\"') + '"'
}

function Get-PlinkPrefix([bool]$Batch) {
  $parts = @("-ssh")
  if ($NasHostKey) { $parts += @("-hostkey", (ConvertTo-QuotedWinArg $NasHostKey)) }
  if ($Batch) { $parts += "-batch" }
  $parts += @("-pw", (ConvertTo-QuotedWinArg $NasPasswordPlain), (ConvertTo-QuotedWinArg $Remote))
  return ($parts -join " ")
}

function Get-PscpPrefix([bool]$Batch) {
  $parts = @()
  if ($NasHostKey) { $parts += @("-hostkey", (ConvertTo-QuotedWinArg $NasHostKey)) }
  if ($Batch) { $parts += "-batch" }
  $parts += @("-pw", (ConvertTo-QuotedWinArg $NasPasswordPlain))
  return ($parts -join " ")
}

function Test-Nas([string]$RemoteCmd) {
  if ($usePassword) {
    $arg = "$(Get-PlinkPrefix $true) $(ConvertTo-QuotedWinArg $RemoteCmd)"
    $res = Invoke-PuttyProcess -FilePath $plink -Arguments $arg
    return ($res.Code -eq 0)
  }
  $sshArgs = @()
  $sshArgs += $sshExtra
  $sshArgs += @("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", $Remote, $RemoteCmd)
  & ssh @sshArgs | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Invoke-Nas([string]$RemoteCmd) {
  if ($usePassword) {
    $arg = "$(Get-PlinkPrefix $true) $(ConvertTo-QuotedWinArg $RemoteCmd)"
    $res = Invoke-PuttyProcess -FilePath $plink -Arguments $arg
    if ($res.Code -ne 0) { Die "plink failed (exit $($res.Code)): $RemoteCmd" }
    return
  }

  $sshArgs = @()
  $sshArgs += $sshExtra
  $sshArgs += @("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", $Remote, $RemoteCmd)
  & ssh @sshArgs
  if ($LASTEXITCODE -ne 0) { Die "ssh failed (exit $LASTEXITCODE): $RemoteCmd" }
}

function Copy-ToNas([string]$LocalPath, [string]$RemotePath) {
  if ($usePassword) {
    # Stream via plink+cat — more reliable than pscp for absolute Linux paths on Windows
    $remoteShell = "cat > '$RemotePath'"
    $arg = "$(Get-PlinkPrefix $true) $(ConvertTo-QuotedWinArg $remoteShell)"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $plink
    $psi.Arguments = $arg
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $proc = [Diagnostics.Process]::Start($psi)
    $outTask = $proc.StandardOutput.ReadToEndAsync()
    $errTask = $proc.StandardError.ReadToEndAsync()
    $fs = [System.IO.File]::OpenRead($LocalPath)
    try {
      $fs.CopyTo($proc.StandardInput.BaseStream)
      $proc.StandardInput.BaseStream.Flush()
    } finally {
      $fs.Close()
      try { $proc.StandardInput.Close() } catch {}
    }
    $proc.WaitForExit()
    $stdout = $outTask.Result
    $stderr = $errTask.Result
    if ($stdout) { Write-Host $stdout.TrimEnd() }
    if ($stderr) { Write-Host $stderr.TrimEnd() }
    if ($proc.ExitCode -ne 0) { Die "plink upload failed (exit $($proc.ExitCode)): $LocalPath -> $RemotePath" }
    return
  }
  $sshArgs = @()
  $sshArgs += $sshExtra
  $sshArgs += @("-o", "StrictHostKeyChecking=accept-new", $LocalPath, "${Remote}:${RemotePath}")
  & scp @sshArgs
  if ($LASTEXITCODE -ne 0) { Die "scp failed: $LocalPath -> $RemotePath" }
}

function Copy-FromNas([string]$RemotePath, [string]$LocalPath) {
  if ($usePassword) {
    # Stream via plink+cat — pscp fails on absolute Linux paths from Windows
    $remoteShell = "cat -- '$RemotePath'"
    $arg = "$(Get-PlinkPrefix $true) $(ConvertTo-QuotedWinArg $remoteShell)"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $plink
    $psi.Arguments = $arg
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $proc = [Diagnostics.Process]::Start($psi)
    try { $proc.StandardInput.Close() } catch {}
    $errTask = $proc.StandardError.ReadToEndAsync()
    $fs = [System.IO.File]::Create($LocalPath)
    try {
      $proc.StandardOutput.BaseStream.CopyTo($fs)
      $fs.Flush()
    } finally {
      $fs.Close()
    }
    $proc.WaitForExit()
    $stderr = $errTask.Result
    if ($stderr) { Write-Host $stderr.TrimEnd() }
    if ($proc.ExitCode -ne 0) {
      Remove-Item $LocalPath -Force -ErrorAction SilentlyContinue
      Die "plink download failed (exit $($proc.ExitCode)): $RemotePath -> $LocalPath"
    }
    if (-not (Test-Path $LocalPath) -or (Get-Item $LocalPath).Length -eq 0) {
      # empty remote .env is unusual; still allow and let caller proceed
    }
    return
  }
  $sshArgs = @()
  $sshArgs += $sshExtra
  $sshArgs += @("-o", "StrictHostKeyChecking=accept-new", "${Remote}:${RemotePath}", $LocalPath)
  & scp @sshArgs
  if ($LASTEXITCODE -ne 0) { Die "scp failed: $RemotePath -> $LocalPath" }
}

function Set-EnvFileKey([string]$Path, [string]$Key, [string]$Value) {
  $lines = @(Get-Content $Path -ErrorAction SilentlyContinue)
  $found = $false
  $out = foreach ($line in $lines) {
    if ($line -match "^\s*$Key=") {
      $found = $true
      "$Key=$Value"
    } else {
      $line
    }
  }
  if (-not $found) { $out += "$Key=$Value" }
  # UTF-8 without BOM + LF — Windows PowerShell 5.1 "utf8" writes a BOM that
  # breaks docker compose --env-file on Linux (first key / values with \r).
  $text = (($out | ForEach-Object { $_ -replace "`r$", "" }) -join "`n") + "`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $text, $utf8NoBom)
}

$tmpEnv = $null
try {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Die "missing command: docker"
  }
  if ($usePassword) {
    # PuTTY path — OpenSSH ssh/scp not required
  } else {
    foreach ($cmd in @("ssh", "scp")) {
      if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Die "missing command: $cmd (or set NAS_PASSWORD and install PuTTY)"
      }
    }
  }

  Info "target $Remote  deploy=$DeployDir  image=$ImageRef  mode=$NetworkMode  net=$ProxyNetName"

  if (-not $SkipBuild) {
    Info "docker build $ImageRef"
    & docker build -f $Dockerfile -t $ImageRef $RepoRoot
    if ($LASTEXITCODE -ne 0) { Die "docker build failed" }
  } else {
    Info "skip build (using existing $ImageRef)"
    & docker image inspect $ImageRef | Out-Null
    if ($LASTEXITCODE -ne 0) { Die "local image not found: $ImageRef" }
  }

  Info "create remote dirs"
  # chown data dir to PUID/PGID so upgrades from image uid 100 can persist queue.json
  Invoke-Nas "mkdir -p '$DeployDir' /volume2/Docker_Configs/torzlink /volume1/data/media/descargas/torrents && chown -R 1000:1000 /volume2/Docker_Configs/torzlink 2>/dev/null || true && ls -ld '$DeployDir' /volume1/data/media/descargas/torrents /volume2/Docker_Configs/torzlink"

  Info "transfer image to NAS - may take a while"
  $tar = Join-Path $env:TEMP ("torzlink-" + $ImageTag + ".tar")
  try {
    Info "docker save -> $tar"
    & docker save -o $tar $ImageRef
    if ($LASTEXITCODE -ne 0) { Die "docker save failed" }
    Info "scp image archive"
    Copy-ToNas $tar "$DeployDir/torzlink-image.tar"
    Info "docker load on NAS"
    Invoke-Nas "docker load -i '$DeployDir/torzlink-image.tar' && rm -f '$DeployDir/torzlink-image.tar'"
  } finally {
    Remove-Item $tar -Force -ErrorAction SilentlyContinue
  }

  Info "copy compose + examples"
  Copy-ToNas $ComposeSrc "$DeployDir/docker-compose.nas.yml"
  Copy-ToNas $EnvExample "$DeployDir/.env.nas.example"
  if (Test-Path $LabelsSrc) {
    Copy-ToNas $LabelsSrc "$DeployDir/traefik-gluetun-torzlink.labels.md"
  }

  $tmpEnv = Join-Path $env:TEMP "torzlink-nas.env"
  if (-not (Test-Nas "test -f '$DeployDir/.env'")) {
    Info "create remote .env from example"
    Copy-Item $EnvExample $tmpEnv -Force
  } else {
    Info "fetch existing remote .env"
    Copy-FromNas "$DeployDir/.env" $tmpEnv
  }

  Set-EnvFileKey $tmpEnv "TORZLINK_IMAGE" $ImageRef
  Set-EnvFileKey $tmpEnv "TORZLINK_NETWORK_MODE" $NetworkMode
  Set-EnvFileKey $tmpEnv "DOCKER_CONFIG_ROOT" "/volume2/Docker_Configs"
  Set-EnvFileKey $tmpEnv "MEDIA_ROOT" "/volume1/data"
  Set-EnvFileKey $tmpEnv "TORZLINK_DOWNLOADS_HOST" "/volume1/data/media/descargas/torrents"
  Set-EnvFileKey $tmpEnv "PUID" "1000"
  Set-EnvFileKey $tmpEnv "PGID" "1000"
  Set-EnvFileKey $tmpEnv "TZ" "Europe/Madrid"
  Set-EnvFileKey $tmpEnv "PROXY_NET_NAME" $ProxyNetName

  $token = Read-DotEnvValue $LocalEnv "TORZLINK_SERVE_TOKEN"
  if (-not $token) { $token = Read-DotEnvValue $tmpEnv "TORZLINK_SERVE_TOKEN" }
  if (-not $token) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    Info "generated TORZLINK_SERVE_TOKEN (saved on NAS .env; copy into local .env to use the UI)"
  }
  Set-EnvFileKey $tmpEnv "TORZLINK_SERVE_TOKEN" $token

  if (-not $SkipTelegramSync) {
    foreach ($k in @("TELEGRAM_ENABLED", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID")) {
      $v = Read-DotEnvValue $LocalEnv $k
      if ($null -ne $v -and $v -ne "") { Set-EnvFileKey $tmpEnv $k $v }
    }
  }

  Copy-ToNas $tmpEnv "$DeployDir/.env"
  Invoke-Nas "chmod 600 '$DeployDir/.env'"

  Info "compose up on NAS (profile=$NetworkMode)"
  $fmt = "{{.Names}} {{.Status}} {{.Image}}"
  $gluetunName = Coalesce (Read-DotEnvValue $tmpEnv "GLUETUN_CONTAINER_NAME") (
    Coalesce (Read-DotEnvValue $LocalEnv "GLUETUN_CONTAINER_NAME") "gluetun"
  )
  Remove-Item $tmpEnv -Force -ErrorAction SilentlyContinue

  $composeCmd = "set -e; cd '$DeployDir'; " +
    "docker compose --env-file .env --profile direct -f docker-compose.nas.yml down 2>/dev/null || true; " +
    "docker compose --env-file .env --profile vpn -f docker-compose.nas.yml down 2>/dev/null || true; "
  if ($NetworkMode -eq "vpn") {
    # Use bash if/then/fi (not `{ ... }`) so PowerShell tooling never treats
    # remote-shell braces as script-block delimiters.
    $composeCmd += (
      "if ! docker inspect -f '{{.State.Running}}' '$gluetunName' 2>/dev/null | grep -qx true; then " +
      "echo `"gluetun $gluetunName not running`"; exit 1; fi; "
    )
  }
  $composeCmd += (
    "docker compose --env-file .env --profile '$NetworkMode' -f docker-compose.nas.yml up -d; " +
    "docker ps --filter name=torzlink --format '$fmt'"
  )
  Invoke-Nas $composeCmd

  Info "done. Open http://torzlink.lan (Pi-hole DNS -> Traefik). Bearer token required on /api/*."
  if ($NetworkMode -eq "vpn") {
    Info "vpn mode: ensure Traefik labels from traefik-gluetun-torzlink.labels.md are on gluetun"
  }
} finally {
  if ($tmpEnv -and (Test-Path $tmpEnv)) {
    Remove-Item $tmpEnv -Force -ErrorAction SilentlyContinue
  }
  if ($askPassCmd -and (Test-Path $askPassCmd)) {
    Remove-Item $askPassCmd -Force -ErrorAction SilentlyContinue
  }
  if ($askPassPs1 -and (Test-Path $askPassPs1)) {
    Remove-Item $askPassPs1 -Force -ErrorAction SilentlyContinue
  }
  Remove-Item Env:SSH_ASKPASS -ErrorAction SilentlyContinue
  Remove-Item Env:SSH_ASKPASS_REQUIRE -ErrorAction SilentlyContinue
  Remove-Item Env:TORZLINK_NAS_ASKPASS_PW -ErrorAction SilentlyContinue
}

$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$tailscale = "C:\Program Files\Tailscale\tailscale.exe"
$configPath = Join-Path $env:USERPROFILE ".config\opencode\opencode-roam.json"
$botHealthUrl = "http://127.0.0.1:8787/healthz"
$failed = $false

function Get-BotHealth {
  try {
    return (curl.exe -s -o NUL -w "%{http_code}" $botHealthUrl)
  } catch {
    return "000"
  }
}

function Ensure-Tailscale {
  if (-not (Test-Path $tailscale)) {
    throw "Tailscale non è installato. Scaricalo da tailscale.com/download."
  }

  $service = Get-Service Tailscale -ErrorAction SilentlyContinue
  if (-not $service) {
    throw "Servizio Tailscale non trovato."
  }

  if ($service.Status -ne "Running") {
    try {
      Start-Service Tailscale -ErrorAction Stop
      Write-Host "Tailscale: servizio avviato."
      Start-Sleep -Seconds 2
    } catch {
      throw "Non riesco ad avviare il servizio Tailscale. Prova ad aprire Tailscale o esegui come amministratore."
    }
  } else {
    Write-Host "Tailscale: servizio già attivo."
  }

  $status = $null
  try {
    $status = & $tailscale status --json 2>$null | ConvertFrom-Json
  } catch {
    $status = $null
  }

  if (-not $status -or $status.BackendState -ne "Running" -or -not $status.Self.Online) {
    $state = if ($status) { $status.BackendState } else { "sconosciuto" }
    Write-Host "Tailscale: non connesso ($state), eseguo tailscale up…"
    $process = Start-Process -FilePath $tailscale -ArgumentList "up" -NoNewWindow -PassThru
    try {
      Wait-Process -Id $process.Id -Timeout 25 -ErrorAction Stop
    } catch {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    try {
      $status = & $tailscale status --json 2>$null | ConvertFrom-Json
    } catch {
      $status = $null
    }
  }

  if (-not $status -or $status.BackendState -ne "Running" -or -not $status.Self.Online) {
    $state = if ($status) { $status.BackendState } else { "sconosciuto" }
    throw "Tailscale non connesso ($state). Se serve il login, aprilo sul PC."
  }

  Write-Host "Tailscale: connesso."
}

function Ensure-Serve {
  $serve = (& $tailscale serve status 2>&1 | Out-String)
  if ($serve -match "127\.0\.0\.1:8787") {
    Write-Host "Tailscale Serve: già configurato su 8787."
    return
  }
  if ($serve -match "proxy") {
    throw "Tailscale Serve è configurato su un'altra destinazione. Non lo cambio automaticamente."
  }

  Write-Host "Tailscale Serve: configuro la porta 8787…"
  & $tailscale serve --bg http://127.0.0.1:8787 | Out-Host
  Start-Sleep -Seconds 2
  $serve = (& $tailscale serve status 2>&1 | Out-String)
  if ($serve -notmatch "127\.0\.0\.1:8787") {
    throw "Tailscale Serve non punta a 127.0.0.1:8787."
  }
  Write-Host "Tailscale Serve: configurato."
}

function Ensure-Bot {
  if ((Get-BotHealth) -eq "200") {
    Write-Host "Bot: già attivo."
    return
  }

  Write-Host "Bot: avvio in background…"
  Start-Process -FilePath "wscript.exe" `
    -ArgumentList "`"$project\start-hidden.vbs`"" `
    -WorkingDirectory $project

  for ($i = 0; $i -lt 40; $i++) {
    if ((Get-BotHealth) -eq "200") {
      Write-Host "Bot: avviato."
      return
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Il bot non risponde su 8787. Controlla logs\bridge.log."
}

$publicUrl = ""
if (Test-Path $configPath) {
  $config = Get-Content $configPath -Raw | ConvertFrom-Json
  $publicUrl = [string]$config.web.publicUrl
  if ($publicUrl) { $publicUrl = $publicUrl.TrimEnd("/") }
}

try { Ensure-Tailscale } catch { Write-Host "ERRORE Tailscale: $($_.Exception.Message)" -ForegroundColor Red; $failed = $true }
try { Ensure-Serve } catch { Write-Host "ERRORE Tailscale Serve: $($_.Exception.Message)" -ForegroundColor Red; $failed = $true }
try { Ensure-Bot } catch { Write-Host "ERRORE bot: $($_.Exception.Message)" -ForegroundColor Red; $failed = $true }

if ($publicUrl) {
  $remoteHealth = curl.exe -s -o NUL -w "%{http_code}" "$publicUrl/healthz"
  if ($remoteHealth -eq "200") {
    Write-Host "UI via Tailscale: raggiungibile."
  } else {
    Write-Host "UI via Tailscale: NON raggiungibile (HTTP $remoteHealth)." -ForegroundColor Red
    $failed = $true
  }
} else {
  Write-Host "UI via Tailscale: web.publicUrl non impostato nella configurazione."
  $failed = $true
}

if ($failed) {
  Write-Host ""
  Write-Host "Qualcosa non è pronto: leggi gli errori sopra." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "Tutto pronto."
Write-Host "UI: $publicUrl"

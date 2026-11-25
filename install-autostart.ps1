$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath("Startup")
$target = Join-Path $startup "OpenCode Roam.vbs"
$logs = Join-Path $project "logs"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Warning "node non è nel PATH: l'avvio automatico potrebbe fallire."
}
if (-not (Test-Path (Join-Path $project "src\index.mjs"))) {
  throw "src\index.mjs non trovato. Esegui lo script dalla cartella del progetto."
}

New-Item -ItemType Directory -Force -Path $logs | Out-Null

$content = (@'
Set shell = CreateObject("WScript.Shell")
shell.Run "wscript.exe ""__VBS__""", 0, False
'@).Replace("__VBS__", (Join-Path $project "start-hidden.vbs"))

Set-Content -Path $target -Value $content -Encoding Default
Write-Host "Avvio automatico installato:"
Write-Host "  $target"
Write-Host "Log:"
Write-Host "  $(Join-Path $logs 'bridge.log')"
Write-Host ""
Write-Host "Avrà effetto al prossimo accesso a Windows. Per avviarlo subito: start.cmd"

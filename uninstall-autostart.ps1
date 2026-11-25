$ErrorActionPreference = "Stop"

$startup = [Environment]::GetFolderPath("Startup")
$target = Join-Path $startup "OpenCode Roam.vbs"

if (Test-Path $target) {
  Remove-Item $target -Force
  Write-Host "Avvio automatico rimosso: $target"
} else {
  Write-Host "Nessun avvio automatico trovato."
}

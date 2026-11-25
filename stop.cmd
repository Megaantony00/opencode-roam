@echo off
powershell -NoProfile -Command "$project = [System.IO.Path]::GetFullPath('%~dp0'); Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($project + 'src\index.mjs') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo OpenCode Roam stopped.
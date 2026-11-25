@echo off
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
curl.exe -s --fail --max-time 2 -o NUL http://127.0.0.1:8787/healthz
if not errorlevel 1 (
  echo OpenCode Roam is already running on http://127.0.0.1:8787/
  exit /b 0
)
node "%~dp0src\index.mjs"
if errorlevel 1 (
  echo.
  echo OpenCode Roam stopped with an error. Check the message above.
  pause
)
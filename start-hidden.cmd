@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
curl.exe -s --fail --max-time 2 -o NUL http://127.0.0.1:8787/healthz
if not errorlevel 1 exit /b 0
echo [%date% %time%] avvio >> logs\bridge.log
node "%~dp0src\index.mjs" >> logs\bridge.log 2>&1
@echo off
cd /d "%~dp0"
"SiteBridge\node.exe" "SiteBridge\entry.mjs" --remote
pause

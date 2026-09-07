@echo off
cd /d "%~dp0"
echo Close the existing Site Connector first. This creates a new remote code.
"SiteBridge\node.exe" "SiteBridge\entry.mjs" --remote --rotate-remote-code
pause

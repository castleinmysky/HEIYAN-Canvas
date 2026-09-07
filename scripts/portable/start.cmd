@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\node\node.exe" (
  echo Please extract the complete ZIP before starting HEIYAN.
  pause
  exit /b 1
)
"runtime\node\node.exe" "scripts\portable-launcher.mjs" start
if errorlevel 1 pause

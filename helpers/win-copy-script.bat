@echo off
setlocal
cd /d "%~dp0.."

if not exist "domscout.js" (
  echo Could not find domscout.js next to this tool's parent folder.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Clipboard -Value (Get-Content -Raw -LiteralPath 'domscout.js')"

exit /b 0

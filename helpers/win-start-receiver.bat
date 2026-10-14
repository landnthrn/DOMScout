@echo off
cd /d "%~dp0.."

if not exist "domscout.receiver.js" (
  echo Could not find domscout.receiver.js next to this tool's parent folder.
  pause
  exit /b 1
)

node domscout.receiver.js
if errorlevel 1 (
  echo Failed to start the DOMScout receiver.
  pause
  exit /b 1
)

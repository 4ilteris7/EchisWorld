@echo off
setlocal
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm were not found. Install Node.js 24 or newer, then retry.
  pause
  exit /b 1
)

echo Starting EchisWorld...
call npm.cmd run local:open
if errorlevel 1 (
  echo.
  echo EchisWorld could not start. Review the message above.
  pause
  exit /b 1
)

exit /b 0

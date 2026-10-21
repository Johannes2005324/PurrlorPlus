@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build-PurrlorPlus.ps1" %*
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)
echo.
echo Build complete.
pause

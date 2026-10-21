@echo off
pwsh -NoProfile -File "%~dp0Setup-Updates.ps1"
if errorlevel 1 (
  echo Einrichtung fehlgeschlagen. PowerShell 7 und GitHub CLI werden benoetigt.
  pause
  exit /b 1
)
pause

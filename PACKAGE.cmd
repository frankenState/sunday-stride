@echo off
setlocal
cd /d "%~dp0"
node scripts\package-desktop.mjs %*
if errorlevel 1 exit /b %errorlevel%
endlocal

@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 goto node_missing
node -e "if(Number(process.versions.node.split('.')[0])<20)process.exit(1)"
if errorlevel 1 goto node_missing
where kirocrew >nul 2>nul
if errorlevel 1 goto crew_missing
call kirocrew app install "%~dp0."
if errorlevel 1 goto failed
echo.
echo FreeChain installed. Open Kiro Crew Library, grant app trust if requested,
echo and enable FreeChain. Add provider credentials on Providers.
echo No standalone server or additional npm install is required.
if /I not "%~1"=="--quiet" pause
exit /b 0
:node_missing
echo Install Node.js 20 or newer, reopen this installer, and try again.
goto failed
:crew_missing
echo The Kiro Crew CLI is not on PATH. Open a terminal with kirocrew available,
echo then run: kirocrew app install "%~dp0."
:failed
echo Installation did not complete. Your Kiro Crew security settings were unchanged.
if /I not "%~1"=="--quiet" pause
exit /b 1

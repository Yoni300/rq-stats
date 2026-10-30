@echo off
rem Starts the RQ Stats overlay.
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing Electron, please wait...
  call npm install
)
start "" "node_modules\electron\dist\electron.exe" .

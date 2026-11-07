@echo off
REM Starts Craftly on http://127.0.0.1:5173 (installs dependencies on the first run).
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
start "" http://127.0.0.1:5173/
call npm run dev

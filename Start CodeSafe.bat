@echo off
title CodeSafe - Keep this window open
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages for the first time, please wait...
  call npm install
)
start "" /min cmd /c "timeout /t 10 /nobreak >nul && start http://localhost:3000"
call npm start
pause
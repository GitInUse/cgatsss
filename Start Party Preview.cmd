@echo off
setlocal
cd /d "%~dp0"
set "PARTY_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%PARTY_NODE%" goto launch
where node >nul 2>nul
if errorlevel 1 goto missing
set "PARTY_NODE=node"
:launch
echo Keep this window open while using the party site.
echo Close it to stop the local preview.
"%PARTY_NODE%" scripts\preview.js --open
echo.
echo The preview has stopped. Any error is shown above.
pause
exit /b
:missing
echo Node.js could not be found. The preview cannot start.
pause

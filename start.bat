@echo off
cd /d "%~dp0"
if exist "%~dp0.venv\Scripts\python.exe" (
  "%~dp0.venv\Scripts\python.exe" "%~dp0server.py"
) else (
  py -3 "%~dp0server.py"
)
pause

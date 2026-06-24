@echo off
chcp 65001 > nul
title Subculture Calendar

reg add "HKCU\Console" /v QuickEdit /t REG_DWORD /d 0 /f > nul 2>&1

:start
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8080 "') do (
    taskkill /F /PID %%a > nul 2>&1
)

cd /d "%~dp0"

set PYTHON_CMD=
rem 1순위: 실제 설치 경로 (시스템 python 런처가 깨져 있어도 동작)
set "PY_LOCAL=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if exist "%PY_LOCAL%" set PYTHON_CMD="%PY_LOCAL%"
if defined PYTHON_CMD goto found
rem 2순위 이하: PATH 상의 런처로 폴백
python --version > nul 2>&1
if %errorlevel% == 0 set PYTHON_CMD=python
if defined PYTHON_CMD goto found
py --version > nul 2>&1
if %errorlevel% == 0 set PYTHON_CMD=py
if defined PYTHON_CMD goto found
python3 --version > nul 2>&1
if %errorlevel% == 0 set PYTHON_CMD=python3
if defined PYTHON_CMD goto found

echo  [ERROR] Python not found.
echo  Install: https://www.python.org/downloads/
echo  Check 'Add Python to PATH' during install!
pause
exit /b 1

:found
if not exist "%~dp0proxy.py" (
    echo  [ERROR] proxy.py not found in %~dp0
    pause & exit /b 1
)

echo.
echo  ============================================
echo   Subculture Calendar - Local Server
echo  ============================================
echo   Python : %PYTHON_CMD%
echo   Server : http://localhost:8080
echo   Keys   : R = Restart  /  Q = Quit
echo  ============================================
echo.

start "" /B %PYTHON_CMD% "%~dp0proxy.py"
timeout /t 2 /nobreak > nul
start "" "http://localhost:8080/game-calendar-standalone.html"
echo   Browser opened.
echo.

:loop
choice /c RQ /n /t 300 /d R /m "   [R] Restart  [Q] Quit  "
if errorlevel 2 goto quit
if errorlevel 1 goto restart
goto loop

:restart
echo.
echo   Restarting...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8080 "') do (
    taskkill /F /PID %%a > nul 2>&1
)
timeout /t 1 /nobreak > nul
start "" /B %PYTHON_CMD% "%~dp0proxy.py"
timeout /t 1 /nobreak > nul
echo   Server restarted.
echo.
goto loop

:quit
echo.
echo   Stopping server...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8080 "') do (
    taskkill /F /PID %%a > nul 2>&1
)
echo   Done.
exit /b 0

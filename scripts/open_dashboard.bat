@echo off
setlocal EnableDelayedExpansion

set "PYTHON=C:\Users\Zac\AppData\Local\Python\pythoncore-3.14-64\python.exe"
set "NQ_BOT_DIR=C:\nq_bot"
set "NQ_DASHBOARD_DIR=C:\nq_dashboard"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"

REM 1. Start the always-on launcher service (port 8090) if it isn't already up.
REM    This is what the dashboard's On/Off toggle talks to -- it has to exist
REM    before that toggle can do anything.
REM
REM    Launched via PowerShell Start-Process -WindowStyle Hidden rather than
REM    "start /min cmd /c ..." -- /min still creates a real, visible-in-
REM    taskbar, closable console window; closing it (or the console session
REM    it belongs to) kills every process attached to that console group,
REM    including the trading backend the launcher spawns. Hidden means no
REM    window exists at all, so there's nothing to find or accidentally close.
curl -s -m 2 http://127.0.0.1:8090/status >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%PYTHON%' -ArgumentList '-m','app.launcher' -WorkingDirectory '%NQ_BOT_DIR%' -WindowStyle Hidden"
)

REM 2. Start the React dev server (:3000) only -- NOT "npm start", which
REM    also tries to launch backend/server.js (a Node proxy on :5000 that
REM    doesn't exist in this checkout and crashes the whole launch script).
REM    The dashboard doesn't need it: botApi/pnlApi talk straight to the
REM    Python adapter on :8080 by default. Same hidden-process approach as
REM    step 1, for the same reason.
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm run start:frontend' -WorkingDirectory '%NQ_DASHBOARD_DIR%' -WindowStyle Hidden"

REM 3. Wait (up to 60s) for the frontend to come up, then open it as a
REM    chromeless app window instead of a normal tab.
set /a tries=0
:waitloop
curl -s -m 1 -o nul http://127.0.0.1:3000
if not errorlevel 1 goto ready
set /a tries+=1
if !tries! GEQ 60 goto ready
timeout /t 1 /nobreak >nul
goto waitloop

:ready
start "" "%CHROME%" --app=http://localhost:3000 --window-size=1600,1000

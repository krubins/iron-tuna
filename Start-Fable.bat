@echo off
REM Double-click this to start the Fable draft panel.
REM It opens the bridge (which prints a login check) and then your draft.

cd /d "%~dp0"

echo.
echo   Starting the Fable bridge...
echo.

start "Fable Bridge - leave this open" cmd /k node tools\fable-bridge.js

REM Give the bridge a moment to boot and run its login check.
timeout /t 4 /nobreak >nul

REM ?fable=1 arms the panel and is remembered in this browser, so later visits
REM to the plain draft URL keep it. (Do NOT use ?admin=1 -- that opens the
REM admin dashboard instead of the draft board.)
start "" "https://irontuna.com/auctiondraft?fable=1"

exit

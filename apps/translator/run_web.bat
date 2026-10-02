@echo off
cd /d "%~dp0"
title SmartTranslator Web Server

echo ========================================================
echo   SmartTranslator AI Web Server
echo   Starting the server and opening the browser...
echo ========================================================

:: Open browser automatically (about 1.5s later, together with server start)
start "" "http://127.0.0.1:4201"

:: Run web server
npm run dev

if errorlevel 1 pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Sistema de Asistencia - U.E. Instituto Elena de Bueno

where node >nul 2>nul
if errorlevel 1 (
    echo No se encontro Node.js. Instalelo desde https://nodejs.org y vuelva a intentar.
    pause
    exit /b 1
)

echo Iniciando el Sistema de Asistencia...
echo Recuerde encender MySQL en el panel de XAMPP.
echo Para apagar el sistema cierre esta ventana o presione Ctrl+C.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000/login.html"
node server.js
pause

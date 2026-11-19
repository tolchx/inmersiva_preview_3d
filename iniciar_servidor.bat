@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Sala Inmersiva 3D - Servidor Local

cd /d "%~dp0"

if not exist "index.html" (
    echo [ERROR] No se encontro index.html en "%CD%".
    pause
    exit /b 1
)

set "PORT="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$used=[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()|ForEach-Object{$_.Port};for($p=8000;$p -le 8050;$p++){if($used -notcontains $p){try{$l=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$p);$l.Start();$l.Stop();$p;break}catch{}}}"`) do set "PORT=%%P"

if not defined PORT set "PORT=8000"

if not "%PORT%"=="8000" (
    echo [AVISO] El puerto 8000 esta ocupado. Usando puerto alternativo %PORT%.
)

echo ==================================================
echo   Sala Inmersiva 3D - Servidor Local
echo   URL: http://localhost:%PORT%/
echo   Carpeta: %CD%
echo ==================================================
echo.
echo Abriendo navegador cuando el servidor este listo...
echo (No cierres esta ventana mientras uses la app. Ctrl+C para salir.)
echo.

start "" /b powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "for($i=0;$i -lt 50;$i++){try{$c=New-Object System.Net.Sockets.TcpClient('127.0.0.1',%PORT%);$c.Close();Start-Process 'http://localhost:%PORT%/';exit 0}catch{Start-Sleep -Milliseconds 200}}"

py -3 -c "import http.server" >nul 2>&1
if %errorlevel%==0 (
    py -3 -m http.server %PORT% --bind 127.0.0.1
    goto :ended
)

python -c "import http.server" >nul 2>&1
if %errorlevel%==0 (
    python -m http.server %PORT% --bind 127.0.0.1
    goto :ended
)

python3 -c "import http.server" >nul 2>&1
if %errorlevel%==0 (
    python3 -m http.server %PORT% --bind 127.0.0.1
    goto :ended
)

if exist "%~dp0assets\server.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0assets\server.ps1" -Port %PORT% -Root "%CD%"
    goto :ended
)

echo [ERROR] No se encontro Python ni assets\server.ps1 para iniciar el servidor.
pause
exit /b 1

:ended
echo.
echo El servidor se detuvo.
pause

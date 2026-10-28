@echo off
title Cliente - Campaigns and Dragons Online
cd /d "%~dp0"

rem --- Buscar Node.js (por si Windows no lo tiene en el PATH) ---
set "PATH=%ProgramFiles%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
    echo No se encontro Node.js en este equipo.
    echo.
    echo Instalalo desde https://nodejs.org  ^(boton "LTS"^), acepta todo por defecto
    echo y vuelve a abrir este archivo.
    echo.
    pause
    exit /b 1
)

rem --- Primera vez: instalar Electron (descarga unos 100 MB) ---
if not exist "node_modules\electron\dist\electron.exe" (
    echo Instalando los componentes por primera vez. Puede tardar unos minutos...
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo No se pudo instalar. Revisa tu conexion a internet y vuelve a intentarlo.
        echo.
        pause
        exit /b 1
    )
)

call npm start
if errorlevel 1 pause

@echo off
title Editor - Campaigns and Dragons Online
cd /d "%~dp0editor"

set "PATH=%ProgramFiles%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
    echo No se encontro Node.js.
    echo Instalalo desde https://nodejs.org  ^(boton "LTS"^), acepta todo por defecto
    echo y vuelve a abrir este archivo.
    echo.
    pause
    exit /b 1
)

rem --- Python: el Editor lo usa para comprobar la campana con las mismas reglas del servidor ---
set "MESA_PYTHON="
for /d %%D in ("%LocalAppData%\Programs\Python\Python3*") do (
    if exist "%%D\python.exe" set "MESA_PYTHON=%%D\python.exe"
)
if not defined MESA_PYTHON (
    where py >nul 2>nul && set "MESA_PYTHON=py"
)
if not defined MESA_PYTHON (
    where python >nul 2>nul && set "MESA_PYTHON=python"
)
if not defined MESA_PYTHON (
    echo Aviso: no se encontro Python. El Editor funcionara, pero no podra comprobar la campana.
    echo.
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Preparando el Editor por primera vez ^(puede tardar unos minutos^)...
    call npm install
    if errorlevel 1 (
        echo.
        echo No se pudo preparar el Editor. Revisa tu conexion a internet.
        pause
        exit /b 1
    )
)

call npm start
if errorlevel 1 pause

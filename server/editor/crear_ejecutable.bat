@echo off
title Crear ejecutable del Editor - Campaigns and Dragons Online
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
    echo No se encontro Node.js. Instalalo desde https://nodejs.org ^(boton "LTS"^) y vuelve a intentarlo.
    echo Solo hace falta para FABRICAR el ejecutable: quien lo use no necesita Node ni Python.
    pause
    exit /b 1
)
echo Preparando herramientas ^(solo la primera vez, puede tardar unos minutos^)...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo No se pudieron descargar las herramientas. Revisa tu conexion a internet.
    pause
    exit /b 1
)
echo.
echo Preparando el Python que va dentro del Editor y creando el ejecutable portable...
call npm run portable
if errorlevel 1 (
    echo.
    echo Algo fallo al crear el ejecutable. Si habla de permisos o enlaces simbolicos, ejecuta este archivo como administrador.
    pause
    exit /b 1
)
echo.
echo Listo. El ejecutable esta en la carpeta "release" ^(junto a "client" y "server"^):
echo   Campaigns-and-Dragons-Editor-^<version^>.exe
echo Ponlo en una carpeta propia: a su lado se crean "campanas" y "data".
start "" "%~dp0..\..\release"
pause

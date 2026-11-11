@echo off
rem Opens LatexFrog in development mode, on the project that was left open last.
rem Interface changes show up by themselves; to stop, close the app window or this console.
rem Another project: set LF_PROYECTO=folder before running it.
rem The app also listens for a debugger on 127.0.0.1 (see docs/debugging-dev-app.md).
title LatexFrog (development)
cd /d "%~dp0"
set "PATH=%TEMP%\latexfrog-dev;%USERPROFILE%\.cargo\bin;%PATH%"
rem Without LF_PROYECTO the app reopens whatever was open last.
set "VITE_LOG=%TEMP%\latexfrog-dev\vite.log"
rem The port of the vite server. Another one: set LF_PUERTO=number before running it.
if not defined LF_PUERTO set "LF_PUERTO=5180"

rem pnpm is not on this PC's PATH and the repo's scripts call it by name.
rem Node 25 and later no longer ship corepack: then pnpm comes through npx, at the version the lockfile was made with.
if not exist "%TEMP%\latexfrog-dev" mkdir "%TEMP%\latexfrog-dev"
where corepack >nul 2>&1 && (echo @corepack pnpm %%*) > "%TEMP%\latexfrog-dev\pnpm.cmd"
where corepack >nul 2>&1 || (echo @npx --yes pnpm@10.14.0 %%*) > "%TEMP%\latexfrog-dev\pnpm.cmd"

rem pnpm links node_modules with absolute paths: if the folder was moved or copied, the links break.
rem Then the dependencies are installed again here (CI=true so pnpm does not ask for confirmation).
if not exist "node_modules\typescript\package.json" (
  echo node_modules is missing or points to another folder: installing dependencies...
  set "CI=true"
  call pnpm install --frozen-lockfile --config.engine-strict=false || goto fallo
  call node node_modules/electron/install.js || goto fallo
  set "CI="
)

call cargo build --release -p lv-sidecar || goto fallo
call pnpm electron:build || goto fallo

rem vite runs in this same console, in the background; what it writes goes to a log so it does not mix with the app.
start "" /b cmd /c "pnpm --filter=texpile-editor dev --host 127.0.0.1 --port %LF_PUERTO% --strictPort > "%VITE_LOG%" 2>&1"
call npx wait-on -t 180000 http-get://127.0.0.1:%LF_PUERTO% || goto fallo
set "ELECTRON_START_URL=http://127.0.0.1:%LF_PUERTO%"
rem Debug ports, on 127.0.0.1 only: 9222 for the window (console, network, state) and 9229 for the main process.
rem Others: set LF_DEBUG_RENDERER=number and set LF_DEBUG_MAIN=number before running it.
if not defined LF_DEBUG_RENDERER set "LF_DEBUG_RENDERER=9222"
if not defined LF_DEBUG_MAIN set "LF_DEBUG_MAIN=9229"
set "LF_DEBUG=--remote-debugging-port=%LF_DEBUG_RENDERER% --remote-debugging-address=127.0.0.1 --inspect=127.0.0.1:%LF_DEBUG_MAIN%"
if defined LF_PROYECTO (call npx electron %LF_DEBUG% . "%LF_PROYECTO%") else (call npx electron %LF_DEBUG% .)
set "SALIDA=%ERRORLEVEL%"
call :cerrar_vite
rem Closing the app closes this console. It stays open only if the app ended with an error.
if not "%SALIDA%"=="0" (
  echo.
  echo The app ended with an error ^(code %SALIDA%^): what was written above helps to find it.
  pause
)
exit /b %SALIDA%

rem vite is the process listening on port LF_PUERTO: it is closed by that process id, never by name.
:cerrar_vite
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%LF_PUERTO% .*LISTENING"') do taskkill /pid %%p /t /f >nul 2>&1
exit /b 0

:fallo
call :cerrar_vite
echo.
echo What vite wrote is in %VITE_LOG%
echo.
echo The app could not be opened: what was written above helps to find the error.
pause
exit /b 1

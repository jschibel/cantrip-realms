@echo off
rem ---------------------------------------------------------------------------
rem Merges cantrip-rs's main (the remote "upstream") into this fork's main and pushes it.
rem
rem   sync-upstream.cmd            fetch, merge, push
rem   sync-upstream.cmd /nopush    fetch and merge only
rem
rem Run it on a clean main. A conflict stops it with the merge in progress: resolve it, commit, push.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0..\.."

for /f %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
if not "%BRANCH%"=="main" (
    echo sync-upstream: on %BRANCH%, not main.
    exit /b 1
)
git diff --quiet && git diff --cached --quiet
if errorlevel 1 (
    echo sync-upstream: the working tree has changes; commit them first.
    exit /b 1
)

git fetch upstream main || exit /b 1
git fetch origin main || exit /b 1
git merge --ff-only origin/main || exit /b 1
git merge --no-edit upstream/main -m "Merge cantrip-rs main" || exit /b 1

if /i "%~1"=="/nopush" exit /b 0
git push origin main

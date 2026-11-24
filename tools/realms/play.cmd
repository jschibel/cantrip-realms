@echo off
rem ---------------------------------------------------------------------------
rem Plays Cantrip Realms on this machine, from a fresh clone: builds what is stale - the native engine host that checks
rem duels, the rules engine for the browser, the web client (the card layer), the realm server and the overworld's
rem packages - then starts the realm server with the development sign-in on a SQLite file of its own
rem (realms\web\.play), serves the card layer, starts the overworld and opens the browser signed in. Every duel is a real
rem game of Magic on the rules engine in the page, against the mob's deck played by the bot. Ctrl+C stops it all.
rem
rem   play.cmd [/offline] [/fresh] [/nobuild] [/player N] [/name NAME] [/port P] [/noopen]
rem
rem   /offline    no server: the in-memory API; duels and loot still in the real card layer, nothing kept
rem   /fresh      a new store: every character made before is gone
rem   /nobuild    start what was built last, building nothing
rem   /player N   the development sign-in's player number (1 by default): each number is its own character
rem   /name NAME  that player's name
rem   /port P     the overworld's port, 5300 by default; the realm server is on P+1, the card layer on P+2
rem   /noopen     leave the browser alone
rem
rem Card art is served when a content folder with illustrations is found: CANTRIP_ART, else this repository's content\
rem when content\mtg\images has them (the fetch-card-art skill fills it). realms\docs\tech.md, "Playing it locally".
rem ---------------------------------------------------------------------------
setlocal EnableDelayedExpansion
cd /d "%~dp0..\.."

set BUILD=1
set PASS=
:args
if "%~1"=="" goto parsed
if /i "%~1"=="/offline" set PASS=!PASS! --offline& shift & goto args
if /i "%~1"=="/fresh" set PASS=!PASS! --fresh& shift & goto args
if /i "%~1"=="/nobuild" set BUILD=0& shift & goto args
if /i "%~1"=="/noopen" set PASS=!PASS! --no-open& shift & goto args
if /i "%~1"=="/player" set PASS=!PASS! --player "%~2"& shift & shift & goto args
if /i "%~1"=="/name" set PASS=!PASS! --name "%~2"& shift & shift & goto args
if /i "%~1"=="/port" set PASS=!PASS! --port "%~2"& shift & shift & goto args
echo Unknown option %1 & exit /b 2
:parsed

if "%BUILD%"=="0" goto start

echo == The native engine host (checks every duel's log)
cargo build --profile cards -p cantrip-host || exit /b 1

echo == The rules engine for the browser
call tools\build-engine-wasm.cmd || exit /b 1

echo == The web client (the card layer)
dotnet build dotnet\src\Cantrip.Client.Web -v q -nologo || exit /b 1

echo == The realm server
dotnet build realms\dotnet\Cantrip.Realms.Server -v q -nologo || exit /b 1

echo == The cards' faces for a card layer with no server
dotnet realms\dotnet\Cantrip.Realms.Server\bin\Debug\net10.0\cantrip-realms-server.dll catalog realms\web\.cards\catalog.msgpack || exit /b 1

if not exist realms\web\node_modules (
  echo == The overworld's packages
  pushd realms\web
  call npm ci || (popd & exit /b 1)
  popd
)

pushd realms\web
call node scripts\theme.mjs || (popd & exit /b 1)
popd

:start
node realms\web\scripts\play.mjs %PASS%

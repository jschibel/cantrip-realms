@echo off
rem ---------------------------------------------------------------------------
rem The balance lab (realms\docs\tech.md C5): plays reference players against the realm's mobs, whole duels on the native
rem engine dealt as the realm server deals an encounter - the player's deck, stats and gear against the mob's deck,
rem stats and gear emblems - with the tactical bot in the player's seat and RealmBot in the mob's, and reports each
rem tier's, each boss's, each deck's and each mob's win rate with its 95% interval.
rem
rem   balance.cmd                                  the plan: T1-T2 against the starters, T3-T4 against the upgraded
rem                                                decks, the bosses against the upgraded and two-color decks
rem   balance.cmd --games 8 --boss-games 40        more games per pairing (4 and 20 by default)
rem   balance.cmd --mobs boss                      only the bosses (t1..t4, boss, wanderers, minibosses, or mob ids)
rem   balance.cmd --mobs rofellos --decks duo      one boss against the two-color decks
rem   balance.cmd --log run.jsonl --out run.md     keep each game's result, and the report
rem   balance.cmd --from a.jsonl --from b.jsonl    report logged games again, playing none
rem
rem The reference decks are decks\realms\dominaria\reference (the starters are the content's own). It plays half the
rem cores' worth of games at once (at most 16; --parallel N), each on a native host of its own. Every argument is
rem passed through; --help for the rest.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0..\.."

cargo build --profile cards -p cantrip-host -q || exit /b 2
dotnet build realms\dotnet\Cantrip.Realms.Balance -c Release -v q -nologo || exit /b 2
dotnet realms\dotnet\Cantrip.Realms.Balance\bin\Release\net10.0\cantrip-realm-balance.dll %*

endlocal & exit /b %ERRORLEVEL%

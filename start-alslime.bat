@echo off
rem AlSlime 起動用バッチ（Windows）
rem 本体 alslime.exe を起動し、数秒待ってから既定のブラウザで画面を開きます。
rem 起動設定でポートを変更した場合は、下の URL のポート番号（3000）を書き換えてください。

cd /d "%~dp0"
if not exist "%~dp0alslime.exe" (
    echo alslime.exe が見つかりません。このバッチは alslime.exe と同じフォルダに置いてください。
    pause
    exit /b 1
)

start "AlSlime" "%~dp0alslime.exe"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:3000"

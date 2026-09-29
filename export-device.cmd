@echo off
cd /d "%~dp0"
node src\archive.mjs --export
pause

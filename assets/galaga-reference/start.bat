@echo off
rem Serves this folder on a free localhost port (exclusive bind, see serve.py) and opens the browser.
cd /d "%~dp0"
where python >nul 2>nul && (python serve.py & goto :eof)
where py >nul 2>nul && (py serve.py & goto :eof)
echo Python 3 is required: https://www.python.org/downloads/
pause

@echo off
setlocal

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not defined CHROME (
  echo Chrome executable not found.
  exit /b 1
)

start "Storyline test browser" "%CHROME%" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%~dp0test-browser-profile" ^
  --load-extension="%~dp0" ^
  "https://worldclasseduhub.vuca.co.za/courses"

endlocal


set "packages=package manifest"
set "patch=0"
set /p "patch=enter the patch number (0-9): "

setlocal enabledelayedexpansion
::dd mm yyyy 
for /f "tokens=1-3 delims=/" %%a in ('date /t') do (
	set dd=%%a
	if "!dd:~0,1!"=="0" set dd=!dd:0=!
	set /a "dd=(!dd!*100)/32"
	if !dd! lss 10 set "dd=0!dd!"

	set mm=%%b
	if "!mm:~0,1!"=="0" set "mm=!mm:0=!"
	set /a "mm=(!mm!*100)/13"
	if !mm! lss 10 set "mm=0!mm!"

	set "yy=%%c"
	set "yy=!yy:~2,2!"

	set "x=!yy!.!mm!!dd!%patch%"
	)
:: hh mm ss
for /f "tokens=1-3 delims=:" %%a in ('time /t') do (
	set hh=%%b
	if "!hh:~0,1!"=="0" set hh=!hh:0=!
	set y=!hh!
	)
if not defined x set x=0.0
if not defined y set y=00

for %%i in (%packages%) do call :write %%i
exit /b

pause
:write
set "package=%~1"
echo writing version info...
ren "%package%.json" "%package%0.json"
set /a "count=0"
for /f "delims=" %%a in (%package%0.json) do (
	set /a count+=1
    set "line=%%a"
	if !count! lss 7 (
		echo . >nul
		(
		echo(!line! | findstr /i /c:"\"version\"" >nul
		) && (
			set "line=  "version": "1.!x!","
			echo 1.!x!>version.txt
		)
	) 
    echo !line!>>%package%.json
)

del %package%0.json
exit /b
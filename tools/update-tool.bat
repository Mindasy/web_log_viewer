@echo off
setlocal enabledelayedexpansion

:: === Auto detect Windows system proxy ===
set PROXY_ADDR=
for /f "tokens=*" %%a in ('powershell -command "$p=Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue; if($p.ProxyEnable -eq 1){$s=$p.ProxyServer; if($s -match 'http=([^;]+)'){$Matches[1]}else{$s}}"') do set PROXY_ADDR=%%a

if not "%PROXY_ADDR%"=="" (
    set HTTP_PROXY=http://%PROXY_ADDR%
    set HTTPS_PROXY=http://%PROXY_ADDR%
    echo [Proxy] Using Windows system proxy: %PROXY_ADDR%
) else (
    echo [Proxy] No system proxy detected, connecting directly.
)
echo.

:: === Script settings ===
set REPO=%1
set ASSET_NAME=%2
if "%REPO%"=="" set REPO=Mindasy/web_log_viewer
if "%ASSET_NAME%"=="" set ASSET_NAME=weblogviewer.tar.gz
set EXTRACT_DIR=%ASSET_NAME:.tar.gz=%

echo Repository: %REPO%
echo Target asset: %ASSET_NAME%
echo.

:: === Check dependencies ===
curl --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] curl not found. Please install curl.
    pause
    exit /b 1
)

tar --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] tar not found. Ensure Windows 10 1803+.
    pause
    exit /b 1
)

:: === Remove old files ===
echo Removing old asset: %ASSET_NAME%
del /f /q "%ASSET_NAME%" 2>nul
echo Removing old extract dir: %EXTRACT_DIR%
rmdir /s /q "%EXTRACT_DIR%" 2>nul
echo.

:: === Fetch latest release (with --ssl-no-revoke) ===
echo Fetching latest release info...
set API_URL=https://api.github.com/repos/%REPO%/releases/latest
set JSON_FILE=%TEMP%\release.json

curl --ssl-no-revoke -s -H "Accept: application/vnd.github.v3+json" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)" "%API_URL%" -o "%JSON_FILE%"

if errorlevel 1 (
    echo [ERROR] curl command failed. Check network connectivity.
    echo [HINT] Please manually test: curl --ssl-no-revoke -v "%API_URL%"
    pause
    exit /b 1
)

:: Check if response contains error (rate limit, etc)
findstr /i "message" "%JSON_FILE%" >nul
if not errorlevel 1 (
    echo [ERROR] GitHub API returned an error. Response:
    type "%JSON_FILE%"
    del "%JSON_FILE%" 2>nul
    pause
    exit /b 1
)

:: === Parse asset URL ===
for /f "delims=" %%i in ('
    powershell -command "$json = Get-Content '%JSON_FILE%' | ConvertFrom-Json; $asset = $json.assets | Where-Object { $_.name -eq '%ASSET_NAME%' }; if ($asset) { $asset.browser_download_url } else { '' }"
') do set DOWNLOAD_URL=%%i

if "%DOWNLOAD_URL%"=="" (
    echo [ERROR] Asset '%ASSET_NAME%' not found in the latest release.
    echo Available assets:
    powershell -command "$json = Get-Content '%JSON_FILE%' | ConvertFrom-Json; $json.assets | ForEach-Object { $_.name }"
    del "%JSON_FILE%" 2>nul
    pause
    exit /b 1
)

echo Download URL: %DOWNLOAD_URL%
echo.

:: === Download asset (with --ssl-no-revoke) ===
set TMP_FILE=%TEMP%\asset.tar.gz
echo Downloading...
curl --ssl-no-revoke -L -o "%TMP_FILE%" "%DOWNLOAD_URL%"
if errorlevel 1 (
    echo [ERROR] Download failed.
    del "%JSON_FILE%" 2>nul
    pause
    exit /b 1
)

:: === Extract ===
mkdir "%EXTRACT_DIR%" 2>nul
echo Extracting to: %EXTRACT_DIR%
tar -xzf "%TMP_FILE%" -C "%EXTRACT_DIR%"
if errorlevel 1 (
    echo [ERROR] Extraction failed.
    del "%TMP_FILE%" "%JSON_FILE%" 2>nul
    pause
    exit /b 1
)

:: === Cleanup ===
del "%TMP_FILE%" "%JSON_FILE%" 2>nul

echo.
echo [SUCCESS] Extracted to .\%EXTRACT_DIR%
pause
endlocal
@echo off
setlocal enabledelayedexpansion

echo 🌐 Setting up Cloudflare Tunnel for RVC Peter Griffin API...

REM Set the exact path to cloudflared
set CLOUDFLARED_PATH="C:\PROGRA~2\cloudflared\cloudflared.exe"

REM Check if cloudflared exists at the specified path
if not exist "%CLOUDFLARED_PATH%" (
    echo ❌ cloudflared not found at: %CLOUDFLARED_PATH%
    echo Please make sure cloudflared is installed at this location
    pause
    exit /b 1
)

echo ✅ cloudflared found at: %CLOUDFLARED_PATH%

REM Check if .env file exists
if not exist ".env" (
    echo ❌ .env file not found
    echo Please create a .env file with CLOUDFLARE_TUNNEL_TOKEN=your_token
    pause
    exit /b 1
)

REM Read CLOUDFLARE_TUNNEL_TOKEN from .env file
echo 🔑 Reading tunnel token from .env...
set "TUNNEL_TOKEN="

for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    if "%%a"=="CLOUDFLARE_TUNNEL_TOKEN" (
        set "TUNNEL_TOKEN=%%b"
    )
)

if not defined TUNNEL_TOKEN (
    echo ❌ CLOUDFLARE_TUNNEL_TOKEN not found in .env file
    echo Make sure your .env file contains: CLOUDFLARE_TUNNEL_TOKEN=your_token
    pause
    exit /b 1
)

REM Remove any potential whitespace or quotes
set "TUNNEL_TOKEN=%TUNNEL_TOKEN: =%"
set "TUNNEL_TOKEN=%TUNNEL_TOKEN:"=%"

echo 🚀 Starting Cloudflare tunnel...
echo 📡 Tunnel will be available at: https://goonly.norrevik.ai/tts/
echo ⚠️  Make sure your RVC API is running on localhost:8000
echo.

REM Start the tunnel with the exact command specified
%CLOUDFLARED_PATH% tunnel run --token "%TUNNEL_TOKEN%" --protocol h2mux --max-upstream-conns 5 --retries 3

echo.
echo ❌ Tunnel stopped or encountered an error
pause

@echo off
setlocal enabledelayedexpansion
echo 🚀 Setting up RVC Peter Griffin API environment...

REM Check if python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Error: Python not found. Please install Python 3.10 first.
    echo Download from: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM Check Python version
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo 🐍 Found Python version: %PYTHON_VERSION%

REM Extract major.minor version
for /f "tokens=1,2 delims=." %%a in ("%PYTHON_VERSION%") do (
    set MAJOR=%%a
    set MINOR=%%b
)

if not "%MAJOR%.%MINOR%"=="3.10" (
    echo ❌ Warning: Expected Python 3.10, but found %PYTHON_VERSION%
    echo This may still work, but Python 3.10 is recommended.
    timeout /t 3 >nul
)

REM Check if ffmpeg is available
echo 🔍 Checking for ffmpeg...
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo ❌ ffmpeg not found. Attempting to install...
    
    REM Try chocolatey first
    choco --version >nul 2>&1
    if not errorlevel 1 (
        echo 📦 Installing ffmpeg via chocolatey...
        choco install ffmpeg -y
        if not errorlevel 1 (
            echo ✅ ffmpeg installed successfully via chocolatey
        ) else (
            echo ❌ Failed to install ffmpeg via chocolatey
            goto :manual_ffmpeg
        )
    ) else (
        echo ⚠️ Chocolatey not found, trying manual installation...
        goto :manual_ffmpeg
    )
) else (
    echo ✅ ffmpeg is already installed
)

goto :continue_setup

:manual_ffmpeg
echo 📥 Downloading ffmpeg manually...
if not exist "ffmpeg" mkdir ffmpeg
cd ffmpeg

REM Check if ffmpeg.exe already exists
if exist "ffmpeg.exe" (
    echo ✅ ffmpeg.exe already exists in local directory
    set "PATH=%CD%;%PATH%"
    cd ..
    goto :continue_setup
)

REM Download ffmpeg for Windows
powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' -OutFile 'ffmpeg.zip'}"

if exist "ffmpeg.zip" (
    echo 📦 Extracting ffmpeg...
    powershell -Command "Expand-Archive -Path 'ffmpeg.zip' -DestinationPath '.' -Force"
    
    REM Find the extracted directory and move ffmpeg.exe
    for /d %%d in (ffmpeg-master-latest-win64-gpl) do (
        if exist "%%d\bin\ffmpeg.exe" (
            copy "%%d\bin\ffmpeg.exe" "ffmpeg.exe" >nul
            copy "%%d\bin\ffprobe.exe" "ffprobe.exe" >nul
            rmdir /s /q "%%d" >nul 2>&1
        )
    )
    
    del "ffmpeg.zip" >nul 2>&1
    
    if exist "ffmpeg.exe" (
        echo ✅ ffmpeg installed successfully
        set "PATH=%CD%;%PATH%"
    ) else (
        echo ❌ Failed to extract ffmpeg
        echo Please install ffmpeg manually and add it to your PATH
        echo Download from: https://ffmpeg.org/download.html
        pause
        exit /b 1
    )
) else (
    echo ❌ Failed to download ffmpeg
    echo Please install ffmpeg manually and add it to your PATH
    echo Download from: https://ffmpeg.org/download.html
    pause
    exit /b 1
)

cd ..

:continue_setup
REM Verify ffmpeg is working
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo ❌ ffmpeg installation failed or not in PATH
    echo Please install ffmpeg manually and add it to your PATH
    echo Download from: https://ffmpeg.org/download.html
    pause
    exit /b 1
) else (
    echo ✅ ffmpeg is ready
)

REM Change to rvc directory
cd /d "%~dp0rvc"

REM Remove existing virtual environment if it exists and check Python version
if exist "rvc_env" (
    call rvc_env\Scripts\activate.bat
    for /f "tokens=2" %%i in ('python --version 2^>^&1') do set VENV_PYTHON_VERSION=%%i
    call rvc_env\Scripts\deactivate.bat
    
    for /f "tokens=1,2 delims=." %%a in ("%VENV_PYTHON_VERSION%") do (
        set VENV_MAJOR=%%a
        set VENV_MINOR=%%b
    )
    
    if not "!VENV_MAJOR!.!VENV_MINOR!"=="!MAJOR!.!MINOR!" (
        echo 🗑️ Removing existing virtual environment (wrong Python version: %VENV_PYTHON_VERSION%^)...
        rmdir /s /q rvc_env
    )
)

REM Check if virtual environment exists
if not exist "rvc_env" (
    echo 📦 Creating virtual environment with Python %PYTHON_VERSION%...
    python -m venv rvc_env
    if errorlevel 1 (
        echo ❌ Error: Failed to create virtual environment
        pause
        exit /b 1
    )
)

REM Activate virtual environment
echo 🔌 Activating virtual environment...
call rvc_env\Scripts\activate.bat

REM Verify we're using the correct Python version in the venv
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set VENV_PYTHON_VERSION=%%i
echo ✅ Virtual environment Python version: %VENV_PYTHON_VERSION%

REM Upgrade pip and install requirements
echo 📥 Installing Python dependencies... (this may take a while)
python -m pip install --upgrade pip --quiet >nul 2>&1
python -m pip install "pip<24.1" --quiet >nul 2>&1

REM Install requirements
python -m pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo ❌ Error: Failed to install Python requirements
    pause
    exit /b 1
)

REM Verify uvicorn is installed and working
python -m uvicorn --version >nul 2>&1
if errorlevel 1 (
    echo 🔧 Fixing uvicorn installation...
    python -m pip install --force-reinstall uvicorn --quiet
    python -m uvicorn --version >nul 2>&1
    if errorlevel 1 (
        echo ❌ Error: Failed to install uvicorn
        pause
        exit /b 1
    )
)

echo ✅ Setup complete!
echo.
echo 🚨 IMPORTANT: The virtual environment is active in this window only.
echo.
echo 🚀 Starting API server...
echo Press Ctrl+C to stop the server
echo.

set PYTORCH_ENABLE_MPS_FALLBACK=1
python -m uvicorn api:app --reload 
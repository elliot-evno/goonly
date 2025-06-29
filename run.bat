@echo off
echo 🚀 Starting RVC API server...

REM Change to rvc directory
cd /d "%~dp0rvc"

REM Check if virtual environment exists
if not exist "rvc_env" (
    echo ❌ Error: Virtual environment not found. Please run startup.bat first.
    pause
    exit /b 1
)

REM Activate virtual environment
call rvc_env\Scripts\activate.bat

REM Check if uvicorn is available
python -m uvicorn --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Error: uvicorn not found. Please run startup.bat to set up the environment.
    pause
    exit /b 1
)

echo ✅ Virtual environment activated
echo 🌐 Starting API server on http://localhost:8000
echo Press Ctrl+C to stop the server
echo.

set PYTORCH_ENABLE_MPS_FALLBACK=1
python -m uvicorn api:app --reload 
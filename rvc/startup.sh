#!/bin/bash

echo "🚀 Setting up RVC Peter Griffin API environment..."

# Check if python3.10 is available
if ! command -v python3.10 &> /dev/null; then
    echo "❌ Error: python3.10 not found. Please install Python 3.10 first."
    echo "On macOS: brew install python@3.10"
    exit 1
fi

# Check Python version
PYTHON_VERSION=$(python3.10 --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
echo "🐍 Found Python version: $PYTHON_VERSION"

if [[ "$PYTHON_VERSION" != "3.10" ]]; then
    echo "❌ Error: Expected Python 3.10, but found $PYTHON_VERSION"
    exit 1
fi

# Remove existing virtual environment if it exists and was created with wrong Python version
if [ -d "rvc_env" ]; then
    VENV_PYTHON_VERSION=$(rvc_env/bin/python --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
    if [[ "$VENV_PYTHON_VERSION" != "3.10" ]]; then
        echo "🗑️  Removing existing virtual environment (wrong Python version: $VENV_PYTHON_VERSION)..."
        rm -rf rvc_env
    fi
fi

# Check if virtual environment exists
if [ ! -d "rvc_env" ]; then
    echo "📦 Creating virtual environment with Python 3.10..."
    python3.10 -m venv rvc_env
fi

# Activate virtual environment
echo "🔌 Activating virtual environment..."
source rvc_env/bin/activate

# Verify we're using the correct Python version in the venv
VENV_PYTHON_VERSION=$(python --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
echo "✅ Virtual environment Python version: $VENV_PYTHON_VERSION"

if [[ "$VENV_PYTHON_VERSION" != "3.10" ]]; then
    echo "❌ Error: Virtual environment is using Python $VENV_PYTHON_VERSION instead of 3.10"
    echo "Try deleting the rvc_env folder and running this script again"
    exit 1
fi
# Upgrade pip and downgrade to compatible version
python -m pip install --upgrade pip --quiet > /dev/null 2>&1
python -m pip install "pip<24.1" --quiet > /dev/null 2>&1

# Install requirements
python -m pip install -r requirements.txt --quiet > /dev/null 2>&1

# Verify uvicorn is installed and working
if ! python -m uvicorn --version &> /dev/null; then
    python -m pip install --force-reinstall uvicorn --quiet > /dev/null 2>&1
    if ! python -m uvicorn --version &> /dev/null; then
        exit 1
    fi
fi

echo "✅ Setup complete!"
echo ""
echo "🚨 IMPORTANT: The virtual environment is only active during this script."

echo "🚀 Starting API server..."
echo "Press Ctrl+C to stop the server"
echo ""
export PYTORCH_ENABLE_MPS_FALLBACK=1
exec python -m uvicorn api:app --reload

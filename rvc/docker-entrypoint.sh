#!/bin/bash
set -e

echo "🚀 Starting RVC Voice Conversion API..."

# Function to check if models exist
check_models() {
    local missing_files=()
    
    # Check for model files
    if [ ! -f "rvc/assets/weights/peter.pth" ]; then
        missing_files+=("rvc/assets/weights/peter.pth")
    fi
    
    if [ ! -f "rvc/assets/weights/stewie.pth" ]; then
        missing_files+=("rvc/assets/weights/stewie.pth")
    fi
    
    if [ ! -f "rvc/assets/weights/peter.index" ]; then
        missing_files+=("rvc/assets/weights/peter.index")
    fi
    
    if [ ! -f "rvc/assets/weights/stewie.index" ]; then
        missing_files+=("rvc/assets/weights/stewie.index")
    fi
    
    if [ ! -f "rvc/assets/hubert/hubert_base.pt" ]; then
        missing_files+=("rvc/assets/hubert/hubert_base.pt")
    fi
    
    if [ ${#missing_files[@]} -gt 0 ]; then
        echo "⚠️  Warning: Missing model files:"
        for file in "${missing_files[@]}"; do
            echo "   - $file"
        done
        echo "The API will start but voice conversion may not work properly."
        echo "Please mount the model files as volumes or copy them to the container."
        echo ""
    else
        echo "✅ All required model files found"
    fi
}

# Function to wait for dependencies
wait_for_dependencies() {
    echo "🔍 Checking dependencies..."
    
    # Test if Python imports work
    python -c "import torch; print(f'PyTorch version: {torch.__version__}')" || {
        echo "❌ PyTorch import failed"
        exit 1
    }
    
    python -c "import fastapi; print(f'FastAPI available')" || {
        echo "❌ FastAPI import failed"
        exit 1
    }
    
    echo "✅ Dependencies check passed"
}

# Create necessary directories
mkdir -p temp uploads logs

# Check environment variables
if [ -z "$ELEVENLABS_API_KEY" ]; then
    echo "⚠️  Warning: ELEVENLABS_API_KEY not set. TTS may not work."
fi

# Check models
check_models

# Wait for dependencies
wait_for_dependencies

# Set default values for environment variables
export PYTORCH_ENABLE_MPS_FALLBACK=${PYTORCH_ENABLE_MPS_FALLBACK:-1}

# Handle different run modes
case "${1:-default}" in
    "dev")
        echo "🔧 Starting in development mode with reload..."
        exec python -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload
        ;;
    "prod")
        echo "🚀 Starting in production mode..."
        exec python -m uvicorn api:app --host 0.0.0.0 --port 8000 --workers 1
        ;;
    "shell")
        echo "🐚 Starting shell..."
        exec /bin/bash
        ;;
    "default"|*)
        echo "🚀 Starting API server..."
        exec python -m uvicorn api:app --host 0.0.0.0 --port 8000
        ;;
esac 
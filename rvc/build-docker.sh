#!/bin/bash

set -e

echo "🐳 RVC Voice Conversion API - Docker Setup"
echo "========================================="

# Function to check if Docker is running
check_docker() {
    if ! docker info >/dev/null 2>&1; then
        echo "❌ Docker is not running. Please start Docker and try again."
        exit 1
    fi
    echo "✅ Docker is running"
}

# Function to check if docker-compose is available
check_docker_compose() {
    if command -v docker-compose >/dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker-compose"
    elif docker compose version >/dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
    else
        echo "❌ Docker Compose not found. Please install Docker Compose."
        exit 1
    fi
    echo "✅ Docker Compose found: $DOCKER_COMPOSE_CMD"
}

# Function to check NVIDIA Docker support
check_nvidia_docker() {
    if command -v nvidia-docker >/dev/null 2>&1 || docker info | grep -q nvidia; then
        echo "✅ NVIDIA Docker support detected"
        return 0
    else
        echo "⚠️  NVIDIA Docker support not detected"
        return 1
    fi
}

# Function to check environment file
check_env_file() {
    if [ ! -f ".env" ]; then
        echo "⚠️  No .env file found. Creating one from example..."
        if [ -f "env.example" ]; then
            cp env.example .env
            echo "📋 Created .env file from env.example"
            echo "⚠️  Please edit .env and add your API keys before proceeding!"
            echo ""
            echo "Required variables:"
            echo "  - ELEVENLABS_API_KEY"
            echo "  - PETER_VOICE_ID"
            echo "  - STEWIE_VOICE_ID"
            echo ""
            read -p "Press Enter after updating .env file to continue..."
        else
            echo "❌ No env.example file found. Please create a .env file manually."
            exit 1
        fi
    else
        echo "✅ .env file found"
    fi
}

# Function to check model files
check_models() {
    local missing_files=()
    
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
    
    if [ ${#missing_files[@]} -gt 0 ]; then
        echo "⚠️  Warning: Missing model files:"
        for file in "${missing_files[@]}"; do
            echo "   - $file"
        done
        echo ""
        echo "The container will start but voice conversion may not work properly."
        echo "Please add the model files to continue."
        echo ""
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Setup cancelled."
            exit 1
        fi
    else
        echo "✅ All model files found"
    fi
}

# Function to create necessary directories
create_directories() {
    echo "📁 Creating necessary directories..."
    mkdir -p temp uploads logs ssl
    echo "✅ Directories created"
}

# Function to build the image
build_image() {
    local mode=${1:-"default"}
    echo "🔨 Building Docker image for mode: $mode..."
    
    case $mode in
        "gpu")
            $DOCKER_COMPOSE_CMD -f docker-compose.gpu.yml build
            ;;
        *)
            $DOCKER_COMPOSE_CMD build
            ;;
    esac
    
    echo "✅ Docker image built successfully"
}

# Function to start services
start_services() {
    local mode=${1:-"default"}
    
    case $mode in
        "dev")
            echo "🔧 Starting in development mode..."
            $DOCKER_COMPOSE_CMD -f docker-compose.yml -f docker-compose.dev.yml up -d
            ;;
        "gpu")
            echo "🚀 Starting with GPU support..."
            $DOCKER_COMPOSE_CMD -f docker-compose.gpu.yml up -d
            ;;
        "nginx")
            echo "🌐 Starting with Nginx proxy..."
            $DOCKER_COMPOSE_CMD --profile with-nginx up -d
            ;;
        *)
            echo "🚀 Starting in production mode..."
            $DOCKER_COMPOSE_CMD up -d
            ;;
    esac
    
    echo "✅ Services started"
}

# Function to check service health
check_health() {
    echo "🏥 Checking service health..."
    sleep 10  # Wait for services to start
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s http://localhost:8000/health >/dev/null 2>&1; then
            echo "✅ API is healthy and responding"
            curl -s http://localhost:8000/health | python -m json.tool 2>/dev/null || echo "API responding"
            return 0
        fi
        
        echo "⏳ Waiting for API to start (attempt $attempt/$max_attempts)..."
        sleep 5
        ((attempt++))
    done
    
    echo "❌ API health check failed after $max_attempts attempts"
    echo "Checking container logs..."
    
    case $MODE in
        "gpu")
            $DOCKER_COMPOSE_CMD -f docker-compose.gpu.yml logs --tail=20 rvc-api
            ;;
        *)
            $DOCKER_COMPOSE_CMD logs --tail=20 rvc-api
            ;;
    esac
    return 1
}

# Function to show usage information
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -m, --mode MODE     Set run mode: default, dev, gpu, nginx (default: default)"
    echo "  -h, --help         Show this help message"
    echo "  --no-build         Skip building the image"
    echo "  --no-health        Skip health check"
    echo ""
    echo "Examples:"
    echo "  $0                  # Build and run in production mode (CPU)"
    echo "  $0 -m dev          # Build and run in development mode"
    echo "  $0 -m gpu          # Build and run with GPU support"
    echo "  $0 -m nginx        # Build and run with Nginx proxy"
    echo "  $0 --no-build      # Start without rebuilding"
    echo ""
    echo "Modes:"
    echo "  default - Production mode with CPU-only support"
    echo "  dev     - Development mode with hot reload"
    echo "  gpu     - Production mode with NVIDIA GPU support"
    echo "  nginx   - Production mode with Nginx reverse proxy"
}

# Parse command line arguments
MODE="default"
BUILD=true
HEALTH_CHECK=true

while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mode)
            MODE="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        --no-build)
            BUILD=false
            shift
            ;;
        --no-health)
            HEALTH_CHECK=false
            shift
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Main execution
main() {
    echo "Starting RVC Docker setup with mode: $MODE"
    echo ""
    
    # Checks
    check_docker
    check_docker_compose
    
    # Check GPU support if GPU mode is requested
    if [ "$MODE" = "gpu" ]; then
        if ! check_nvidia_docker; then
            echo "❌ GPU mode requested but NVIDIA Docker support not available"
            echo "Please install nvidia-docker2 or use a different mode"
            exit 1
        fi
    fi
    
    check_env_file
    check_models
    create_directories
    
    # Build and start
    if [ "$BUILD" = true ]; then
        build_image "$MODE"
    fi
    
    start_services "$MODE"
    
    # Health check
    if [ "$HEALTH_CHECK" = true ]; then
        if check_health; then
            echo ""
            echo "🎉 RVC Voice Conversion API is ready!"
            echo ""
            echo "API URL: http://localhost:8000"
            echo "Health Check: http://localhost:8000/health"
            echo "Available Characters: http://localhost:8000/characters"
            echo ""
            if [ "$MODE" = "gpu" ]; then
                echo "🚀 Running with GPU acceleration!"
            fi
            echo ""
            echo "Example usage:"
            echo "curl -X POST http://localhost:8000/tts/ \\"
            echo "  -F \"text=Hello, this is a test\" \\"
            echo "  -F \"character=peter\" \\"
            echo "  -o output.wav"
            echo ""
            case $MODE in
                "gpu")
                    echo "To view logs: $DOCKER_COMPOSE_CMD -f docker-compose.gpu.yml logs -f"
                    echo "To stop: $DOCKER_COMPOSE_CMD -f docker-compose.gpu.yml down"
                    ;;
                *)
                    echo "To view logs: $DOCKER_COMPOSE_CMD logs -f"
                    echo "To stop: $DOCKER_COMPOSE_CMD down"
                    ;;
            esac
        else
            echo "❌ Setup completed but API is not responding correctly"
            exit 1
        fi
    fi
}

# Run main function
main 
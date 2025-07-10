# Use Python 3.10 slim as base image
FROM python:3.10-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTORCH_ENABLE_MPS_FALLBACK=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    build-essential \
    git \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements files
COPY requirements-docker.txt requirements.txt ./

# Upgrade pip and install Python dependencies
RUN python -m pip install --upgrade pip && \
    python -m pip install "pip<24.1"

# Install PyTorch first (helps with dependency resolution)
RUN python -m pip install torch==2.1.0 torchaudio==2.1.0 torchvision==0.16.0 --index-url https://download.pytorch.org/whl/cpu

# Install onnxruntime (CPU version for Docker compatibility)
RUN python -m pip install onnxruntime

# Install remaining requirements
RUN python -m pip install -r requirements-docker.txt

# Copy the entrypoint script first
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Copy the entire application
COPY . .

# Create necessary directories
RUN mkdir -p assets/weights assets/hubert assets/rmvpe temp uploads logs

# Set proper permissions
RUN chmod +x startup.sh

# Expose the port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Set entrypoint
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Default command
CMD ["default"] 
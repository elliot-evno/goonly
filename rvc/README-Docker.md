# RVC Voice Conversion API - Docker Setup

This directory contains Docker configuration for running the RVC (Real-time Voice Conversion) API in a containerized environment.

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Model files (see Model Setup section)
- Environment variables configured

### Basic Setup

1. **Copy your model files** to the `rvc/assets/` directory:
   ```
   rvc/assets/weights/peter.pth
   rvc/assets/weights/peter.index
   rvc/assets/weights/stewie.pth
   rvc/assets/weights/stewie.index
   rvc/assets/hubert/hubert_base.pt
   ```

2. **Create environment file** (`.env`):
   ```bash
   ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
   PETER_VOICE_ID=your_peter_voice_id
   STEWIE_VOICE_ID=your_stewie_voice_id
   ```

3. **Start the service**:
   ```bash
   docker-compose up -d
   ```

4. **Check if it's running**:
   ```bash
   curl http://localhost:8000/health
   ```

## Build Options

### Development Build
```bash
# Build and run in development mode with auto-reload
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### Production Build
```bash
# Build and run in production mode
docker-compose up -d
```

### With Nginx Reverse Proxy
```bash
# Include Nginx for load balancing and SSL termination
docker-compose --profile with-nginx up -d
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ELEVENLABS_API_KEY` | API key for ElevenLabs TTS | Yes |
| `PETER_VOICE_ID` | Voice ID for Peter character | Yes |
| `STEWIE_VOICE_ID` | Voice ID for Stewie character | Yes |
| `PYTORCH_ENABLE_MPS_FALLBACK` | Enable MPS fallback for PyTorch | No (default: 1) |

### Volume Mounts

- `./rvc/assets:/app/rvc/assets:ro` - Model files (read-only)
- `./temp:/app/temp` - Temporary processing files
- `./uploads:/app/uploads` - Uploaded files

### Ports

- `8000` - Main API port
- `80/443` - Nginx proxy (if using with-nginx profile)

## Model Setup

### Required Model Files

Place these files in the `rvc/assets/` directory structure:

```
rvc/assets/
├── weights/
│   ├── peter.pth
│   ├── peter.index
│   ├── stewie.pth
│   └── stewie.index
├── hubert/
│   └── hubert_base.pt
└── rmvpe/
    └── rmvpe.pt (optional)
```

### Downloading Models

If you don't have the model files:

1. **Hubert Base Model**:
   ```bash
   # This will be downloaded automatically on first run
   # Or manually download to rvc/assets/hubert/hubert_base.pt
   ```

2. **Character Models**: 
   - You need to provide your own trained RVC models
   - Place `.pth` and `.index` files in `rvc/assets/weights/`

## Usage

### API Endpoints

- `GET /health` - Health check
- `GET /characters` - List available characters
- `POST /tts/` - Text-to-speech conversion
- `POST /video` - Video processing
- `POST /whisper-timestamped/` - Whisper transcription

### Example API Calls

```bash
# Health check
curl http://localhost:8000/health

# List characters
curl http://localhost:8000/characters

# Generate voice
curl -X POST http://localhost:8000/tts/ \
  -F "text=Hello, this is a test" \
  -F "character=peter" \
  -o output.wav
```

## Docker Commands

### Build and Run
```bash
# Build image
docker-compose build

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Development Commands
```bash
# Run in development mode
docker run -it --rm \
  -p 8000:8000 \
  -v $(pwd):/app \
  -e ELEVENLABS_API_KEY=your_key \
  rvc-voice-api dev

# Access shell in container
docker exec -it rvc-voice-api /bin/bash

# View real-time logs
docker logs -f rvc-voice-api
```

### Debugging
```bash
# Check container status
docker-compose ps

# Check resource usage
docker stats rvc-voice-api

# Access container shell
docker-compose exec rvc-api /bin/bash

# Test API from inside container
docker-compose exec rvc-api curl http://localhost:8000/health
```

## Performance Tuning

### Resource Limits

Adjust in `docker-compose.yml`:
```yaml
deploy:
  resources:
    limits:
      memory: 4G      # Increase for better performance
      cpus: '2.0'     # Adjust based on CPU cores
    reservations:
      memory: 2G
```

### GPU Support

For NVIDIA GPU support, add to `docker-compose.yml`:
```yaml
services:
  rvc-api:
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
```

## Troubleshooting

### Common Issues

1. **Model files not found**:
   - Ensure model files are in the correct directory
   - Check volume mounts in docker-compose.yml

2. **Out of memory errors**:
   - Increase memory limits in docker-compose.yml
   - Use smaller batch sizes

3. **Permission errors**:
   ```bash
   # Fix file permissions
   sudo chown -R $USER:$USER rvc/assets/
   chmod -R 755 rvc/assets/
   ```

4. **Port already in use**:
   ```bash
   # Change port in docker-compose.yml
   ports:
     - "8001:8000"  # Use different external port
   ```

### Logs and Monitoring

```bash
# View all logs
docker-compose logs

# View specific service logs
docker-compose logs rvc-api

# Follow logs in real-time
docker-compose logs -f

# Check health status
curl http://localhost:8000/health
```

## Security Considerations

1. **Environment Variables**: Never commit `.env` files with real API keys
2. **Network**: Use Nginx proxy for SSL termination in production
3. **Resource Limits**: Set appropriate memory and CPU limits
4. **File Permissions**: Ensure proper file permissions for model files

## Production Deployment

For production deployment:

1. Use the nginx profile for reverse proxy
2. Configure SSL certificates
3. Set up monitoring and logging
4. Use Docker secrets for sensitive data
5. Configure backup for model files
6. Set up health checks and restart policies

```bash
# Production deployment example
docker-compose --profile with-nginx up -d
```

## Support

If you encounter issues:

1. Check the logs: `docker-compose logs -f`
2. Verify model files are present and accessible
3. Test API endpoints manually
4. Check resource usage with `docker stats` 
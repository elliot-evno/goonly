import warnings
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

# Suppress fairseq logging
import logging
logging.getLogger("fairseq").setLevel(logging.ERROR)
logging.getLogger("fairseq.tasks.hubert_pretraining").setLevel(logging.ERROR)
logging.getLogger("fairseq.models.hubert.hubert").setLevel(logging.ERROR)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

# Import endpoint handlers
from api_modules.endpoints import (
    tts_endpoint,
    health_check,
    get_characters,
    process_video_from_conversation,
    whisper_timestamped_handler
)
from api_modules.models import VideoRequest
from models.models import preload_all_models

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting up RVC API...")
    try:
        # Preload models to avoid loading during requests
        preload_all_models()
        logger.info("Models preloaded successfully")
    except Exception as e:
        logger.error(f"Failed to preload models: {str(e)}")
        logger.warning("API will start but model loading may fail during requests")
    
    yield
    
    # Shutdown
    logger.info("Shutting down RVC API...")

app = FastAPI(title="RVC TTS API", version="1.0.0", lifespan=lifespan)

# Add CORS middleware - include your production domain when deploying
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Disposition", "*"],
    max_age=3600,
)

# Register endpoints
app.post("/tts/")(tts_endpoint)
app.get("/health")(health_check)
app.get("/characters")(get_characters)
app.post("/video")(process_video_from_conversation)
app.post("/whisper-timestamped/")(whisper_timestamped_handler)
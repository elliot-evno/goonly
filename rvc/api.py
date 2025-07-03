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

# Import endpoint handlers
from api_modules.endpoints import (
    tts_endpoint,
    health_check,
    get_characters,
    process_video_from_conversation,
    whisper_timestamped_handler
)
from api_modules.models import VideoRequest

app = FastAPI(title="RVC TTS API", version="1.0.0")

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
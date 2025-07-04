import os
from dotenv import load_dotenv

load_dotenv()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

# Character-specific TTS voice IDs for ElevenLabs
ELEVENLABS_VOICE_IDS = {
    "peter": os.getenv("PETER_VOICE_ID"),  # Fallback to default if not set
    "stewie": os.getenv("STEWIE_VOICE_ID")  # Fallback to default if not set
}

# Global variables for models (will be loaded on first request)
models = {}
whisper_model = None

# Model configurations
MODEL_CONFIG = {
    "peter": {
        "model_path": "peter.pth",
        "index_path": "assets/weights/peter.index",
        "tts_voice_id": ELEVENLABS_VOICE_IDS["peter"]
    },
    "stewie": {
        "model_path": "stewie.pth", 
        "index_path": "assets/weights/stewie.index",
        "tts_voice_id": ELEVENLABS_VOICE_IDS["stewie"]
    }
}
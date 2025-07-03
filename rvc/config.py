import os
from dotenv import load_dotenv

load_dotenv()

ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")


# Global variables for models (will be loaded on first request)
models = {}
whisper_model = None

# Model configurations
MODEL_CONFIG = {
    "peter": {
        "model_path": "peter.pth",
        "index_path": "assets/weights/peter.index"
    },
    "stewie": {
        "model_path": "stewie.pth", 
        "index_path": "assets/weights/stewie.index"
    }
}
from fastapi import FastAPI, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import sys
import tempfile
import subprocess
from scipy.io import wavfile
import requests
import logging
import uuid
from dotenv import load_dotenv

# Import your RVC inference logic:
from infer.modules.vc.modules import VC
from configs.config import Config

load_dotenv()

ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variables for models (will be loaded on first request)
models = {}

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

app = FastAPI(title="RVC TTS API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def cleanup_temp_files(*file_paths):
    """Clean up temporary files safely"""
    for file_path in file_paths:
        try:
            if file_path and os.path.exists(file_path):
                os.unlink(file_path)
                logger.debug(f"Cleaned up temp file: {file_path}")
        except Exception as e:
            logger.warning(f"Could not delete temp file {file_path}: {e}")

def load_model(character: str):
    """Load the RVC model for the specified character if not already loaded"""
    global models
    
    if character not in MODEL_CONFIG:
        raise ValueError(f"Unknown character: {character}. Available: {list(MODEL_CONFIG.keys())}")
    
    if character not in models:
        logger.info(f"Loading model for character: {character}")
        
        # Override sys.argv to prevent argument parsing conflicts
        original_argv = sys.argv.copy()
        original_cwd = os.getcwd()
        
        try:
            # Set up sys.argv like main.py expects
            sys.argv = [sys.argv[0]]
            
            # Change to the script directory
            script_dir = os.path.dirname(os.path.abspath(__file__))
            os.chdir(script_dir)
            
            # Initialize exactly like main.py
            from dotenv import load_dotenv
            load_dotenv()
            config = Config()
            vc = VC(config)
            vc.get_vc(MODEL_CONFIG[character]["model_path"])
            models[character] = vc
            
            logger.info(f"Successfully loaded model for character: {character}")
            
        except Exception as e:
            logger.error(f"Failed to load model for character {character}: {e}")
            raise
        finally:
            # Restore original argv and working directory
            sys.argv = original_argv
            os.chdir(original_cwd)
            
    return models[character]

async def generate_tts_audio(text: str, character: str, output_path: str) -> bool:
    """Generate TTS audio with fallback chain"""
    request_id = str(uuid.uuid4())[:8]
    logger.info(f"[{request_id}] Starting TTS generation for character: {character}")
    
    # First attempt: ElevenLabs via direct API
    try:
        logger.info(f"[{request_id}] Attempting ElevenLabs TTS...")
        
        voice_id = ELEVENLABS_VOICE_ID
        api_key = ELEVENLABS_API_KEY
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        
        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": api_key
        }
        
        data = {
            "text": text,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.5
            }
        }
        
        response = requests.post(url, json=data, headers=headers, timeout=30)
        response.raise_for_status()
        
        # Save to temporary MP3, then convert
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as mp3_file:
            mp3_path = mp3_file.name
            mp3_file.write(response.content)
        
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", mp3_path, output_path], 
                check=True, 
                capture_output=True
            )
            logger.info(f"[{request_id}] ✅ ElevenLabs TTS successful")
            return True
        finally:
            cleanup_temp_files(mp3_path)
            
    except Exception as e:
        logger.warning(f"[{request_id}] ElevenLabs failed: {e}")
    

@app.post("/tts/")
async def tts_endpoint(text: str = Form(...), character: str = Form("peter")):
    """Generate TTS with RVC voice conversion"""
    request_id = str(uuid.uuid4())[:8]
    
    # Validate inputs
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    if character not in MODEL_CONFIG:
        raise HTTPException(
            status_code=400, 
            detail=f"Unknown character: {character}. Available: {list(MODEL_CONFIG.keys())}"
        )
    
    logger.info(f"[{request_id}] Processing TTS request for character: {character}")
    
    # Create temporary files
    tts_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    output_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    
    tts_path = tts_file.name
    output_path = output_file.name
    
    # Close file handles
    tts_file.close()
    output_file.close()
    
    try:
        # Load model
        model = load_model(character)
        config = MODEL_CONFIG[character]
        
        # Generate TTS audio
        tts_success = await generate_tts_audio(text, character, tts_path)
        if not tts_success:
            raise HTTPException(status_code=500, detail="All TTS services failed")
        
        logger.info(f"[{request_id}] Applying RVC voice conversion...")
        
        # Apply RVC voice conversion
        _, wav_opt = model.vc_single(
            0, tts_path, 0, None, "harvest", config["index_path"], None, 0.66, 3, 0, 1, 0.33
        )
        
        # Write the converted audio
        wavfile.write(output_path, wav_opt[0], wav_opt[1])
        
        logger.info(f"[{request_id}] ✅ TTS processing complete")
        
        # Return file response with background cleanup
        return FileResponse(
            output_path,
            media_type="audio/wav",
            filename=f"{character}_voice.wav",
            background=lambda: cleanup_temp_files(tts_path, output_path)
        )
        
    except HTTPException:
        # Re-raise HTTP exceptions
        cleanup_temp_files(tts_path, output_path)
        raise
    except Exception as e:
        # Handle unexpected errors
        logger.error(f"[{request_id}] Unexpected error: {e}")
        cleanup_temp_files(tts_path, output_path)
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "loaded_models": list(models.keys())}

@app.get("/characters")
async def get_characters():
    """Get available character voices"""
    return {"characters": list(MODEL_CONFIG.keys())}
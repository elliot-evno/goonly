import warnings
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

# Suppress fairseq logging
import logging
logging.getLogger("fairseq").setLevel(logging.ERROR)
logging.getLogger("fairseq.tasks.hubert_pretraining").setLevel(logging.ERROR)
logging.getLogger("fairseq.models.hubert.hubert").setLevel(logging.ERROR)

from fastapi import FastAPI, Form, HTTPException, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import sys
import tempfile
import subprocess
from scipy.io import wavfile
import requests
import uuid
from dotenv import load_dotenv

# Import whisper-timestamped for word-level timing
try:
    import whisper_timestamped as whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False
    pass

# Import your RVC inference logic:
from infer.modules.vc.modules import VC
from configs.config import Config

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
        except Exception as e:
            pass

def load_model(character: str):
    """Load the RVC model for the specified character if not already loaded"""
    global models
    
    if character not in MODEL_CONFIG:
        raise ValueError(f"Unknown character: {character}. Available: {list(MODEL_CONFIG.keys())}")
    
    if character not in models:
        
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
            
            
        except Exception as e:
            raise
        finally:
            # Restore original argv and working directory
            sys.argv = original_argv
            os.chdir(original_cwd)
            
    return models[character]

def load_whisper_model():
    """Load the Whisper model for word-level timing if not already loaded"""
    global whisper_model
    
    
    if not WHISPER_AVAILABLE:
        raise RuntimeError("whisper-timestamped is not installed. Install with: pip install whisper-timestamped")
    
    if whisper_model is None:
        try:
            # Use small model for balance of speed and accuracy
            whisper_model = whisper.load_model("small", device="cpu")
        except Exception as e:
            raise e
    return whisper_model

async def generate_tts_audio(text: str, character: str, output_path: str) -> bool:
    """Generate TTS audio with fallback chain"""
    request_id = str(uuid.uuid4())[:8]
    
    # First attempt: ElevenLabs via direct API
    if ELEVENLABS_VOICE_ID and ELEVENLABS_API_KEY:
        try:
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
            try:
                response.raise_for_status()
            except Exception:
                pass
            
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
                return True
            finally:
                cleanup_temp_files(mp3_path)
        except Exception:
            # If ElevenLabs fails, we could add fallback logic here
            pass
    
    # If we reach here, TTS generation failed
    return False


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
        
        
        # Apply RVC voice conversion
        _, wav_opt = model.vc_single(
            0, tts_path, 0, None, "harvest", config["index_path"], None, 0.66, 3, 0, 1, 0.33
        )
        
        # Write the converted audio
        wavfile.write(output_path, wav_opt[0], wav_opt[1])
        
        
        # Return file response with background cleanup
        async def cleanup_background():
            cleanup_temp_files(tts_path, output_path)
        
        return FileResponse(
            output_path,
            media_type="audio/wav",
            filename=f"{character}_voice.wav",
            background=cleanup_background
        )
        
    except HTTPException:
        # Re-raise HTTP exceptions
        cleanup_temp_files(tts_path, output_path)
        raise
    except Exception as e:
        # Handle unexpected errors
        cleanup_temp_files(tts_path, output_path)
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy", 
        "loaded_models": list(models.keys()),
        "whisper_available": WHISPER_AVAILABLE,
        "whisper_loaded": whisper_model is not None,
        "whisper_endpoint": "enabled"
    }

@app.get("/characters")
async def get_characters():
    """Get available character voices"""
    return {"characters": list(MODEL_CONFIG.keys())}

@app.post("/whisper-timestamped/")
async def whisper_timestamped_endpoint(
    audio: UploadFile = File(...),
    text: str = Form(...)
):
    """Generate CapCut-style word-level timestamps using whisper-timestamped"""
    request_id = str(uuid.uuid4())[:8]
    
    
    if not WHISPER_AVAILABLE:
        raise HTTPException(
            status_code=500, 
            detail="whisper-timestamped is not installed. Install with: pip install whisper-timestamped"
        )
    
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    temp_audio_path = None
    
    try:
        # Save uploaded audio to temp file
        temp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        temp_audio_path = temp_file.name
        
        audio_content = await audio.read()
        
        temp_file.write(audio_content)
        temp_file.close()
        
        # Load Whisper model
        model = load_whisper_model()
        
        # Load audio and transcribe with word-level timestamps
        audio_data = whisper.load_audio(temp_audio_path)
        
        # Use whisper-timestamped for accurate word timing
        try:
            # Use whisper-timestamped's transcribe function (not transcribe_timestamped)
            # The API is: whisper.transcribe(model, audio, **kwargs)
            result = whisper.transcribe(
                whisper_model, 
                audio_data,
                language="en",  # You can make this configurable
                verbose=False
            )
        except Exception as e:
            raise
        
        
        # Extract word segments from whisper-timestamped format
        word_segments = []
        
        if "segments" in result:
            for i, segment in enumerate(result["segments"]):
                
                # whisper-timestamped puts words directly in segments
                if "words" in segment and segment["words"]:
                    for word_data in segment["words"]:
                        if isinstance(word_data, dict) and "text" in word_data:
                            word_segments.append({
                                "word": word_data.get("text", "").strip(),
                                "start": word_data.get("start", 0),
                                "end": word_data.get("end", 0)
                            })

        
        # Clean up temp file
        try:
            os.unlink(temp_audio_path)
        except Exception:
            pass
        return {"word_segments": word_segments}
        
    except Exception as e:
        
        # Clean up temp file on error only if it still exists
        if 'temp_audio_path' in locals() and os.path.exists(temp_audio_path):
            try:
                os.unlink(temp_audio_path)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Whisper timestamped processing failed: {str(e)}")
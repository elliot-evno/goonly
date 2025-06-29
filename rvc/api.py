from fastapi import FastAPI, Form, HTTPException, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse
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

# Import whisper-timestamped for word-level timing
try:
    import whisper_timestamped as whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False
    print("⚠️ whisper-timestamped not available. Install with: pip install whisper-timestamped")

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

def load_whisper_model():
    """Load the Whisper model for word-level timing if not already loaded"""
    global whisper_model
    
    logger.info("Checking whisper model status...")
    
    if not WHISPER_AVAILABLE:
        logger.error("whisper-timestamped is not installed")
        raise RuntimeError("whisper-timestamped is not installed. Install with: pip install whisper-timestamped")
    
    if whisper_model is None:
        logger.info("Whisper model not loaded, loading now...")
        try:
            logger.info("Calling whisper.load_model('small', device='cpu')...")
            # Use small model for balance of speed and accuracy
            whisper_model = whisper.load_model("small", device="cpu")
            logger.info("✅ Whisper model loaded successfully!")
        except Exception as e:
            logger.error(f"Failed to load Whisper model: {type(e).__name__}: {e}")
            logger.error("Whisper model loading traceback:", exc_info=True)
            raise
    else:
        logger.info("Whisper model already loaded, reusing existing model")
            
    return whisper_model

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
    
    logger.info(f"[{request_id}] Starting whisper-timestamped request")
    logger.info(f"[{request_id}] Audio filename: {audio.filename}, Content-Type: {audio.content_type}")
    logger.info(f"[{request_id}] Text length: {len(text)} chars, Preview: {text[:50]}...")
    
    if not WHISPER_AVAILABLE:
        logger.error(f"[{request_id}] Whisper not available - whisper-timestamped not installed")
        raise HTTPException(
            status_code=500, 
            detail="whisper-timestamped is not installed. Install with: pip install whisper-timestamped"
        )
    
    if not text.strip():
        logger.error(f"[{request_id}] Empty text provided")
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    temp_audio_path = None
    
    try:
        logger.info(f"[{request_id}] Creating temporary file...")
        # Save uploaded audio to temp file
        temp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        temp_audio_path = temp_file.name
        logger.info(f"[{request_id}] Temp file created: {temp_audio_path}")
        
        logger.info(f"[{request_id}] Reading uploaded audio content...")
        audio_content = await audio.read()
        logger.info(f"[{request_id}] Audio content size: {len(audio_content)} bytes")
        
        logger.info(f"[{request_id}] Writing audio to temp file...")
        temp_file.write(audio_content)
        temp_file.close()
        logger.info(f"[{request_id}] Audio written to temp file successfully")
        
        # Load Whisper model
        logger.info(f"[{request_id}] Loading Whisper model...")
        model = load_whisper_model()
        logger.info(f"[{request_id}] Whisper model loaded successfully")
        
        logger.info(f"[{request_id}] Loading audio data with whisper.load_audio...")
        # Load audio and transcribe with word-level timestamps
        audio_data = whisper.load_audio(temp_audio_path)
        logger.info(f"[{request_id}] Audio data loaded, shape/length: {len(audio_data) if hasattr(audio_data, '__len__') else 'unknown'}")
        
        # Use whisper-timestamped for accurate word timing
        logger.info(f"[{request_id}] Starting whisper transcription with word timestamps...")
        try:
            # Use whisper-timestamped's transcribe function (not transcribe_timestamped)
            # The API is: whisper.transcribe(model, audio, **kwargs)
            result = whisper.transcribe(
                whisper_model, 
                audio_data,
                language="en",  # You can make this configurable
                verbose=False
            )
            logger.info(f"[{request_id}] Whisper transcription completed successfully")
        except Exception as e:
            logger.error(f"[{request_id}] Whisper transcription failed: {str(e)}")
            raise
        
        logger.info(f"[{request_id}] Result keys: {list(result.keys()) if isinstance(result, dict) else 'not a dict'}")
        logger.info(f"[{request_id}] Generated {len(result.get('segments', []))} segments")
        
        # Extract word segments from whisper-timestamped format
        word_segments = []
        
        if "segments" in result:
            logger.info(f"[{request_id}] Processing {len(result['segments'])} segments for word extraction")
            for i, segment in enumerate(result["segments"]):
                logger.info(f"[{request_id}] Segment {i} keys: {list(segment.keys()) if isinstance(segment, dict) else 'not a dict'}")
                
                # whisper-timestamped puts words directly in segments
                if "words" in segment and segment["words"]:
                    for word_data in segment["words"]:
                        if isinstance(word_data, dict) and "text" in word_data:
                            word_segments.append({
                                "word": word_data.get("text", "").strip(),
                                "start": word_data.get("start", 0),
                                "end": word_data.get("end", 0)
                            })
                else:
                    logger.warning(f"[{request_id}] Segment {i} has no 'words' key or empty words")
        else:
            logger.error(f"[{request_id}] Result has no 'segments' key")
        
        logger.info(f"[{request_id}] Extracted {len(word_segments)} word segments")
        
        # Clean up temp file
        try:
            os.unlink(temp_audio_path)
            logger.info(f"[{request_id}] Temp file cleaned up successfully")
        except Exception as e:
            logger.warning(f"[{request_id}] Could not delete temp file {temp_audio_path}: {e}")
        
        return {"word_segments": word_segments}
        
    except Exception as e:
        logger.error(f"[{request_id}] Exception occurred: {type(e).__name__}: {str(e)}")
        logger.error(f"[{request_id}] Exception traceback:")
        import traceback
        logger.error(traceback.format_exc())
        
        # Clean up temp file on error only if it still exists
        if 'temp_audio_path' in locals() and os.path.exists(temp_audio_path):
            try:
                os.unlink(temp_audio_path)
                logger.info(f"[{request_id}] Temp file cleaned up after error")
            except Exception as cleanup_error:
                logger.warning(f"[{request_id}] Could not delete temp file after error: {cleanup_error}")
        
        logger.error(f"[{request_id}] Returning 500 error to client")
        raise HTTPException(status_code=500, detail=f"Whisper timestamped processing failed: {str(e)}")
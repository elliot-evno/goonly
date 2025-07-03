import os
import tempfile
import uuid
from fastapi import HTTPException, File, Form, UploadFile
from rvc.models.models import *


try: 
    import whisper_timestamped as whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False
    pass

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
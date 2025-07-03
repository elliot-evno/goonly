import warnings
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

# Suppress fairseq logging
import logging
logging.getLogger("fairseq").setLevel(logging.ERROR)
logging.getLogger("fairseq.tasks.hubert_pretraining").setLevel(logging.ERROR)
logging.getLogger("fairseq.models.hubert.hubert").setLevel(logging.ERROR)

# Import whisper-timestamped for word-level timing
try:
    import whisper_timestamped as whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False
    pass

from fastapi import FastAPI, Form, HTTPException, File, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import sys
import tempfile
import subprocess
from scipy.io import wavfile
import requests
import uuid
import base64
from typing import Optional, List, Dict, Any
from pydantic import BaseModel


from models import *
from captions import *
from config import *
from tts import *
from whisper import *




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
        "whisper_endpoint": "enabled",
        "video_processing": "enabled",
        "endpoints": {
            "tts": "/tts/",
            "whisper_timestamped": "/whisper-timestamped/",
            "video": "/video",
            "characters": "/characters",
            "health": "/health"
        }
    }

@app.get("/characters")
async def get_characters():
    """Get available character voices"""
    return {"characters": list(MODEL_CONFIG.keys())}

# Import video processing
from video import (
    create_final_video_with_buffers,
    AudioFileData,
    CharacterTimeline,
    ImageOverlay,
    VideoConfig
)

class ConversationTurn(BaseModel):
    stewie: str
    peter: str
    imageOverlays: Optional[List[Dict[str, Any]]] = None

class VideoRequest(BaseModel):
    conversation: List[ConversationTurn]
    mediaFiles: Optional[List[Dict[str, Any]]] = None

@app.post("/video")
async def process_video_from_conversation(request: VideoRequest):
    """Process video from conversation data - matches Next.js frontend expectations"""
    request_id = str(uuid.uuid4())[:8]
    print(f"[{request_id}] Processing video from conversation")
    
    conversation = request.conversation
    media_files = request.mediaFiles or []
    
    if not conversation:
        raise HTTPException(status_code=400, detail="No conversation provided")
    
    try:
        # Default paths
        video_path = os.path.join(os.path.dirname(__file__), "..", "public", "content", "subwaysurfers.mp4")
        stewie_image_path = os.path.join(os.path.dirname(__file__), "..", "public", "content", "stewie.png")
        peter_image_path = os.path.join(os.path.dirname(__file__), "..", "public", "content", "peter.png")
        
        # Verify files exist
        if not os.path.exists(video_path):
            raise HTTPException(status_code=400, detail="Background video not found")
        if not os.path.exists(stewie_image_path):
            raise HTTPException(status_code=400, detail="Stewie image not found")
        if not os.path.exists(peter_image_path):
            raise HTTPException(status_code=400, detail="Peter image not found")
        
        # Process media files
        media_buffers = {}
        if media_files:
            for media_file in media_files:
                if media_file.get("type") == "image":
                    buffer_data = base64.b64decode(media_file["data"])
                    media_buffers[media_file["filename"]] = buffer_data
        
        # Generate audio for each line
        audio_results = []
        audio_tasks = []
        
        for turn in conversation:
            audio_tasks.append({"text": turn.stewie, "character": "stewie"})
            audio_tasks.append({"text": turn.peter, "character": "peter"})
        
        # Process audio generation with RVC
        for i, task in enumerate(audio_tasks):
            print(f"[{request_id}] Generating audio {i+1}/{len(audio_tasks)}: {task['character']} - {task['text'][:50]}...")
            
            # Create temp files
            tts_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            output_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tts_path = tts_file.name
            output_path = output_file.name
            tts_file.close()
            output_file.close()
            
            try:
                # Load RVC model
                model = load_model(task["character"])
                config = MODEL_CONFIG[task["character"]]
                
                # Generate TTS audio
                tts_success = await generate_tts_audio(task["text"], task["character"], tts_path)
                if not tts_success:
                    raise HTTPException(status_code=500, detail="TTS generation failed")
                
                # Apply RVC voice conversion
                _, wav_opt = model.vc_single(
                    0, tts_path, 0, None, "harvest", config["index_path"], None, 0.66, 3, 0, 1, 0.33
                )
                
                # Write the converted audio
                wavfile.write(output_path, wav_opt[0], wav_opt[1])
                
                # Read the converted audio
                with open(output_path, "rb") as f:
                    audio_buffer = f.read()
                
                # Calculate actual duration from wav data
                sample_rate = wav_opt[0]
                num_samples = len(wav_opt[1])
                duration = num_samples / sample_rate
                
                audio_results.append({
                    "buffer": audio_buffer,
                    "character": task["character"],
                    "text": task["text"],
                    "duration": duration
                })
                
            finally:
                # Cleanup temp files
                cleanup_temp_files(tts_path, output_path)
        
        # Build timeline
        audio_data_list = []
        character_timeline_list = []
        word_timeline = []
        GAP_DURATION = 0.2
        current_time = 0
        
        for audio in audio_results:
            audio_data_list.append(
                AudioFileData(
                    buffer=audio["buffer"],
                    duration=audio["duration"],
                    character=audio["character"]
                )
            )
            
            character_timeline_list.append(
                CharacterTimeline(
                    character=audio["character"],
                    start_time=current_time,
                    end_time=current_time + audio["duration"]
                )
            )
            
            # Get word timings using whisper
            if WHISPER_AVAILABLE:
                try:
                    word_timings = await get_word_timings_from_whisper(audio["buffer"], audio["text"])
                    for word_timing in word_timings:
                        word_timeline.append({
                            "text": word_timing["word"],
                            "startTime": current_time + word_timing["start"],
                            "endTime": current_time + word_timing["end"],
                            "character": audio["character"]
                        })
                except Exception as e:
                    print(f"[{request_id}] Warning: Failed to get word timings: {str(e)}")
                    # Fallback: create simple word timeline
                    words = audio["text"].split()
                    word_duration = audio["duration"] / len(words) if words else 0
                    for i, word in enumerate(words):
                        word_timeline.append({
                            "text": word,
                            "startTime": current_time + (i * word_duration),
                            "endTime": current_time + ((i + 1) * word_duration),
                            "character": audio["character"]
                        })
            else:
                # No whisper available - create simple word timeline
                words = audio["text"].split()
                word_duration = audio["duration"] / len(words) if words else 0
                for i, word in enumerate(words):
                    word_timeline.append({
                        "text": word,
                        "startTime": current_time + (i * word_duration),
                        "endTime": current_time + ((i + 1) * word_duration),
                        "character": audio["character"]
                    })
            
            current_time += audio["duration"] + GAP_DURATION
        
        total_duration = current_time - GAP_DURATION + 1
        
        # Create subtitle content
        subtitle_content = create_subtitle_content(word_timeline)
        
        # Process image overlays
        image_overlays_list = []
        conversation_index = 0
        for turn in conversation:
            if turn.imageOverlays:
                turn_start_time = current_time if conversation_index * 2 < len(audio_data_list) else 0
                
                for overlay in turn.imageOverlays:
                    if overlay["filename"] in media_buffers:
                        global_start_time = turn_start_time + overlay["startTime"]
                        global_end_time = global_start_time + overlay["duration"]
                        
                        image_overlays_list.append(
                            ImageOverlay(
                                buffer=media_buffers[overlay["filename"]],
                                start_time=global_start_time,
                                end_time=global_end_time,
                                description=overlay.get("description", "")
                            )
                        )
            conversation_index += 1
        
        # Create video
        config = VideoConfig()
        video_buffer = await create_final_video_with_buffers(
            video_path=video_path,
            stewie_image_path=stewie_image_path,
            peter_image_path=peter_image_path,
            audio_data=audio_data_list,
            subtitle_content=subtitle_content,
            character_timeline=character_timeline_list,
            duration=total_duration,
            image_overlays=image_overlays_list if image_overlays_list else None,
            config=config
        )
        
        print(f"[{request_id}] Video generation completed")
        
        # For large files, we should save to a temp file and stream it
        temp_video_path = os.path.join(tempfile.gettempdir(), f"video_output_{request_id}.mp4")
        with open(temp_video_path, "wb") as f:
            f.write(video_buffer)
        
        # Get file size for logging
        file_size = os.path.getsize(temp_video_path)
        print(f"[{request_id}] Video file size: {file_size / (1024*1024):.1f} MB")
        
        # For large files, use streaming response with chunks
        def iterfile():
            with open(temp_video_path, 'rb') as f:
                while chunk := f.read(1024 * 1024):  # 1MB chunks
                    yield chunk
            # Cleanup after streaming
            try:
                os.unlink(temp_video_path)
            except:
                pass
        
        return StreamingResponse(
            iterfile(),
            media_type="video/mp4",
            headers={
                "Content-Disposition": f'attachment; filename="peter-stewie-conversation_{request_id}.mp4"',
                "Content-Length": str(file_size),
            }
        )
        
    except Exception as e:
        print(f"[{request_id}] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/whisper-timestamped/")
async def whisper_timestamped_endpoint(
    audio: UploadFile = File(...),
    text: str = Form(...)
):
    return await whisper_timestamped_endpoint(audio, text)
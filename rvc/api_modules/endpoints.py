import tempfile
import uuid
import os
import traceback
import logging
from fastapi import Form, HTTPException, File, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from scipy.io import wavfile

from models.models import load_model
from config import MODEL_CONFIG, models
from models.tts import generate_tts_audio, cleanup_temp_files
from models.whisper import WHISPER_AVAILABLE, whisper_timestamped_endpoint
from config import whisper_model
from .models import VideoRequest
from .audio_service import process_conversation_audio
from .video_service import (
    validate_file_paths,
    process_media_files,
    create_image_overlays,
    generate_video,
    save_video_to_temp
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

async def get_characters():
    """Get available character voices"""
    return {"characters": list(MODEL_CONFIG.keys())}

async def process_video_from_conversation(request: VideoRequest):
    """Process video from conversation data - matches Next.js frontend expectations"""
    request_id = str(uuid.uuid4())[:8]
    logger.info(f"[{request_id}] Starting video processing")
    print(f"[{request_id}] Processing video from conversation")
    
    try:
        # Log request details
        logger.info(f"[{request_id}] Conversation length: {len(request.conversation) if request.conversation else 0}")
        logger.info(f"[{request_id}] Media files count: {len(request.mediaFiles) if request.mediaFiles else 0}")
        
        conversation = request.conversation
        media_files = request.mediaFiles or []
        
        if not conversation:
            logger.error(f"[{request_id}] No conversation provided")
            raise HTTPException(status_code=400, detail="No conversation provided")
        
        # Log conversation details
        for i, turn in enumerate(conversation):
            peter_text = turn.peter if turn.peter else "(silence)"
            stewie_text = turn.stewie if turn.stewie else "(silence)"
            logger.info(f"[{request_id}] Turn {i}: peter='{peter_text[:50]}...', stewie='{stewie_text[:50]}...'")
        
        # Validate file paths
        logger.info(f"[{request_id}] Validating file paths...")
        video_path, stewie_image_path, peter_image_path = validate_file_paths()
        logger.info(f"[{request_id}] File paths validated successfully")
        
        # Process media files
        logger.info(f"[{request_id}] Processing media files...")
        media_buffers = process_media_files(media_files)
        logger.info(f"[{request_id}] Processed {len(media_buffers)} media files")
        
        # Process conversation audio
        logger.info(f"[{request_id}] Processing conversation audio...")
        audio_data_list, character_timeline_list, word_timeline, total_duration = await process_conversation_audio(
            conversation, request_id
        )
        logger.info(f"[{request_id}] Audio processing complete. Total duration: {total_duration}s")
        logger.info(f"[{request_id}] Generated {len(audio_data_list)} audio files")
        logger.info(f"[{request_id}] Word timeline entries: {len(word_timeline)}")
        
        # Process image overlays
        logger.info(f"[{request_id}] Creating image overlays...")
        image_overlays_list = create_image_overlays(conversation, media_buffers, word_timeline)
        logger.info(f"[{request_id}] Created {len(image_overlays_list) if image_overlays_list else 0} image overlays")
        
        # Generate video
        logger.info(f"[{request_id}] Starting video generation...")
        video_buffer = await generate_video(
            video_path,
            stewie_image_path,
            peter_image_path,
            audio_data_list,
            character_timeline_list,
            word_timeline,
            total_duration,
            image_overlays_list if image_overlays_list else None
        )
        logger.info(f"[{request_id}] Video generation completed. Buffer size: {len(video_buffer) / (1024*1024):.1f} MB")
        print(f"[{request_id}] Video generation completed")
        
        # Save to temp file for streaming
        logger.info(f"[{request_id}] Saving video to temp file...")
        temp_video_path, file_size = save_video_to_temp(video_buffer, request_id)
        logger.info(f"[{request_id}] Video saved to: {temp_video_path}")
        logger.info(f"[{request_id}] Video file size: {file_size / (1024*1024):.1f} MB")
        print(f"[{request_id}] Video file size: {file_size / (1024*1024):.1f} MB")
        
        # Stream response with chunks
        def iterfile():
            try:
                with open(temp_video_path, 'rb') as f:
                    while chunk := f.read(1024 * 1024):  # 1MB chunks
                        yield chunk
            except Exception as e:
                logger.error(f"[{request_id}] Error during streaming: {str(e)}")
            finally:
                # Cleanup after streaming
                try:
                    os.unlink(temp_video_path)
                    logger.info(f"[{request_id}] Temp file cleaned up")
                except Exception as e:
                    logger.warning(f"[{request_id}] Failed to cleanup temp file: {str(e)}")
        
        logger.info(f"[{request_id}] Returning streaming response")
        return StreamingResponse(
            iterfile(),
            media_type="video/mp4",
            headers={
                "Content-Disposition": f'attachment; filename="peter-stewie-conversation_{request_id}.mp4"',
                "Content-Length": str(file_size),
            }
        )
        
    except HTTPException as e:
        logger.error(f"[{request_id}] HTTP Exception: {e.detail}")
        print(f"[{request_id}] Error: {e.detail}")
        raise
    except Exception as e:
        logger.error(f"[{request_id}] Unexpected error: {str(e)}")
        logger.error(f"[{request_id}] Traceback: {traceback.format_exc()}")
        print(f"[{request_id}] Error: {str(e)}")
        print(f"[{request_id}] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

async def whisper_timestamped_handler(
    audio: UploadFile = File(...),
    text: str = Form(...)
):
    """Handle whisper timestamped requests"""
    return await whisper_timestamped_endpoint(audio, text) 
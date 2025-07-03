import os
import base64
import tempfile
from typing import List, Dict, Any, Optional
from fastapi import HTTPException

from video.types import ImageOverlay, VideoConfig
from final_video import create_final_video_with_buffers
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from captions import create_subtitle_content

def validate_file_paths() -> tuple[str, str, str]:
    """Validate and return required file paths"""
    video_path = os.path.join(os.path.dirname(__file__), "..", "..", "public", "content", "subwaysurfers.mp4")
    stewie_image_path = os.path.join(os.path.dirname(__file__), "..", "..", "public", "content", "stewie.png")
    peter_image_path = os.path.join(os.path.dirname(__file__), "..", "..", "public", "content", "peter.png")
    
    # Verify files exist
    if not os.path.exists(video_path):
        raise HTTPException(status_code=400, detail="Background video not found")
    if not os.path.exists(stewie_image_path):
        raise HTTPException(status_code=400, detail="Stewie image not found")
    if not os.path.exists(peter_image_path):
        raise HTTPException(status_code=400, detail="Peter image not found")
    
    return video_path, stewie_image_path, peter_image_path

def process_media_files(media_files: List[Dict[str, Any]]) -> Dict[str, bytes]:
    """Process and decode media files"""
    media_buffers = {}
    if media_files:
        for media_file in media_files:
            if media_file.get("type") == "image":
                buffer_data = base64.b64decode(media_file["data"])
                media_buffers[media_file["filename"]] = buffer_data
    return media_buffers

def create_image_overlays(conversation, media_buffers: Dict[str, bytes], current_time: float) -> List[ImageOverlay]:
    """Create image overlay objects from conversation data"""
    image_overlays_list = []
    conversation_index = 0
    
    for turn in conversation:
        if turn.imageOverlays:
            turn_start_time = current_time if conversation_index * 2 < len(conversation) else 0
            
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
    
    return image_overlays_list

async def generate_video(
    video_path: str,
    stewie_image_path: str,
    peter_image_path: str,
    audio_data_list,
    character_timeline_list,
    word_timeline: List[Dict],
    total_duration: float,
    image_overlays_list: Optional[List[ImageOverlay]] = None
) -> bytes:
    """Generate the final video with all components"""
    # Create subtitle content
    subtitle_content = create_subtitle_content(word_timeline)
    
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
    
    return video_buffer

def save_video_to_temp(video_buffer: bytes, request_id: str) -> tuple[str, int]:
    """Save video buffer to temporary file and return path and size"""
    temp_video_path = os.path.join(tempfile.gettempdir(), f"video_output_{request_id}.mp4")
    with open(temp_video_path, "wb") as f:
        f.write(video_buffer)
    
    # Get file size for logging
    file_size = os.path.getsize(temp_video_path)
    return temp_video_path, file_size 
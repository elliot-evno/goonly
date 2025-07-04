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
    """Process and decode media files (images and videos)"""
    media_buffers = {}
    if media_files:
        for media_file in media_files:
            if media_file.get("type") in ["image", "video"]:
                try:
                    buffer_data = base64.b64decode(media_file["data"])
                    file_size_mb = len(buffer_data) / (1024 * 1024)
                    
                    # Size validation
                    max_size = 50 if media_file.get("type") == "video" else 10  # MB
                    if file_size_mb > max_size:
                        print(f"Warning: {media_file['filename']} is {file_size_mb:.1f}MB, which exceeds the {max_size}MB limit")
                        continue
                    
                    media_buffers[media_file["filename"]] = buffer_data
                    print(f"Processed {media_file['type']}: {media_file['filename']} ({file_size_mb:.1f}MB)")
                except Exception as e:
                    print(f"Error processing {media_file.get('filename', 'unknown')}: {str(e)}")
                    continue
    return media_buffers

def create_image_overlays(conversation, media_buffers: Dict[str, bytes], word_timeline: List[Dict]) -> List[ImageOverlay]:
    """Create image overlay objects from conversation data using word timing"""
    image_overlays_list = []
    
    # Helper function to detect media type from filename
    def get_media_type(filename: str) -> str:
        video_extensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv']
        image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']
        
        filename_lower = filename.lower()
        if any(filename_lower.endswith(ext) for ext in video_extensions):
            return "video"
        elif any(filename_lower.endswith(ext) for ext in image_extensions):
            return "image"
        else:
            return "image"  # Default to image
    
    for turn in conversation:
        if hasattr(turn, 'imageOverlays') and turn.imageOverlays:
            for overlay in turn.imageOverlays:
                if overlay.filename in media_buffers:
                    trigger_word = overlay.triggerWord.lower().strip() if overlay.triggerWord else None
                    media_type = get_media_type(overlay.filename)
                    
                    # For videos, use a default duration if not specified, for images use the specified duration
                    if media_type == "video":
                        duration = overlay.duration if overlay.duration is not None else 10.0  # Default 10 seconds for videos
                    else:
                        duration = overlay.duration if overlay.duration is not None else 3.0  # Default 3 seconds for images
                    
                    if trigger_word:
                        # Find the trigger word in the word timeline
                        trigger_time = None
                        for word_data in word_timeline:
                            word_text = word_data["text"].lower().strip().rstrip('.,!?;:')
                            if word_text == trigger_word:
                                trigger_time = word_data["startTime"]
                                print(f"Found trigger word '{trigger_word}' at {trigger_time}s for {media_type} {overlay.filename}")
                                break
                        
                        if trigger_time is not None:
                            image_overlays_list.append(
                                ImageOverlay(
                                    buffer=media_buffers[overlay.filename],
                                    start_time=trigger_time,
                                    end_time=trigger_time + duration,
                                    description=overlay.description or "",
                                    media_type=media_type
                                )
                            )
                            print(f"Added {media_type} overlay: {overlay.filename} from {trigger_time}s to {trigger_time + duration}s")
                        else:
                            print(f"Warning: Trigger word '{trigger_word}' not found in conversation for {media_type} {overlay.filename}")
                            # Use fallback startTime if provided, or default
                            fallback_time = overlay.startTime if overlay.startTime is not None else 1.0
                            image_overlays_list.append(
                                ImageOverlay(
                                    buffer=media_buffers[overlay.filename],
                                    start_time=fallback_time,
                                    end_time=fallback_time + duration,
                                    description=overlay.description or "",
                                    media_type=media_type
                                )
                            )
                            print(f"Using fallback timing for {media_type} {overlay.filename}: {fallback_time}s to {fallback_time + duration}s")
                    else:
                        # No trigger word, use startTime or default
                        fallback_time = overlay.startTime if overlay.startTime is not None else 1.0
                        image_overlays_list.append(
                            ImageOverlay(
                                buffer=media_buffers[overlay.filename],
                                start_time=fallback_time,
                                end_time=fallback_time + duration,
                                description=overlay.description or "",
                                media_type=media_type
                            )
                        )
                        print(f"No trigger word specified for {media_type} {overlay.filename}, using time: {fallback_time}s to {fallback_time + duration}s")
    
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
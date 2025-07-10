import os
import base64
import tempfile
import logging
from typing import List, Dict, Any, Optional
from fastapi import HTTPException

from video.types import ImageOverlay, VideoConfig
from final_video import create_final_video_with_buffers
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from captions import create_subtitle_content

# Configure logging
logger = logging.getLogger(__name__)

def validate_file_paths() -> tuple[str, str, str]:
    """Validate and return required file paths"""
    logger.info("Validating file paths...")
    
    # Check current working directory
    cwd = os.getcwd()
    logger.info(f"Current working directory: {cwd}")
    
    # Try different path approaches
    # First try relative to the module
    module_dir = os.path.dirname(__file__)
    logger.info(f"Module directory: {module_dir}")
    
    # Try paths relative to module
    video_path = os.path.join(module_dir, "..", "..", "public", "content", "subwaysurfers.mp4")
    stewie_image_path = os.path.join(module_dir, "..", "..", "public", "content", "stewie.png")
    peter_image_path = os.path.join(module_dir, "..", "..", "public", "content", "peter.png")
    
    # Normalize paths
    video_path = os.path.normpath(video_path)
    stewie_image_path = os.path.normpath(stewie_image_path)
    peter_image_path = os.path.normpath(peter_image_path)
    
    logger.info(f"Checking video path: {video_path}")
    logger.info(f"Checking stewie image path: {stewie_image_path}")
    logger.info(f"Checking peter image path: {peter_image_path}")
    
    # If files don't exist, try absolute paths from /app
    if not os.path.exists(video_path):
        video_path = "/app/public/content/subwaysurfers.mp4"
        logger.info(f"Trying absolute video path: {video_path}")
    
    if not os.path.exists(stewie_image_path):
        stewie_image_path = "/app/public/content/stewie.png"
        logger.info(f"Trying absolute stewie path: {stewie_image_path}")
    
    if not os.path.exists(peter_image_path):
        peter_image_path = "/app/public/content/peter.png"
        logger.info(f"Trying absolute peter path: {peter_image_path}")
    
    # Verify files exist
    if not os.path.exists(video_path):
        logger.error(f"Background video not found at: {video_path}")
        # List directory contents to help debug
        try:
            public_dir = "/app/public/content"
            if os.path.exists(public_dir):
                files = os.listdir(public_dir)
                logger.info(f"Files in {public_dir}: {files}")
        except Exception as e:
            logger.error(f"Failed to list directory: {e}")
        raise HTTPException(status_code=400, detail=f"Background video not found at: {video_path}")
    
    if not os.path.exists(stewie_image_path):
        logger.error(f"Stewie image not found at: {stewie_image_path}")
        raise HTTPException(status_code=400, detail=f"Stewie image not found at: {stewie_image_path}")
    
    if not os.path.exists(peter_image_path):
        logger.error(f"Peter image not found at: {peter_image_path}")
        raise HTTPException(status_code=400, detail=f"Peter image not found at: {peter_image_path}")
    
    logger.info("All file paths validated successfully")
    return video_path, stewie_image_path, peter_image_path

def process_media_files(media_files: List[Dict[str, Any]]) -> Dict[str, bytes]:
    """Process and decode media files (images and videos)"""
    logger.info(f"Processing {len(media_files)} media files...")
    media_buffers = {}
    
    if media_files:
        for i, media_file in enumerate(media_files):
            logger.info(f"Processing media file {i+1}/{len(media_files)}: {media_file.get('filename', 'unknown')}")
            if media_file.get("type") in ["image", "video"]:
                try:
                    buffer_data = base64.b64decode(media_file["data"])
                    file_size_mb = len(buffer_data) / (1024 * 1024)
                    
                    # Size validation
                    max_size = 50 if media_file.get("type") == "video" else 10  # MB
                    if file_size_mb > max_size:
                        logger.warning(f"{media_file['filename']} is {file_size_mb:.1f}MB, which exceeds the {max_size}MB limit")
                        print(f"Warning: {media_file['filename']} is {file_size_mb:.1f}MB, which exceeds the {max_size}MB limit")
                        continue
                    
                    media_buffers[media_file["filename"]] = buffer_data
                    logger.info(f"Successfully processed {media_file['type']}: {media_file['filename']} ({file_size_mb:.1f}MB)")
                    print(f"Processed {media_file['type']}: {media_file['filename']} ({file_size_mb:.1f}MB)")
                except Exception as e:
                    logger.error(f"Error processing {media_file.get('filename', 'unknown')}: {str(e)}")
                    print(f"Error processing {media_file.get('filename', 'unknown')}: {str(e)}")
                    continue
    
    logger.info(f"Processed {len(media_buffers)} media files successfully")
    return media_buffers

def create_image_overlays(conversation, media_buffers: Dict[str, bytes], word_timeline: List[Dict]) -> List[ImageOverlay]:
    """Create image overlay objects from conversation data using word timing"""
    logger.info("Creating image overlays...")
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
    
    for turn_idx, turn in enumerate(conversation):
        if hasattr(turn, 'imageOverlays') and turn.imageOverlays:
            logger.info(f"Turn {turn_idx} has {len(turn.imageOverlays)} image overlays")
            for overlay_idx, overlay in enumerate(turn.imageOverlays):
                logger.info(f"Processing overlay {overlay_idx+1}: {overlay.filename}")
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
                                logger.info(f"Found trigger word '{trigger_word}' at {trigger_time}s for {media_type} {overlay.filename}")
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
                            logger.info(f"Added {media_type} overlay: {overlay.filename} from {trigger_time}s to {trigger_time + duration}s")
                            print(f"Added {media_type} overlay: {overlay.filename} from {trigger_time}s to {trigger_time + duration}s")
                        else:
                            logger.warning(f"Trigger word '{trigger_word}' not found in conversation for {media_type} {overlay.filename}")
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
                            logger.info(f"Using fallback timing for {media_type} {overlay.filename}: {fallback_time}s to {fallback_time + duration}s")
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
                        logger.info(f"No trigger word specified for {media_type} {overlay.filename}, using time: {fallback_time}s to {fallback_time + duration}s")
                        print(f"No trigger word specified for {media_type} {overlay.filename}, using time: {fallback_time}s to {fallback_time + duration}s")
                else:
                    logger.warning(f"Media file {overlay.filename} not found in media buffers")
    
    logger.info(f"Created {len(image_overlays_list)} image overlays")
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
    logger.info(f"Generating video with duration: {total_duration}s")
    logger.info(f"Audio files: {len(audio_data_list)}")
    logger.info(f"Character timeline entries: {len(character_timeline_list)}")
    logger.info(f"Word timeline entries: {len(word_timeline)}")
    logger.info(f"Image overlays: {len(image_overlays_list) if image_overlays_list else 0}")
    
    # Create subtitle content
    logger.info("Creating subtitle content...")
    subtitle_content = create_subtitle_content(word_timeline)
    subtitle_entries = subtitle_content.split('\n\n')
    logger.info(f"Created subtitle content with {len(subtitle_entries)} entries")
    
    # Create video
    logger.info("Creating final video...")
    config = VideoConfig()
    
    try:
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
        logger.info(f"Video buffer created successfully, size: {len(video_buffer) / (1024*1024):.1f} MB")
    except Exception as e:
        logger.error(f"Error creating video: {str(e)}")
        raise
    
    return video_buffer

def save_video_to_temp(video_buffer: bytes, request_id: str) -> tuple[str, int]:
    """Save video buffer to temporary file and return path and size"""
    logger.info(f"Saving video to temp file for request {request_id}")
    temp_video_path = os.path.join(tempfile.gettempdir(), f"video_output_{request_id}.mp4")
    
    try:
        with open(temp_video_path, "wb") as f:
            f.write(video_buffer)
        
        # Get file size for logging
        file_size = os.path.getsize(temp_video_path)
        logger.info(f"Video saved successfully to {temp_video_path}, size: {file_size / (1024*1024):.1f} MB")
    except Exception as e:
        logger.error(f"Error saving video to temp file: {str(e)}")
        raise
    
    return temp_video_path, file_size 
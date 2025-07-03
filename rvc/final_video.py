import os
import tempfile
import time
import uuid
import asyncio
from typing import List, Optional

from video.types import AudioFileData, CharacterTimeline, ImageOverlay, VideoConfig
from video.audio_processing import write_combined_audio_file
from video.file_utils import write_subtitle_file, write_image_overlay_files, cleanup_temp_files
from video.video_effects import create_character_overlay_expressions
from video.ffmpeg_utils import build_ffmpeg_inputs, build_filter_complex, build_ffmpeg_command

async def create_final_video_with_buffers(
    video_path: str,
    stewie_image_path: str,
    peter_image_path: str,
    audio_data: List[AudioFileData],
    subtitle_content: str,
    character_timeline: List[CharacterTimeline],
    duration: float,
    image_overlays: Optional[List[ImageOverlay]] = None,
    config: Optional[VideoConfig] = None
) -> bytes:
    """Create final video with character overlays, subtitles, and image overlays"""
    
    if config is None:
        config = VideoConfig()
    
    fade_in_duration = config.subtitle_config.fade_in_duration
    fade_out_duration = config.subtitle_config.fade_out_duration
    
    # Prepare temporary files
    subtitle_path = write_subtitle_file(subtitle_content)
    combined_audio_path = await write_combined_audio_file(audio_data)
    overlay_temp_files = write_image_overlay_files(image_overlays)
    
    try:
        # Create character overlay expressions
        stewie_overlay, peter_overlay = create_character_overlay_expressions(
            character_timeline, fade_in_duration, fade_out_duration
        )
        
        # Build FFmpeg command components
        inputs = build_ffmpeg_inputs(
            video_path, stewie_image_path, peter_image_path, 
            combined_audio_path, duration, overlay_temp_files
        )
        
        filter_complex = build_filter_complex(
            stewie_overlay, peter_overlay, image_overlays, 
            overlay_temp_files, subtitle_path
        )
        
        output_path = os.path.join(tempfile.gettempdir(), f"output_{int(time.time())}_{uuid.uuid4()}.mp4")
        
        command = build_ffmpeg_command(inputs, filter_complex, output_path)
        
        # Run FFmpeg
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await process.communicate()
        
        if process.returncode != 0:
            raise RuntimeError(f"FFmpeg processing failed: {stderr.decode()}")
        
        # Read output video
        with open(output_path, 'rb') as f:
            video_buffer = f.read()
        
        # Cleanup
        os.unlink(output_path)
        
        return video_buffer
        
    finally:
        # Cleanup temp files
        cleanup_temp_files([subtitle_path, combined_audio_path] + overlay_temp_files)
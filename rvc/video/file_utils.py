import os
import tempfile
import time
import uuid
from typing import List, Optional
from ..video import ImageOverlay

def write_subtitle_file(subtitle_content: str) -> str:
    """Write subtitle content to a temporary file and return the path"""
    subtitle_path = os.path.join(tempfile.gettempdir(), f"subtitles_{int(time.time())}_{uuid.uuid4()}.ass")
    with open(subtitle_path, 'w') as f:
        f.write(subtitle_content)
    return subtitle_path

def write_image_overlay_files(image_overlays: Optional[List[ImageOverlay]]) -> List[str]:
    """Write image overlay buffers to temporary files and return list of paths"""
    overlay_temp_files = []
    if image_overlays:
        for i, overlay in enumerate(image_overlays):
            temp_image_path = os.path.join(tempfile.gettempdir(), f"overlay_{int(time.time())}_{i}_{uuid.uuid4()}.png")
            with open(temp_image_path, 'wb') as f:
                f.write(overlay.buffer)
            overlay_temp_files.append(temp_image_path)
    return overlay_temp_files

def cleanup_temp_files(temp_files: List[str]) -> None:
    """Clean up temporary files"""
    for temp_file in temp_files:
        try:
            os.unlink(temp_file)
        except:
            pass 
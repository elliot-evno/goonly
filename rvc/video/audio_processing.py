import os
import tempfile
import subprocess
import uuid
import asyncio
import time
from typing import List
from .types import AudioFileData

async def combine_audio_buffers(audio_data: List[AudioFileData]) -> bytes:
    """Combine multiple audio buffers into a single WAV file"""
    if not audio_data:
        raise ValueError("No audio data provided")
    
    # Write buffers to temporary files
    temp_files = []
    try:
        for i, data in enumerate(audio_data):
            temp_path = os.path.join(tempfile.gettempdir(), f"audio_part_{uuid.uuid4()}.wav")
            with open(temp_path, 'wb') as f:
                f.write(data.buffer)
            temp_files.append(temp_path)
        
        # Use ffmpeg to concatenate audio files
        output_path = os.path.join(tempfile.gettempdir(), f"combined_audio_{uuid.uuid4()}.wav")
        
        # Create concat file list
        concat_list_path = os.path.join(tempfile.gettempdir(), f"concat_list_{uuid.uuid4()}.txt")
        with open(concat_list_path, 'w') as f:
            for temp_file in temp_files:
                f.write(f"file '{temp_file}'\n")
        
        # Run ffmpeg concat
        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_list_path,
            '-c', 'copy',
            output_path
        ]
        
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await process.communicate()
        
        if process.returncode != 0:
            raise RuntimeError(f"FFmpeg concat failed: {stderr.decode()}")
        
        # Read combined audio
        with open(output_path, 'rb') as f:
            combined_buffer = f.read()
        
        # Cleanup
        os.unlink(output_path)
        os.unlink(concat_list_path)
        
        return combined_buffer
        
    finally:
        # Cleanup temp files
        for temp_file in temp_files:
            try:
                os.unlink(temp_file)
            except:
                pass

async def write_combined_audio_file(audio_data: List[AudioFileData]) -> str:
    """Combine audio buffers and write to a temporary file, return the path"""
    combined_audio_buffer = await combine_audio_buffers(audio_data)
    combined_audio_path = os.path.join(tempfile.gettempdir(), f"combined_audio_{int(time.time())}_{uuid.uuid4()}.wav")
    with open(combined_audio_path, 'wb') as f:
        f.write(combined_audio_buffer)
    return combined_audio_path 
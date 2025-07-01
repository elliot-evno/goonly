import os
import sys
import tempfile
import subprocess
from scipy.io import wavfile
import numpy as np
import time
import uuid
import pathlib
import requests
import logging
import json
from typing import List, Dict, Optional, Tuple
import asyncio
from dataclasses import dataclass

@dataclass
class AudioFileData:
    buffer: bytes
    duration: float
    character: str

@dataclass
class CharacterTimeline:
    character: str
    start_time: float
    end_time: float

@dataclass
class ImageOverlay:
    buffer: bytes
    start_time: float
    end_time: float
    description: str

@dataclass
class SubtitleConfig:
    fade_in_duration: float = 0.05
    fade_out_duration: float = 0.05
    scale_animation: bool = False
    dynamic_positioning: bool = True
    max_simultaneous_lines: int = 1

@dataclass
class VideoConfig:
    subtitle_config: SubtitleConfig = None
    
    def __post_init__(self):
        if self.subtitle_config is None:
            self.subtitle_config = SubtitleConfig()

async def combine_audio_buffers(audio_data: List[AudioFileData]) -> bytes:
    """Combine multiple audio buffers into a single WAV file"""
    if not audio_data:
        raise ValueError("No audio data provided")
    
    # Write buffers to temporary files
    temp_files = []
    try:
        for i, data in enumerate(audio_data):
            temp_path = f"/tmp/audio_part_{uuid.uuid4()}.wav"
            with open(temp_path, 'wb') as f:
                f.write(data.buffer)
            temp_files.append(temp_path)
        
        # Use ffmpeg to concatenate audio files
        output_path = f"/tmp/combined_audio_{uuid.uuid4()}.wav"
        
        # Create concat file list
        concat_list_path = f"/tmp/concat_list_{uuid.uuid4()}.txt"
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
    
    # Write subtitle content to temp file
    subtitle_path = f"/tmp/subtitles_{int(time.time())}_{uuid.uuid4()}.ass"
    with open(subtitle_path, 'w') as f:
        f.write(subtitle_content)
    
    # Combine audio buffers
    combined_audio_buffer = await combine_audio_buffers(audio_data)
    combined_audio_path = f"/tmp/combined_audio_{int(time.time())}_{uuid.uuid4()}.wav"
    with open(combined_audio_path, 'wb') as f:
        f.write(combined_audio_buffer)
    
    # Write image overlay buffers to temp files
    overlay_temp_files = []
    try:
        if image_overlays:
            for i, overlay in enumerate(image_overlays):
                temp_image_path = f"/tmp/overlay_{int(time.time())}_{i}_{uuid.uuid4()}.png"
                with open(temp_image_path, 'wb') as f:
                    f.write(overlay.buffer)
                overlay_temp_files.append(temp_image_path)
        
        # Create character overlay expressions
        stewie_segments = [t for t in character_timeline if t.character == 'stewie']
        peter_segments = [t for t in character_timeline if t.character == 'peter']
        
        stewie_overlay = '+'.join([
            f"between(t,{t.start_time},{t.end_time})*"
            f"if(between(t,{t.start_time},{t.start_time + fade_in_duration}),"
            f"(t-{t.start_time})/{fade_in_duration},"
            f"if(between(t,{t.end_time - fade_out_duration},{t.end_time}),"
            f"({t.end_time}-t)/{fade_out_duration},1))"
            for t in stewie_segments
        ]) or '0'
        
        peter_overlay = '+'.join([
            f"between(t,{t.start_time},{t.end_time})*"
            f"if(between(t,{t.start_time},{t.start_time + fade_in_duration}),"
            f"(t-{t.start_time})/{fade_in_duration},"
            f"if(between(t,{t.end_time - fade_out_duration},{t.end_time}),"
            f"({t.end_time}-t)/{fade_out_duration},1))"
            for t in peter_segments
        ]) or '0'
        
        # Build FFmpeg command
        inputs = [
            '-t', str(duration),
            '-i', video_path,
            '-i', stewie_image_path,
            '-i', peter_image_path,
            '-i', combined_audio_path
        ]
        
        image_filter_chain = []
        if image_overlays:
            for i, (overlay, temp_file) in enumerate(zip(image_overlays, overlay_temp_files)):
                inputs.extend(['-i', temp_file])
                input_index = 4 + i
                scaled_label = f"img_{i}_scaled"
                image_filter_chain.append(f"[{input_index}:v]scale=600:-1[{scaled_label}]")
        
        # Build filter chain
        filter_parts = [
            # Scale character images
            '[1:v]scale=-1:700[stewie_img]',
            '[2:v]scale=-1:700[peter_img]',
            
            # Add character overlays
            f"[0:v][stewie_img]overlay=400:H-h-30:enable='{stewie_overlay}'[with_stewie]",
            f"[with_stewie][peter_img]overlay=-300:H-h-30:enable='{peter_overlay}'[with_characters]",
        ]
        
        # Add image scaling
        filter_parts.extend(image_filter_chain)
        
        # Add image overlays
        if image_overlays:
            for i, overlay in enumerate(image_overlays):
                input_label = 'with_characters' if i == 0 else f'with_overlay_{i-1}'
                output_label = 'with_overlays' if i == len(image_overlays) - 1 else f'with_overlay_{i}'
                scaled_label = f'img_{i}_scaled'
                overlay_enable = f"between(t,{overlay.start_time},{overlay.end_time})"
                
                filter_parts.append(
                    f"[{input_label}][{scaled_label}]overlay=(W-w)/2:100:enable='{overlay_enable}'[{output_label}]"
                )
        
        # Add subtitles
        final_input = 'with_overlays' if image_overlays else 'with_characters'
        filter_parts.append(
            f"[{final_input}]subtitles='{subtitle_path}':"
            f"force_style='FontName=Arial Black,Fontsize=140,PrimaryColour=&H00FFFFFF,"
            f"BorderStyle=1,Outline=8,Shadow=3,Alignment=2,MarginV=600'[final]"
        )
        
        filter_complex = ';'.join(filter_parts)
        
        output_path = f"/tmp/output_{int(time.time())}_{uuid.uuid4()}.mp4"
        
        command = [
            'ffmpeg',
            *inputs,
            '-y',
            '-filter_complex', filter_complex,
            '-map', '[final]',
            '-map', '3:a',
            '-c:v', 'libx264',
            '-preset', 'slow',
            '-crf', '18',
            '-c:a', 'aac',
            '-s', '1080x1920',
            '-r', '30',
            '-shortest',
            '-y',
            output_path
        ]
        
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
        for temp_file in [subtitle_path, combined_audio_path] + overlay_temp_files:
            try:
                os.unlink(temp_file)
            except:
                pass
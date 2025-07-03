from typing import List, Optional
from ..video import ImageOverlay

def build_ffmpeg_inputs(video_path: str, stewie_image_path: str, peter_image_path: str, 
                       combined_audio_path: str, duration: float, overlay_temp_files: List[str]) -> List[str]:
    """Build the input arguments for FFmpeg"""
    inputs = [
        '-t', str(duration),
        '-i', video_path,
        '-i', stewie_image_path,
        '-i', peter_image_path,
        '-i', combined_audio_path
    ]
    
    # Add image overlay inputs
    for temp_file in overlay_temp_files:
        inputs.extend(['-i', temp_file])
    
    return inputs

def build_filter_complex(stewie_overlay: str, peter_overlay: str, image_overlays: Optional[List[ImageOverlay]], 
                        overlay_temp_files: List[str], subtitle_path: str) -> str:
    """Build the filter complex string for FFmpeg"""
    # Create image scaling filters
    image_filter_chain = []
    if image_overlays:
        for i in range(len(image_overlays)):
            input_index = 4 + i  # Starting from input index 4
            scaled_label = f"img_{i}_scaled"
            image_filter_chain.append(f"[{input_index}:v]scale=600:-1[{scaled_label}]")
    
    # Build main filter chain
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
        f"BorderStyle=1,Outline=8,Shadow=3,Alignment=8,MarginV=200'[final]"
    )
    
    return ';'.join(filter_parts)

def build_ffmpeg_command(inputs: List[str], filter_complex: str, output_path: str) -> List[str]:
    """Build the complete FFmpeg command"""
    return [
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
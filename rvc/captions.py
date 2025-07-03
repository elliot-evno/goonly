import os
import tempfile
import uuid
from models.whisper import load_whisper_model, WHISPER_AVAILABLE

try: 
    import whisper_timestamped as whisper
except ImportError:
    pass

async def get_word_timings_from_whisper(audio_buffer: bytes, text: str):
    """Helper function to get word timings from whisper"""
    if not WHISPER_AVAILABLE:
        return []
    
    # Save audio buffer to temp file
    temp_audio_path = os.path.join(tempfile.gettempdir(), f"whisper_audio_{uuid.uuid4()}.wav")
    with open(temp_audio_path, "wb") as f:
        f.write(audio_buffer)
    
    try:
        # Load whisper model
        model = load_whisper_model()
        
        # Load audio and transcribe
        audio_data = whisper.load_audio(temp_audio_path)
        result = whisper.transcribe(model, audio_data, language="en", verbose=False)
        
        # Extract word timings
        word_segments = []
        if "segments" in result:
            for segment in result["segments"]:
                if "words" in segment:
                    for word_data in segment["words"]:
                        if isinstance(word_data, dict) and "text" in word_data:
                            word_segments.append({
                                "word": word_data.get("text", "").strip(),
                                "start": word_data.get("start", 0),
                                "end": word_data.get("end", 0)
                            })
        
        return word_segments
        
    finally:
        if os.path.exists(temp_audio_path):
            os.unlink(temp_audio_path)

def create_subtitle_content(word_timeline):
    """Create ASS subtitle content from word timeline"""
    # ASS header
    content = """[Script Info]
Title: Generated Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,140,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,8,3,2,10,10,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    
    # Add word events
    for word in word_timeline:
        start_time = format_ass_time(word["startTime"])
        end_time = format_ass_time(word["endTime"])
        text = word["text"]
        
        content += f"Dialogue: 0,{start_time},{end_time},Default,,0,0,0,,{text}\n"
    
    return content

def format_ass_time(seconds):
    """Format seconds to ASS time format (h:mm:ss.cc)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    centisecs = int((seconds % 1) * 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{centisecs:02d}"

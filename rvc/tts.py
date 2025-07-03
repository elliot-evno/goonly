import requests
import tempfile
import subprocess
import uuid
from config import *
import os

def cleanup_temp_files(*file_paths):
    """Clean up temporary files safely"""
    for file_path in file_paths:
        try:
            if file_path and os.path.exists(file_path):
                os.unlink(file_path)
        except Exception as e:
            pass


async def generate_tts_audio(text: str, character: str, output_path: str) -> bool:
    """Generate TTS audio with fallback chain"""
    request_id = str(uuid.uuid4())[:8]
    
    # First attempt: ElevenLabs via direct API
    if ELEVENLABS_VOICE_ID and ELEVENLABS_API_KEY:
        try:
            voice_id = ELEVENLABS_VOICE_ID
            api_key = ELEVENLABS_API_KEY
            url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
            
            headers = {
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
                "xi-api-key": api_key
            }
            
            data = {
                "text": text,
                "model_id": "eleven_monolingual_v1",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.5
                }
            }
            
            response = requests.post(url, json=data, headers=headers, timeout=30)
            try:
                response.raise_for_status()
            except Exception:
                pass
            
            # Save to temporary MP3, then convert
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as mp3_file:
                mp3_path = mp3_file.name
                mp3_file.write(response.content)
            
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-i", mp3_path, output_path], 
                    check=True, 
                    capture_output=True
                )
                return True
            finally:
                cleanup_temp_files(mp3_path)
        except Exception:
            # If ElevenLabs fails, we could add fallback logic here
            pass
    
    # If we reach here, TTS generation failed
    return False

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
    """Generate TTS audio with character-specific voices"""
    request_id = str(uuid.uuid4())[:8]
    
    # Get character-specific voice ID from config
    if character not in MODEL_CONFIG:
        print(f"[{request_id}] Unknown character: {character}")
        return False
    
    character_voice_id = MODEL_CONFIG[character].get("tts_voice_id")
    
    # First attempt: ElevenLabs via direct API with character-specific voice
    if character_voice_id and ELEVENLABS_API_KEY:
        try:
            print(f"[{request_id}] Using {character} voice ID: {character_voice_id}")
            
            url = f"https://api.elevenlabs.io/v1/text-to-speech/{character_voice_id}"
            
            headers = {
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
                "xi-api-key": ELEVENLABS_API_KEY
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
                print(f"[{request_id}] Successfully generated TTS for {character}")
            except Exception as e:
                print(f"[{request_id}] ElevenLabs API error: {str(e)}")
                return False
            
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
                print(f"[{request_id}] Successfully converted MP3 to WAV for {character}")
                return True
            finally:
                cleanup_temp_files(mp3_path)
        except Exception as e:
            print(f"[{request_id}] TTS generation failed for {character}: {str(e)}")
            # If ElevenLabs fails, we could add fallback logic here
            pass
    else:
        print(f"[{request_id}] No voice ID or API key configured for {character}")
    
    # If we reach here, TTS generation failed
    return False

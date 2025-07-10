import tempfile
import uuid
import os
import asyncio
from typing import List, Dict, Any
from scipy.io import wavfile
from fastapi import HTTPException

from models.models import load_model
from config import MODEL_CONFIG
from models.tts import generate_tts_audio, cleanup_temp_files
from models.whisper import WHISPER_AVAILABLE
from captions import get_word_timings_from_whisper
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'video'))
from video.types import AudioFileData, CharacterTimeline

async def generate_audio_for_text(text: str, character: str, request_id: str) -> Dict[str, Any]:
    """Generate RVC audio for a single text input"""
    # Create temp files
    tts_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    output_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tts_path = tts_file.name
    output_path = output_file.name
    tts_file.close()
    output_file.close()
    
    try:
        print(f"[{request_id}] Starting audio generation for {character}: {text[:50]}...")
        
        # Load RVC model
        print(f"[{request_id}] Loading RVC model...")
        model = load_model(character)
        config = MODEL_CONFIG[character]
        print(f"[{request_id}] Model loaded successfully")
        
        # Generate TTS audio
        print(f"[{request_id}] Generating TTS audio...")
        tts_success = await generate_tts_audio(text, character, tts_path)
        if not tts_success:
            raise HTTPException(status_code=500, detail="TTS generation failed")
        print(f"[{request_id}] TTS audio generated successfully")
        
        # Apply RVC voice conversion
        print(f"[{request_id}] Applying RVC voice conversion...")
        try:
            result = model.vc_single(
                0, tts_path, 0, None, "harvest", config["index_path"], None, 0.66, 3, 0, 1, 0.33
            )
            print(f"[{request_id}] RVC conversion completed, result type: {type(result)}")
        except Exception as e:
            print(f"[{request_id}] RVC conversion failed with error: {str(e)}")
            import traceback
            print(traceback.format_exc())
            raise HTTPException(status_code=500, detail=f"RVC conversion error: {str(e)}")
        
        # Check if the RVC conversion was successful
        if result is None or len(result) < 2:
            raise HTTPException(status_code=500, detail="RVC voice conversion failed")
        
        info, wav_opt = result
        print(f"[{request_id}] RVC result info: {info}")
        print(f"[{request_id}] wav_opt type: {type(wav_opt)}, length: {len(wav_opt) if wav_opt else 'None'}")
        
        # Check if wav_opt is valid
        if wav_opt is None or len(wav_opt) < 2:
            raise HTTPException(status_code=500, detail=f"RVC conversion failed: {info}")
        
        # Write the converted audio
        print(f"[{request_id}] Writing converted audio...")
        wavfile.write(output_path, wav_opt[0], wav_opt[1])
        
        # Read the converted audio
        with open(output_path, "rb") as f:
            audio_buffer = f.read()
        
        # Calculate actual duration from wav data
        sample_rate = wav_opt[0]
        num_samples = len(wav_opt[1])
        duration = num_samples / sample_rate
        
        print(f"[{request_id}] Audio generation completed successfully, duration: {duration}s")
        
        return {
            "buffer": audio_buffer,
            "character": character,
            "text": text,
            "duration": duration
        }
        
    finally:
        # Cleanup temp files
        cleanup_temp_files(tts_path, output_path)

async def process_conversation_audio(conversation, request_id: str) -> tuple[List[AudioFileData], List[CharacterTimeline], List[Dict], float]:
    """Process all audio for a conversation and return timeline data"""
    # Generate audio for each line
    audio_tasks = []
    
    for turn in conversation:
        if turn.stewie and turn.stewie.strip():
            audio_tasks.append({"text": turn.stewie, "character": "stewie"})
        if turn.peter and turn.peter.strip():
            audio_tasks.append({"text": turn.peter, "character": "peter"})
    
    print(f"[{request_id}] Found {len(audio_tasks)} non-empty audio tasks")
    
    # Process audio generation sequentially (as per the original implementation)
    print(f"[{request_id}] Generating {len(audio_tasks)} audio files sequentially...")
    audio_results = []
    for i, task in enumerate(audio_tasks):
        print(f"[{request_id}] Processing audio {i+1}/{len(audio_tasks)} ({task['character']})")
        result = await generate_audio_for_text(task["text"], task["character"], request_id)
        audio_results.append(result)
    print(f"[{request_id}] All audio generation completed")
    
    # Build timeline
    audio_data_list = []
    character_timeline_list = []
    word_timeline = []
    GAP_DURATION = 0.2
    current_time = 0
    
    for audio in audio_results:
        audio_data_list.append(
            AudioFileData(
                buffer=audio["buffer"],
                duration=audio["duration"],
                character=audio["character"]
            )
        )
        
        character_timeline_list.append(
            CharacterTimeline(
                character=audio["character"],
                start_time=current_time,
                end_time=current_time + audio["duration"]
            )
        )
        
        # Get word timings using whisper
        if WHISPER_AVAILABLE:
            try:
                word_timings = await get_word_timings_from_whisper(audio["buffer"], audio["text"])
                for word_timing in word_timings:
                    word_timeline.append({
                        "text": word_timing["word"],
                        "startTime": current_time + word_timing["start"],
                        "endTime": current_time + word_timing["end"],
                        "character": audio["character"]
                    })
            except Exception as e:
                print(f"[{request_id}] Warning: Failed to get word timings: {str(e)}")
                # Fallback: create simple word timeline
                words = audio["text"].split()
                word_duration = audio["duration"] / len(words) if words else 0
                for i, word in enumerate(words):
                    word_timeline.append({
                        "text": word,
                        "startTime": current_time + (i * word_duration),
                        "endTime": current_time + ((i + 1) * word_duration),
                        "character": audio["character"]
                    })
        else:
            # No whisper available - create simple word timeline
            words = audio["text"].split()
            word_duration = audio["duration"] / len(words) if words else 0
            for i, word in enumerate(words):
                word_timeline.append({
                    "text": word,
                    "startTime": current_time + (i * word_duration),
                    "endTime": current_time + ((i + 1) * word_duration),
                    "character": audio["character"]
                })
        
        current_time += audio["duration"] + GAP_DURATION
    
    total_duration = current_time - GAP_DURATION + 1 if current_time > 0 else 1
    
    return audio_data_list, character_timeline_list, word_timeline, total_duration 
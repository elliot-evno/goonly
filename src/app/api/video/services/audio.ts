import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { AudioResult, AudioFileData } from '../types';

export async function generateAudio(text: string, character: 'stewie' | 'peter', retries: number = 3): Promise<AudioResult> {
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const formData = new FormData();
      formData.append('text', text);
      formData.append('character', character);
      
      // Use AbortController with longer timeout for TTS
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes
      
      const response = await fetch('http://goonly.norrevik.ai/tts/', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Audio generation failed for ${character}: ${response.status} ${response.statusText}`);
      }
      
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      
      if (audioBuffer.length === 0) {
        throw new Error(`Empty audio buffer received for ${character}`);
      }
      
      // Get actual duration using ffprobe
      const tempPath = path.join(process.cwd(), 'temp', `temp_${Date.now()}_${Math.random()}.wav`);
      await fs.promises.writeFile(tempPath, audioBuffer);
      
      const duration = await new Promise<number>((resolve) => {
        ffmpeg.ffprobe(tempPath, (err: Error | null, metadata: { format: { duration?: number } }) => {
          if (err) {
            console.warn(`⚠️ Failed to get duration for ${character}, using fallback:`, err.message);
            resolve(3.0); // Fallback duration
          } else {
            const actualDuration = metadata.format.duration || 3.0;
            resolve(actualDuration);
          }
        });
      });
      
      // Cleanup temp file
      await fs.promises.unlink(tempPath).catch(() => {});
      
      return { 
        buffer: audioBuffer, 
        duration, 
        character, 
        text 
      };
      
    } catch (error) {
      console.warn(`⚠️ Attempt ${attempt + 1} failed for ${character}:`, error);
      
      if (attempt === retries) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`TTS timeout: ${character} speech generation took longer than 2 minutes`);
        }
        throw new Error(`Failed to generate ${character} speech after ${retries + 1} attempts: ${error}`);
      }
      
      // Wait before retrying with exponential backoff
      const waitTime = Math.pow(2, attempt + 1) * 1000;
      console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw new Error(`Failed to generate ${character} speech`);
}

export async function getWhisperWordTimings(audioPath: string, text: string): Promise<Array<{word: string, start: number, end: number}>> {
  try {
    
    const formData = new FormData();
    const audioBuffer = await fs.promises.readFile(audioPath);
    const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' });
    
    formData.append('audio', audioBlob, 'audio.wav');
    formData.append('text', text);
    
    const response = await fetch('http://goonly.norrevik.ai/whisper-timestamped/', {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`Whisper timestamped failed: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.word_segments && result.word_segments.length > 0) {
      return result.word_segments.map((segment: { word: string; start: number; end: number }) => ({
        word: segment.word.trim(),
        start: segment.start,
        end: segment.end
      }));
    } else {
      throw new Error('No word segments returned from whisper-timestamped');
    }
    
  } catch (error) {
    console.warn(`⚠️ Whisper-timestamped failed, falling back to improved estimation:`, error);
    return estimateWordTiming(text, await getAudioDuration(audioPath));
  }
}

async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise<number>((resolve) => {
    ffmpeg.ffprobe(audioPath, (err: Error | null, metadata: { format: { duration?: number } }) => {
      if (err) resolve(3.0); // Fallback duration
      else resolve(metadata.format.duration || 3.0);
    });
  });
}

export function estimateWordTiming(text: string, duration: number): Array<{word: string, start: number, end: number}> {
  const words = text.split(' ').filter(word => word.trim() !== '');
  
  if (words.length === 0) {
    return [];
  }

  // Simple, even distribution (like CapCut actually does)
  const avgTimePerWord = duration / words.length;
  
  let currentTime = 0;
  return words.map((word) => {
    // Simple calculation - no complex heuristics
    const wordDuration = avgTimePerWord;
    
    const result = {
      word: word,
      start: currentTime,
      end: currentTime + wordDuration
    };
    
    currentTime += wordDuration;
    return result;
  });
}

export async function combineAudioFiles(audioFiles: AudioFileData[], tempDir: string): Promise<string> {
  const combinedAudioPath = path.join(tempDir, 'combined_audio.wav');
  const GAP_DURATION = 0.2;
  
  const audioInputs = [];
  const filterParts = [];
  
  for (let i = 0; i < audioFiles.length; i++) {
    audioInputs.push(`[${i}:a]`);
    
    if (i < audioFiles.length - 1) {
      filterParts.push(`anullsrc=duration=${GAP_DURATION}:sample_rate=44100:channel_layout=stereo[gap${i}]`);
      audioInputs.push(`[gap${i}]`);
    }
  }
  
  const audioFilterComplex = [
    ...filterParts,
    `${audioInputs.join('')}concat=n=${audioInputs.length}:v=0:a=1[out]`
  ].join(';');

  await new Promise((resolve, reject) => {
    const command = ffmpeg();
    
    audioFiles.forEach(audio => {
      command.input(audio.fileName);
    });
    
    command
      .complexFilter(audioFilterComplex)
      .outputOptions(['-map', '[out]', '-c:a', 'pcm_s16le'])
      .output(combinedAudioPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  return combinedAudioPath;
} 
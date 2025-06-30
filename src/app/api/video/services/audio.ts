import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { AudioResult, AudioFileData } from '../types';

export async function generateAudio(text: string, character: 'stewie' | 'peter', retries: number = 3): Promise<AudioResult> {
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const params = new URLSearchParams();
      params.append('text', text);
      params.append('character', character);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      const url = process.env.NODE_ENV === 'development' 
        ? 'http://localhost:8000/' 
        : 'https://goonly.norrevik.ai/';

      const response = await fetch(url + 'tts/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
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
      
      // Get duration using a temp file only when necessary
      const tempPath = path.join('/tmp', `temp_${Date.now()}_${Math.random()}.wav`);
      await fs.promises.writeFile(tempPath, audioBuffer);
      
      const duration = await new Promise<number>((resolve) => {
        ffmpeg.ffprobe(tempPath, (err: Error | null, metadata: { format: { duration?: number } }) => {
          if (err) {
            console.warn(`⚠️ Failed to get duration for ${character}, using fallback:`, err.message);
            resolve(3.0);
          } else {
            const actualDuration = metadata.format.duration || 3.0;
            resolve(actualDuration);
          }
        });
      });
      
      // Cleanup temp file immediately
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
      
      const waitTime = Math.pow(2, attempt + 1) * 1000;
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
    const url = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:8000/' 
      : 'https://goonly.norrevik.ai/';
      
    
    const response = await fetch(url + 'whisper-timestamped/', {
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

  // Simple, even distribution
  const avgTimePerWord = duration / words.length;
  
  let currentTime = 0;
  return words.map((word) => {
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

export async function combineAudioBuffers(audioData: AudioFileData[]): Promise<Buffer> {
  const GAP_DURATION = 0.2;
  
  // Write audio buffers to temp files for FFmpeg processing
  const tempFiles: string[] = [];
  const audioInputs = [];
  const filterParts = [];
  
  try {
    for (let i = 0; i < audioData.length; i++) {
      const tempFile = path.join('/tmp', `audio_${Date.now()}_${i}.wav`);
      await fs.promises.writeFile(tempFile, audioData[i].buffer);
      tempFiles.push(tempFile);
      audioInputs.push(`[${i}:a]`);
      
      if (i < audioData.length - 1) {
        filterParts.push(`anullsrc=duration=${GAP_DURATION}:sample_rate=44100:channel_layout=stereo[gap${i}]`);
        audioInputs.push(`[gap${i}]`);
      }
    }
    
    const audioFilterComplex = [
      ...filterParts,
      `${audioInputs.join('')}concat=n=${audioInputs.length}:v=0:a=1[out]`
    ].join(';');

    const outputPath = path.join('/tmp', `combined_${Date.now()}.wav`);
    
    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      
      tempFiles.forEach(file => {
        command.input(file);
      });
      
      command
        .complexFilter(audioFilterComplex)
        .outputOptions(['-map', '[out]', '-c:a', 'pcm_s16le'])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const combinedBuffer = await fs.promises.readFile(outputPath);
    
    // Cleanup temp files
    await Promise.all(tempFiles.map(file => fs.promises.unlink(file).catch(() => {})));
    
    return combinedBuffer;
    
  } catch (error) {
    // Cleanup on error
    await Promise.all(tempFiles.map(file => fs.promises.unlink(file).catch(() => {})));
    throw error;
  }
} 
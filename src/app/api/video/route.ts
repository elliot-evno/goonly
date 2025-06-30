import { NextResponse } from "next/server";
import path from 'path';
import fs from 'fs';
import { 
  ConversationTurn, 
  AudioResult, 
  AudioFileData, 
  WordTiming
} from './types';
import { generateAudio, getWhisperWordTimings } from './services/audio';
import { createSubtitleContent } from './services/subtitle';
import { createFinalVideoWithBuffers } from './services/video';

export async function POST(request: Request) {
  const startTime = Date.now();
  
  try {
    const { conversation, mediaFiles }: { 
      conversation: ConversationTurn[], 
      mediaFiles?: Array<{ data: string; mimeType: string; filename: string; type: string }>
    } = await request.json();
    
    if (!conversation || conversation.length === 0) {
      throw new Error('No conversation provided');
    }
    
    // Process uploaded media files (keep as buffers)
    const mediaBuffers: { [filename: string]: Buffer } = {};
    if (mediaFiles && mediaFiles.length > 0) {
      for (const mediaFile of mediaFiles) {
        if (mediaFile.type === 'image') {
          const buffer = Buffer.from(mediaFile.data, 'base64');
          mediaBuffers[mediaFile.filename] = buffer;
        }
      }
    }

    // Generate audio in batches (keep as buffers)
    const audioResults: AudioResult[] = [];
    const BATCH_SIZE = 2;
    
    const audioTasks: Array<{ text: string; character: 'stewie' | 'peter' }> = [];
    conversation.forEach(turn => {
      audioTasks.push({ text: turn.stewie, character: 'stewie' });
      audioTasks.push({ text: turn.peter, character: 'peter' });
    });
    
    // Process tasks in small batches with delays
    for (let i = 0; i < audioTasks.length; i += BATCH_SIZE) {
      const batch = audioTasks.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(task => 
        generateAudio(task.text, task.character, 3)
      );
      
      const batchResults = await Promise.all(batchPromises);
      audioResults.push(...batchResults);
      
      if (i + BATCH_SIZE < audioTasks.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Build audio timeline (no file writing)
    const audioData: AudioFileData[] = [];
    const GAP_DURATION = 0.2;
    let currentTime = 0;
    
    for (let i = 0; i < audioResults.length; i++) {
      const audio = audioResults[i];
      
      audioData.push({
        buffer: audio.buffer,
        character: audio.character,
        text: audio.text,
        duration: audio.duration,
        startTime: currentTime
      });
      
      currentTime += audio.duration + GAP_DURATION;
    }
    
    const wordTimeline: WordTiming[] = [];
    const characterTimeline: Array<{ character: 'stewie' | 'peter'; startTime: number; endTime: number }> = [];
    
    // Process each audio for word timing using Whisper
    for (const audio of audioData) {
      characterTimeline.push({
        character: audio.character,
        startTime: audio.startTime,
        endTime: audio.startTime + audio.duration
      });
      
      // Use Whisper for accurate word timing
      const wordTimings = await getWhisperWordTimings(audio.buffer, audio.text);
      
      wordTimings.forEach((wordTiming: { word: string; start: number; end: number; }) => {
        if (wordTiming.word.trim()) {
          wordTimeline.push({
            text: wordTiming.word,
            startTime: audio.startTime + wordTiming.start,
            endTime: audio.startTime + wordTiming.end,
            character: audio.character
          });
        }
      });
    }
    
    const totalDuration = currentTime - GAP_DURATION + 1;

    // Process image overlays
    const imageOverlays: Array<{
      buffer: Buffer;
      startTime: number;
      endTime: number;
      description: string;
    }> = [];
    
    let conversationIndex = 0;
    for (const turn of conversation) {
      if (turn.imageOverlays && turn.imageOverlays.length > 0) {
        const turnStartTime = conversationIndex < audioData.length ? audioData[conversationIndex * 2]?.startTime || 0 : 0;
        
        for (const overlay of turn.imageOverlays) {
          const buffer = mediaBuffers[overlay.filename];
          if (buffer) {
            const globalStartTime = turnStartTime + overlay.startTime;
            const globalEndTime = globalStartTime + overlay.duration;
            
            imageOverlays.push({
              buffer,
              startTime: globalStartTime,
              endTime: globalEndTime,
              description: overlay.description
            });
          }
        }
      }
      conversationIndex++;
    }

    // Required file paths (these exist in the filesystem)
    const videoPath = path.join(process.cwd(), 'public', 'content', 'subwaysurfers.mp4');
    const stewieImagePath = path.join(process.cwd(), 'public', 'content', 'stewie.png');
    const peterImagePath = path.join(process.cwd(), 'public', 'content', 'peter.png');

    // Verify required files exist
    if (!fs.existsSync(videoPath)) throw new Error(`Background video not found: ${videoPath}`);
    if (!fs.existsSync(stewieImagePath)) throw new Error(`Stewie image not found: ${stewieImagePath}`);
    if (!fs.existsSync(peterImagePath)) throw new Error(`Peter image not found: ${peterImagePath}`);

    // Create subtitle content (only write to /tmp if needed)
    const subtitleContent = createSubtitleContent(wordTimeline);

    // Create final video with buffers
    const videoBuffer = await createFinalVideoWithBuffers(
      videoPath,
      stewieImagePath,
      peterImagePath,
      audioData,
      subtitleContent,
      characterTimeline,
      totalDuration,
      imageOverlays
    );

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`🎉 Video created successfully in ${totalTime}s! Size: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    
    return new NextResponse(videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="peter-stewie-conversation.mp4"'
      }
    });

  } catch (error) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`❌ Video generation failed after ${totalTime}s:`, error);
    return NextResponse.json({ 
      error: 'Failed to process video',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
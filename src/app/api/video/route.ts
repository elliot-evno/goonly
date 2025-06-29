import { NextResponse } from "next/server";
import path from 'path';
import fs from 'fs';
import { 
  ConversationTurn, 
  AudioResult, 
  AudioFileData, 
  WordTiming
} from './types';
import { generateAudio, getWhisperWordTimings, combineAudioFiles, estimateWordTiming } from './services/audio';
import { createSubtitleFile } from './services/subtitle';
import { createFinalVideo } from './services/video';

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
    
    
    // Setup temp directory
    const sessionId = Date.now().toString();
    const tempDir = path.join(process.cwd(), 'temp', sessionId);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Save uploaded media files to temp directory
    const savedMediaFiles: { [filename: string]: string } = {};
    if (mediaFiles && mediaFiles.length > 0) {
      for (const mediaFile of mediaFiles) {
        if (mediaFile.type === 'image') {
          const buffer = Buffer.from(mediaFile.data, 'base64');
          const filepath = path.join(tempDir, mediaFile.filename);
          await fs.promises.writeFile(filepath, buffer);
          savedMediaFiles[mediaFile.filename] = filepath;
        }
      }
    }

    // OPTIMIZATION 1: TRUE sequential batch audio generation (prevent RVC server overload)
    const audioResults: AudioResult[] = [];
    const BATCH_SIZE = 2; // Process 2 at a time to avoid overwhelming TTS server
    
    // Create array of audio tasks
    const audioTasks: Array<{ text: string; character: 'stewie' | 'peter' }> = [];
    conversation.forEach(turn => {
      audioTasks.push({ text: turn.stewie, character: 'stewie' });
      audioTasks.push({ text: turn.peter, character: 'peter' });
    });
    
    // Process tasks in small batches with delays
    for (let i = 0; i < audioTasks.length; i += BATCH_SIZE) {
      const batch = audioTasks.slice(i, i + BATCH_SIZE);
      
      // Generate this batch in parallel (small batch is safe)
      const batchPromises = batch.map(task => 
        generateAudio(task.text, task.character, 3)
      );
      
      const batchResults = await Promise.all(batchPromises);
      audioResults.push(...batchResults);
      
      // Add delay between batches to let TTS server recover
      if (i + BATCH_SIZE < audioTasks.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    
    // Save audio files and build timeline
    const audioFiles: AudioFileData[] = [];
    const GAP_DURATION = 0.2; // 200ms between speakers
    let currentTime = 0;
    
    for (let i = 0; i < audioResults.length; i++) {
      const audio = audioResults[i];
      const fileName = path.join(tempDir, `audio_${i}.wav`);
      await fs.promises.writeFile(fileName, audio.buffer);
      
      audioFiles.push({
        fileName,
        character: audio.character,
        text: audio.text,
        duration: audio.duration,
        startTime: currentTime
      });
      
      currentTime += audio.duration + GAP_DURATION;
    }
    
    const wordTimeline: WordTiming[] = [];
    const characterTimeline: Array<{ character: 'stewie' | 'peter'; startTime: number; endTime: number }> = [];
    
    // Process each audio file for precise word timing
    for (const audio of audioFiles) {
      // Create character timeline for overlays
      characterTimeline.push({
        character: audio.character,
        startTime: audio.startTime,
        endTime: audio.startTime + audio.duration
      });
      
      // Get precise word timings using Whisper forced alignment with fallback
      let wordTimings;
      try {
        wordTimings = await getWhisperWordTimings(audio.fileName, audio.text);
      } catch (error) {
        console.warn(`⚠️ Whisper failed for ${audio.character}, using improved estimation:`, error);
        wordTimings = estimateWordTiming(audio.text, audio.duration);
      }
      
      // Adjust timings to global timeline and add to word timeline
      wordTimings.forEach((wordTiming: { word: string; start: number; end: number; }) => {
        if (wordTiming.word.trim()) { // Skip empty words
          wordTimeline.push({
            text: wordTiming.word,
            startTime: audio.startTime + wordTiming.start,
            endTime: audio.startTime + wordTiming.end,
            character: audio.character
          });
        }
      });
    }
    
    // OPTIMIZATION 3: Fix duration calculation 
    const totalDuration = currentTime - GAP_DURATION + 1; // Remove last gap, add buffer

    // Process image overlays from conversation
    const imageOverlays: Array<{
      imagePath: string;
      startTime: number;
      endTime: number;
      description: string;
    }> = [];
    
    let conversationIndex = 0;
    for (const turn of conversation) {
      if (turn.imageOverlays && turn.imageOverlays.length > 0) {
        // Find the start time for this conversation turn
        const turnStartTime = conversationIndex < audioFiles.length ? audioFiles[conversationIndex * 2]?.startTime || 0 : 0;
        
        for (const overlay of turn.imageOverlays) {
          const imagePath = savedMediaFiles[overlay.filename];
          if (imagePath && fs.existsSync(imagePath)) {
            const globalStartTime = turnStartTime + overlay.startTime;
            const globalEndTime = globalStartTime + overlay.duration;
            
            imageOverlays.push({
              imagePath,
              startTime: globalStartTime,
              endTime: globalEndTime,
              description: overlay.description
            });
            
          }
        }
      }
      conversationIndex++;
    }
    

    // File paths
    const outputPath = path.join(tempDir, 'output.mp4');
    
    const videoPath = path.join(process.cwd(), 'public', 'content', 'subwaysurfers.mp4');
    const stewieImagePath = path.join(process.cwd(), 'public', 'content', 'stewie.png');
    const peterImagePath = path.join(process.cwd(), 'public', 'content', 'peter.png');

    // Verify required files exist
    if (!fs.existsSync(videoPath)) throw new Error(`Background video not found: ${videoPath}`);
    if (!fs.existsSync(stewieImagePath)) throw new Error(`Stewie image not found: ${stewieImagePath}`);
    if (!fs.existsSync(peterImagePath)) throw new Error(`Peter image not found: ${peterImagePath}`);

    // Step 1: Create combined audio
    const combinedAudioPath = await combineAudioFiles(audioFiles, tempDir);

    // Step 3: Create efficient ASS subtitles for word-by-word display (avoids FFmpeg filter limits)
    const subtitlePath = await createSubtitleFile(wordTimeline, tempDir);

    // Step 4: Create simplified video filter (characters + subtitles, NO hundreds of drawtext overlays)
    await createFinalVideo(
      videoPath,
      stewieImagePath,
      peterImagePath,
      combinedAudioPath,
      subtitlePath,
      characterTimeline,
      totalDuration,
      outputPath,
      imageOverlays
    );

    // Check if output file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('Output video file was not created');
    }

    // Read the output file
    const videoBuffer = await fs.promises.readFile(outputPath);
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`🎉 Video created successfully in ${totalTime}s! Size: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    
    // Cleanup temp files
    await Promise.all([
      ...audioFiles.map(audio => fs.promises.unlink(audio.fileName).catch(() => {})),
      ...Object.values(savedMediaFiles).map(imagePath => fs.promises.unlink(imagePath).catch(() => {})),
      fs.promises.unlink(outputPath).catch(() => {}),
      fs.promises.unlink(combinedAudioPath).catch(() => {}),
      fs.promises.unlink(subtitlePath).catch(() => {})
    ]);

    // Remove temp directory
    await fs.promises.rmdir(tempDir).catch(() => {});

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
import { NextResponse } from "next/server";
import path from 'path';
import fs from 'fs';
import { 
  ConversationTurn, 
  AudioResult, 
  AudioFileData, 
  WordTiming, 
  CharacterTimeline 
} from './types';
import { generateAudio, getWhisperWordTimings, combineAudioFiles, estimateWordTiming } from './services/audio';
import { createSubtitleFile } from './services/subtitle';
import { createFinalVideo } from './services/video';

export async function POST(request: Request) {
  const startTime = Date.now();
  console.log('🚀 Starting video generation...');
  
  try {
    const { conversation }: { conversation: ConversationTurn[] } = await request.json();
    
    if (!conversation || conversation.length === 0) {
      throw new Error('No conversation provided');
    }
    
    console.log(`📝 Processing conversation with ${conversation.length} turns`);
    
    // Setup temp directory
    const sessionId = Date.now().toString();
    const tempDir = path.join(process.cwd(), 'temp', sessionId);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // OPTIMIZATION 1: TRUE sequential batch audio generation (prevent RVC server overload)
    console.log('🎵 Generating audio in sequential batches...');
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
      console.log(`🎤 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(audioTasks.length/BATCH_SIZE)}: ${batch.length} audio files`);
      
      // Generate this batch in parallel (small batch is safe)
      const batchPromises = batch.map(task => 
        generateAudio(task.text, task.character, 3)
      );
      
      const batchResults = await Promise.all(batchPromises);
      audioResults.push(...batchResults);
      
      console.log(`✅ Batch ${Math.floor(i/BATCH_SIZE) + 1} complete`);
      
      // Add delay between batches to let TTS server recover
      if (i + BATCH_SIZE < audioTasks.length) {
        console.log('⏳ Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log(`✅ Generated ${audioResults.length} audio files`);
    
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
    
        // Step 2: Create precise word timeline using Whisper alignment
    console.log('🎯 Creating precise word timeline with Whisper alignment...');
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
        console.log(`🎯 Got precise Whisper timings for ${audio.character}: ${wordTimings.length} words`);
      } catch (error) {
        console.warn(`⚠️ Whisper failed for ${audio.character}, using improved estimation:`, error);
        wordTimings = estimateWordTiming(audio.text, audio.duration);
        console.log(`📊 Using estimated timings for ${audio.character}: ${wordTimings.length} words`);
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
    console.log(`📏 Total video duration: ${totalDuration.toFixed(1)}s`);
    console.log(`👥 Character timeline:`, characterTimeline.map(c => `${c.character}: ${c.startTime.toFixed(1)}s-${c.endTime.toFixed(1)}s`));
    console.log(`📝 Word timeline:`, wordTimeline.slice(0, 5).map(w => `"${w.text}": ${w.startTime.toFixed(2)}s-${w.endTime.toFixed(2)}s (${w.character})`));

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
    console.log('🎶 Combining audio tracks...');
    const combinedAudioPath = await combineAudioFiles(audioFiles, tempDir);

    // Step 3: Create efficient ASS subtitles for word-by-word display (avoids FFmpeg filter limits)
    console.log('📝 Creating word-by-word subtitles...');
    const subtitlePath = await createSubtitleFile(wordTimeline, tempDir);
    console.log(`Created subtitle file with ${wordTimeline.length} word-by-word entries`);

    // Step 4: Create simplified video filter (characters + subtitles, NO hundreds of drawtext overlays)
    console.log('🎥 Creating final video...');
    await createFinalVideo(
      videoPath,
      stewieImagePath,
      peterImagePath,
      combinedAudioPath,
      subtitlePath,
      characterTimeline,
      totalDuration,
      outputPath
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
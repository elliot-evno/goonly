import { NextResponse } from "next/server";
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

interface ConversationTurn {
  stewie: string;
  peter: string;
}

interface AudioResult {
  buffer: Buffer;
  duration: number;
  character: 'stewie' | 'peter';
  text: string;
}

interface AudioFileData {
  fileName: string;
  character: 'stewie' | 'peter';
  text: string;
  duration: number;
  startTime: number;
}

interface WordTiming {
  text: string;
  startTime: number;
  endTime: number;
  character: 'stewie' | 'peter';
}

// Generate audio using RVC API (optimized with proper error handling)
async function generateAudio(text: string, character: 'stewie' | 'peter', retries: number = 3): Promise<AudioResult> {
  console.log(`🎤 Generating audio for ${character}: "${text.substring(0, 30)}..."`);
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const formData = new FormData();
      formData.append('text', text);
      formData.append('character', character);
      
      // Use AbortController with longer timeout for TTS
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutes
      
      const response = await fetch('http://localhost:8000/tts/', {
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
      
      const duration = await new Promise<number>((resolve, reject) => {
        ffmpeg.ffprobe(tempPath, (err: any, metadata: any) => {
          if (err) {
            console.warn(`⚠️ Failed to get duration for ${character}, using fallback:`, err.message);
            resolve(3.0); // Fallback duration
          } else {
            const actualDuration = metadata.format.duration || 3.0;
            console.log(`✅ ${character}: ${actualDuration.toFixed(1)}s`);
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

// Production-ready word timing using Whisper forced alignment
async function getWhisperWordTimings(audioPath: string, text: string): Promise<Array<{word: string, start: number, end: number}>> {
  try {
    console.log(`🎯 Getting precise word timings for: "${text.substring(0, 50)}..."`);
    
    const formData = new FormData();
    const audioBuffer = await fs.promises.readFile(audioPath);
    const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' });
    
    formData.append('audio', audioBlob, 'audio.wav');
    formData.append('text', text);
    formData.append('word_timestamps', 'true');
    
    const response = await fetch('http://localhost:8000/whisper-align/', {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`Whisper alignment failed: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.word_segments && result.word_segments.length > 0) {
      console.log(`✅ Got ${result.word_segments.length} precise word timings`);
      return result.word_segments.map((segment: any) => ({
        word: segment.word.trim(),
        start: segment.start,
        end: segment.end
      }));
    } else {
      throw new Error('No word segments returned from Whisper');
    }
    
  } catch (error) {
    console.warn(`⚠️ Whisper alignment failed, falling back to estimated timing:`, error);
    // We don't have duration here, so we'll need to estimate from the audio file
    const audioBuffer = await fs.promises.readFile(audioPath);
    const tempPath = path.join(process.cwd(), 'temp', `temp_timing_${Date.now()}.wav`);
    await fs.promises.writeFile(tempPath, audioBuffer);
    
    const duration = await new Promise<number>((resolve) => {
      require('fluent-ffmpeg').ffprobe(tempPath, (err: any, metadata: any) => {
        if (err) resolve(3.0); // Fallback duration
        else resolve(metadata.format.duration || 3.0);
      });
    });
    
    await fs.promises.unlink(tempPath).catch(() => {});
    return estimateWordTiming(text, duration);
  }
}

// Improved fallback word timing estimation (better than simple division)
function estimateWordTiming(text: string, duration: number): Array<{word: string, start: number, end: number}> {
  const words = text.split(' ').filter(word => word.trim() !== '');
  
  // Estimate relative durations based on word characteristics
  const wordDurations = words.map(word => {
    let baseDuration = 0.3; // Base duration per word
    
    // Longer words take more time
    baseDuration += word.length * 0.05;
    
    // Add time for punctuation (pauses)
    if (word.match(/[.!?]$/)) baseDuration += 0.3;
    else if (word.match(/[,;:]$/)) baseDuration += 0.15;
    
    // Syllable estimation (rough)
    const vowelMatches = word.match(/[aeiouAEIOU]/g);
    const syllables = vowelMatches ? Math.max(1, vowelMatches.length) : 1;
    baseDuration += syllables * 0.1;
    
    return baseDuration;
  });
  
  // Scale to fit actual duration
  const totalEstimated = wordDurations.reduce((sum, dur) => sum + dur, 0);
  const scaleFactor = duration / totalEstimated;
  
  let currentTime = 0;
  return words.map((word, index) => {
    const scaledDuration = wordDurations[index] * scaleFactor;
    const result = {
      word: word,
      start: currentTime,
      end: currentTime + scaledDuration
    };
    currentTime += scaledDuration;
    return result;
  });
}



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
      wordTimings.forEach(wordTiming => {
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
    const combinedAudioPath = path.join(tempDir, 'combined_audio.wav');
    
    const videoPath = path.join(process.cwd(), 'public', 'content', 'subwaysurfers.mp4');
    const stewieImagePath = path.join(process.cwd(), 'public', 'content', 'stewie.png');
    const peterImagePath = path.join(process.cwd(), 'public', 'content', 'peter.png');

    // Verify required files exist
    if (!fs.existsSync(videoPath)) throw new Error(`Background video not found: ${videoPath}`);
    if (!fs.existsSync(stewieImagePath)) throw new Error(`Stewie image not found: ${stewieImagePath}`);
    if (!fs.existsSync(peterImagePath)) throw new Error(`Peter image not found: ${peterImagePath}`);

    // Step 1: Create combined audio
    console.log('🎶 Combining audio tracks...');
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

    // Step 3: Create efficient ASS subtitles for word-by-word display (avoids FFmpeg filter limits)
    console.log('📝 Creating word-by-word subtitles...');
    const subtitlePath = path.join(tempDir, 'subtitles.ass');
    
    // Create ASS header with bigger, bolder styling like social media word displays
    const assHeader = `[Script Info]
Title: Peter and Stewie Conversation
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Stewie,Arial Black,140,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,8,3,5,50,50,0,1
Style: Peter,Arial Black,140,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,8,3,5,50,50,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    
    // Helper function to format time for ASS subtitles (h:mm:ss.cc)
    function formatAssTime(seconds: number): string {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const centiseconds = Math.floor((seconds % 1) * 100);
      
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
    }

    // Convert word timeline to ASS events for word-by-word display
    const assEvents = wordTimeline.map((word) => {
      const startTime = formatAssTime(word.startTime);
      const endTime = formatAssTime(word.endTime);
      const style = word.character === 'stewie' ? 'Stewie' : 'Peter';
      const text = word.text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
      
      return `Dialogue: 0,${startTime},${endTime},${style},,0,0,0,,${text}`;
    }).join('\n');
    
    const assContent = assHeader + assEvents;
    await fs.promises.writeFile(subtitlePath, assContent);
    console.log(`Created subtitle file with ${wordTimeline.length} word-by-word entries`);

    // Step 4: Create simplified video filter (characters + subtitles, NO hundreds of drawtext overlays)
    const videoFilterComplex: string[] = [];
    
    // Scale character images preserving aspect ratio (no squeezing) - made bigger
    // Stewie: 1280x1024 -> scale to height 700, width will be ~875 (preserves 1.25:1 ratio)
    videoFilterComplex.push('[1:v]scale=-1:700[stewie_img]');  
    // Peter: 1680x1050 -> scale to height 700, width will be ~1120 (preserves 1.6:1 ratio), no flip so he faces left
    videoFilterComplex.push('[2:v]scale=-1:700[peter_img]');
    
    // Create a single combined overlay showing characters at the right times
    // Build enable expressions for each character
    const stewieEnable = characterTimeline
      .filter(c => c.character === 'stewie')
      .map(c => `between(t,${c.startTime},${c.endTime})`)
      .join('+');
    
    const peterEnable = characterTimeline
      .filter(c => c.character === 'peter')
      .map(c => `between(t,${c.startTime},${c.endTime})`)
      .join('+');
    
    // Single overlay for Stewie (moved way more left to fit in bounds) 
    videoFilterComplex.push(
      `[0:v][stewie_img]overlay=200:H-h-30:enable='${stewieEnable}'[with_stewie]`
    );
    
    // Single overlay for Peter (moved a little bit more left, bottom, facing left naturally)
    videoFilterComplex.push(
      `[with_stewie][peter_img]overlay=-300:H-h-30:enable='${peterEnable}'[with_characters]`
    );
    
    // Add word-by-word subtitles (MUCH more efficient than hundreds of drawtext filters)
    const escapedSubtitlePath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');
    videoFilterComplex.push(`[with_characters]subtitles='${escapedSubtitlePath}'[final]`);

    console.log('Efficient video filter (characters + ASS subtitles):', videoFilterComplex.join(';'));

    // Calculate total duration using the correct timeline
    const totalSequentialDuration = totalDuration;

    // Combine video with audio (single video input, no duplicates)
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)  // Single subway surfers video input
        .inputOptions(['-t', totalSequentialDuration.toString()])
        .input(stewieImagePath)  // Character images
        .input(peterImagePath)
        .input(combinedAudioPath)  // Combined audio
        .complexFilter(videoFilterComplex.join(';'))
        .outputOptions([
          '-map', '[final]',  // Use final video with character overlays and word-by-word subtitles
          '-map', '3:a',      // Use combined audio
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-s', '1080x1920',  // Vertical video format
          '-r', '30',
          '-shortest',
          '-y'
        ])
        .output(outputPath)
        .on('start', (cmd: string) => {
          console.log('Starting FFmpeg command:', cmd);
        })
        .on('end', () => {
          console.log('FFmpeg processing finished');
          resolve(null);
        })
        .on('error', (err: any) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .run();
    });

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
import { NextResponse } from "next/server";
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

interface AudioPartMeta {
  index: number;
  startTime: number;
  duration: number;
  character: 'stewie' | 'peter';
  text: string;
}

interface VideoMetadata {
  totalDuration: number;
  parts: AudioPartMeta[];
}

interface WhisperWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

// Function to get accurate word-level timestamps using Whisper
async function getWordTimestamps(audioPath: string): Promise<WhisperWord[]> {
  return new Promise((resolve, reject) => {
    console.log(`Getting word timestamps for: ${audioPath}`);
    
    // Use whisper.cpp with word-level timestamps
    // Download whisper.cpp if not present
    const whisperCommand = 'whisper';
    
    const args = [
      audioPath,
      '--model', 'base',  // Use base model for speed (you can use 'small' or 'medium' for better accuracy)
      '--output_format', 'json',
      '--word_timestamps', 'true',
      '--output_dir', path.dirname(audioPath)
    ];
    
    console.log(`Running: ${whisperCommand} ${args.join(' ')}`);
    
    const whisperProcess = spawn(whisperCommand, args, { stdio: 'pipe' });
    
    let stdout = '';
    let stderr = '';
    
    whisperProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    whisperProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    whisperProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`Whisper failed with code ${code}`);
        console.error('stderr:', stderr);
        reject(new Error(`Whisper failed: ${stderr}`));
        return;
      }
      
      try {
        // Read the generated JSON file
        const jsonPath = audioPath.replace('.wav', '.json');
        
        if (!fs.existsSync(jsonPath)) {
          throw new Error(`Whisper output file not found: ${jsonPath}`);
        }
        
        const whisperResult = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        console.log('Whisper result structure:', Object.keys(whisperResult));
        
        // Extract word-level timestamps
        const words: WhisperWord[] = [];
        
        if (whisperResult.segments) {
          whisperResult.segments.forEach((segment: any) => {
            if (segment.words) {
              segment.words.forEach((word: any) => {
                words.push({
                  word: word.word.trim(),
                  start: word.start,
                  end: word.end,
                  confidence: word.confidence || 1.0
                });
              });
            }
          });
        }
        
        console.log(`Extracted ${words.length} words with timestamps`);
        
        // Cleanup JSON file
        fs.unlinkSync(jsonPath);
        
        resolve(words);
      } catch (error) {
        console.error('Failed to parse Whisper output:', error);
        reject(error);
      }
    });
    
    whisperProcess.on('error', (error) => {
      console.error('Failed to spawn Whisper process:', error);
      
      // Fallback: Use python whisper if whisper.cpp not available
      tryPythonWhisper(audioPath).then(resolve).catch(reject);
    });
  });
}

// Fallback function using Python Whisper
async function tryPythonWhisper(audioPath: string): Promise<WhisperWord[]> {
  return new Promise((resolve, reject) => {
    console.log('Trying Python Whisper as fallback...');
    
    // Create a temporary Python script
    const pythonScript = `
import whisper
import json
import sys

try:
    model = whisper.load_model("base")
    result = model.transcribe("${audioPath}", word_timestamps=True)
    
    words = []
    for segment in result["segments"]:
        if "words" in segment:
            for word in segment["words"]:
                words.append({
                    "word": word["word"].strip(),
                    "start": word["start"],
                    "end": word["end"],
                    "confidence": getattr(word, "confidence", 1.0)
                })
    
    print(json.dumps(words))
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
`;
    
    const scriptPath = path.join(path.dirname(audioPath), 'whisper_script.py');
    fs.writeFileSync(scriptPath, pythonScript);
    
    const pythonProcess = spawn('python3', [scriptPath], { stdio: 'pipe' });
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      // Cleanup script
      fs.unlinkSync(scriptPath);
      
      if (code !== 0) {
        console.error('Python Whisper failed:', stderr);
        reject(new Error(`Python Whisper failed: ${stderr}`));
        return;
      }
      
      try {
        const words = JSON.parse(stdout);
        console.log(`Python Whisper extracted ${words.length} words`);
        resolve(words);
      } catch (error) {
        console.error('Failed to parse Python Whisper output:', error);
        reject(error);
      }
    });
    
    pythonProcess.on('error', (error) => {
      fs.unlinkSync(scriptPath);
      console.error('Failed to spawn Python process:', error);
      reject(error);
    });
  });
}

export async function POST(request: Request) {
  try {
    // Parse FormData
    const formData = await request.formData();
    
    // Get metadata
    const metadataString = formData.get('metadata') as string;
    if (!metadataString) {
      throw new Error('No metadata provided');
    }
    
    const metadata: VideoMetadata = JSON.parse(metadataString);
    console.log('Processing video with parts:', metadata.parts.length);
    console.log('Total duration:', metadata.totalDuration);
    
    // Ensure temp directory exists
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Save all audio files from FormData and get ACTUAL durations
    const audioFiles = await Promise.all(
      metadata.parts.map(async (part) => {
        console.log(`Processing audio ${part.index}:`, part.character, part.startTime);
        
        const audioFile = formData.get(`audio_${part.index}`) as File;
        if (!audioFile) {
          throw new Error(`No audio file for part ${part.index}`);
        }
        
        const fileName = path.join(tempDir, `audio_${part.index}.wav`);
        const buffer = Buffer.from(await audioFile.arrayBuffer());
        await fs.promises.writeFile(fileName, buffer);
        
        // Get ACTUAL duration of the audio file using ffprobe
        const actualDuration = await new Promise<number>((resolve, reject) => {
          ffmpeg.ffprobe(fileName, (err, metadata) => {
            if (err) {
              console.error(`Failed to get duration for ${fileName}:`, err);
              resolve(part.duration); // Fallback to metadata duration
            } else {
              const duration = metadata.format.duration || part.duration;
              console.log(`Actual duration for ${part.character}: ${duration}s (metadata said ${part.duration}s)`);
              resolve(duration);
            }
          });
        });
        
        return { 
          fileName, 
          startTime: part.startTime, 
          duration: actualDuration,  // Use ACTUAL duration instead of metadata
          character: part.character 
        };
      })
    );

    // Create final video with character switching
    const outputPath = path.join(tempDir, 'output.mp4');
    const videoPath = path.join(process.cwd(), 'public', 'gameplay', 'subwaysurfers.mp4');
    const stewieImagePath = path.join(process.cwd(), 'public', 'gameplay', 'stewie.png');
    const peterImagePath = path.join(process.cwd(), 'public', 'gameplay', 'peter.png');

    // Check if files exist
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`);
    }
    if (!fs.existsSync(stewieImagePath)) {
      throw new Error(`Stewie image not found: ${stewieImagePath}`);
    }
    if (!fs.existsSync(peterImagePath)) {
      throw new Error(`Peter image not found: ${peterImagePath}`);
    }

    // Sort audio files by start time to ensure proper ordering
    const sortedAudioFiles = [...audioFiles].sort((a, b) => a.startTime - b.startTime);
    console.log('Creating video with timing:', sortedAudioFiles.map(a => 
      `${a.character}: ${a.startTime}s-${a.startTime + a.duration}s`
    ));

    // Step 1: Create combined audio - SEQUENTIAL like the frontend preview
    const combinedAudioPath = path.join(tempDir, 'combined_audio.wav');
    
    // Simple sequential concatenation with small gaps (like frontend preview)
    const audioInputs = [];
    const GAP_DURATION = 0.2; // 200ms gap like frontend preview
    
    for (let i = 0; i < sortedAudioFiles.length; i++) {
      // Add the audio file
      audioInputs.push(`[${i}:a]`);
      
      // Add gap between files (except after the last one)
      if (i < sortedAudioFiles.length - 1) {
        audioInputs.push(`anullsrc=duration=${GAP_DURATION}:sample_rate=44100:channel_layout=stereo[gap${i}]`);
        audioInputs.push(`[gap${i}]`);
      }
    }
    
    // Create simple concatenation
    const audioFilterComplex = [
      ...audioInputs.filter(item => item.includes('anullsrc')),
      `${audioInputs.filter(item => item.startsWith('[') && item.endsWith(']')).join('')}concat=n=${audioInputs.filter(item => item.startsWith('[') && item.endsWith(']')).length}:v=0:a=1[out]`
    ].join(';');

    console.log('Sequential audio filter:', audioFilterComplex);

    // Create combined audio
    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      
      sortedAudioFiles.forEach(audio => {
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

    // Step 2: Get accurate word-level timestamps using Whisper
    console.log('Getting accurate word timestamps using Whisper...');
    const sequentialTimeline = [];
    const wordTimeline = [];
    let currentTime = 0;
    
    for (let i = 0; i < sortedAudioFiles.length; i++) {
      const audio = sortedAudioFiles[i];
      const audioMetadata = metadata.parts.find(p => p.index === i);
      
      // Character appears for the duration of their audio
      sequentialTimeline.push({
        character: audio.character,
        startTime: currentTime,
        endTime: currentTime + audio.duration
      });
      
      // Get REAL word-level timing using Whisper
      if (audioMetadata) {
        try {
          console.log(`Analyzing audio ${i} with Whisper: ${audio.character}`);
          const whisperWords = await getWordTimestamps(audio.fileName);
          
          if (whisperWords.length > 0) {
            console.log(`Whisper found ${whisperWords.length} words for ${audio.character}`);
            
            // Map Whisper timestamps to global timeline
            whisperWords.forEach((whisperWord) => {
              // Only include words with reasonable confidence
              if (whisperWord.confidence > 0.5) {
                wordTimeline.push({
                  text: whisperWord.word,
                  startTime: currentTime + whisperWord.start,
                  endTime: currentTime + whisperWord.end,
                  character: audio.character,
                  confidence: whisperWord.confidence
                });
              }
            });
          } else {
            console.log(`No words found by Whisper for ${audio.character}, using fallback`);
            // Fallback to simple timing if Whisper fails
            const words = audioMetadata.text.split(' ').filter(word => word.trim() !== '');
            const wordsPerSecond = words.length / audio.duration;
            
            for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
              const wordStartTime = currentTime + (wordIndex / wordsPerSecond);
              const wordEndTime = currentTime + ((wordIndex + 1) / wordsPerSecond);
              
              wordTimeline.push({
                text: words[wordIndex],
                startTime: wordStartTime,
                endTime: wordEndTime,
                character: audio.character,
                confidence: 0.5
              });
            }
          }
        } catch (error) {
          console.error(`Whisper failed for audio ${i}:`, error);
          
          // Fallback to simple timing calculation
          const words = audioMetadata.text.split(' ').filter(word => word.trim() !== '');
          const wordsPerSecond = words.length / audio.duration;
          
          for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
            const wordStartTime = currentTime + (wordIndex / wordsPerSecond);
            const wordEndTime = currentTime + ((wordIndex + 1) / wordsPerSecond);
            
            wordTimeline.push({
              text: words[wordIndex],
              startTime: wordStartTime,
              endTime: wordEndTime,
              character: audio.character,
              confidence: 0.3 // Low confidence for fallback
            });
          }
        }
      }
      
      // Move to next time slot (audio duration + gap)
      currentTime += audio.duration;
      if (i < sortedAudioFiles.length - 1) {
        currentTime += GAP_DURATION; // Add gap between files
      }
    }
    
    console.log('Sequential timing (like preview):', sequentialTimeline.map(t => `${t.character}: ${t.startTime}s-${t.endTime}s`));
    console.log('Whisper word timing:', wordTimeline.slice(0, 10).map(w => `"${w.text}": ${w.startTime.toFixed(2)}s-${w.endTime.toFixed(2)}s (conf: ${w.confidence?.toFixed(2) || 'N/A'})`));
    
    const videoFilterComplex = [];
    
    // Scale character images - Stewie smaller on right, Peter larger on left
    videoFilterComplex.push('[1:v]scale=400:400[stewie_img]');  // Stewie smaller
    videoFilterComplex.push('[2:v]scale=600:600,hflip[peter_img]');  // Peter larger (full width)
    
    // Create overlays for each character using SEQUENTIAL timeline (repositioned)
    let videoBase = '0:v';
    for (let i = 0; i < sequentialTimeline.length; i++) {
      const timing = sequentialTimeline[i];
      const nextBase = `character${i}`;
      
      if (timing.character === 'stewie') {
        // Stewie on the RIGHT side
        videoFilterComplex.push(
          `[${videoBase}][stewie_img]overlay=W-w-50:(H-h)/2:enable='between(t,${timing.startTime},${timing.endTime})'[${nextBase}]`
        );
      } else {
        // Peter on the LEFT side
        videoFilterComplex.push(
          `[${videoBase}][peter_img]overlay=50:(H-h)/2:enable='between(t,${timing.startTime},${timing.endTime})'[${nextBase}]`
        );
      }
      videoBase = nextBase;
    }
    
    // Add word-by-word text overlays in the CENTER
    for (let i = 0; i < wordTimeline.length; i++) {
      const word = wordTimeline[i];
      const nextBase = `text${i}`;
      
      // Escape special characters in text for FFmpeg
      const escapedText = word.text.replace(/['"\\:]/g, '\\$&').replace(/,/g, '\\,');
      
      // Different colors for different characters
      const textColor = word.character === 'stewie' ? 'blue' : 'red';
      
      videoFilterComplex.push(
        `[${videoBase}]drawtext=text='${escapedText}':fontsize=60:fontcolor=${textColor}:x=(w-text_w)/2:y=h*0.8:enable='between(t,${word.startTime},${word.endTime})'[${nextBase}]`
      );
      
      videoBase = nextBase;
    }

    console.log('Video filter:', videoFilterComplex.join(';'));

    // Calculate total duration of sequential timeline
    const totalSequentialDuration = sequentialTimeline.length > 0 ? 
      sequentialTimeline[sequentialTimeline.length - 1].endTime + 1 : 10;

    // Combine video with audio
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .inputOptions(['-t', totalSequentialDuration.toString()])
        .input(stewieImagePath)
        .input(peterImagePath)
        .input(combinedAudioPath)
        .complexFilter(videoFilterComplex.join(';'))
        .outputOptions([
          '-map', `[${videoBase}]`,
          '-map', '3:a',
          '-c:v', 'libx264',
          '-c:a', 'aac',
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
    console.log('Video file size:', videoBuffer.length);
    
    // Cleanup temp files
    await Promise.all([
      ...sortedAudioFiles.map(audio => fs.promises.unlink(audio.fileName).catch(() => {})),
      fs.promises.unlink(outputPath).catch(() => {}),
      fs.promises.unlink(combinedAudioPath).catch(() => {})
    ]);

    return new NextResponse(videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="peter-stewie-conversation.mp4"'
      }
    });
  } catch (error) {
    console.error('Video processing error:', error);
    return NextResponse.json({ 
      error: 'Failed to process video',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 
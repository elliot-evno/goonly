import { NextResponse } from "next/server";
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

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

    // Step 2: Create video with character overlays - SEQUENTIAL timeline
    // Calculate timeline exactly like frontend preview: sequential with small gaps
    const sequentialTimeline = [];
    let currentTime = 0;
    
    for (let i = 0; i < sortedAudioFiles.length; i++) {
      const audio = sortedAudioFiles[i];
      
      // Character appears for the duration of their audio
      sequentialTimeline.push({
        character: audio.character,
        startTime: currentTime,
        endTime: currentTime + audio.duration
      });
      
      // Move to next time slot (audio duration + gap)
      currentTime += audio.duration;
      if (i < sortedAudioFiles.length - 1) {
        currentTime += GAP_DURATION; // Add gap between files
      }
    }
    
    console.log('Sequential timing (like preview):', sequentialTimeline.map(t => `${t.character}: ${t.startTime}s-${t.endTime}s`));
    
    const videoFilterComplex = [];
    
    // Scale character images
    videoFilterComplex.push('[1:v]scale=500:500[stewie_img]');
    videoFilterComplex.push('[2:v]scale=500:500,hflip[peter_img]');
    
    // Create overlays for each character using SEQUENTIAL timeline (like preview)
    let videoBase = '0:v';
    for (let i = 0; i < sequentialTimeline.length; i++) {
      const timing = sequentialTimeline[i];
      const nextBase = `video${i}`;
      
      if (timing.character === 'stewie') {
        videoFilterComplex.push(
          `[${videoBase}][stewie_img]overlay=(W-w)/2:(H-h)/2:enable='between(t,${timing.startTime},${timing.endTime})'[${nextBase}]`
        );
      } else {
        videoFilterComplex.push(
          `[${videoBase}][peter_img]overlay=(W-w)/2:(H-h)/2:enable='between(t,${timing.startTime},${timing.endTime})'[${nextBase}]`
        );
      }
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
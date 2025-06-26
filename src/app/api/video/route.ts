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

    // Save all audio files from FormData
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
        
        return { 
          fileName, 
          startTime: part.startTime, 
          duration: part.duration,
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

    // Build simplified filter complex
    const filters = [];
    
    // Initialize base video stream
    filters.push('[0:v]copy[base0]');
    
    // Scale images once
    filters.push('[1:v]scale=300:300[stewie_img]');
    filters.push('[2:v]scale=300:300,hflip[peter_img]');
    
    // Create overlays for each character speaking
    let currentBase = 'base0';
    for (let i = 0; i < audioFiles.length; i++) {
      const audio = audioFiles[i];
      const endTime = audio.startTime + audio.duration;
      const nextBase = `base${i + 1}`;
      
      if (audio.character === 'stewie') {
        filters.push(
          `[${currentBase}][stewie_img]overlay=(W-w)/2:(H-h)/2:enable='between(t,${audio.startTime},${endTime})'[${nextBase}]`
        );
      } else {
        filters.push(
          `[${currentBase}][peter_img]overlay=(W-w)/2:(H-h)/2:enable='between(t,${audio.startTime},${endTime})'[${nextBase}]`
        );
      }
      currentBase = nextBase;
    }
    
    // Create audio timeline that matches the preview exactly
    // Instead of mixing parallel streams, create a sequential timeline
    let audioFilterChain = '';
    
    if (audioFiles.length > 0) {
      // Start with silence for the duration of the first audio's start time
      if (audioFiles[0].startTime > 0) {
        audioFilterChain = `anullsrc=channel_layout=stereo:sample_rate=48000:duration=${audioFiles[0].startTime}[silence_start];`;
        audioFilterChain += `[silence_start][${3}:a]concat=n=2:v=0:a=1[audio_0];`;
      } else {
        audioFilterChain = `[${3}:a]acopy[audio_0];`;
      }
      
      // Add each subsequent audio with gap timing
      for (let i = 1; i < audioFiles.length; i++) {
        const prevAudio = audioFiles[i - 1];
        const currentAudio = audioFiles[i];
        const prevEndTime = prevAudio.startTime + prevAudio.duration;
        const gapDuration = currentAudio.startTime - prevEndTime;
        
        if (gapDuration > 0) {
          // Add silence gap between audios
          audioFilterChain += `anullsrc=channel_layout=stereo:sample_rate=48000:duration=${gapDuration}[gap_${i}];`;
          audioFilterChain += `[audio_${i-1}][gap_${i}][${i + 3}:a]concat=n=3:v=0:a=1[audio_${i}];`;
        } else {
          // No gap needed, just concatenate
          audioFilterChain += `[audio_${i-1}][${i + 3}:a]concat=n=2:v=0:a=1[audio_${i}];`;
        }
      }
      
      // Final audio output
      const finalAudioIndex = audioFiles.length - 1;
      audioFilterChain += `[audio_${finalAudioIndex}]acopy[final_audio]`;
    } else {
      // Fallback if no audio files
      audioFilterChain = 'anullsrc=channel_layout=stereo:sample_rate=48000[final_audio]';
    }
    
    const filterComplex = [...filters, audioFilterChain].join(';');
    
    console.log('Filter complex:', filterComplex);

    await new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(videoPath)
        .inputOptions(['-t', (metadata.totalDuration + 1).toString()]) // Add 1 extra second
        .input(stewieImagePath)
        .input(peterImagePath);

      // Add all audio files as inputs
      audioFiles.forEach(audio => {
        command.input(audio.fileName);
      });

      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map', `[${currentBase}]`,
          '-map', '[final_audio]',
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-shortest',
          '-y' // Overwrite output file
        ])
        .output(outputPath)
        .on('start', (cmd: string) => {
          console.log('Starting FFmpeg with command:', cmd);
        })
        .on('stderr', (stderrLine: string) => {
          console.log('FFmpeg stderr:', stderrLine);
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
      ...audioFiles.map(audio => fs.promises.unlink(audio.fileName).catch(() => {})),
      fs.promises.unlink(outputPath).catch(() => {})
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
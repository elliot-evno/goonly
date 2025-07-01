// Video processing service using ffmpeg
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AudioFileData } from '../types';
import { combineAudioBuffers } from './audio';

interface SubtitleConfig {
  fadeInDuration: number;
  fadeOutDuration: number;
  scaleAnimation: boolean;
  dynamicPositioning: boolean;
  maxSimultaneousLines: number;
}

interface VideoConfig {
  subtitleConfig: SubtitleConfig;
}

export async function createFinalVideoWithBuffers(
  videoPath: string,
  stewieImagePath: string,
  peterImagePath: string,
  audioData: AudioFileData[],
  subtitleContent: string,
  characterTimeline: Array<{ character: 'stewie' | 'peter'; startTime: number; endTime: number }>,
  duration: number,
  imageOverlays?: Array<{
    buffer: Buffer;
    startTime: number;
    endTime: number;
    description: string;
  }>,
  config?: VideoConfig
): Promise<Buffer> {
  const { fadeInDuration, fadeOutDuration } = config?.subtitleConfig ?? {
    fadeInDuration: 0.05,
    fadeOutDuration: 0.05,
    scaleAnimation: false,
    dynamicPositioning: true,
    maxSimultaneousLines: 1
  };

  // Write subtitle content to temp file (FFmpeg requires file path for subtitles)
  const subtitlePath = path.join('/tmp', `subtitles_${Date.now()}.ass`);
  await fs.promises.writeFile(subtitlePath, subtitleContent);

  // Combine audio buffers
  const combinedAudioBuffer = await combineAudioBuffers(audioData);
  const combinedAudioPath = path.join('/tmp', `combined_audio_${Date.now()}.wav`);
  await fs.promises.writeFile(combinedAudioPath, combinedAudioBuffer);

  // Write image overlay buffers to temp files if needed
  const overlayTempFiles: string[] = [];
  try {
    for (let i = 0; i < (imageOverlays?.length || 0); i++) {
      const overlay = imageOverlays![i];
      const tempImagePath = path.join('/tmp', `overlay_${Date.now()}_${i}.png`);
      await fs.promises.writeFile(tempImagePath, overlay.buffer);
      overlayTempFiles.push(tempImagePath);
    }

    // Create character overlay expressions
    const stewieOverlay = characterTimeline
      .filter(t => t.character === 'stewie')
      .map(t => `between(t,${t.startTime},${t.endTime})*if(between(t,${t.startTime},${t.startTime + fadeInDuration}),(t-${t.startTime})/${fadeInDuration},if(between(t,${t.endTime - fadeOutDuration},${t.endTime}),(${t.endTime}-t)/${fadeOutDuration},1))`)
      .join('+');

    const peterOverlay = characterTimeline
      .filter(t => t.character === 'peter')
      .map(t => `between(t,${t.startTime},${t.endTime})*if(between(t,${t.startTime},${t.startTime + fadeInDuration}),(t-${t.startTime})/${fadeInDuration},if(between(t,${t.endTime - fadeOutDuration},${t.endTime}),(${t.endTime}-t)/${fadeOutDuration},1))`)
      .join('+');

    // Build the FFmpeg command
    const inputs = [
      '-t', duration.toString(),
      '-i', videoPath,
      '-i', stewieImagePath,
      '-i', peterImagePath,
      '-i', combinedAudioPath
    ];

    const imageFilterChain: string[] = [];
    if (imageOverlays && imageOverlays.length > 0) {
      imageOverlays.forEach((overlay, index) => {
        inputs.push('-i', overlayTempFiles[index]);
        const inputIndex = 4 + index; // Start after audio input (index 3)
        const scaledLabel = `img_${index}_scaled`;
        
        imageFilterChain.push(`[${inputIndex}:v]scale=600:-1[${scaledLabel}]`);
      });
    }

    const filterChain = [
      // Scale character images
      '[1:v]scale=-1:700[stewie_img]',
      '[2:v]scale=-1:700[peter_img]',
      
      // Add character overlays with dynamic positioning
      `[0:v][stewie_img]overlay=400:H-h-30:enable='${stewieOverlay}'[with_stewie]`,
      `[with_stewie][peter_img]overlay=-300:H-h-30:enable='${peterOverlay}'[with_characters]`,
      
      // Add image scaling for overlays
      ...imageFilterChain,
      
      // Add image overlays
      ...(imageOverlays && imageOverlays.length > 0 ? 
        imageOverlays.map((overlay, index) => {
          const inputLabel = index === 0 ? 'with_characters' : `with_overlay_${index - 1}`;
          const outputLabel = index === imageOverlays.length - 1 ? 'with_overlays' : `with_overlay_${index}`;
          const scaledLabel = `img_${index}_scaled`;
          const overlayEnable = `between(t,${overlay.startTime},${overlay.endTime})`;
          
          return `[${inputLabel}][${scaledLabel}]overlay=(W-w)/2:100:enable='${overlayEnable}'[${outputLabel}]`;
        }) : []
      ),
      
      // Add subtitles
      `[${imageOverlays && imageOverlays.length > 0 ? 'with_overlays' : 'with_characters'}]subtitles='${subtitlePath}':force_style='FontName=Arial Black,Fontsize=140,PrimaryColour=&H00FFFFFF,BorderStyle=1,Outline=8,Shadow=3,Alignment=2'[final]`
    ];

    const outputPath = path.join('/tmp', `output_${Date.now()}.mp4`);

    const command = [
      ...inputs,
      '-y',
      '-filter_complex',
      filterChain.join(';'),
      
      // Map the final video and audio streams
      '-map', '[final]',
      '-map', '3:a',
      
      // Video encoding settings
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-c:a', 'aac',
      '-s', '1080x1920',
      '-r', '30',
      '-shortest',
      '-y',
      outputPath
    ];

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', command);

      ffmpeg.stderr.on('data', (data) => {
        if (data.toString().includes('frame=')) {
          process.stdout.write('.');
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log('\nVideo processing completed successfully');
          resolve(undefined);
        } else {
          reject(new Error(`FFmpeg process exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(err);
      });
    });

    // Read the output video as buffer
    const videoBuffer = await fs.promises.readFile(outputPath);

    // Cleanup temp files
    await Promise.all([
      fs.promises.unlink(subtitlePath).catch(() => {}),
      fs.promises.unlink(combinedAudioPath).catch(() => {}),
      fs.promises.unlink(outputPath).catch(() => {}),
      ...overlayTempFiles.map(file => fs.promises.unlink(file).catch(() => {}))
    ]);

    return videoBuffer;

  } catch (error) {
    // Cleanup on error
    await Promise.all([
      fs.promises.unlink(subtitlePath).catch(() => {}),
      fs.promises.unlink(combinedAudioPath).catch(() => {}),
      ...overlayTempFiles.map(file => fs.promises.unlink(file).catch(() => {}))
    ]);
    throw error;
  }
}

// Keep the original function for backward compatibility if needed
export async function createFinalVideo(
  videoPath: string,
  stewieImagePath: string,
  peterImagePath: string,
  audioPath: string,
  subtitlePath: string,
  characterTimeline: Array<{ character: 'stewie' | 'peter'; startTime: number; endTime: number }>,
  duration: number,
  outputPath: string,
  imageOverlays?: Array<{
    imagePath: string;
    startTime: number;
    endTime: number;
    description: string;
  }>,
  config?: VideoConfig
): Promise<void> {
  // Default configuration
  const { fadeInDuration, fadeOutDuration } = config?.subtitleConfig ?? {
    fadeInDuration: 0.05,
    fadeOutDuration: 0.05,
    scaleAnimation: false,
    dynamicPositioning: true,
    maxSimultaneousLines: 1
  };

  // Create character overlay expressions
  const stewieOverlay = characterTimeline
    .filter(t => t.character === 'stewie')
    .map(t => `between(t,${t.startTime},${t.endTime})*if(between(t,${t.startTime},${t.startTime + fadeInDuration}),(t-${t.startTime})/${fadeInDuration},if(between(t,${t.endTime - fadeOutDuration},${t.endTime}),(${t.endTime}-t)/${fadeOutDuration},1))`)
    .join('+');

  const peterOverlay = characterTimeline
    .filter(t => t.character === 'peter')
    .map(t => `between(t,${t.startTime},${t.endTime})*if(between(t,${t.startTime},${t.startTime + fadeInDuration}),(t-${t.startTime})/${fadeInDuration},if(between(t,${t.endTime - fadeOutDuration},${t.endTime}),(${t.endTime}-t)/${fadeOutDuration},1))`)
    .join('+');

  // Build the FFmpeg command with improved subtitle rendering and image overlays
  const inputs = [
    '-t', duration.toString(),
    '-i', videoPath,
    '-i', stewieImagePath,
    '-i', peterImagePath,
    '-i', audioPath
  ];

const imageFilterChain: string[] = [];
  if (imageOverlays && imageOverlays.length > 0) {
    imageOverlays.forEach((overlay, index) => {
      inputs.push('-i', overlay.imagePath);
      const inputIndex = 4 + index; // Start after audio input (index 3)
      const scaledLabel = `img_${index}_scaled`;
      
      // Scale image to be bigger and positioned above text
      imageFilterChain.push(`[${inputIndex}:v]scale=600:-1[${scaledLabel}]`);
    });
  }

  const filterChain = [
    // Scale character images
    '[1:v]scale=-1:700[stewie_img]',
    '[2:v]scale=-1:700[peter_img]',
    
    // Add character overlays with dynamic positioning
    `[0:v][stewie_img]overlay=400:H-h-30:enable='${stewieOverlay}'[with_stewie]`,
    `[with_stewie][peter_img]overlay=-300:H-h-30:enable='${peterOverlay}'[with_characters]`,
    
    // Add image scaling for overlays
    ...imageFilterChain,
    
    // Add image overlays
    ...(imageOverlays && imageOverlays.length > 0 ? 
      imageOverlays.map((overlay, index) => {
        const inputLabel = index === 0 ? 'with_characters' : `with_overlay_${index - 1}`;
        const outputLabel = index === imageOverlays.length - 1 ? 'with_overlays' : `with_overlay_${index}`;
        const scaledLabel = `img_${index}_scaled`;
        const overlayEnable = `between(t,${overlay.startTime},${overlay.endTime})`;
        
        return `[${inputLabel}][${scaledLabel}]overlay=(W-w)/2:100:enable='${overlayEnable}'[${outputLabel}]`;
      }) : []
    ),
    
    // Add subtitles with center alignment and exact positioning
    `[${imageOverlays && imageOverlays.length > 0 ? 'with_overlays' : 'with_characters'}]subtitles='${subtitlePath}':force_style='FontName=Arial Black,Fontsize=140,PrimaryColour=&H00FFFFFF,BorderStyle=1,Outline=8,Shadow=3,Alignment=2'[final]`
  ];

  const command = [
    ...inputs,
    '-y',
    '-filter_complex',
    filterChain.join(';'),
    
    // Map the final video and audio streams
    '-map', '[final]',
    '-map', '3:a',
    
    // Video encoding settings for smooth text rendering
    '-c:v', 'libx264',
    '-preset', 'slow', // Better quality for text
    '-crf', '18', // High quality
    '-c:a', 'aac',
    '-s', '1080x1920',
    '-r', '30',
    '-shortest',
    '-y',
    outputPath
  ];


  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', command);

    ffmpeg.stderr.on('data', (data) => {
      // Log progress but avoid excessive logging
      if (data.toString().includes('frame=')) {
        process.stdout.write('.');
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('\nVideo processing completed successfully');
        resolve(undefined);
      } else {
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
} 
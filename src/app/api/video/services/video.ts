import ffmpeg from 'fluent-ffmpeg';
import { CharacterTimeline } from '../types';
import { spawn } from 'child_process';

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

export async function createFinalVideo(
  videoPath: string,
  stewieImagePath: string,
  peterImagePath: string,
  audioPath: string,
  subtitlePath: string,
  characterTimeline: Array<{ character: 'stewie' | 'peter'; startTime: number; endTime: number }>,
  duration: number,
  outputPath: string,
  config?: VideoConfig
): Promise<void> {
  // Default configuration
  const subtitleConfig = config?.subtitleConfig ?? {
    fadeInDuration: 0.05,
    fadeOutDuration: 0.05,
    scaleAnimation: false,
    dynamicPositioning: true,
    maxSimultaneousLines: 1
  };

  // Create character overlay expressions
  const stewieOverlay = characterTimeline
    .filter(t => t.character === 'stewie')
    .map(t => `between(t,${t.startTime},${t.endTime})`)
    .join('+');

  const peterOverlay = characterTimeline
    .filter(t => t.character === 'peter')
    .map(t => `between(t,${t.startTime},${t.endTime})`)
    .join('+');

  // Build the FFmpeg command with improved subtitle rendering
  const command = [
    '-t', duration.toString(),
    '-i', videoPath,
    '-i', stewieImagePath,
    '-i', peterImagePath,
    '-i', audioPath,
    '-y',
    '-filter_complex',
    [
      // Scale character images
      '[1:v]scale=-1:700[stewie_img]',
      '[2:v]scale=-1:700[peter_img]',
      
      // Add character overlays with dynamic positioning
      `[0:v][stewie_img]overlay=400:H-h-30:enable='${stewieOverlay}'[with_stewie]`,
      `[with_stewie][peter_img]overlay=-300:H-h-30:enable='${peterOverlay}'[with_characters]`,
      
      // Add subtitles with center alignment and exact positioning
      `[with_characters]subtitles='${subtitlePath}':force_style='FontName=Arial Black,Fontsize=140,PrimaryColour=&H00FFFFFF,BorderStyle=1,Outline=8,Shadow=3,Alignment=2'[final]`
    ].join(';'),
    
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

  console.log('Starting FFmpeg command:', 'ffmpeg', command.join(' '));

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
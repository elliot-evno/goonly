import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { CharacterTimeline } from '../types';

export async function createFinalVideo(
  videoPath: string,
  stewieImagePath: string,
  peterImagePath: string,
  combinedAudioPath: string,
  subtitlePath: string,
  characterTimeline: CharacterTimeline[],
  totalDuration: number,
  outputPath: string
): Promise<void> {
  const videoFilterComplex: string[] = [];
  
  videoFilterComplex.push('[1:v]scale=-1:700[stewie_img]');
  videoFilterComplex.push('[2:v]scale=-1:700[peter_img]');
  
  const stewieEnable = characterTimeline
    .filter(c => c.character === 'stewie')
    .map(c => `between(t,${c.startTime},${c.endTime})`)
    .join('+');
  
  const peterEnable = characterTimeline
    .filter(c => c.character === 'peter')
    .map(c => `between(t,${c.startTime},${c.endTime})`)
    .join('+');
  
  videoFilterComplex.push(
    `[0:v][stewie_img]overlay=200:H-h-30:enable='${stewieEnable}'[with_stewie]`
  );
  
  videoFilterComplex.push(
    `[with_stewie][peter_img]overlay=-300:H-h-30:enable='${peterEnable}'[with_characters]`
  );
  
  const escapedSubtitlePath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');
  videoFilterComplex.push(`[with_characters]subtitles='${escapedSubtitlePath}'[final]`);

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .inputOptions(['-t', totalDuration.toString()])
      .input(stewieImagePath)
      .input(peterImagePath)
      .input(combinedAudioPath)
      .complexFilter(videoFilterComplex.join(';'))
      .outputOptions([
        '-map', '[final]',
        '-map', '3:a',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-s', '1080x1920',
        '-r', '30',
        '-shortest',
        '-y'
      ])
      .output(outputPath)
      .on('start', (cmd: string) => console.log('Starting FFmpeg command:', cmd))
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
} 
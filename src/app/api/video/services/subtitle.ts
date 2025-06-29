import { WordTiming } from '../types';

export function createSubtitleContent(wordTimeline: WordTiming[]): string {
  const assHeader = `[Script Info]
Title: Peter and Stewie Conversation
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Stewie,Arial Black,140,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,8,3,2,50,50,500,1
Style: Peter,Arial Black,140,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,8,3,2,50,50,500,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const assEvents = wordTimeline.map((word) => {
    const startTime = formatAssTime(word.startTime);
    const endTime = formatAssTime(word.endTime);
    const style = word.character === 'stewie' ? 'Stewie' : 'Peter';
    
    const text = word.text.trim()
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}');
    
    const animatedText = `{\\fad(50,50)\\pos(540,960)}${text}`;
    
    return `Dialogue: 0,${startTime},${endTime},${style},,0,0,500,,${animatedText}`;
  }).join('\n');

  return assHeader + assEvents;
}

function formatAssTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centiseconds = Math.floor((seconds % 1) * 100);
  
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
} 
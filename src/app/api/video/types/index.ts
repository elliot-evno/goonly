export interface ImageOverlay {
  filename: string;
  startTime: number;
  duration: number;
  description: string;
}

export interface ConversationTurn {
  stewie: string;
  peter: string;
  imageOverlays?: ImageOverlay[];
}

export interface AudioResult {
  buffer: Buffer;
  duration: number;
  character: 'stewie' | 'peter';
  text: string;
}

export interface AudioFileData {
  fileName: string;
  character: 'stewie' | 'peter';
  text: string;
  duration: number;
  startTime: number;
}

export interface WordTiming {
  text: string;
  startTime: number;
  endTime: number;
  character: 'stewie' | 'peter';
}

export interface CharacterTimeline {
  character: 'stewie' | 'peter';
  startTime: number;
  endTime: number;
} 
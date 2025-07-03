from dataclasses import dataclass
from typing import Optional

@dataclass
class AudioFileData:
    buffer: bytes
    duration: float
    character: str

@dataclass
class CharacterTimeline:
    character: str
    start_time: float
    end_time: float

@dataclass
class ImageOverlay:
    buffer: bytes
    start_time: float
    end_time: float
    description: str

@dataclass
class SubtitleConfig:
    fade_in_duration: float = 0.05
    fade_out_duration: float = 0.05
    scale_animation: bool = False
    dynamic_positioning: bool = True
    max_simultaneous_lines: int = 1

@dataclass
class VideoConfig:
    subtitle_config: SubtitleConfig = None
    
    def __post_init__(self):
        if self.subtitle_config is None:
            self.subtitle_config = SubtitleConfig() 
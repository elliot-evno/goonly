from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class ImageOverlayData(BaseModel):
    filename: str
    triggerWord: Optional[str] = None
    startTime: Optional[float] = None  # Fallback if triggerWord not found
    duration: Optional[float] = None  # Optional, will be set based on media type
    description: Optional[str] = None

class ConversationTurn(BaseModel):
    stewie: str
    peter: str
    imageOverlays: Optional[List[ImageOverlayData]] = None

class VideoRequest(BaseModel):
    conversation: List[ConversationTurn]
    mediaFiles: Optional[List[Dict[str, Any]]] = None 
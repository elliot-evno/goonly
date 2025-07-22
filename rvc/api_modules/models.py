from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class ImageOverlayData(BaseModel):
    filename: str
    triggerWord: Optional[str] = None
    startTime: Optional[float] = None  # Fallback if triggerWord not found
    duration: Optional[float] = None  # Optional, will be set based on media type
    description: Optional[str] = None

class ConversationTurn(BaseModel):
    stewie: Optional[str] = None
    peter: Optional[str] = None
    imageOverlays: Optional[List[ImageOverlayData]] = None

class MediaFile(BaseModel):
    data: str  # base64 encoded file data
    mimeType: str
    filename: str
    type: str  # 'image' or 'video'

class StatusCheckRequest(BaseModel):
    requestId: str
    isStatusCheck: bool = True

class VideoRequest(BaseModel):
    conversation: Optional[List[ConversationTurn]] = None
    mediaFiles: Optional[List[MediaFile]] = None
    requestId: Optional[str] = None  # For polling status
    isStatusCheck: Optional[bool] = False  # To distinguish between new requests and status checks 
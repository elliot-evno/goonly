from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class ConversationTurn(BaseModel):
    stewie: str
    peter: str
    imageOverlays: Optional[List[Dict[str, Any]]] = None

class VideoRequest(BaseModel):
    conversation: List[ConversationTurn]
    mediaFiles: Optional[List[Dict[str, Any]]] = None 
from typing import List, Tuple
from .types import CharacterTimeline

def create_character_overlay_expressions(character_timeline: List[CharacterTimeline], fade_in_duration: float, fade_out_duration: float) -> Tuple[str, str]:
    """Create overlay expressions for character animations"""
    stewie_segments = [t for t in character_timeline if t.character == 'stewie']
    peter_segments = [t for t in character_timeline if t.character == 'peter']
    
    stewie_overlay = '+'.join([
        f"between(t,{t.start_time},{t.end_time})*"
        f"if(between(t,{t.start_time},{t.start_time + fade_in_duration}),"
        f"(t-{t.start_time})/{fade_in_duration},"
        f"if(between(t,{t.end_time - fade_out_duration},{t.end_time}),"
        f"({t.end_time}-t)/{fade_out_duration},1))"
        for t in stewie_segments
    ]) or '0'
    
    peter_overlay = '+'.join([
        f"between(t,{t.start_time},{t.end_time})*"
        f"if(between(t,{t.start_time},{t.start_time + fade_in_duration}),"
        f"(t-{t.start_time})/{fade_in_duration},"
        f"if(between(t,{t.end_time - fade_out_duration},{t.end_time}),"
        f"({t.end_time}-t)/{fade_out_duration},1))"
        for t in peter_segments
    ]) or '0'
    
    return stewie_overlay, peter_overlay 
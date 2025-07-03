import sys
import os
from config import *
from rvc.infer.modules.vc.modules import VC
from rvc.configs.config import Config
from dotenv import load_dotenv

# Import whisper-timestamped for word-level timing
try:
    import whisper_timestamped as whisper
    WHISPER_AVAILABLE = True
except ImportError:
    WHISPER_AVAILABLE = False
    pass

def load_model(character: str):
    """Load the RVC model for the specified character if not already loaded"""
    global models
    
    if character not in MODEL_CONFIG:
        raise ValueError(f"Unknown character: {character}. Available: {list(MODEL_CONFIG.keys())}")
    
    if character not in models:
        
        # Override sys.argv to prevent argument parsing conflicts
        original_argv = sys.argv.copy()
        original_cwd = os.getcwd()
        
        try:
            # Set up sys.argv like main.py expects
            sys.argv = [sys.argv[0]]
            
            # Change to the script directory
            script_dir = os.path.dirname(os.path.abspath(__file__))
            os.chdir(script_dir)
            

            load_dotenv()
            config = Config()
            vc = VC(config)
            vc.get_vc(MODEL_CONFIG[character]["model_path"])
            models[character] = vc
            
            
        except Exception as e:
            raise
        finally:
            # Restore original argv and working directory
            sys.argv = original_argv
            os.chdir(original_cwd)
            
    return models[character]

def load_whisper_model():
    """Load the Whisper model for word-level timing if not already loaded"""
    global whisper_model
    
    
    if not WHISPER_AVAILABLE:
        raise RuntimeError("whisper-timestamped is not installed. Install with: pip install whisper-timestamped")
    
    if whisper_model is None:
        try:
            # Use small model for balance of speed and accuracy
            whisper_model = whisper.load_model("small", device="cpu")
        except Exception as e:
            raise e
    return whisper_model
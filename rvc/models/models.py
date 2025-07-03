import sys
import os
from config import *
from rvc.infer.modules.vc.modules import VC
from rvc.configs.config import Config
from dotenv import load_dotenv


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


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
            
            # Change to the RVC directory where configs are located
            script_dir = os.path.dirname(os.path.abspath(__file__))
            rvc_dir = os.path.join(script_dir, "..", "rvc")
            os.chdir(rvc_dir)
            
            # Set up environment variables for RVC
            assets_dir = os.path.join(os.getcwd(), "assets")
            os.environ["weight_root"] = os.path.join(assets_dir, "weights")
            os.environ["index_root"] = os.path.join(assets_dir, "weights") 
            os.environ["rmvpe_root"] = os.path.join(assets_dir, "rmvpe")
            
            print(f"Loading model {character}...")
            print(f"Working directory: {os.getcwd()}")
            print(f"Weight root: {os.environ.get('weight_root')}")
            print(f"Model path: {MODEL_CONFIG[character]['model_path']}")

            load_dotenv()
            config = Config()
            print(f"Using device: {config.device}")
            print(f"Half precision: {config.is_half}")
            
            vc = VC(config)
            vc.get_vc(MODEL_CONFIG[character]["model_path"])
            models[character] = vc
            print(f"Successfully loaded model {character}")
            
            
        except Exception as e:
            print(f"Error loading model {character}: {str(e)}")
            import traceback
            print(traceback.format_exc())
            raise
        finally:
            # Restore original argv and working directory
            sys.argv = original_argv
            os.chdir(original_cwd)
            
    return models[character]


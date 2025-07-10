import sys
import os
import logging
from config import *
from rvc.infer.modules.vc.modules import VC
from rvc.configs.config import Config
from dotenv import load_dotenv

# Configure logging
logger = logging.getLogger(__name__)

def load_model(character: str):
    """Load the RVC model for the specified character if not already loaded"""
    global models
    
    if character not in MODEL_CONFIG:
        raise ValueError(f"Unknown character: {character}. Available: {list(MODEL_CONFIG.keys())}")
    
    if character not in models:
        logger.info(f"Loading model for {character}...")
        
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
            
            # Check if model files exist
            model_file = os.path.join(os.environ.get('weight_root'), MODEL_CONFIG[character]['model_path'])
            if not os.path.exists(model_file):
                logger.error(f"Model file not found: {model_file}")
                raise FileNotFoundError(f"Model file not found: {model_file}")
            
            # Check Hubert model
            hubert_path = os.path.join(assets_dir, "hubert", "hubert_base.pt")
            if not os.path.exists(hubert_path):
                logger.error(f"Hubert model not found: {hubert_path}")
                raise FileNotFoundError(f"Hubert model not found: {hubert_path}")
            
            logger.info(f"Model files verified, loading VC model...")
            vc = VC(config)
            vc.get_vc(MODEL_CONFIG[character]["model_path"])
            models[character] = vc
            print(f"Successfully loaded model {character}")
            logger.info(f"Successfully loaded model {character}")
            
        except Exception as e:
            logger.error(f"Failed to load model {character}: {str(e)}")
            raise
        finally:
            # Restore original state
            sys.argv = original_argv
            os.chdir(original_cwd)
    else:
        logger.info(f"Model {character} already loaded")
    
    return models[character]

def preload_all_models():
    """Preload all models at startup to avoid loading during requests"""
    logger.info("Preloading all models...")
    for character in MODEL_CONFIG.keys():
        try:
            load_model(character)
            logger.info(f"Preloaded model: {character}")
        except Exception as e:
            logger.error(f"Failed to preload model {character}: {str(e)}")
    logger.info("Model preloading complete")


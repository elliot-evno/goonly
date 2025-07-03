import os

from fairseq import checkpoint_utils


def get_index_path_from_model(sid):
    return next(
        (
            f
            for f in [
                os.path.join(root, name)
                for root, _, files in os.walk(os.getenv("index_root"), topdown=False)
                for name in files
                if name.endswith(".index") and "trained" not in name
            ]
            if sid.split(".")[0] in f
        ),
        "",
    )


def load_hubert(config):
    # Get the absolute path to the hubert model
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # Navigate up to the rvc directory and then to assets
    rvc_dir = os.path.join(script_dir, "..", "..", "..")
    hubert_path = os.path.join(rvc_dir, "assets", "hubert", "hubert_base.pt")
    hubert_path = os.path.abspath(hubert_path)
    
    print(f"Loading Hubert model from: {hubert_path}")
    
    if not os.path.exists(hubert_path):
        raise FileNotFoundError(f"Hubert model not found at: {hubert_path}")
    
    models, _, _ = checkpoint_utils.load_model_ensemble_and_task(
        [hubert_path],
        suffix="",
    )
    hubert_model = models[0]
    hubert_model = hubert_model.to(config.device)
    if config.is_half:
        hubert_model = hubert_model.half()
    else:
        hubert_model = hubert_model.float()
    return hubert_model.eval()

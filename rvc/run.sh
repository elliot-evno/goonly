source rvc_env/bin/activate
export PYTORCH_ENABLE_MPS_FALLBACK=1
exec python -m uvicorn api:app --reload

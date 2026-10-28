"""Converter server for VoiceSwap's "http" engine. Wraps Seed-VC (https://github.com/Plachtaa/seed-vc).
UNTESTED here: the Seed-VC command line may change, so check its README if the call fails.
Run:  CONVERTER_KEY=secret uvicorn main:app --host 0.0.0.0 --port 8000
"""
import os, subprocess, sys, tempfile, glob
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

SEED_VC_DIR = os.environ.get("SEED_VC_DIR", "/opt/seed-vc")   # folder where you cloned Seed-VC
KEY = os.environ.get("CONVERTER_KEY", "")
app = FastAPI()

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/")
async def convert(source: UploadFile = File(...), target: UploadFile = File(...), steps: int = Form(25), authorization: str = Header(default="")):
    if KEY and authorization != "Bearer " + KEY:
        raise HTTPException(401, "bad key")
    with tempfile.TemporaryDirectory() as d:
        s, t, out = os.path.join(d, "source.wav"), os.path.join(d, "target.wav"), os.path.join(d, "out")
        open(s, "wb").write(await source.read()); open(t, "wb").write(await target.read()); os.makedirs(out)
        cmd = [sys.executable, "inference.py", "--source", s, "--target", t, "--output", out, "--diffusion-steps", str(max(4, min(steps, 50))),
               "--length-adjust", "1.0", "--inference-cfg-rate", "0.7", "--fp16", "True" if os.environ.get("FP16", "1") == "1" else "False"]
        r = subprocess.run(cmd, cwd=SEED_VC_DIR, capture_output=True, text=True, timeout=900)
        wavs = sorted(glob.glob(os.path.join(out, "*.wav")), key=os.path.getmtime)
        if r.returncode != 0 or not wavs:
            raise HTTPException(500, (r.stderr or r.stdout)[-300:])
        data = open(wavs[-1], "rb").read()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav"); tmp.write(data); tmp.close()
    return FileResponse(tmp.name, media_type="audio/wav")

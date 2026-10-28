"""Converter server for VoiceSwap's "http" engine. Wraps Seed-VC (https://github.com/Plachtaa/seed-vc).
Uses only the Python standard library (nothing to pip install for the server itself).

Run:  SEED_VC_DIR=/content/seed-vc CONVERTER_KEY=secret python server.py
  POST /   multipart: source (wav), target (wav), steps   ->  audio/wav
  GET  /health
"""
import glob, os, subprocess, sys, tempfile, threading
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SEED_VC_DIR = os.environ.get("SEED_VC_DIR", "/opt/seed-vc")
KEY = os.environ.get("CONVERTER_KEY", "")
PORT = int(os.environ.get("PORT", "8000"))
INFER = os.environ.get("SEED_VC_SCRIPT", "inference.py")
LOCK = threading.Lock()          # one conversion at a time (one GPU)
MAX_BODY = 60 * 1024 * 1024


def parse_multipart(ctype, body):
    msg = BytesParser(policy=HTTP).parsebytes(b"Content-Type: " + ctype.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
    parts = {}
    for p in msg.iter_parts():
        name = p.get_param("name", header="content-disposition")
        if name:
            parts[name] = p.get_payload(decode=True) or b""
    return parts


def convert(source, target, steps):
    with tempfile.TemporaryDirectory() as d:
        s, t, out = os.path.join(d, "source.wav"), os.path.join(d, "target.wav"), os.path.join(d, "out")
        open(s, "wb").write(source); open(t, "wb").write(target); os.makedirs(out)
        cmd = [sys.executable, INFER, "--source", s, "--target", t, "--output", out, "--diffusion-steps", str(max(4, min(steps, 50))),
               "--length-adjust", "1.0", "--inference-cfg-rate", "0.7", "--f0-condition", "False", "--auto-f0-adjust", "False",
               "--fp16", "True" if os.environ.get("FP16", "1") == "1" else "False"]
        r = subprocess.run(cmd, cwd=SEED_VC_DIR, capture_output=True, text=True, timeout=900)
        wavs = sorted(glob.glob(os.path.join(out, "*.wav")), key=os.path.getmtime)
        if r.returncode != 0 or not wavs:
            raise RuntimeError(((r.stderr or r.stdout or "no output")[-300:]).strip())
        return open(wavs[-1], "rb").read()


class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, str): body = body.encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        self._send(200, '{"ok":true}') if self.path.startswith("/health") else self._send(404, '{"error":"not found"}')

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > MAX_BODY:
                return self._send(413, '{"error":"bad size"}')
            body = self.rfile.read(n)                    # read first, so the client is never cut off mid-upload
            if KEY and self.headers.get("Authorization", "") != "Bearer " + KEY:
                return self._send(401, '{"error":"bad key"}')
            parts = parse_multipart(self.headers.get("Content-Type", ""), body)
            if not parts.get("source") or not parts.get("target"):
                return self._send(400, '{"error":"send source and target"}')
            steps = int((parts.get("steps") or b"25").decode() or 25)
            with LOCK:
                wav = convert(parts["source"], parts["target"], steps)
            self._send(200, wav, "audio/wav")
        except Exception as e:                       # never crash the server
            self._send(500, ('{"error":"%s"}' % str(e).replace('"', "'").replace("\n", " ")[:300]))

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"Converter listening on port {PORT}, Seed-VC folder: {SEED_VC_DIR}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()

"use strict";
// ffmpeg helpers + a small pitch (voice height) estimator. No npm packages.
const { spawn } = require("child_process");

function run(cmd, args, { binary = false } = {}) {
  return new Promise((ok, no) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }); const out = []; let err = "";
    p.stdout.on("data", d => out.push(d));
    p.stderr.on("data", d => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on("error", e => no(Object.assign(new Error(cmd + " is not installed on the server"), { cause: e })));
    p.on("close", c => { const b = Buffer.concat(out); c === 0 ? ok(binary ? b : b.toString("utf8")) : no(new Error(`${cmd} failed: ${err.slice(-400)}`)); });
  });
}

async function duration(file) {
  const o = await run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const d = parseFloat(o); if (!isFinite(d) || d <= 0) throw new Error("This file has no readable audio."); return d;
}

// Any input (opus, m4a, mp3, wav, even a video) -> clean mono wav. Cuts to maxSeconds. Light clean-up so the voice is loud and clear.
async function prepare(input, output, { maxSeconds = 120, rate = 24000, clean = true } = {}) {
  const af = clean ? ["-af", "highpass=f=60,loudnorm=I=-18:TP=-2:LRA=11"] : [];
  await run("ffmpeg", ["-y", "-v", "error", "-i", input, "-vn", "-map", "0:a:0", "-t", String(maxSeconds), "-ac", "1", "-ar", String(rate), ...af, "-c:a", "pcm_s16le", output]);
  return duration(output);
}

const CODECS = {
  m4a: { args: ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"], type: "audio/mp4", ext: "m4a" },
  ogg: { args: ["-c:a", "libopus", "-b:a", "64k", "-application", "voip"], type: "audio/ogg", ext: "ogg" },
  mp3: { args: ["-c:a", "libmp3lame", "-q:a", "3"], type: "audio/mpeg", ext: "mp3" },
  wav: { args: ["-c:a", "pcm_s16le"], type: "audio/wav", ext: "wav" }
};
async function encode(wav, output, fmt, { tag = true } = {}) {
  const c = CODECS[fmt]; if (!c) throw new Error("Unknown format");
  const meta = tag ? ["-metadata", "title=AI voice - made with VoiceSwap", "-metadata", "comment=AI-changed voice"] : [];
  await run("ffmpeg", ["-y", "-v", "error", "-i", wav, "-vn", ...meta, ...c.args, output]); return output;
}

async function pcm16k(file) {
  const b = await run("ffmpeg", ["-v", "error", "-i", file, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { binary: true });
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 2)));
}

// Median voice pitch in Hz (autocorrelation on 40 ms frames). Returns { f0, voiced } or throws when no voice is found.
function estimateF0(x, sr = 16000) {
  const N = Math.round(sr * 0.04), H = Math.round(sr * 0.02), lmin = Math.round(sr / 400), lmax = Math.round(sr / 70);
  const rms = []; for (let s = 0; s + N + lmax < x.length; s += H) { let e = 0; for (let i = 0; i < N; i++) e += x[s + i] * x[s + i]; rms.push(Math.sqrt(e / N)); }
  if (!rms.length) throw new Error("Audio is too short to find a voice.");
  const sorted = [...rms].sort((a, b) => a - b), p90 = sorted[Math.floor(sorted.length * 0.9)], gate = Math.max(80, p90 * 0.2);
  const f0s = [];
  for (let f = 0, s = 0; f < rms.length; f++, s += H) {
    if (rms[f] < gate) continue;
    let e0 = 0; for (let i = 0; i < N; i++) e0 += x[s + i] * x[s + i];
    const r = new Float64Array(lmax + 1); let best = 0;
    for (let l = lmin; l <= lmax; l++) {
      let c = 0, e1 = 0; for (let i = 0; i < N; i++) { const b = x[s + i + l]; c += x[s + i] * b; e1 += b * b; }
      r[l] = c / Math.sqrt(e0 * e1 + 1e-9); if (r[l] > best) best = r[l];
    }
    if (best < 0.5) continue;
    let lag = 0; for (let l = lmin + 1; l < lmax; l++) if (r[l] >= best * 0.92 && r[l] >= r[l - 1] && r[l] >= r[l + 1]) { lag = l; break; }   // smallest strong peak (avoids octave errors)
    if (lag) f0s.push(sr / lag);
  }
  if (f0s.length < 8) throw new Error("Could not find a clear voice in this audio. Use a clean recording with one person speaking.");
  f0s.sort((a, b) => a - b); return { f0: f0s[Math.floor(f0s.length / 2)], voiced: f0s.length };
}

module.exports = { run, duration, prepare, encode, pcm16k, estimateF0, CODECS };

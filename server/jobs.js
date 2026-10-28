"use strict";
// One job = one conversion. A single worker processes them one by one (friendly to a small CPU or one GPU).
const fs = require("fs"), path = require("path");
const { rid } = require("./util"), audio = require("./audio");

class Jobs {
  constructor({ dir, engine, ttlMs = 24 * 3600e3, maxSeconds = 120 }) {
    Object.assign(this, { dir, engine, ttlMs, maxSeconds }); this.map = new Map(); this.queue = []; this.busy = false; fs.mkdirSync(dir, { recursive: true });
  }
  create(owner, kind) {
    const id = rid(10), d = path.join(this.dir, id); fs.mkdirSync(d, { recursive: true });
    const j = { id, dir: d, owner, kind, status: "queued", progress: 0, created: Date.now(), error: null, note: "" }; this.map.set(id, j); return j;
  }
  get(id) { return this.map.get(id); }
  position(j) { return this.queue.indexOf(j) + 1; }
  view(j) {
    return { id: j.id, kind: j.kind, status: j.status, progress: +j.progress.toFixed(2), error: j.error, note: j.note, seconds: j.seconds, voiceName: j.voiceName, tag: j.tag,
      queue: this.position(j), formats: j.status === "done" ? ["m4a", "ogg", "mp3", "wav"] : [], expiresAt: j.created + this.ttlMs, engine: this.engine.name };
  }
  // spec: { input, target (path of a voice sample) | preset (id), voiceName, tag, cleanup: [paths to delete afterwards] }
  enqueue(j, spec) { j.spec = spec; j.voiceName = spec.voiceName; j.tag = spec.tag !== false; this.queue.push(j); this._next(); return j; }
  async _next() {
    if (this.busy) return; const j = this.queue.shift(); if (!j) return; this.busy = true;
    try { await this._work(j); } catch (e) { j.status = "error"; j.error = friendly(e); console.error("job", j.id, e.message); }
    for (const f of (j.spec && j.spec.cleanup) || []) fs.rmSync(f, { force: true });
    this.busy = false; setImmediate(() => this._next());
  }
  async _work(j) {
    const s = j.spec, src = path.join(j.dir, "source.wav"), conv = path.join(j.dir, "converted.wav");
    j.status = "preparing"; j.progress = 0.1;
    j.seconds = +(await audio.prepare(s.input, src, { maxSeconds: this.maxSeconds, rate: 24000 })).toFixed(1);
    j.status = "converting"; j.progress = 0.3;
    const r = await this.engine.convert({ source: src, target: s.target, preset: s.preset, out: conv, rate: 24000 });
    j.note = (r && r.note) || ""; j.progress = 0.8; j.status = "encoding";
    const outDur = await audio.duration(conv);
    for (const f of ["m4a", "ogg", "mp3"]) await audio.encode(conv, path.join(j.dir, "result." + f), f, { tag: j.tag });
    fs.renameSync(conv, path.join(j.dir, "result.wav")); fs.rmSync(src, { force: true });
    if (Math.abs(outDur - j.seconds) > 1.5) j.note += " (The length changed a little.)";
    j.status = "done"; j.progress = 1;
  }
  file(j, fmt) { const f = path.join(j.dir, "result." + fmt); return fs.existsSync(f) ? f : null; }
  sweep() {
    const now = Date.now();
    for (const [id, j] of this.map) if (now - j.created > this.ttlMs && !["converting", "preparing", "encoding"].includes(j.status)) { fs.rmSync(j.dir, { recursive: true, force: true }); this.map.delete(id); }
    try { for (const n of fs.readdirSync(this.dir)) { const p = path.join(this.dir, n); if (!this.map.has(n) && now - fs.statSync(p).mtimeMs > this.ttlMs) fs.rmSync(p, { recursive: true, force: true }); } } catch {}
  }
  startSweeper() { this.timer = setInterval(() => this.sweep(), 60e3); this.timer.unref(); }
}

function friendly(e) {
  const m = String((e && e.message) || e);
  if (/clear voice|too short|no readable/i.test(m)) return m;
  if (/not installed/i.test(m)) return "The server is missing a tool (ffmpeg). The owner must fix the setup.";
  if (/converter|replicate|conversion/i.test(m)) return m.slice(0, 220);
  return "Something went wrong while changing the voice. Please try again with a clear recording.";
}
module.exports = { Jobs, friendly };

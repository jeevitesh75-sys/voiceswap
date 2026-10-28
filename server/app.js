"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const { json, fail, readJson, sendFile, parseMultipart, Counter, rid } = require("./util");
const { Jobs } = require("./jobs"), { Voices, hashIp, USER_RE } = require("./voices"), { makeEngine, PRESETS } = require("./engines"), audio = require("./audio");

const MB = 1048576, AUDIO_EXT = new Set([".opus", ".ogg", ".oga", ".m4a", ".mp3", ".wav", ".aac", ".amr", ".3gp", ".webm", ".flac", ".mp4", ".caf", ".wma"]);

function createApp(cfg = {}) {
  const env = cfg.env || process.env, root = path.join(__dirname, ".."), pub = path.join(root, "public");
  const dataDir = cfg.dataDir || env.DATA_DIR || path.join(os.tmpdir(), "voiceswap");
  const engine = cfg.engine || makeEngine(env, cfg.fetchFn || fetch);
  const maxSeconds = +env.MAX_SECONDS || 120, ttlMs = cfg.ttlMs || (+env.RESULT_HOURS || 24) * 3600e3, perDay = +env.PER_DAY || 0;
  const maxUp = (+env.MAX_UPLOAD_MB || 25) * MB;
  const jobs = new Jobs({ dir: path.join(dataDir, "jobs"), engine, ttlMs, maxSeconds }), voices = new Voices(path.join(dataDir, "voices"), { maxPerUser: +env.MAX_VOICES || 10 });
  const pendDir = path.join(dataDir, "pending"); fs.mkdirSync(pendDir, { recursive: true });
  const limits = cfg.limits || {}, apiHits = new Counter(), upHits = new Counter(), daily = new Counter();
  const ip = req => String((env.TRUST_PROXY !== "0" && req.headers["x-forwarded-for"]) || req.socket.remoteAddress || "?").split(",")[0].trim();
  const userOf = (req, u) => { const v = req.headers["x-user"] || u.searchParams.get("u") || ""; if (!USER_RE.test(v)) throw fail(400, "Missing user id. Reload the page."); return v; };

  const sink = dir => (name, field) => {
    const ext = path.extname(name).toLowerCase(); if (!AUDIO_EXT.has(ext)) throw fail(400, "Please use an audio file (m4a, mp3, wav, opus, ogg, aac).");
    const p = path.join(dir, rid(6) + "-" + (field || "f").replace(/\W/g, "") + ext); return { stream: fs.createWriteStream(p), path: p };
  };
  const pendingPath = tok => { if (!/^[a-f0-9]{16}$/.test(tok || "")) return null; const f = fs.readdirSync(pendDir).find(n => n.startsWith(tok + ".")); return f ? path.join(pendDir, f) : null; };

  async function handler(req, res) {
    try {
      const u = new URL(req.url, "http://x"), p = u.pathname, who = ip(req);
      if (p === "/share" && req.method === "POST") return await share(req, res, who);          // Android "Share" menu lands here
      if (p.startsWith("/api/")) {
        if (apiHits.hit(who, 60e3) > (limits.api || 240)) throw fail(429, "Too many requests. Please wait a minute.");
        return await api(req, res, u, p, who);
      }
      let f = p === "/" ? "/index.html" : p; f = path.normalize(f).replace(/^(\.\.[/\\])+/, "");
      const full = path.join(pub, f); if (!full.startsWith(pub)) throw fail(404, "Not found");
      return sendFile(req, res, full);
    } catch (e) { json(res, e.code && e.code < 600 ? e.code : 500, { error: e.code ? e.message : "Something went wrong on the server. Please try again." }); if (!e.code) console.error(e); }
  }

  async function share(req, res, who) {
    const redirect = q => { res.writeHead(303, { Location: "/?" + q, "Cache-Control": "no-store" }); res.end(); };
    if (upHits.hit(who, 3600e3) > (limits.uploads || 40)) return redirect("err=" + encodeURIComponent("Too many uploads. Try again later."));
    const tok = rid(8); let file;
    try {
      ({ file } = await parseMultipart(req, { maxFileBytes: maxUp, sink: (name) => { const ext = path.extname(name).toLowerCase() || ".opus"; if (!AUDIO_EXT.has(ext)) throw fail(400, "That shared file is not audio."); const pth = path.join(pendDir, tok + ext); return { stream: fs.createWriteStream(pth), path: pth }; } }));
      if (!file || !file.size) throw fail(400, "Nothing was shared.");
      await audio.duration(file.path);
    } catch (e) { for (const n of fs.readdirSync(pendDir)) if (n.startsWith(tok + ".")) fs.rmSync(path.join(pendDir, n), { force: true }); return redirect("err=" + encodeURIComponent(e.code ? e.message : "This shared file could not be read as audio.")); }
    redirect("pending=" + tok);
  }

  async function api(req, res, u, p, who) {
    const m = req.method;
    if (p === "/api/config" && m === "GET") return json(res, 200, { engine: engine.name, engineLabel: engine.label, maxSeconds, maxVoices: voices.maxPerUser, ttlHours: Math.round(ttlMs / 3600e3), minSample: voices.minSeconds, maxSample: voices.maxSeconds,
      presets: Object.entries(PRESETS).map(([id, v]) => ({ id: "preset:" + id, name: v.name })), presetsOn: engine.name === "basic" || env.PRESETS_ALWAYS === "1" });
    if (p === "/api/voices" && m === "GET") return json(res, 200, { voices: voices.list(userOf(req, u)) });
    if (p === "/api/voices" && m === "POST") {
      const user = userOf(req, u); if (upHits.hit(who, 3600e3) > (limits.uploads || 40)) throw fail(429, "Too many uploads from your network. Try again later.");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-")); let file;
      try {
        const r = await parseMultipart(req, { maxFileBytes: maxUp, sink: sink(tmp) }); file = r.file; if (!file || !file.size) throw fail(400, "Choose an audio file of the voice.");
        const v = await voices.add(user, { name: r.fields.name, file: file.path, consent: r.fields.consent === "1", ipHash: hashIp(who) });
        return json(res, 200, { voice: v });
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    let mm = /^\/api\/voices\/([a-f0-9]{12})(?:\/(sample))?$/.exec(p);
    if (mm) {
      const user = userOf(req, u), v = voices.get(user, mm[1]); if (!v) throw fail(404, "Voice not found.");
      if (m === "DELETE" && !mm[2]) { voices.remove(user, mm[1]); return json(res, 200, { ok: true }); }
      if (m === "GET" && mm[2]) return sendFile(req, res, v.path, { type: "audio/wav" });
      throw fail(404, "Not found");
    }
    if (p === "/api/convert" && m === "POST") return await startJob(req, res, u, who, "convert");
    if (p === "/api/swap" && m === "POST") return await startJob(req, res, u, who, "swap");
    mm = /^\/api\/pending\/([a-f0-9]{16})$/.exec(p);
    if (mm && m === "GET") { const f = pendingPath(mm[1]); if (!f) throw fail(404, "This shared audio is gone. Share it again."); return sendFile(req, res, f); }
    mm = /^\/api\/jobs\/([a-f0-9]+)(?:\/(\w+))?$/.exec(p);
    if (mm) {
      const j = jobs.get(mm[1]); if (!j) throw fail(404, "This result was deleted (results are kept for " + Math.round(ttlMs / 3600e3) + " hours). Convert again.");
      const act = mm[2];
      if (!act && m === "GET") return json(res, 200, jobs.view(j));
      if (act === "result" && m === "GET") {
        if (j.status !== "done") throw fail(409, "Not ready yet."); const fmt = u.searchParams.get("fmt") || "m4a", f = audio.CODECS[fmt] && jobs.file(j, fmt); if (!f) throw fail(404, "Unknown format.");
        return sendFile(req, res, f, { type: audio.CODECS[fmt].type, download: u.searchParams.get("dl") ? "voiceswap." + audio.CODECS[fmt].ext : undefined });
      }
      if (act === "original" && m === "GET") { if (!j.spec || !fs.existsSync(j.spec.input)) throw fail(404, "Original is gone."); return sendFile(req, res, j.spec.input); }
    }
    throw fail(404, "Not found");
  }

  // Both "convert" (speech -> my saved voice or preset) and "swap" (audio B -> voice of audio A).
  async function startJob(req, res, u, who, kind) {
    const user = userOf(req, u);
    if (upHits.hit(who, 3600e3) > (limits.uploads || 40)) throw fail(429, "Too many uploads from your network. Try again later.");
    if (perDay && daily.count("u:" + user, 864e5) >= perDay) throw fail(429, `Daily limit reached (${perDay} conversions). Come back tomorrow.`);
    const j = jobs.create(user, kind); let ok = false;
    try {
      const { fields, files } = await parseMultipart(req, { maxFileBytes: maxUp, sink: sink(j.dir) });
      const by = f => (files.find(x => x.field === f) || {}).path;
      let input = kind === "swap" ? by("speech") : by("audio"), spec;
      if (!input && fields.pending) { const pp = pendingPath(fields.pending); if (pp) { input = path.join(j.dir, "shared" + path.extname(pp)); fs.copyFileSync(pp, input); } }
      if (!input) throw fail(400, kind === "swap" ? "Choose the speech you want to convert (audio B)." : "Choose or share an audio first.");
      const tag = fields.tag !== "0";
      if (kind === "swap") {
        if (fields.consent !== "1") throw fail(400, "Please tick the box that says you have permission to use this voice.");
        const target = by("voice"); if (!target) throw fail(400, "Choose the voice you want to copy (audio A).");
        const tw = path.join(j.dir, "voice.wav"); const sec = await audio.prepare(target, tw, { maxSeconds: 60 }).catch(() => { throw fail(400, "Audio A is not readable audio."); });
        if (sec < voices.minSeconds) throw fail(400, `Audio A is too short. Use at least ${voices.minSeconds} seconds of clear speech.`);
        spec = { input, target: tw, voiceName: "Voice of audio A", tag };
      } else {
        const vid = String(fields.voice || "");
        if (vid.startsWith("preset:")) { if (!PRESETS[vid.slice(7)] || engine.name !== "basic" && env.PRESETS_ALWAYS !== "1") throw fail(400, "That preset voice is not available."); spec = { input, preset: vid.slice(7), voiceName: PRESETS[vid.slice(7)].name, tag }; }
        else { const v = voices.get(user, vid); if (!v) throw fail(400, "Pick one of your saved voices first."); spec = { input, target: v.path, voiceName: v.name, tag }; }
      }
      if (perDay) daily.hit("u:" + user, 864e5);
      jobs.enqueue(j, spec); ok = true; return json(res, 200, { id: j.id });
    } finally { if (!ok) { fs.rmSync(j.dir, { recursive: true, force: true }); jobs.map.delete(j.id); } }
  }

  const server = http.createServer(handler); server.requestTimeout = 0; server.headersTimeout = 60e3;
  const sweepPending = () => { try { const now = Date.now(); for (const n of fs.readdirSync(pendDir)) { const f = path.join(pendDir, n); if (now - fs.statSync(f).mtimeMs > 2 * 3600e3) fs.rmSync(f, { force: true }); } } catch {} };
  jobs.startSweeper(); const t = setInterval(() => { apiHits.sweep(60e3); upHits.sweep(3600e3); daily.sweep(864e5); sweepPending(); }, 600e3); t.unref();
  server.on("close", () => { clearInterval(jobs.timer); clearInterval(t); });
  return { server, jobs, voices, handler, engine };
}
module.exports = { createApp };

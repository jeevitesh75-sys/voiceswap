"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), os = require("os");
const audio = require("../server/audio"), { makeBasic } = require("../server/engines/basic"), { makeHttp } = require("../server/engines/http"), { makeReplicate } = require("../server/engines/replicate");
const { createApp } = require("../server/app");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-test-"));
const USER = "a".repeat(32), H = { "X-User": USER };
// a fake "voice": harmonics of f0 with a slow loudness wobble, so the pitch finder has something speech-like
async function voice(name, f0, secs = 8, ext = "wav") {
  const p = path.join(tmp, name + "." + ext), h = [1, .5, .33, .25].map((a, i) => `${a}*sin(2*PI*${f0 * (i + 1)}*t)`).join("+");
  await audio.run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `aevalsrc=(${h})*(0.5+0.4*sin(2*PI*2*t))*0.4:s=24000:d=${secs}`, "-ac", "1", p]); return p;
}
const near = (a, b, pct) => assert.ok(Math.abs(a - b) / b <= pct, `${a} not within ${pct * 100}% of ${b}`);
const f0Of = async f => audio.estimateF0(await audio.pcm16k(f)).f0;

test("pitch finder reads 120 Hz and 220 Hz", async () => {
  near(await f0Of(await voice("p120", 120)), 120, 0.06); near(await f0Of(await voice("p220", 220)), 220, 0.06);
});
test("pitch finder rejects silence/noise", async () => {
  const p = path.join(tmp, "silence.wav"); await audio.run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "3", p]);
  await assert.rejects(f0Of(p), /clear voice|too short/i);
});
test("basic engine moves pitch to the target and keeps the length", async () => {
  const src = await voice("src", 120), tgt = await voice("tgt", 220), out = path.join(tmp, "o.wav");
  const r = await makeBasic().convert({ source: src, target: tgt, out }); near(await f0Of(out), 220, 0.09); near(await audio.duration(out), await audio.duration(src), 0.03); assert.ok(r.ratio > 1.6);
});
test("presets work (deep lowers pitch, robot runs)", async () => {
  const src = await voice("ps", 160), e = makeBasic();
  await e.convert({ source: src, preset: "deep", out: path.join(tmp, "d.wav") }); near(await f0Of(path.join(tmp, "d.wav")), 160 * 0.74, 0.1);
  await e.convert({ source: src, preset: "robot", out: path.join(tmp, "r.wav") }); assert.ok(fs.statSync(path.join(tmp, "r.wav")).size > 5000);
  await assert.rejects(e.convert({ source: src, preset: "nope", out: path.join(tmp, "x.wav") }), /Unknown preset/);
});
test("female and male presets aim for a typical pitch, and the voice stays less 'child-like' than a plain pitch shift", async () => {
  const man = await voice("man", 115), e = makeBasic(), fo = path.join(tmp, "fem.wav");
  await e.convert({ source: man, preset: "female", out: fo }); near(await f0Of(fo), 215, 0.1); near(await audio.duration(fo), await audio.duration(man), 0.03);
  const woman = await voice("woman", 220), mo = path.join(tmp, "mal.wav"); await e.convert({ source: woman, preset: "male", out: mo }); near(await f0Of(mo), 115, 0.1);
  const same = path.join(tmp, "same.wav"); const r = await e.convert({ source: woman, preset: "female", out: same }); assert.match(r.note, /already/);
  // brightness check: formant-aware shift must be darker than a plain "shift everything" (which gives the child sound)
  const plain = path.join(tmp, "plain.wav"); await audio.run("ffmpeg", ["-y", "-v", "error", "-i", man, "-af", "rubberband=pitch=1.87:formant=shifted", plain]);
  const centroid = async f => { const x = await audio.pcm16k(f); let n = 0, d = 0; const N = 2048; for (let k = 1; k < 120; k++) { let re = 0, im = 0; for (let i = 0; i < N; i++) { const w = x[8000 + i] || 0; re += w * Math.cos(2 * Math.PI * k * 8 * i / 16000 / 1); im -= w * Math.sin(2 * Math.PI * k * 8 * i / 16000); } const m = Math.hypot(re, im); n += m * k; d += m; } return n / d; };
  assert.ok(await centroid(fo) < await centroid(plain), "formant-aware version should be darker than the plain shift");
});
test("http engine sends source+target and writes the answer", async () => {
  const src = await voice("hs", 120, 2), tgt = await voice("ht", 200, 2), out = path.join(tmp, "h.wav"); let seen;
  const fetchFn = async (url, o) => { seen = { url, auth: o.headers.Authorization, keys: [...o.body.keys()] }; return { ok: true, arrayBuffer: async () => fs.readFileSync(src) }; };
  await makeHttp({ url: "http://conv/x", key: "k", fetchFn }).convert({ source: src, target: tgt, out });
  assert.deepEqual(seen.keys.sort(), ["source", "steps", "target"]); assert.equal(seen.auth, "Bearer k"); assert.ok(fs.existsSync(out));
  await assert.rejects(makeHttp({ url: "http://c", fetchFn: async () => ({ ok: false, status: 500, text: async () => "boom" }) }).convert({ source: src, target: tgt, out }), /converter error 500/);
  await assert.rejects(makeHttp({ url: "http://c", fetchFn: async () => { throw new Error("fetch failed"); } }).convert({ source: src, target: tgt, out }), /converter is offline/);
});
test("replicate engine creates, polls, downloads", async () => {
  const src = await voice("rs", 120, 2), tgt = await voice("rt", 200, 2), out = path.join(tmp, "rep.wav"), calls = [];
  const fetchFn = async (url, o = {}) => { calls.push(url);
    if (url.endsWith("/predictions")) { const b = JSON.parse(o.body); assert.ok(b.input.source_audio.startsWith("data:audio/wav;base64,")); return { ok: true, json: async () => ({ status: "starting", urls: { get: "https://api/p/1" } }) }; }
    if (url === "https://api/p/1") return { ok: true, json: async () => ({ status: "succeeded", output: "https://files/out.wav" }) };
    return { ok: true, arrayBuffer: async () => fs.readFileSync(src) }; };
  await makeReplicate({ token: "t", version: "owner/model:abc", fetchFn, pollMs: 1 }).convert({ source: src, target: tgt, out }); assert.equal(calls.length, 3); assert.ok(fs.existsSync(out));
  assert.throws(() => makeReplicate({}), /must be set/);
});

// ---------- whole app over HTTP ----------
async function boot(extra = {}) {
  const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "vs-data-")), env: { TRUST_PROXY: "0", ...extra } });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r)); return { app, base: "http://127.0.0.1:" + app.server.address().port };
}
const form = (fields, files = {}) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); for (const [k, p] of Object.entries(files)) fd.append(k, new Blob([fs.readFileSync(p)]), path.basename(p)); return fd; };
async function waitJob(base, id) { for (let i = 0; i < 120; i++) { const j = await (await fetch(`${base}/api/jobs/${id}`)).json(); if (j.status === "done" || j.status === "error") return j; await new Promise(r => setTimeout(r, 250)); } throw new Error("job timeout"); }

test("app: consent, saving voices, converting, formats, delete", async () => {
  const { app, base } = await boot(); try {
    const cfg = await (await fetch(base + "/api/config")).json(); assert.equal(cfg.engine, "basic"); assert.ok(cfg.presets.length >= 4);
    assert.equal((await fetch(base + "/api/voices")).status, 400);                                                     // no user id
    const sample = await voice("sample", 220, 8), speech = await voice("speech", 120, 4, "opus");
    let r = await fetch(base + "/api/voices", { method: "POST", headers: H, body: form({ name: "Test" }, { sample }) });  // no consent
    assert.equal(r.status, 400); assert.match((await r.json()).error, /permission/);
    r = await fetch(base + "/api/voices", { method: "POST", headers: H, body: form({ name: "Test", consent: "1" }, { sample: await voice("short", 220, 2) }) });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /too short/);
    r = await fetch(base + "/api/voices", { method: "POST", headers: H, body: form({ name: "<b>Anna</b>", consent: "1" }, { sample }) }); assert.equal(r.status, 200);
    const v = (await r.json()).voice; assert.equal(v.name, "bAnna/b"); assert.equal((await (await fetch(base + "/api/voices", { headers: H })).json()).voices.length, 1);
    assert.equal((await fetch(`${base}/api/voices/${v.id}/sample?u=${USER}`)).status, 200);
    assert.equal((await fetch(`${base}/api/voices/${v.id}/sample?u=${"b".repeat(32)}`)).status, 404);                   // another user cannot read it
    r = await fetch(base + "/api/convert", { method: "POST", headers: H, body: form({ voice: v.id }, { audio: speech }) }); assert.equal(r.status, 200);
    const j = await waitJob(base, (await r.json()).id); assert.equal(j.status, "done", j.error); assert.ok(j.formats.includes("ogg"));
    for (const [fmt, codec] of [["m4a", "aac"], ["ogg", "opus"], ["mp3", "mp3"]]) {
      const b = Buffer.from(await (await fetch(`${base}/api/jobs/${j.id}/result?fmt=${fmt}`)).arrayBuffer()), f = path.join(tmp, "res." + fmt); fs.writeFileSync(f, b);
      const info = JSON.parse(await audio.run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", f]));
      assert.equal(info.streams[0].codec_name, codec); near(+info.format.duration, 4, 0.12);
      if (fmt === "m4a") assert.match(JSON.stringify(info.format.tags || {}), /AI voice/);
    }
    near(await f0Of(path.join(tmp, "res.m4a")), 220, 0.12);                                                              // really in the saved voice's pitch
    assert.equal((await fetch(`${base}/api/jobs/${j.id}/original`)).status, 200);
    r = await fetch(base + "/api/convert", { method: "POST", headers: H, body: form({ voice: "preset:deep", tag: "0" }, { audio: speech }) });
    const pj = await waitJob(base, (await r.json()).id); assert.equal(pj.status, "done"); assert.equal(pj.tag, false);
    r = await fetch(base + "/api/convert", { method: "POST", headers: H, body: form({ voice: "ffffffffffff" }, { audio: speech }) }); assert.equal(r.status, 400);   // unknown voice
    r = await fetch(base + "/api/convert", { method: "POST", headers: H, body: form({ voice: v.id }) }); assert.equal(r.status, 400);                              // no audio
    const bad = path.join(tmp, "evil.exe"); fs.writeFileSync(bad, "x"); r = await fetch(base + "/api/convert", { method: "POST", headers: H, body: form({ voice: v.id }, { audio: bad }) }); assert.equal(r.status, 400);
    assert.equal((await fetch(`${base}/api/voices/${v.id}`, { method: "DELETE", headers: H })).status, 200); assert.equal((await (await fetch(base + "/api/voices", { headers: H })).json()).voices.length, 0);
  } finally { app.server.close(); }
});

test("app: Android share target -> pending -> convert", async () => {
  const { app, base } = await boot(); try {
    const note = await voice("wa", 130, 3, "opus"), sample = await voice("sm2", 210, 8);
    let r = await fetch(base + "/share", { method: "POST", body: form({}, { audio: note }), redirect: "manual" }); assert.equal(r.status, 303);
    const loc = r.headers.get("location"), tok = /pending=([a-f0-9]{16})/.exec(loc)[1]; assert.equal((await fetch(`${base}/api/pending/${tok}`)).status, 200);
    const v = (await (await fetch(base + "/api/voices", { method: "POST", headers: H, body: form({ name: "V", consent: "1" }, { sample }) })).json()).voice;
    r = await fetch(base + "/api/convert", { method: "POST", headers: H, body: form({ voice: v.id, pending: tok }) }); assert.equal(r.status, 200);
    const j = await waitJob(base, (await r.json()).id); assert.equal(j.status, "done", j.error);
    const junk = path.join(tmp, "junk.opus"); fs.writeFileSync(junk, "not audio at all");                                  // a broken share gives a friendly redirect, not a crash
    r = await fetch(base + "/share", { method: "POST", body: form({}, { audio: junk }), redirect: "manual" }); assert.equal(r.status, 303); assert.match(r.headers.get("location"), /err=/);
  } finally { app.server.close(); }
});

test("app: voice 2 -> voice 1 needs consent and works", async () => {
  const { app, base } = await boot(); try {
    const A = await voice("A", 230, 8), B = await voice("B", 115, 4);
    let r = await fetch(base + "/api/swap", { method: "POST", headers: H, body: form({}, { voice: A, speech: B }) }); assert.equal(r.status, 400); assert.match((await r.json()).error, /permission/);
    r = await fetch(base + "/api/swap", { method: "POST", headers: H, body: form({ consent: "1" }, { voice: A }) }); assert.equal(r.status, 400);
    r = await fetch(base + "/api/swap", { method: "POST", headers: H, body: form({ consent: "1" }, { voice: A, speech: B }) }); assert.equal(r.status, 200);
    const j = await waitJob(base, (await r.json()).id); assert.equal(j.status, "done", j.error);
    fs.writeFileSync(path.join(tmp, "swap.ogg"), Buffer.from(await (await fetch(`${base}/api/jobs/${j.id}/result?fmt=ogg`)).arrayBuffer())); near(await f0Of(path.join(tmp, "swap.ogg")), 230, 0.12);
  } finally { app.server.close(); }
});

test("app: with a GPU engine, presets are hidden; daily limit works; static files and sweep", async () => {
  const fake = { name: "http", label: "x", convert: async ({ source, out }) => { fs.copyFileSync(source, out); return { note: "ok" }; } };
  const app = createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "vs-data-")), env: { TRUST_PROXY: "0", PER_DAY: "1" }, engine: fake, ttlMs: 50 });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r)); const base = "http://127.0.0.1:" + app.server.address().port;
  try {
    assert.equal((await (await fetch(base + "/api/config")).json()).presetsOn, false);
    for (const f of ["/", "/app.js", "/manifest.webmanifest", "/sw.js", "/icon-192.png", "/terms.html"]) assert.equal((await fetch(base + f)).status, 200, f);
    const man = await (await fetch(base + "/manifest.webmanifest")).json(); assert.equal(man.share_target.action, "/share"); assert.equal(man.share_target.method, "POST");
    const sample = await voice("g1", 200, 8), speech = await voice("g2", 120, 3);
    const v = (await (await fetch(base + "/api/voices", { method: "POST", headers: H, body: form({ name: "G", consent: "1" }, { sample }) })).json()).voice;
    let r = await fetch(base + "/api/convert", { method: "POST", headers: H, body: form({ voice: "preset:deep" }, { audio: speech }) }); assert.equal(r.status, 400);
    r = await fetch(base + "/api/convert", { method: "POST", headers: H, body: form({ voice: v.id }, { audio: speech }) }); assert.equal(r.status, 200); const id = (await r.json()).id;
    r = await fetch(base + "/api/convert", { method: "POST", headers: H, body: form({ voice: v.id }, { audio: speech }) }); assert.equal(r.status, 429);
    await waitJob(base, id); await new Promise(r => setTimeout(r, 80)); app.jobs.sweep(); assert.equal((await fetch(`${base}/api/jobs/${id}`)).status, 404);   // deleted after the time limit
  } finally { app.server.close(); }
});

"use strict";
// Saved voices ("My voices"). One folder per user. A voice can only be saved when the consent box was ticked; the time is stored.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const audio = require("./audio");
const { fail, rid } = require("./util");

const USER_RE = /^[a-f0-9]{32}$/, ID_RE = /^[a-f0-9]{12}$/;
const cleanName = s => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);

class Voices {
  constructor(dir, { maxPerUser = 10, minSeconds = 5, maxSeconds = 60 } = {}) { Object.assign(this, { dir, maxPerUser, minSeconds, maxSeconds }); fs.mkdirSync(dir, { recursive: true }); }
  ud(user) { if (!USER_RE.test(user || "")) throw fail(400, "Missing user id. Reload the page."); return path.join(this.dir, user); }
  list(user) {
    const d = this.ud(user); if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter(f => f.endsWith(".json")).map(f => { try { return JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); } catch { return null; } })
      .filter(Boolean).sort((a, b) => b.created - a.created).map(v => ({ id: v.id, name: v.name, seconds: v.seconds, created: v.created }));
  }
  get(user, id) {
    if (!ID_RE.test(id || "")) return null; const d = this.ud(user), meta = path.join(d, id + ".json"), wav = path.join(d, id + ".wav");
    if (!fs.existsSync(meta) || !fs.existsSync(wav)) return null; return { ...JSON.parse(fs.readFileSync(meta, "utf8")), path: wav };
  }
  async add(user, { name, file, consent, ipHash }) {
    if (!consent) throw fail(400, "Please tick the box that says you have permission to use this voice.");
    const nm = cleanName(name); if (!nm) throw fail(400, "Give this voice a name.");
    const d = this.ud(user); fs.mkdirSync(d, { recursive: true });
    if (this.list(user).length >= this.maxPerUser) throw fail(400, `You can save up to ${this.maxPerUser} voices. Delete one first.`);
    const id = rid(6), wav = path.join(d, id + ".wav");
    let seconds; try { seconds = await audio.prepare(file, wav, { maxSeconds: this.maxSeconds, rate: 24000 }); } catch { fs.rmSync(wav, { force: true }); throw fail(400, "This file is not readable audio."); }
    if (seconds < this.minSeconds) { fs.rmSync(wav, { force: true }); throw fail(400, `The sample is too short (${seconds.toFixed(1)} s). Use at least ${this.minSeconds} seconds of clear speech.`); }
    const meta = { id, name: nm, seconds: +seconds.toFixed(1), created: Date.now(), consent: { at: new Date().toISOString(), ip: ipHash } };
    fs.writeFileSync(path.join(d, id + ".json"), JSON.stringify(meta)); return { id, name: nm, seconds: meta.seconds, created: meta.created };
  }
  remove(user, id) { const v = this.get(user, id); if (!v) return false; const d = this.ud(user); fs.rmSync(path.join(d, id + ".wav"), { force: true }); fs.rmSync(path.join(d, id + ".json"), { force: true }); return true; }
}
const hashIp = ip => crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 12);
module.exports = { Voices, hashIp, USER_RE, ID_RE, cleanName };

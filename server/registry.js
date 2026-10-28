"use strict";
// Remembers the current address of the AI converter. The Colab notebook tells the website its new address
// (POST /api/converter/register with the shared key), so nobody has to copy it by hand.
const fs = require("fs"), path = require("path");

class Registry {
  constructor(file, initialUrl) {
    this.file = file; this.url = initialUrl || null; this.at = 0;
    try { const j = JSON.parse(fs.readFileSync(file, "utf8")); if (j.url) { this.url = j.url; this.at = j.at || 0; } } catch {}
  }
  get() { return this.url; }
  set(url) {
    this.url = url; this.at = Date.now();
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ url, at: this.at })); } catch {}
  }
  clean(u) {                                   // only https addresses; keep just the origin + path
    let x; try { x = new URL(String(u)); } catch { return null; }
    if (x.protocol !== "https:" || x.username || x.password) return null;
    return x.origin + (x.pathname === "/" ? "/" : x.pathname);
  }
}
module.exports = { Registry };

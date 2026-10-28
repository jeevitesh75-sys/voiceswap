"use strict";
// HTTP engine: sends the speech + the target voice to a converter server (see /converter) and gets a wav back.
// Contract:  POST CONVERTER_URL   multipart fields: source (wav), target (wav), steps (number)
//            Authorization: Bearer CONVERTER_KEY (optional)      ->  200 audio/wav bytes
const fs = require("fs");

function makeHttp({ url, key, fetchFn = fetch, timeoutMs = 600e3, steps = 25 }) {
  if (!url) throw new Error("CONVERTER_URL is not set");
  return {
    name: "http",
    label: "AI voice conversion (high quality).",
    async convert({ source, target, preset, out }) {
      if (preset) throw new Error("Preset voices use the basic engine");
      const fd = new FormData();
      fd.append("source", new Blob([fs.readFileSync(source)], { type: "audio/wav" }), "source.wav");
      fd.append("target", new Blob([fs.readFileSync(target)], { type: "audio/wav" }), "target.wav");
      fd.append("steps", String(steps));
      const r = await fetchFn(url, { method: "POST", body: fd, headers: key ? { Authorization: "Bearer " + key } : {}, signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) { let t = ""; try { t = (await r.text()).slice(0, 200); } catch {} throw new Error(`Voice converter error ${r.status}. ${t}`); }
      const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 1000) throw new Error("The voice converter returned an empty file.");
      fs.writeFileSync(out, buf); return { note: "AI voice conversion done." };
    }
  };
}
module.exports = { makeHttp };

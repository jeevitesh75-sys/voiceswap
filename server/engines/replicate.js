"use strict";
// Replicate engine (paid GPU API). UNTESTED against the real service: the input field names depend on the model you pick,
// so they are settings. Open the model page on replicate.com, look at its "API" tab, and copy the two audio input names.
const fs = require("fs");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeReplicate({ token, version, fieldSource = "source_audio", fieldTarget = "target_audio", extraInput = {}, fetchFn = fetch, pollMs = 2000, timeoutMs = 600e3 }) {
  if (!token || !version) throw new Error("REPLICATE_API_TOKEN and REPLICATE_MODEL_VERSION must be set");
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const uri = f => "data:audio/wav;base64," + fs.readFileSync(f).toString("base64");
  return {
    name: "replicate",
    label: "AI voice conversion on a cloud GPU (high quality).",
    async convert({ source, target, preset, out }) {
      if (preset) throw new Error("Preset voices use the basic engine");
      const body = { version: String(version).split(":").pop(), input: { ...extraInput, [fieldSource]: uri(source), [fieldTarget]: uri(target) } };
      let r = await fetchFn("https://api.replicate.com/v1/predictions", { method: "POST", headers: H, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`Replicate error ${r.status}: ${(await r.text()).slice(0, 200)}`);
      let p = await r.json(); const t0 = Date.now();
      while (p.status === "starting" || p.status === "processing") {
        if (Date.now() - t0 > timeoutMs) throw new Error("The voice conversion took too long.");
        await sleep(pollMs); r = await fetchFn(p.urls.get, { headers: H }); if (!r.ok) throw new Error("Replicate poll error " + r.status); p = await r.json();
      }
      if (p.status !== "succeeded") throw new Error("Voice conversion failed: " + String(p.error || p.status).slice(0, 200));
      const url = Array.isArray(p.output) ? p.output[0] : p.output; if (!url) throw new Error("Replicate returned no audio.");
      const a = await fetchFn(url); if (!a.ok) throw new Error("Could not download the converted audio.");
      fs.writeFileSync(out, Buffer.from(await a.arrayBuffer())); return { note: "AI voice conversion done." };
    }
  };
}
module.exports = { makeReplicate };

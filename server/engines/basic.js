"use strict";
// BASIC engine: needs no GPU and no account. It moves the pitch and voice colour of the speech toward the target voice.
// It is NOT an exact AI clone. For a real clone use the "http" or "replicate" engine.
const audio = require("../audio");

const PRESETS = {
  female: { name: "Female voice", targetHz: 215 },
  male:   { name: "Male voice",   targetHz: 115 },
  deep:   { name: "Deep voice",   ratio: 0.74 },
  child:  { name: "Child voice",  ratio: 1.45 },
  anchor: { name: "News anchor",  ratio: 0.9, extra: "acompressor=threshold=0.1:ratio=3,equalizer=f=3000:t=q:w=1:g=3" },
  robot:  { name: "Robot",        robot: true }
};
const ROBOT = "afftfilt=real='hypot(re,im)*cos(0)':imag='hypot(re,im)*sin(0)':win_size=512:overlap=0.75";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Pitch goes by the full ratio r, but the "voice tone" (formants) only moves by about r^0.35.
// A man -> woman change moves pitch x1.8 but the throat/mouth tone only x1.2. Moving both x1.8 sounds like a child.
function pitchFilter(r, rate, fallback) {
  if (!fallback) { const f = clamp(Math.pow(r, 0.35), 0.8, 1.27);
    return `asetrate=${Math.round(rate * f)},aresample=${rate},atempo=${(1 / f).toFixed(4)},rubberband=pitch=${(r / f).toFixed(4)}:formant=preserved`; }
  return `asetrate=${Math.round(rate * r)},aresample=${rate},atempo=${(1 / r).toFixed(4)}`;     // simple fallback when rubberband is missing
}

async function applyFilter(source, out, chain, rate) {
  const go = fb => audio.run("ffmpeg", ["-y", "-v", "error", "-i", source, "-af", chain(fb), "-ac", "1", "-ar", String(rate), "-c:a", "pcm_s16le", out]);
  try { await go(false); } catch { await go(true); }
}

function makeBasic() {
  return {
    name: "basic",
    label: "Basic mode: moves your pitch and tone toward the chosen voice. It is not an exact clone.",
    async convert({ source, target, preset, out, rate = 24000 }) {
      if (preset) {
        const p = PRESETS[preset]; if (!p) throw new Error("Unknown preset voice");
        if (p.targetHz) {                                   // Female / Male: aim for a typical pitch, whoever is speaking
          const src = audio.estimateF0(await audio.pcm16k(source)), ratio = clamp(p.targetHz / src.f0, 0.55, 2.0);
          if (Math.abs(ratio - 1) < 0.08) { await audio.run("ffmpeg", ["-y", "-v", "error", "-i", source, "-c:a", "pcm_s16le", out]); return { note: "Your voice already sounds " + p.name.toLowerCase() + "." }; }
          await applyFilter(source, out, fb => pitchFilter(ratio, rate, fb), rate); return { note: p.name + " applied.", ratio, srcHz: src.f0, tgtHz: p.targetHz };
        }
        if (p.robot) { await audio.run("ffmpeg", ["-y", "-v", "error", "-i", source, "-af", ROBOT, "-ac", "1", "-ar", String(rate), "-c:a", "pcm_s16le", out]); return { note: "Robot effect applied." }; }
        await applyFilter(source, out, fb => pitchFilter(p.ratio, rate, fb) + (p.extra ? "," + p.extra : ""), rate); return { note: p.name + " applied." };
      }
      const [a, b] = await Promise.all([audio.pcm16k(source), audio.pcm16k(target)]);
      const src = audio.estimateF0(a), tgt = audio.estimateF0(b);
      const ratio = clamp(tgt.f0 / src.f0, 0.55, 2.0);
      if (Math.abs(ratio - 1) < 0.03) { await audio.run("ffmpeg", ["-y", "-v", "error", "-i", source, "-c:a", "pcm_s16le", out]); return { note: "Your voice is already close to this voice.", ratio, srcHz: src.f0, tgtHz: tgt.f0 }; }
      await applyFilter(source, out, fb => pitchFilter(ratio, rate, fb), rate);
      return { note: `Pitch moved from about ${Math.round(src.f0)} Hz to ${Math.round(tgt.f0)} Hz.`, ratio, srcHz: src.f0, tgtHz: tgt.f0 };
    }
  };
}
module.exports = { makeBasic, PRESETS };

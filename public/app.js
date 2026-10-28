"use strict";
const $ = id => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
let USER = store.get("vs_user"); if (!/^[a-f0-9]{32}$/.test(USER || "")) { USER = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join(""); store.set("vs_user", USER); }
const S = { cfg: null, voices: [], pending: null, job: null, fmt: "m4a" };
const err = m => { const b = $("banner"); b.textContent = m; b.hidden = !m; if (m) window.scrollTo({ top: 0, behavior: "smooth" }); };
async function api(url, opt = {}) { opt.headers = { ...(opt.headers || {}), "X-User": USER }; const r = await fetch(url, opt); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || "Request failed (" + r.status + ")"); return j; }
const show = id => { ["busy", "result"].forEach(k => $(k).hidden = k !== id); document.querySelectorAll(".tab").forEach(t => t.hidden = !!id || t.id !== "t-" + (S.tab || "convert")); document.querySelector(".tabs").hidden = !!id; };

document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b)); document.querySelectorAll(".tab").forEach(t => t.hidden = t.id !== "t-" + S.tab); err(""); });
const pickName = (inp, out, hint) => inp.onchange = () => { const f = inp.files[0]; if (f) { out.textContent = f.name; if (hint) hint.textContent = (f.size / 1048576).toFixed(1) + " MB"; } };
pickName($("audio"), $("aname")); pickName($("vfile"), $("vfname"), $("vhint")); pickName($("sA"), $("sAn")); pickName($("sB"), $("sBn"));

(async function init() {
  try { S.cfg = await api("/api/config"); } catch (e) { return err("Cannot reach the server. " + e.message); }
  $("engNote").textContent = S.cfg.engineLabel; $("ttl").textContent = S.cfg.ttlHours;
  const q = new URLSearchParams(location.search);
  if (q.get("err")) err(q.get("err"));
  if (q.get("pending")) { S.pending = q.get("pending"); $("gotShared").hidden = false; $("sharedPlayer").src = "/api/pending/" + S.pending; $("aname").textContent = "Using the audio you shared"; history.replaceState(null, "", "/"); }
  await loadVoices();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();

async function loadVoices() {
  try { S.voices = (await api("/api/voices")).voices; } catch (e) { S.voices = []; err(e.message); }
  const sel = $("voiceSel"), keep = store.get("vs_active") || sel.value; sel.innerHTML = "";
  const add = (v, n, g) => { const o = document.createElement("option"); o.value = v; o.textContent = n; (g || sel).appendChild(o); };
  if (S.voices.length) { const g = document.createElement("optgroup"); g.label = "My voices"; sel.appendChild(g); S.voices.forEach(v => add(v.id, v.name, g)); }
  if (S.cfg.presetsOn) { const g = document.createElement("optgroup"); g.label = "Fun voices"; sel.appendChild(g); S.cfg.presets.forEach(p => add(p.id, p.name, g)); }
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  sel.onchange = () => store.set("vs_active", sel.value);
  const box = $("vlist"); box.innerHTML = ""; if (!S.voices.length) box.innerHTML = '<p class="note">No saved voices yet. Add one below.</p>';
  S.voices.forEach(v => { const d = document.createElement("div"); d.className = "row"; const n = document.createElement("div"); n.textContent = `${v.name} (${v.seconds}s)`;
    const p = document.createElement("button"); p.textContent = "Play"; p.onclick = () => new Audio(`/api/voices/${v.id}/sample?u=${USER}`).play();
    const x = document.createElement("button"); x.textContent = "Delete"; x.onclick = async () => { if (!confirm("Delete this voice?")) return; try { await api("/api/voices/" + v.id, { method: "DELETE" }); if (store.get("vs_active") === v.id) store.set("vs_active", ""); loadVoices(); } catch (e) { err(e.message); } };
    d.append(n, p, x); box.appendChild(d); });
}

$("vsave").onclick = async () => {
  err(""); const f = $("vfile").files[0]; if (!f) return err("Choose an audio sample first."); if (!$("vconsent").checked) return err("Please tick the permission box.");
  const fd = new FormData(); fd.append("name", $("vname").value || "My voice"); fd.append("consent", "1"); fd.append("sample", f);
  $("vsave").disabled = true; $("vsave").textContent = "Saving...";
  try { const r = await api("/api/voices", { method: "POST", body: fd }); store.set("vs_active", r.voice.id); $("vfile").value = ""; $("vfname").textContent = "Tap to choose a clear sample"; $("vname").value = ""; $("vconsent").checked = false; await loadVoices(); }
  catch (e) { err(e.message); } finally { $("vsave").disabled = false; $("vsave").textContent = "Save voice"; }
};

async function start(url, fd) {
  err(""); show("busy"); $("busyT").textContent = "Uploading..."; $("barI").style.width = "5%"; $("busyN").textContent = "Keep this page open.";
  try { const r = await api(url, { method: "POST", body: fd }); S.job = r.id; poll(); } catch (e) { show(null); err(e.message); }
}
$("go").onclick = () => {
  const v = $("voiceSel").value; if (!v) { err("Save a voice first (My voices tab)" + (S.cfg.presetsOn ? "." : ".")); return; }
  const f = $("audio").files[0]; if (!f && !S.pending) return err("Choose an audio first, or share one from WhatsApp.");
  const fd = new FormData(); fd.append("voice", v); fd.append("tag", $("tag").checked ? "1" : "0"); if (f) fd.append("audio", f); else fd.append("pending", S.pending);
  S.origUrl = null; start("/api/convert", fd);
};
$("sgo").onclick = () => {
  const a = $("sA").files[0], b = $("sB").files[0]; if (!a || !b) return err("Choose both audio A and audio B."); if (!$("sconsent").checked) return err("Please tick the permission box.");
  const fd = new FormData(); fd.append("consent", "1"); fd.append("tag", $("tag").checked ? "1" : "0"); fd.append("voice", a); fd.append("speech", b); start("/api/swap", fd);
};

const LABEL = { queued: "Waiting in line...", preparing: "Cleaning your audio...", converting: "Changing the voice...", encoding: "Making the files..." };
async function poll() {
  let j; try { j = await api("/api/jobs/" + S.job); } catch (e) { show(null); return err(e.message); }
  if (j.status === "error") { show(null); return err(j.error); }
  if (j.status === "done") return done(j);
  $("busyT").textContent = LABEL[j.status] || "Working..."; $("barI").style.width = Math.max(8, j.progress * 100) + "%";
  $("busyN").textContent = j.queue ? `${j.queue} before you.` : "Longer audio takes longer.";
  setTimeout(poll, 1200);
}
function setFmt() { const f = $("fmt").value; $("newv").src = `/api/jobs/${S.job}/result?fmt=${f}`; $("dl").href = `/api/jobs/${S.job}/result?fmt=${f}&dl=1`; }
function done(j) {
  show("result"); S.j = j; $("rnote").textContent = (j.voiceName ? "Voice: " + j.voiceName + ". " : "") + (j.note || "");
  $("orig").src = `/api/jobs/${S.job}/original`; setFmt(); $("aiLabel").textContent = j.tag ? 'This file has an "AI voice" label inside it. Please tell people it is an AI voice.' : "Please tell people it is an AI voice.";
  window.scrollTo({ top: 0 });
}
$("fmt").onchange = setFmt;
$("share").onclick = async () => {
  const f = $("fmt").value, types = { m4a: "audio/mp4", ogg: "audio/ogg", mp3: "audio/mpeg" };
  try {
    const r = await fetch(`/api/jobs/${S.job}/result?fmt=${f}`), b = await r.blob(), file = new File([b], "voiceswap." + f, { type: types[f] });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: "VoiceSwap" }); else { $("dl").click(); err("Sharing is not supported here, so the file is downloading instead."); }
  } catch (e) { if (e && e.name !== "AbortError") err("Could not share. Use Download instead."); }
};
$("again").onclick = () => { S.pending = null; $("gotShared").hidden = true; $("audio").value = ""; $("aname").textContent = "Tap to choose an audio"; show(null); err(""); };

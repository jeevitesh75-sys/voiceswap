"use strict";
// optional local .env loader (no packages needed)
try { for (const l of require("fs").readFileSync(require("path").join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !process.env[m[1]] && !l.trim().startsWith("#")) process.env[m[1]] = m[2]; } } catch {}
const { createApp } = require("./app");
const port = +process.env.PORT || 7860;
const app = createApp();
app.server.listen(port, "0.0.0.0", () => console.log(`VoiceSwap running on port ${port} (engine: ${app.engine.name})`));

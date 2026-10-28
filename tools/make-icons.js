"use strict";
// Draws the app icons (a sound-wave on a dark rounded square) with no packages. Run: node tools/make-icons.js
const fs = require("fs"), zlib = require("zlib"), path = require("path");
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(size, maskable) {
  const px = Buffer.alloc(size * size * 4), bars = [0.28, 0.55, 0.85, 0.55, 0.28], pad = maskable ? 0.25 : 0.16, rad = maskable ? 0 : size * 0.22;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4; let a = 255;
    if (rad) { const dx = Math.max(rad - x, x - (size - 1 - rad), 0), dy = Math.max(rad - y, y - (size - 1 - rad), 0); if (dx * dx + dy * dy > rad * rad) a = 0; }
    let r = 15, g = 16, b = 32;
    const inner = size * (1 - 2 * pad), x0 = size * pad, bw = inner / 9;
    for (let k = 0; k < 5; k++) { const bx = x0 + bw * (1 + 2 * k), h = inner * bars[k], cy = size / 2;
      if (x >= bx && x < bx + bw && Math.abs(y - cy) < h / 2) { const t = k / 4; r = Math.round(139 + (34 - 139) * t); g = Math.round(92 + (211 - 92) * t); b = Math.round(246 + (238 - 246) * t); } }
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }
  const raw = Buffer.alloc((size * 4 + 1) * size); for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(size, 0); ih.writeUInt32BE(size, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const out = path.join(__dirname, "..", "public");
fs.writeFileSync(path.join(out, "icon-192.png"), png(192, false)); fs.writeFileSync(path.join(out, "icon-512.png"), png(512, false)); fs.writeFileSync(path.join(out, "icon-maskable-512.png"), png(512, true));
console.log("icons written");

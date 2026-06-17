// Generates the extension PNG icons (16/32/48/128) with no external deps.
// A teal rounded square with a white speech bubble and three dots.
// Run: node tools/make-icons.mjs

import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "icons");
mkdirSync(OUT, { recursive: true });

const TEAL = [20, 184, 166, 255];
const SLATE = [15, 23, 42, 255];
const WHITE = [255, 255, 255, 255];

function makeCanvas(size) {
  return { size, data: new Uint8Array(size * size * 4) };
}

function setPx(c, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  // simple source-over alpha blend
  const sa = a / 255;
  const da = c.data[i + 3] / 255;
  const out = sa + da * (1 - sa);
  if (out === 0) return;
  c.data[i] = Math.round((r * sa + c.data[i] * da * (1 - sa)) / out);
  c.data[i + 1] = Math.round((g * sa + c.data[i + 1] * da * (1 - sa)) / out);
  c.data[i + 2] = Math.round((b * sa + c.data[i + 2] * da * (1 - sa)) / out);
  c.data[i + 3] = Math.round(out * 255);
}

function fillRoundRect(c, x0, y0, w, h, radius, color) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.min(x, w - 1 - x);
      const dy = Math.min(y, h - 1 - y);
      if (dx < radius && dy < radius) {
        const cx = radius - dx;
        const cy = radius - dy;
        if (cx * cx + cy * cy > radius * radius) continue;
      }
      setPx(c, x0 + x, y0 + y, color);
    }
  }
}

function fillCircle(c, cx, cy, r, color) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) setPx(c, Math.round(cx + x), Math.round(cy + y), color);
    }
  }
}

function fillTriangle(c, pts, color) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.floor(Math.min(...xs));
  const maxX = Math.ceil(Math.max(...xs));
  const minY = Math.floor(Math.min(...ys));
  const maxY = Math.ceil(Math.max(...ys));
  const sign = (a, b, p) =>
    (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = [x + 0.5, y + 0.5];
      const d1 = sign(pts[0], pts[1], p);
      const d2 = sign(pts[1], pts[2], p);
      const d3 = sign(pts[2], pts[0], p);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(hasNeg && hasPos)) setPx(c, x, y, color);
    }
  }
}

function drawIcon(size) {
  const c = makeCanvas(size);
  const s = size;
  // teal rounded square background
  fillRoundRect(c, 0, 0, s, s, Math.round(s * 0.22), TEAL);

  // white speech bubble
  const bx = Math.round(s * 0.18);
  const by = Math.round(s * 0.2);
  const bw = Math.round(s * 0.64);
  const bh = Math.round(s * 0.42);
  const br = Math.max(2, Math.round(s * 0.1));
  fillRoundRect(c, bx, by, bw, bh, br, WHITE);
  // tail
  const tailY = by + bh - 1;
  const tailX = bx + Math.round(bw * 0.3);
  fillTriangle(
    c,
    [
      [tailX, tailY],
      [tailX + Math.round(s * 0.12), tailY],
      [tailX - Math.round(s * 0.02), tailY + Math.round(s * 0.16)],
    ],
    WHITE
  );

  // three dots inside the bubble
  const dotR = Math.max(1, Math.round(s * 0.045));
  const cy = by + Math.round(bh * 0.45);
  const startX = bx + Math.round(bw * 0.28);
  const gap = Math.round(bw * 0.22);
  for (let i = 0; i < 3; i++) {
    fillCircle(c, startX + i * gap, cy, dotR, SLATE);
  }
  return c;
}

// ---- PNG encoding ----------------------------------------------------------
function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(canvas) {
  const { size, data } = canvas;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size * 4; x++) {
      raw[y * (size * 4 + 1) + 1 + x] = data[y * size * 4 + x];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  const png = encodePNG(drawIcon(size));
  writeFileSync(join(OUT, `icon${size}.png`), png);
  console.log(`wrote icons/icon${size}.png (${png.length} bytes)`);
}

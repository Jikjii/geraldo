#!/usr/bin/env node
/*
 * make-og.mjs - draws assets/og.png, the 1200x630 link-preview image.
 *
 * It renders the light wall the same way the site does (same noise, same
 * palette gradient, same 19px tiles on a 20px grid), caught mid-bloom, in
 * the default palette from content.js. No dependencies: the PNG is encoded
 * here with node:zlib and a small CRC32.
 *
 *   node tools/make-og.mjs            # default palette from content.js
 *   node tools/make-og.mjs olive      # any palette name from content.js
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "og.png");
const WIDTH = 1200, HEIGHT = 630;
const TILE = 19, CELL = 20;
const BG = [0x14, 0x0c, 0x08];
const UNLIT = [0x20, 0x13, 0x09];
const AMBER = ["#ff2d00", "#ff5400", "#ff6b1a", "#ff8510", "#ff9f1c", "#ffb703", "#ffc933", "#ffd60a", "#ffe566", "#ff8a3d", "#ff4d1a"];

/* ---------- content.js ---------- */

function loadSite() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(ROOT, "content.js"), "utf8"), sandbox, { filename: "content.js" });
  return sandbox.window.SITE || {};
}

function parseHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, c => c + c);
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* FNV-1a, as in site.js: a palette without a seed gets 3 + hash % 97 there. */
function hashString(text) {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pickPalette(site, requested) {
  const name = requested || site.defaultPalette || "amber";
  const def = site.palettes && site.palettes[name];
  const stops = Array.isArray(def) ? def : def && (def.stops || def.colors);
  const rgb = (Array.isArray(stops) ? stops : AMBER).map(parseHex).filter(Boolean);
  if (!def || rgb.length < 2) return { name: "amber", rgb: AMBER.map(parseHex), seed: 0 };
  const given = !Array.isArray(def) ? Number(def.seed) : NaN;
  const seed = Number.isFinite(given) ? given : 3 + (hashString(name) % 97);
  return { name, rgb, seed };
}

/* ---------- the wall (same maths as assets/site.js) ---------- */

const sm = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

function hash3(x, y, z) {
  let h = (Math.imul(x, 0x27d4eb2d) + Math.imul(y, 0x165667b1) + Math.imul(z, 0x61c88647)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const lerp = (a, b, t) => a + (b - a) * t;
  const x00 = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u);
  const x10 = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u);
  const x01 = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u);
  const x11 = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

const fbm = (x, y, z) => 0.62 * noise3(x, y, z) + 0.38 * noise3(x * 2.17 + 11.3, y * 2.17 + 7.9, z * 2.17 + 3.1);

function buildLUT(rgb) {
  const out = new Uint8ClampedArray(512 * 3), n = rgb.length;
  for (let k = 0; k < 512; k++) {
    const pos = (k / 512) * n, seg = Math.floor(pos), f = sm(pos - seg);
    const a = rgb[seg % n], b = rgb[(seg + 1) % n];
    for (let c = 0; c < 3; c++) out[k * 3 + c] = Math.sqrt(a[c] * a[c] * (1 - f) + b[c] * b[c] * f);
  }
  return out;
}

function render(palette) {
  const lut = buildLUT(palette.rgb);
  const cols = Math.floor((WIDTH + 1) / CELL);          // 60
  const rows = Math.floor((HEIGHT + 1) / CELL);         // 31
  const offX = Math.floor((WIDTH - (cols * CELL - 1)) / 2);
  const offY = Math.floor((HEIGHT - (rows * CELL - 1)) / 2);
  const T = 12 * 1.3675;                                // a pleasant moment of the field
  const hue = T * 0.012 + 12 * 0.04;
  const seed = palette.seed * 0.07;

  // Mid-bloom: a ragged disc with a bright rim, corners still dark.
  const si = (cols - 1) / 2, sj = (rows - 1) / 2;
  const radius = 23;

  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let p = 0; p < WIDTH * HEIGHT; p++) pixels.set(BG, p * 3);
  const paint = (i, j, color) => {
    const x0 = offX + i * CELL, y0 = offY + j * CELL;
    for (let y = y0; y < y0 + TILE; y++) {
      if (y < 0 || y >= HEIGHT) continue;
      for (let x = x0; x < x0 + TILE; x++) if (x >= 0 && x < WIDTH) pixels.set(color, (y * WIDTH + x) * 3);
    }
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) { paint(i, j, UNLIT); continue; }
      let b = fbm(i * 0.1 + T * 0.06, j * 0.1 + T * 0.025, T * 0.09 + 47.1 + seed);
      b = (b - 0.02) / 0.98;
      b = b <= 0 ? 0 : Math.pow(b, 0.95);
      b = (0.55 + 0.45 * Math.min(b, 1)) * 0.935;
      let s = fbm(i * 0.05 + T * 0.04, j * 0.05 + T * 0.018, T * 0.05) + hue;
      const e = radius - Math.hypot(i - si, j - sj) + (fbm(i * 0.3, j * 0.3, 5.7) - 0.5) * 7;
      b = b * sm(e / 2.3) + 0.8 * Math.exp(-(e * e) / 5);
      if (b < 0.02) continue;
      if (b > 1) b = 1;
      s -= Math.floor(s);
      const idx = (s * 512) | 0, m = (((b * 63) | 0) + 0.5) / 64;
      paint(i, j, [(lut[idx * 3] * m) | 0, (lut[idx * 3 + 1] * m) | 0, (lut[idx * 3 + 2] * m) | 0]);
    }
  }
  return pixels;
}

/* ---------- PNG encoding ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let k = 0; k < buf.length; k++) c = CRC_TABLE[(c ^ buf[k]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePNG(pixels, width, height) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // "Up" filter: tiles repeat row after row, so most bytes become zero.
    const out = y * (stride + 1);
    raw[out] = y === 0 ? 0 : 2;
    for (let x = 0; x < stride; x++) {
      const cur = pixels[y * stride + x];
      raw[out + 1 + x] = y === 0 ? cur : (cur - pixels[(y - 1) * stride + x]) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter method
  ihdr[12] = 0;  // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- main ---------- */

const site = loadSite();
const palette = pickPalette(site, process.argv[2]);
const png = encodePNG(render(palette), WIDTH, HEIGHT);
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`Wrote ${path.relative(ROOT, OUT)} (${WIDTH}x${HEIGHT}, palette "${palette.name}", ${(png.length / 1024).toFixed(1)} KB)`);

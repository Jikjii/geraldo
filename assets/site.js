/*!
 * site.js - the light-wall portfolio engine.
 * Design inspired by shreygups.com. Original implementation: no dependencies,
 * no build step. All content comes from window.SITE (content.js).
 *
 * Contents
 *   1  Config and tokens         CFG, colours, DOM handles, motion preference
 *   2  Math and noise            smoothstep, lattice hash, value noise, fbm
 *   3  Palettes                  library, 512-entry colour tables, crossfades
 *   4  Routes and content model  pages derived from content.js
 *   5  Markdown                  small, safe renderer (builds DOM nodes)
 *   6  Page DOM                  panes, nav links, open-page dots, buttons
 *   7  Pane mask and waves       per-cell open mask, jagged wipe fronts, crest
 *   8  Switch band               in-place swap between sibling pages
 *   9  Page stack                open / close / switch / cascade semantics
 *  10  Layout                    grid, world width, canvas DPR, bloom geometry
 *  11  Camera                    horizontal stage scroll, wheel, touch
 *  12  Router                    clean URLs in the site's folder (hash routes on file://), metadata
 *  12b Manifesto overlay         /manifesto: a full-screen dialog; loads assets/manifesto.js on first open
 *  13  Pointer                   wake trail and sparks on the wall
 *  14  Sound                     your audio file, or a generated Web Audio pad
 *  15  Favicon                   live squircle in the corner tile's colour
 *  16  Frame loop and renderer   per-frame orchestration and the tile pass
 *  17  Events and boot
 *
 * The one idea everything hangs on: opened pages sit UNDER the canvas. The
 * canvas paints lit tiles over them and "opens" a page by clearing whole
 * 20px cells, cell by cell, behind a jagged front of light. Nothing slides.
 */
(() => {
"use strict";

const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";

/* Wait (briefly) for the stylesheet. It normally applies before this script
   runs; if it's late, starting unstyled would measure the wrong layout. After
   about four seconds (say the file is missing), start anyway. */
function whenReady(start) {
  let tries = 0;
  const check = () => {
    const stage = document.getElementById("stage");
    const styled = !!stage && getComputedStyle(stage).position === "absolute";
    if (styled || tries++ > 250) start();
    else setTimeout(check, 16);
  };
  check();
}

whenReady(main);

function main() {
if (window.__lightWallBooted) return;
window.__lightWallBooted = true;

const contentMissing = !(window.SITE && typeof window.SITE === "object");
const SITE = contentMissing ? {} : window.SITE;
if (contentMissing && window.console && console.error) {
  console.error("[site] content.js did not load, so window.SITE is missing. Look for a syntax error " +
    "reported above: usually an unescaped backtick (write \\`) or ${ (write \\${) inside a page body.");
}

/* ======================================================================
   1. Config and tokens
   ====================================================================== */

const CFG = {
  tile: 19,             // tile edge, CSS px (constant at every viewport)
  gap: 1,               // gap between tiles; a cell is tile + gap = 20px

  // Colour (palette position) field: blobs ~20 tiles across.
  colorScale: 0.05,
  colorDrift: 0.04,
  colorDriftY: 0.018,
  colorEvolve: 0.05,
  hueCycle: 0.012,      // palette advance per unit of field time
  hueSpin: 0.04,        // extra palette advance per real second (~17.7s per cycle in total)

  // Brightness field: blobs ~10 tiles across.
  waveScale: 0.10,
  waveDriftX: 0.06,
  waveDriftY: 0.025,
  waveEvolve: 0.09,
  threshold: 0.02,
  gamma: 0.95,
  floor: 0.55,          // no tile is ever dark

  timeScale: 1.3675,    // the field clock runs this much faster than real time
  dim: 0.935,           // global brightness (1 under reduced motion)

  // Timings, seconds.
  revealIn: 1.3,        // intro bloom, navigation palette fade, one pane wipe
  switchIn: 1.5,        // sibling swap band
  colorIn: 0.65,        // hover palette preview

  // Shapes, in tiles.
  revealSoft: 2.3,      // bloom edge softness
  jagAmp: 7,            // bloom rim raggedness
  flowCols: 3.1,        // wipe front bend
  glowCols: 4.2,        // wipe crest width
  flexCols: 1.6,        // crest width breathing
  lead: 1.15,           // fronts start this far outside the pane
  bandRows: 10,         // switch band thickness
  bandMinRows: 10,
  bandFlowRows: 3,
  bandFlexRows: 2.2,

  glide: 0.16,          // trapezoid acceleration share (switch band, camera pace)
  seedRate: 1.8,        // brightness-pattern morph speed on palette change
  roomPx: 400,          // camera keeps a pane plus ~100px of lights in view
  cullCells: 12,        // columns drawn beyond each viewport edge
};

const TAU = Math.PI * 2;
const tile = CFG.tile;
const gap = CFG.gap;
const cell = tile + gap;
const LEAD = CFG.lead;
const WAVE_FIELD_PAD = Math.ceil(CFG.glowCols * 2);

const doc = document;
const rootEl = doc.documentElement;
const stage = doc.getElementById("stage");
const wall = doc.getElementById("wall");
const deck = doc.getElementById("deck");
const strip = doc.getElementById("strip");
const paneStack = doc.getElementById("pane-stack");
if (!stage || !wall || !deck || !strip || !paneStack || !wall.getContext) return;
const ctx = wall.getContext("2d");
if (!ctx) return;

function warn(message) {
  if (window.console && console.warn) console.warn("[site] " + message);
}

/* Read a colour token from CSS and normalise it through the canvas parser,
   so the wall and the stylesheet always agree. */
function readColor(name, fallback) {
  const raw = getComputedStyle(rootEl).getPropertyValue(name).trim();
  ctx.fillStyle = fallback;
  if (raw) ctx.fillStyle = raw;
  return ctx.fillStyle;
}
const BG = readColor("--bg", "#140c08");
const UNLIT = readColor("--line", "#201309");
const ACCENT = readColor("--accent", "#ff9f1c");

const motionQuery = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
let reducedMotion = !!(motionQuery && motionQuery.matches);

/* ======================================================================
   2. Math and noise
   ====================================================================== */

const sm = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const clamp01 = u => (u <= 0 ? 0 : u >= 1 ? 1 : u);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* Integer lattice hash to [0,1). Any well-mixed 32-bit hash gives the same
   statistics; only the exact pattern would differ. */
function hash3(x, y, z) {
  let h = (Math.imul(x, 0x27d4eb2d) + Math.imul(y, 0x165667b1) + Math.imul(z, 0x61c88647)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* Trilinear value noise with smoothstep weights, output in [0,1). */
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const x1 = xi + 1, y1 = yi + 1, z1 = zi + 1;
  const a = hash3(xi, yi, zi), b = hash3(x1, yi, zi);
  const c = hash3(xi, y1, zi), d = hash3(x1, y1, zi);
  const e = hash3(xi, yi, z1), f = hash3(x1, yi, z1);
  const g = hash3(xi, y1, z1), h = hash3(x1, y1, z1);
  const ab = a + (b - a) * u, cd = c + (d - c) * u;
  const ef = e + (f - e) * u, gh = g + (h - g) * u;
  const lo = ab + (cd - ab) * v, hi = ef + (gh - ef) * v;
  return lo + (hi - lo) * w;
}

/* Two octaves (lacunarity 2.17, weights 0.62 / 0.38). Median ~0.5, p5..p95
   ~0.28..0.72: a narrow range is what keeps the wall evenly lit. */
function fbm(x, y, z) {
  return 0.62 * noise3(x, y, z) + 0.38 * noise3(x * 2.17 + 11.3, y * 2.17 + 7.9, z * 2.17 + 3.1);
}

/* "Add light": pushes brightness toward 1 without ever overshooting. */
function expose(base, glow) {
  const b = base <= 0 ? 0 : base >= 1 ? 1 : base;
  return 1 - (1 - b) * Math.exp(-1.25 * glow);
}

/* ======================================================================
   3. Palettes
   ====================================================================== */

const AMBER = [
  "#ff2d00", "#ff5400", "#ff6b1a", "#ff8510", "#ff9f1c", "#ffb703",
  "#ffc933", "#ffd60a", "#ffe566", "#ff8a3d", "#ff4d1a"
];

function parseHex(value) {
  if (typeof value !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hashString(text) {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const palettes = Object.create(null);

/* A palette is a list of colours, or { stops: [...], seed }. The seed shifts
   the brightness pattern, so each palette also has its own texture. */
function definePalette(name, def) {
  const stops = Array.isArray(def) ? def : def && typeof def === "object" ? def.stops || def.colors : null;
  if (!Array.isArray(stops)) return null;
  const rgb = [];
  for (let k = 0; k < stops.length; k++) {
    const c = parseHex(stops[k]);
    if (c) rgb.push(c);
    else warn(`Palette "${name}": "${stops[k]}" is not a #rrggbb colour.`);
  }
  if (rgb.length < 2) {
    warn(`Palette "${name}" needs at least two colours.`);
    return null;
  }
  const given = def && !Array.isArray(def) ? Number(def.seed) : NaN;
  const seed = Number.isFinite(given) ? given : 3 + (hashString(name) % 97);
  palettes[name] = { seed, rgb };
  return name;
}

definePalette("amber", { seed: 0, stops: AMBER });
if (SITE.palettes && typeof SITE.palettes === "object") {
  for (const name of Object.keys(SITE.palettes)) definePalette(name, SITE.palettes[name]);
}
const defaultPaletteKey = typeof SITE.defaultPalette === "string" && palettes[SITE.defaultPalette]
  ? SITE.defaultPalette
  : "amber";
const defaultRGB = palettes[defaultPaletteKey].rgb;
/* Brightness-pattern offset for a palette key (null = the default palette). */
const seedOf = key => palettes[key || defaultPaletteKey].seed * 0.07;

/* 512-entry cyclic gradient. Each segment eases with smoothstep (so every
   stop holds briefly) and blends channels in squared space (RMS), which
   keeps the in-betweens bright and clean. */
const LUT_SIZE = 512;
function fillLUT(out, rgb) {
  const n = rgb.length;
  for (let k = 0; k < LUT_SIZE; k++) {
    const pos = (k / LUT_SIZE) * n;
    const seg = Math.floor(pos);
    const f = sm(pos - seg);
    const a = rgb[seg % n], b = rgb[(seg + 1) % n];
    for (let c = 0; c < 3; c++) {
      out[k * 3 + c] = Math.sqrt(a[c] * a[c] * (1 - f) + b[c] * b[c] * f);
    }
  }
}

const lutFrom = new Uint8ClampedArray(LUT_SIZE * 3);
const lutTo = new Uint8ClampedArray(LUT_SIZE * 3);
const lutMix = new Float32Array(LUT_SIZE * 3);
fillLUT(lutFrom, defaultRGB);
fillLUT(lutTo, defaultRGB);
let lut = lutTo;            // the table the renderer reads this frame
let lutT = 1;               // crossfade progress
let lutDur = CFG.colorIn;
let paletteKey = null;      // null = default palette
let paletteLocked = false;  // true while the open stack carries its own palette
let fieldSeed = seedOf(null), fieldSeedTo = fieldSeed;

/* Fill-string cache: 512 palette slots x 64 brightness levels. An entry is
   valid while its stamp equals fillEpoch; bumping the epoch invalidates all. */
const FILL_SLOTS = LUT_SIZE * 64;
const fillCache = new Array(FILL_SLOTS).fill("");
const fillStamp = new Uint32Array(FILL_SLOTS);
let fillEpoch = 1;

/* Bake what is on screen into lutFrom, so a new fade always starts from
   exactly the visible colours (interruptions stay continuous). */
function snapshotLUT() {
  const u = sm(lutT);
  for (let k = 0; k < lutFrom.length; k++) lutFrom[k] = lutFrom[k] + (lutTo[k] - lutFrom[k]) * u;
}

function applyPalette(key, lock, duration) {
  const known = key && palettes[key] ? key : null;
  // A page that names the default palette looks exactly like home: no fade.
  const next = known === defaultPaletteKey ? null : known;
  if (lock) paletteLocked = !!known;
  if (next === paletteKey) {
    syncActiveLinks();
    return;
  }
  paletteKey = next;
  lutDur = duration || CFG.colorIn;
  snapshotLUT();
  fillLUT(lutTo, next ? palettes[next].rgb : defaultRGB);
  lutT = 0;
  fieldSeedTo = seedOf(next);
  fillEpoch++;
  syncActiveLinks();
}

function snapPalette() {
  lutFrom.set(lutTo);
  lutT = 1;
  lut = lutTo;
  fieldSeed = fieldSeedTo;
  fillEpoch++;
}

function stepPalette(dt) {
  if (lutT < 1) {
    lutT = Math.min(1, lutT + dt / (reducedMotion ? 0.01 : lutDur));
    fillEpoch++;
    if (lutT < 1) {
      const u = sm(lutT);
      for (let k = 0; k < lutMix.length; k++) lutMix[k] = lutFrom[k] + (lutTo[k] - lutFrom[k]) * u;
      lut = lutMix;
    } else {
      lut = lutTo;
    }
  }
  // The brightness pattern slides to the palette's own offset; it churns
  // visibly while it moves (0.4s to 3.5s depending on the distance).
  const delta = fieldSeedTo - fieldSeed;
  const step = (reducedMotion ? 1000 : CFG.seedRate) * dt;
  fieldSeed = Math.abs(delta) <= step ? fieldSeedTo : fieldSeed + Math.sign(delta) * step;
}

/* ======================================================================
   4. Routes and content model
   ====================================================================== */

const FILE_MODE = location.protocol === "file:";

/* The folder the site is served from: "/" at the root of a domain, or e.g.
   "/portfolio/" (the <base href> at the top of index.html, which its inline
   script tidies and shares as window.SITE_BASE). Pages keep
   their own paths ("/", "/work/x"); their addresses are that folder plus the
   path ("/portfolio/", "/portfolio/work/x"). Served from outside the folder
   (the setting no longer matches the host), the root is used, exactly as
   index.html does for the assets. Opened from disk, pages use hash routes and
   the folder only matters for recognising addresses written with it. */
function normalizeBase(raw) {
  let base = typeof raw === "string" ? raw.trim() : "";
  // A full address pasted by mistake ("https://you.github.io/portfolio/"): keep its path.
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(base)) base = base.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*/i, "");
  return ("/" + base + "/").replace(/\/{2,}/g, "/");
}
const BASE_PATH = (() => {
  const base = normalizeBase(window.SITE_BASE);
  return FILE_MODE || (location.pathname + "/").indexOf(base) === 0 ? base : "/";
})();

/* "/portfolio/work/x" -> "/work/x" ("/portfolio" alone is the home page);
   null for an address outside the site's folder. */
function stripBase(pathname) {
  const p = String(pathname || "/");
  if (BASE_PATH === "/") return p;
  if (p === BASE_PATH.slice(0, -1)) return "/";
  return p.indexOf(BASE_PATH) === 0 ? p.slice(BASE_PATH.length - 1) : null;
}

/* A page path's address: "/work/x" -> "/portfolio/work/x". Always absolute,
   since a relative one would resolve against index.html's <base>. */
function addressFor(path) {
  return BASE_PATH + String(path || "/").replace(/^\/+/, "");
}

const ASSET_BASE = (() => {
  try {
    return FILE_MODE ? new URL("../", SCRIPT_SRC || location.href).href : location.origin + BASE_PATH;
  } catch (_) { return BASE_PATH; }
})();
function assetURL(rel) {
  try { return new URL(rel, ASSET_BASE).href; } catch (_) { return BASE_PATH + rel; }
}

/* Addresses written in content.js that start with "/" ("/assets/photo.jpg",
   "/assets/soundtrack.mp3") are relative to the site's folder, so the same
   content works at a domain's root, in a sub-folder and from disk. One that
   already starts with the folder is left alone. */
function siteHref(value) {
  const pathPart = String(value).split(/[?#]/)[0];
  const inner = stripBase(pathPart);
  const rest = (inner == null ? String(value) : inner + String(value).slice(pathPart.length)).replace(/^\/+/, "");
  return FILE_MODE ? assetURL(rest) : BASE_PATH + rest;
}

const str = v => (typeof v === "string" ? v : "");
const txt = v => str(v).trim();
const listOf = v => (Array.isArray(v) ? v : []);

function slugify(value) {
  const slug = txt(String(value == null ? "" : value)).toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "page";
}

function normalizePath(path) {
  let out = String(path || "/").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (out[0] !== "/") out = "/" + out;
  out = out.replace(/\/(?:index|404)\.html?$/i, "/");
  if (out.length > 1) out = out.replace(/\/+$/, "");
  return out || "/";
}

/* Link targets: clean addresses over http(s), hash routes when opened from disk. */
function hrefFor(path) {
  return FILE_MODE ? "#" + path : addressFor(path);
}

/* The page a root-relative address names, if any: "/projects", or the same
   written with the site's folder ("/portfolio/projects"). */
function pageAt(pathname) {
  const direct = pageById[normalizePath(pathname)];
  if (direct) return direct;
  const inner = stripBase(pathname);
  return inner == null ? null : pageById[normalizePath(inner)] || null;
}

/* Plain text from Markdown, for descriptions. */
function plainText(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, "")
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, " ")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function firstSentence(md) {
  const text = plainText(md);
  if (!text) return "";
  const m = /^(.+?[.!?])(?=\s|$)/.exec(text);
  let out = m ? m[1] : text;
  if (out.length > 200) out = out.slice(0, 197).replace(/\s+\S*$/, "") + "…";
  return out;
}

const siteName = txt(SITE.name) || "Your Name";
// Shown in the sidebar instead of the bio when content.js failed to load.
const CONTENT_ERROR = "content.js failed to load, so there is nothing to show yet. Open the browser " +
  "console to see why. The usual cause is a backtick or ${ inside a page body: write `` \\` `` and `\\${` there instead.";
const bio = contentMissing ? CONTENT_ERROR : str(SITE.bio);
const siteDescription = txt(SITE.description) || (contentMissing ? "" : plainText(bio)) || siteName;
const siteURL = txt(SITE.url).replace(/\/+$/, "");
const email = txt(SITE.email);

/* Every page: { id (= its path), path, title, parent, palette, description, blocks }.
   Blocks are { kind: "markdown", markdown } or { kind: "nav", label, links }. */
const pageById = Object.create(null);
const pageList = [];
function addPage(page) {
  if (pageById[page.id]) {
    warn(`Two pages share the address ${page.path}; keeping the first.`);
    return null;
  }
  pageById[page.id] = page;
  pageList.push(page);
  return page;
}

function resolvePagePalette(value, path) {
  if (typeof value === "string" && value.trim()) {
    const key = value.trim();
    if (palettes[key]) return key;
    warn(`Unknown palette "${key}" on ${path}; using the default.`);
    return null;
  }
  if (Array.isArray(value) || (value && typeof value === "object")) return definePalette("page:" + path, value);
  return null;
}

function makeContentPage(item, path, parent, fallbackTitle) {
  return addPage({
    id: path,
    path,
    title: txt(item.title) || fallbackTitle,
    parent,
    palette: resolvePagePalette(item.palette, path),
    description: txt(item.description) || firstSentence(item.body) || siteDescription,
    blocks: [{ kind: "markdown", markdown: str(item.body) }]
  });
}

const home = addPage({
  id: "/", path: "/", title: siteName, parent: null, palette: null,
  description: siteDescription, blocks: []
});

const workPages = [];
listOf(SITE.work).forEach((item, n) => {
  if (!item || typeof item !== "object") return;
  const title = txt(item.title) || "Untitled " + (n + 1);
  const page = makeContentPage(item, "/work/" + slugify(item.slug || title), "/", title);
  if (page) workPages.push(page);
});

const groupDefs = [];
if (listOf(SITE.projects).length) {
  groupDefs.push({
    title: txt(SITE.projectsTitle) || "Projects",
    slug: "projects",
    intro: SITE.projectsIntro,
    palette: SITE.projectsPalette,
    description: SITE.projectsDescription,
    items: SITE.projects
  });
}
listOf(SITE.groups).forEach(g => { if (g && typeof g === "object") groupDefs.push(g); });

const groupPages = [];
groupDefs.forEach(group => {
  const title = txt(group.title) || "More";
  const path = "/" + slugify(group.slug || title);
  const page = addPage({
    id: path, path, title, parent: "/",
    palette: resolvePagePalette(group.palette, path),
    description: txt(group.description) || firstSentence(group.intro) || `${title} by ${siteName}.`,
    blocks: []
  });
  if (!page) return;
  const links = [];
  listOf(group.items).forEach((item, n) => {
    if (!item || typeof item !== "object") return;
    const itemTitle = txt(item.title) || "Untitled " + (n + 1);
    if (txt(item.url) && !str(item.body).trim()) {
      links.push({ label: itemTitle, url: txt(item.url) });
      return;
    }
    const child = makeContentPage(item, path + "/" + slugify(item.slug || itemTitle), path, itemTitle);
    if (child) links.push({ label: child.title, page: child.id });
  });
  if (str(group.intro).trim()) page.blocks.push({ kind: "markdown", markdown: str(group.intro) });
  page.blocks.push({ kind: "nav", label: title, links });
  groupPages.push(page);
});

const socialLinks = listOf(SITE.social)
  .filter(s => s && txt(s.label) && txt(s.url))
  .map(s => ({ label: txt(s.label), url: txt(s.url) }));

if (bio.trim()) home.blocks.push({ kind: "markdown", markdown: bio });
if (workPages.length) {
  home.blocks.push({ kind: "nav", label: txt(SITE.workTitle) || "Work", links: workPages.map(p => ({ label: p.title, page: p.id })) });
}
if (groupPages.length) {
  home.blocks.push({ kind: "nav", label: "More", links: groupPages.map(p => ({ label: p.title, page: p.id })) });
}
if (socialLinks.length || email) {
  home.blocks.push({ kind: "nav", region: "bottom", label: "Elsewhere", links: socialLinks });
}

/* The Manifesto (content.js `manifesto`): the first link under the bio. It
   opens a full-screen overlay at /manifesto instead of a pane, over whatever
   stack is open, and its code, styles, text and fonts load on first open
   (section 12b). `manifesto: false`, or leaving it out, removes it. */
const MANIFESTO_PATH = "/manifesto";
const MANIFESTO_TERMINAL = ["> SUBJECT: EXISTING PERSON", "> PROCEDURE: PROGRESSIVE INCORPORATION", "> CONTINUITY: UNVERIFIED"];

/* A media address from content.js: "/..." is relative to the site's folder. */
function mediaHref(value) {
  const v = txt(value);
  if (!v) return "";
  if (v[0] === "/" && v[1] !== "/") return siteHref(v);
  try { return new URL(v, doc.baseURI || location.href).href; } catch (_) { return ""; }
}

function readManifestoConfig(raw) {
  if (!raw) return null;
  const cfg = typeof raw === "object" ? raw : {};
  const card = cfg.titleCard && typeof cfg.titleCard === "object" ? cfg.titleCard : {};
  const lines = v => listOf(v).map(txt).filter(Boolean);
  const series = lines(card.series);
  return {
    label: txt(cfg.label) || "Manifesto",
    image: mediaHref(cfg.image),
    terminal: Array.isArray(cfg.terminal) ? lines(cfg.terminal) : MANIFESTO_TERMINAL.slice(),
    titleCard: {
      series: series.length ? series : ["THE", "JEWEL"],
      label: typeof card.label === "string" ? card.label.trim() : "MANIFESTO:",
      episode: typeof card.episode === "string" ? card.episode.trim() : "The Continuity of a Person."
    }
  };
}

const manifestoConfig = readManifestoConfig(SITE.manifesto);
// Not a pane: it never enters pageById, so stacks and panes ignore it.
const manifestoPage = manifestoConfig ? {
  id: MANIFESTO_PATH, path: MANIFESTO_PATH, title: manifestoConfig.label,
  description: `${manifestoConfig.label} by ${siteName}.`
} : null;
if (manifestoPage) {
  if (pageById[MANIFESTO_PATH]) warn(`A page already lives at ${MANIFESTO_PATH}; the Manifesto takes that address.`);
  const link = { label: manifestoConfig.label, manifesto: true };
  const firstNav = home.blocks.find(b => b.kind === "nav" && b.region !== "bottom");
  if (firstNav) firstNav.links.unshift(link);
  else home.blocks.splice(bio.trim() ? 1 : 0, 0, { kind: "nav", label: "More", links: [link] });
}

/* "/manifesto", or the same written with the site's folder. */
function isManifestoPath(pathname) {
  if (!manifestoPage) return false;
  const p = String(pathname || "");
  if (normalizePath(p) === MANIFESTO_PATH) return true;
  const inner = stripBase(p);
  return inner != null && normalizePath(inner) === MANIFESTO_PATH;
}

function primaryChainFor(page) {
  const chain = [];
  const seen = new Set();
  let cursor = page || home;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor.id);
    cursor = cursor.parent ? pageById[cursor.parent] : null;
  }
  if (chain[0] !== home.id) chain.unshift(home.id);
  return chain;
}

/* Keep ids in order up to the first unknown or repeated one; always rooted at home. */
function validStack(ids) {
  const out = [];
  const seen = new Set();
  for (const id of listOf(ids)) {
    if (!pageById[id] || seen.has(id)) break;
    seen.add(id);
    out.push(id);
  }
  if (out[0] !== home.id) out.unshift(home.id);
  return out;
}

function commonPrefix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/* The deepest page in the stack that declares a palette wins. */
function paletteForStack(ids) {
  for (let k = ids.length - 1; k >= 0; k--) {
    const page = pageById[ids[k]];
    if (page && page.palette && palettes[page.palette]) return page.palette;
  }
  return null;
}

/* ======================================================================
   5. Markdown (safe: text is only ever set through text nodes)
   ====================================================================== */

const RE_BLANK = /^\s*$/;
const RE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
// A closing run of #s only counts after a space, so "I love C#" keeps its #.
const RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const RE_QUOTE = /^ {0,3}> ?/;
const RE_UL = /^( *)([-*+])[ \t]+(.*)$/;
const RE_OL = /^( *)(\d{1,9})([.)])[ \t]+(.*)$/;
const ESCAPABLE = "\\`*_{}[]()#+-.!>~|";

function el(tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function dedent(source) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  while (lines.length && RE_BLANK.test(lines[0])) lines.shift();
  while (lines.length && RE_BLANK.test(lines[lines.length - 1])) lines.pop();
  let min = Infinity;
  for (const line of lines) {
    if (!RE_BLANK.test(line)) min = Math.min(min, /^ */.exec(line)[0].length);
  }
  return min > 0 && min !== Infinity ? lines.map(line => line.slice(min)) : lines;
}

function renderMarkdown(source) {
  const frag = doc.createDocumentFragment();
  renderBlocks(dedent(source), frag);
  return frag;
}

function startsBlock(line) {
  if (RE_FENCE.test(line) || RE_HEADING.test(line) || RE_HR.test(line) || RE_QUOTE.test(line) || RE_UL.test(line)) return true;
  const ol = RE_OL.exec(line);
  return !!ol && ol[2] === "1";
}

function isFenceClose(line, fence) {
  const t = line.trim();
  if (t.length < fence.length) return false;
  for (let k = 0; k < t.length; k++) if (t[k] !== fence[0]) return false;
  return true;
}

function renderBlocks(lines, parent) {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (RE_BLANK.test(line)) { i++; continue; }
    let m = RE_FENCE.exec(line);
    if (m) {
      const fence = m[1];
      const code = [];
      i++;
      while (i < lines.length && !isFenceClose(lines[i], fence)) code.push(lines[i++]);
      i++;
      const pre = el("pre");
      pre.appendChild(el("code", null, code.join("\n")));
      parent.appendChild(pre);
      continue;
    }
    if (RE_HR.test(line)) { parent.appendChild(el("hr")); i++; continue; }
    m = RE_HEADING.exec(line);
    if (m) {
      const heading = el("h" + m[1].length);
      renderInline(m[2] || "", heading);
      parent.appendChild(heading);
      i++;
      continue;
    }
    if (RE_QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && !RE_BLANK.test(lines[i])) inner.push(lines[i++].replace(RE_QUOTE, ""));
      const quote = el("blockquote");
      renderBlocks(inner, quote);
      parent.appendChild(quote);
      continue;
    }
    if (RE_UL.test(line) || RE_OL.test(line)) { i = renderList(lines, i, parent); continue; }
    const para = [line.replace(/^\s+/, "")];
    i++;
    while (i < lines.length && !RE_BLANK.test(lines[i]) && !startsBlock(lines[i])) para.push(lines[i++].replace(/^\s+/, ""));
    const p = el("p");
    renderInline(para.join("\n"), p);
    parent.appendChild(p);
  }
}

function renderList(lines, i, parent) {
  const ordered = !RE_UL.test(lines[i]);
  const itemRE = ordered ? RE_OL : RE_UL;
  const head = itemRE.exec(lines[i]);
  const indent = head[1].length;
  const listEl = el(ordered ? "ol" : "ul");
  if (ordered && head[2] !== "1") listEl.setAttribute("start", String(parseInt(head[2], 10)));
  while (i < lines.length) {
    const m = itemRE.exec(lines[i]);
    if (!m || m[1].length < indent || m[1].length > indent + 1) break;
    const body = [ordered ? m[4] : m[3]];
    const contentIndent = m[1].length + m[2].length + (ordered ? 2 : 1);
    let loose = false, blank = false;
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (RE_BLANK.test(next)) { blank = true; body.push(""); i++; continue; }
      const lead = /^ */.exec(next)[0].length;
      if (lead >= contentIndent || lead > indent + 1) {
        if (blank) loose = true;
        blank = false;
        body.push(next.slice(Math.min(lead, contentIndent)));
        i++;
        continue;
      }
      if (blank || itemRE.test(next) || startsBlock(next)) break;
      body.push(next.trim());
      i++;
    }
    while (body.length && RE_BLANK.test(body[body.length - 1])) body.pop();
    const li = el("li");
    renderBlocks(body, li);
    if (!loose) {
      // Tight lists: no paragraph margins inside items.
      for (const child of Array.from(li.children)) {
        if (child.tagName === "P") {
          while (child.firstChild) li.insertBefore(child.firstChild, child);
          child.remove();
        }
      }
    }
    listEl.appendChild(li);
    // A blank line followed by another item continues the same list.
    while (i < lines.length && RE_BLANK.test(lines[i]) && i + 1 < lines.length && itemRE.test(lines[i + 1])) i++;
  }
  parent.appendChild(listEl);
  return i;
}

function renderInline(source, parent) {
  const s = String(source);
  let buf = "";
  const flush = () => {
    if (buf) { parent.appendChild(doc.createTextNode(buf)); buf = ""; }
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      const next = s[i + 1];
      if (next === "\n") { flush(); parent.appendChild(el("br")); i += 2; continue; }
      if (next && ESCAPABLE.indexOf(next) >= 0) { buf += next; i += 2; continue; }
    }
    if (ch === "\n") {
      if (/ {2,}$/.test(buf)) {
        buf = buf.replace(/ +$/, "");
        flush();
        parent.appendChild(el("br"));
      } else {
        buf += " ";
      }
      i++;
      continue;
    }
    if (ch === "`") {
      let ticks = 1;
      while (s[i + ticks] === "`") ticks++;
      const marker = s.slice(i, i + ticks);
      const end = s.indexOf(marker, i + ticks);
      if (end > -1) {
        flush();
        parent.appendChild(el("code", null, s.slice(i + ticks, end).replace(/^ (.+) $/, "$1")));
        i = end + ticks;
        continue;
      }
      buf += marker;
      i += ticks;
      continue;
    }
    if (ch === "!" && s[i + 1] === "[") {
      const link = parseLinkAt(s, i + 1);
      if (link) {
        const img = makeImage(link);
        if (img) { flush(); parent.appendChild(img); } else buf += link.label;
        i = link.end;
        continue;
      }
    }
    if (ch === "[") {
      const link = parseLinkAt(s, i);
      if (link) {
        flush();
        parent.appendChild(makeLink(link));
        i = link.end;
        continue;
      }
    }
    if (ch === "<") {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/.exec(s.slice(i));
      if (m) {
        flush();
        parent.appendChild(makeLink({ label: m[1].replace(/^mailto:/, ""), url: m[1], title: "" }));
        i += m[0].length;
        continue;
      }
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const span = parseEmphasisAt(s, i);
      if (span) {
        flush();
        const node = el(span.tag);
        renderInline(span.inner, node);
        parent.appendChild(node);
        i = span.end;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
}

/* Emphasis starting at s[i]. `size` forces how many of an opening run of
   three this span uses (1 or 2); the rest is left for an inner span. */
function parseEmphasisAt(s, i, size) {
  const ch = s[i];
  let run = 1;
  while (s[i + run] === ch) run++;
  if (ch === "~" ? run !== 2 : run > 3) return null;
  if (i + run >= s.length || /\s/.test(s[i + run])) return null;
  if (ch === "_" && i > 0 && /[A-Za-z0-9]/.test(s[i - 1])) return null;
  const n = size || run;
  const open = i + n;
  const marker = ch.repeat(n);
  let from = i + run;
  for (;;) {
    const k = s.indexOf(marker, from);
    if (k < 0) break;
    let after = k + n;
    let closeRun = n;
    while (s[after] === ch) { after++; closeRun++; }
    const fits = closeRun === n || (ch !== "~" && closeRun === 3);
    const ok = fits && !/\s/.test(s[k - 1]) && s[k - 1] !== ch &&
      !(ch === "_" && /[A-Za-z0-9]/.test(s[after] || ""));
    if (ok) {
      // A closing run of three can close a shorter span too. If a span opened
      // inside this one, the run's first characters close that and its last
      // ones close this: "*a **b***" is <em>a <strong>b</strong></em>.
      let close = k;
      if (closeRun !== n && s.slice(open, k).indexOf(ch.repeat(3 - n)) >= 0) close = after - n;
      const inner = s.slice(open, close), end = close + n;
      if (ch === "~") return { tag: "del", inner, end };
      if (n === 3) return { tag: "strong", inner: ch + inner + ch, end };
      return { tag: n === 2 ? "strong" : "em", inner, end };
    }
    from = after;
  }
  // An opening run of three with no closing run of three: the first shorter
  // closer belongs to the inner span, so the outer one is the other size.
  // "***a** b*" is <em><strong>a</strong> b</em>.
  if (!size && run === 3) {
    for (let k = i + run; k < s.length; k++) {
      if (s[k] !== ch || s[k - 1] === ch || /\s/.test(s[k - 1])) continue;
      let c = 1;
      while (s[k + c] === ch) c++;
      if (c < 3) return parseEmphasisAt(s, i, 3 - c);
      k += c - 1;
    }
  }
  return null;
}

function parseLinkAt(s, i) {
  let depth = 0, k = i;
  for (; k < s.length; k++) {
    const c = s[k];
    if (c === "\\") { k++; continue; }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  if (k >= s.length || s[k + 1] !== "(") return null;
  const label = s.slice(i + 1, k);
  let parens = 1, e = k + 2;
  for (; e < s.length; e++) {
    const c = s[e];
    if (c === "\\") { e++; continue; }
    if (c === "(") parens++;
    else if (c === ")" && --parens === 0) break;
  }
  if (e >= s.length) return null;
  let url = s.slice(k + 2, e).trim();
  let title = "";
  const t = /^(\S+)\s+["'](.*)["']$/.exec(url);
  if (t) { url = t[1]; title = t[2]; }
  if (url[0] === "<" && url[url.length - 1] === ">") url = url.slice(1, -1);
  // Backslash escapes in the address and title: "\)" is a plain ")".
  const unescape = v => v.replace(/\\([!-\/:-@\[-`{-~])/g, "$1");
  return { label, url: unescape(url), title: unescape(title), end: e + 1 };
}

/* Classify a link: an internal page (opened as a pane), or a safe URL. */
function resolveLink(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  // Same-page "#fragment" links have nothing to land on (headings carry no
  // ids), and following one would disturb the router's history entries.
  if (value[0] === "#") return null;
  // "/projects", "/assets/cv.pdf": relative to the site's folder (see siteHref).
  if (/^\/(?!\/)/.test(value)) {
    if (isManifestoPath(value.split(/[?#]/)[0])) return { href: hrefFor(MANIFESTO_PATH), manifesto: true };
    const page = pageAt(value.split(/[?#]/)[0]);
    if (page) return { href: hrefFor(page.path), page };
    return { href: siteHref(value), external: false };
  }
  let url;
  try { url = new URL(value, doc.baseURI || location.href); } catch (_) { return null; }
  // Opened from disk, a relative address ("projects", "assets/cv.pdf") lands
  // on a file: URL inside the site's folder; read it like "/projects".
  if (FILE_MODE && url.protocol === "file:" && url.href.indexOf(ASSET_BASE) === 0 &&
      !/^[a-z][a-z\d+.-]*:/i.test(value)) {
    return resolveLink("/" + url.href.slice(ASSET_BASE.length).replace(/^\/+/, ""));
  }
  if (!/^(?:https?|mailto|tel):$/.test(url.protocol)) return null;
  const web = url.protocol === "http:" || url.protocol === "https:";
  // Same host but outside the site's folder (another project site on
  // you.github.io) is another site: it opens in a new tab like any other.
  const inSite = web && url.host === location.host && stripBase(url.pathname) != null;
  if (inSite) {
    if (isManifestoPath(url.pathname) && !url.search) return { href: hrefFor(MANIFESTO_PATH), manifesto: true };
    const page = pageById[normalizePath(stripBase(url.pathname))];
    if (page && !url.search) return { href: hrefFor(page.path), page };
  }
  return { href: url.href, external: web && !inSite };
}

function makeLink(link) {
  const a = el("a", "text-link");
  renderInline(link.label, a);
  const target = resolveLink(link.url);
  if (target) {
    a.href = target.href;
    if (target.page) a.dataset.route = target.page.id;
    else if (target.manifesto) a.dataset.manifesto = "true";
    else if (target.external) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }
  if (link.title) a.title = link.title;
  return a;
}

function makeImage(link) {
  const value = String(link.url || "").trim();
  if (!value) return null;
  let url;
  try {
    url = value[0] === "/" && value[1] !== "/"
      ? new URL(siteHref(value), location.href)
      : new URL(value, doc.baseURI || location.href);
  } catch (_) { return null; }
  if (!/^https?:$/.test(url.protocol) && !(FILE_MODE && url.protocol === "file:")) return null;
  const img = el("img");
  img.alt = plainText(link.label);
  img.src = url.href;
  img.loading = "lazy";
  img.decoding = "async";
  if (link.title) img.title = link.title;
  return img;
}

/* ======================================================================
   6. Page DOM
   ====================================================================== */

const CLOSE_SVG = '<svg viewBox="0 0 12 12" focusable="false"><path d="M4 4L8 8M8 4L4 8"/></svg>';
const SPEAKER = "M3.5 9.75h4.25L13 5.75v12.5l-5.25-4H3.5z";
const SOUND_SVG =
  '<svg class="sound-icon sound-icon-on" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="' + SPEAKER + '"/><path d="M16.25 9.4a4.2 4.2 0 0 1 0 5.2"/><path d="M18.9 6.9a8 8 0 0 1 0 10.2"/></svg>' +
  '<svg class="sound-icon sound-icon-off" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="' + SPEAKER + '"/><path d="M17 10l4 4M21 10l-4 4"/></svg>';

function makeCloseIcon() {
  const icon = el("span", "close-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = CLOSE_SVG;
  return icon;
}

function renderNav(block, depth) {
  const nav = el("nav", "work-list");
  nav.setAttribute("aria-label", block.label || "Links");
  for (const item of block.links) {
    const a = el("a");
    const page = item.page ? pageById[item.page] : null;
    if (item.manifesto) {
      a.href = hrefFor(MANIFESTO_PATH);
      a.dataset.manifesto = "true";
      a.setAttribute("aria-haspopup", "dialog");
    } else if (page) {
      a.href = hrefFor(page.path);
      a.dataset.pageId = page.id;
      a.dataset.sourceDepth = String(depth);
    } else {
      const target = resolveLink(item.url);
      if (!target) continue;
      a.href = target.href;
      if (target.manifesto) a.dataset.manifesto = "true";
      else if (target.page) {
        a.dataset.pageId = target.page.id;
        a.dataset.sourceDepth = String(depth);
      } else if (target.external) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    }
    a.appendChild(el("span", "link-label", item.label || (page && page.title) || a.href));
    nav.appendChild(a);
  }
  return nav;
}

/* Pane titles get a close control (shown only when the stack is clipped). */
function appendPaneClose(heading, depth) {
  const label = heading.textContent;
  const wrap = el("span", "title-label", label);
  const parent = pageById[mountedIds[depth - 1]] || home;
  const close = el("a", "pane-close");
  close.href = hrefFor(parent.path);
  close.dataset.closeDepth = String(depth);
  close.setAttribute("aria-label", "Close " + label);
  close.appendChild(makeCloseIcon());
  wrap.appendChild(close);
  heading.textContent = "";
  heading.appendChild(wrap);
}

function renderPage(page, depth) {
  const article = el("article", "pane editorial pane-layout");
  if (depth === 0) article.id = "about";
  article.dataset.pageId = page.id;
  article.dataset.depth = String(depth);

  const heading = el(depth === 0 ? "h1" : "h2", "name", page.title);
  if (depth > 0) heading.tabIndex = -1;
  article.appendChild(heading);

  const mainEl = el("div", "page-main");
  const bottom = el("div", "pane-bottom page-bottom");
  let bottomNav = null;
  for (const block of page.blocks) {
    let node;
    if (block.kind === "nav") node = renderNav(block, depth);
    else {
      node = el("div", "markdown-block");
      node.appendChild(renderMarkdown(block.markdown));
    }
    if (block.region === "bottom") {
      bottom.appendChild(node);
      if (block.kind === "nav") bottomNav = node;
    } else {
      mainEl.appendChild(node);
    }
  }
  article.appendChild(mainEl);

  if (depth === 0 && email) {
    const button = el("button", "email-copy", "Email");
    button.type = "button";
    button.setAttribute("aria-label", "Copy email address");
    button.setAttribute("aria-live", "polite");
    if (!bottomNav) {
      bottomNav = el("nav", "work-list");
      bottomNav.setAttribute("aria-label", "Contact");
      bottom.appendChild(bottomNav);
    }
    bottomNav.appendChild(button);
  }
  if (bottom.childElementCount) article.appendChild(bottom);

  if (depth > 0) appendPaneClose(heading, depth);
  if (depth === 0 && soundEnabled) {
    const button = el("button", "sound-toggle");
    button.type = "button";
    button.id = "sound-toggle";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", "Sound");
    button.title = "Turn sound on";
    button.innerHTML = SOUND_SVG;
    article.appendChild(button);
  }
  return article;
}

/* A link is "on" while the page it opens is showing in the next pane. The
   dot appears at once; it leaves the moment a close is requested. Screen
   readers hear the same thing the dot says: activating it closes the page.
   Only the deepest open page is the "current page"; links to the pages
   around it are marked as part of the current path. */
function syncActiveLinks() {
  let deepest = 0;
  for (let d = 1; d < paneStates.length; d++) {
    if (paneStates[d] && paneStates[d].intentOpen !== false) deepest = d;
  }
  const links = doc.querySelectorAll("a[data-page-id]");
  for (let k = 0; k < links.length; k++) {
    const a = links[k];
    const src = Math.max(0, Number(a.dataset.sourceDepth) || 0);
    const state = paneStates[src + 1];
    const active = mountedIds[src + 1] === a.dataset.pageId && !!state && state.intentOpen !== false;
    const icon = a.querySelector(":scope > .close-icon");
    if (active && !icon) a.appendChild(makeCloseIcon());
    else if (!active && icon) icon.remove();
    a.classList.toggle("is-on", active);
    if (active) {
      const label = a.querySelector(".link-label");
      a.setAttribute("aria-current", src + 1 === deepest ? "page" : "true");
      a.setAttribute("aria-label", "Close " + (label ? label.textContent : a.textContent));
    } else {
      a.removeAttribute("aria-current");
      a.removeAttribute("aria-label");
    }
  }
}

/* ======================================================================
   7. Pane mask and waves
   ====================================================================== */

let cellOpen = new Uint8Array(0);    // 1 = cell cleared, page shows through
let cellEvent = new Uint32Array(0);  // id of the last wave or mark that wrote the cell
let eventSeq = 0;                    // one counter for waves and marks: newer always wins
const waves = [];
let maskCols = 0, maskRows = 0, maskHome = 0, maskPane = 0, maskDepth = -1;

function bandOf(start, end) {
  const first = Math.max(1, start);
  const last = Math.max(first, end);
  return { left: homeRight + (first - 1) * paneCols, right: homeRight + last * paneCols };
}

function setIntent(start, end, open) {
  for (let d = start; d <= end; d++) if (paneStates[d]) paneStates[d].intentOpen = open;
}

function markBand(start, end, open) {
  const { left, right } = bandOf(start, end);
  const value = open ? 1 : 0;
  const id = ++eventSeq;
  const hi = Math.min(right, cols - 1);
  for (let j = 1; j < rows - 1; j++) {
    const row = j * cols;
    for (let i = left; i < hi; i++) {
      cellOpen[row + i] = value;
      cellEvent[row + i] = id;
    }
  }
}

function overlaps(a0, a1, b0, b1) {
  return a0 <= b1 && b0 <= a1;
}

/* How far a wave's front has travelled past the end of its band (0 while
   it is still crossing it). */
function waveBeyond(w) {
  return w.dir > 0 ? Math.max(0, w.x - (w.right - 1 + LEAD)) : Math.max(0, w.left - LEAD - w.x);
}

/* Hand depths start..end over to a new owner. A wave entirely inside the
   range goes, and so does one whose front has already finished its band.
   A wave still crossing depths outside the range keeps running over those
   depths only, so a pane that stays open (or closed) still finishes. */
function retireWaves(start, end) {
  for (let k = waves.length - 1; k >= 0; k--) {
    const w = waves[k];
    if (!overlaps(start, end, w.start, w.end)) continue;
    const before = w.start < start, after = w.end > end;
    if ((!before && !after) || waveBeyond(w) > 0) {
      waves.splice(k, 1);
      continue;
    }
    if (before) {
      // Settle anything past the range at once, then keep the part before it.
      if (after) markBand(end + 1, w.end, w.open);
      w.end = start - 1;
    } else {
      w.start = end + 1;
    }
    const band = bandOf(w.start, w.end);
    w.left = band.left;
    w.right = band.right;
  }
}

function settleBand(start, end, open) {
  retireWaves(start, end);
  markBand(start, end, open);
  setIntent(start, end, open);
}

function bandIs(open, start, end) {
  if (start < 1 || end < start) return true;
  const left = homeRight + (start - 1) * paneCols;
  const hi = Math.min(homeRight + end * paneCols, cols - 1);
  const want = open ? 1 : 0;
  for (let j = 1; j < rows - 1; j++) {
    const row = j * cols;
    for (let i = left; i < hi; i++) if (cellOpen[row + i] !== want) return false;
  }
  return true;
}

/* Rebuild the mask whenever the grid changes (resize, or a pane mounting
   or unmounting changes the world width). Bands are resampled by relative
   position and waves keep their relative progress, so nothing jumps. */
function syncMask() {
  const depth = mountedDepth();
  if (maskDepth >= 0 && maskCols === cols && maskRows === rows && maskHome === homeRight &&
      maskPane === paneCols && maskDepth === depth) return;
  const had = maskDepth >= 0;
  const oldOpen = cellOpen, oldEvent = cellEvent;
  const oCols = maskCols, oRows = maskRows, oHome = maskHome, oPane = maskPane, oDepth = maskDepth;
  cellOpen = new Uint8Array(cols * rows);
  cellEvent = new Uint32Array(cols * rows);
  maskCols = cols; maskRows = rows; maskHome = homeRight; maskPane = paneCols; maskDepth = depth;

  if (!had) {
    waves.length = 0;
    for (let d = 1; d <= depth; d++) if (paneStates[d] && paneStates[d].intentOpen) markBand(d, d, true);
    return;
  }

  const count = Math.max(oDepth, depth);
  for (let d = 1; d <= count; d++) {
    const oLeft = oHome + (d - 1) * oPane;
    const nLeft = homeRight + (d - 1) * paneCols;
    for (let j = 1; j < rows - 1; j++) {
      const oj = Math.min(oRows - 2, j);
      if (oj < 1) continue;
      for (let n = 0; n < paneCols; n++) {
        const i = nLeft + n;
        if (i >= cols - 1) break;
        const oi = oLeft + Math.min(oPane - 1, Math.floor(((n + 0.5) / paneCols) * oPane));
        if (oi >= oCols - 1) continue;
        cellOpen[j * cols + i] = oldOpen[oj * oCols + oi];
        cellEvent[j * cols + i] = oldEvent[oj * oCols + oi];
      }
    }
  }

  for (const w of waves) {
    const oMin = w.left - LEAD, oMax = w.right - 1 + LEAD;
    const progress = oMax === oMin ? 0.5 : (w.x - oMin) / (oMax - oMin);
    const band = bandOf(w.start, w.end);
    w.left = band.left;
    w.right = band.right;
    w.x = band.left - LEAD + (band.right - band.left - 1 + 2 * LEAD) * progress;
    w.speed = waveSpeed();
  }
}

/* One physical tile speed for every wipe: (15 + 2.3) cols / 1.3s = 266px/s. */
function waveSpeed() {
  return (paneCols + 2 * LEAD) / CFG.revealIn;
}

/* Per-row front offset and crest width for this frame. */
function prepareWaveRows(w) {
  if (w.flow.length < rows) {
    w.flow = new Float32Array(rows);
    w.width = new Float32Array(rows);
  }
  const t = w.age, seed = w.seed, phase = w.phase;
  // Opens start 58% rough and roughen fully in 0.24s; closes start straight.
  const born = w.open ? 0.58 + 0.42 * sm(t / 0.24) : sm(t / 0.56);
  const breath = 0.82 + 0.18 * Math.sin(t * 1.9 + phase);
  const pulse = 0.65 * Math.sin(t * 1.6 + seed * 0.7);
  const flowAmp = 2 * CFG.flowCols * breath;
  const flow = w.flow, width = w.width;
  for (let j = 0; j < rows; j++) {
    flow[j] = ((fbm(j * 0.13 + seed, t * 0.22, 73.4 + seed) - 0.5) * flowAmp +
      1.05 * Math.sin(j * 0.21 + t * 1.35 + phase) +
      0.42 * Math.sin(j * 0.47 - t * 0.8 + seed * 0.37)) * born;
    const flex = (fbm(j * 0.15 + seed * 0.4, t * 0.18, 146.2 + seed) - 0.5) * 2 * CFG.flexCols +
      0.55 * Math.sin(j * 0.28 - t * 1.1 + phase);
    const wd = 1.5 + (CFG.glowCols - 1.5 + flex + pulse) * born;
    width[j] = wd > 1.5 ? wd : 1.5;
  }
}

/* Start a wipe over depths start..end. A reversal of a live wave on the same
   band (or a given predecessor) continues from its front with its shape and
   energy. Returns the nominal travel time (used to pace the camera). */
function emitWave(open, start, end, predecessor) {
  if (reducedMotion) {
    settleBand(start, end, open);
    return 0;
  }
  const band = bandOf(start, end);
  let from = predecessor || null;
  if (!from) {
    for (let k = waves.length - 1; k >= 0; k--) {
      const w = waves[k];
      if (w.start === start && w.end === end && w.open !== open && w.strength > 0.02) { from = w; break; }
    }
  }
  const minX = band.left - LEAD, maxX = band.right - 1 + LEAD;
  const x = from ? clamp(from.x, minX, maxX) : open ? minX : maxX;
  const speed = waveSpeed();
  const duration = Math.max(0.18, Math.abs((open ? maxX : minX) - x) / speed);
  retireWaves(start, end);
  const wave = {
    id: ++eventSeq,
    start, end, open,
    dir: open ? 1 : -1,
    left: band.left,
    right: band.right,
    x, speed,
    age: from ? from.age : 0,
    strength: from ? from.strength : open ? 1 : 0,
    seed: from ? from.seed : Math.random() * 1000,
    phase: from ? from.phase : Math.random() * TAU,
    flow: new Float32Array(Math.max(1, rows)),
    width: new Float32Array(Math.max(1, rows))
  };
  prepareWaveRows(wave);
  waves.push(wave);
  setIntent(start, end, open);
  return duration;
}

function emitCascadeClose(keep) {
  const start = keep + 1, end = mountedDepth();
  if (start > end) return 0;
  let predecessor = null;
  for (let k = waves.length - 1; k >= 0; k--) {
    const w = waves[k];
    if (!w.open && w.strength > 0.02 && overlaps(start, end, w.start, w.end)) { predecessor = w; break; }
  }
  closingRange = { start, end, keep };
  return emitWave(false, start, end, predecessor);
}

function updateWaves(dt) {
  for (let k = waves.length - 1; k >= 0; k--) {
    const w = waves[k];
    w.age += dt;
    w.x += w.dir * w.speed * dt;
    // The front keeps travelling after its band is done: its light carries
    // on into the wall and fades (1.8s tail for opens, 2.4s for closes).
    const beyond = waveBeyond(w);
    const finishAt = Math.max(LEAD + 2, w.speed * (w.open ? 1.8 : 2.4));
    const target = beyond > 0 ? Math.max(0, 1 - beyond / finishAt) : 1;
    w.strength += (target - w.strength) * (1 - Math.exp(-dt * (target > w.strength ? 8 : 1.6)));
    prepareWaveRows(w);

    const value = w.open ? 1 : 0;
    const hi = Math.min(w.right, cols - 1) - 1;
    for (let j = 1; j < rows - 1; j++) {
      const front = w.x + w.flow[j];
      const row = j * cols;
      // A cell flips once the row's front passes its integer column.
      const i0 = w.dir > 0 ? w.left : Math.max(w.left, Math.ceil(front));
      const i1 = w.dir > 0 ? Math.min(hi, Math.floor(front)) : hi;
      for (let i = i0; i <= i1; i++) {
        const c = row + i;
        if (w.id >= cellEvent[c]) {
          cellEvent[c] = w.id;
          cellOpen[c] = value;
        }
      }
    }
    if (beyond > finishAt && w.strength < 0.02) {
      waves.splice(k, 1);
      setupPending = true; // the world may shrink now
    }
  }
}

/* Crest light for a tile. Light stays in the wave's own band or spills
   right into the open wall; it never crosses other panes, and a closing
   crest never lights text that is still uncovered. */
function waveLight(i, j, paneDepth) {
  let glow = 0;
  for (let k = 0; k < waves.length; k++) {
    const w = waves[k];
    if (!(i >= w.left && i < w.right) && !(paneDepth === 0 && i >= w.right)) continue;
    if (!w.open && paneDepth && cellOpen[j * cols + i] === 1) continue;
    const width = w.width[j];
    const front = w.x + w.flow[j];
    const e = w.dir > 0 ? front - i : i - front;
    let amt = 0;
    if (e <= width * 1.8 && e >= -width * 1.8) {
      const q = e / width;
      amt = 0.85 * Math.exp(-2.2 * q * q) * w.strength;
    }
    if (!w.open && e > 0) {
      // A faint afterglow over the re-lit area, fading into the wall.
      const beyondEdge = i - (w.right - 1);
      amt += 0.11 * sm(clamp01(e / (width > 1 ? width : 1))) *
        Math.exp(-(beyondEdge > 0 ? beyondEdge : 0) / 12) * w.strength;
    }
    glow += amt;
  }
  return glow > 1.25 ? 1.25 : glow;
}

/* ======================================================================
   8. Switch band (sibling page swap at the deepest depth)
   ====================================================================== */

const BAND_PAD = CFG.bandRows / 2 + CFG.bandFlowRows + CFG.bandFlexRows + 2; // 12.2 rows

/* Band centre row: from fully above the pane to fully below it. */
function bandCenter(p) {
  return (1 - BAND_PAD) + ((rows - 2 + BAND_PAD) - (1 - BAND_PAD)) * p;
}

/* Trapezoid velocity: brief acceleration, a linear middle, brief stop. */
function glide(t) {
  const a = CFG.glide, v = 1 / (1 - a);
  if (t < a) return 0.5 * (v / a) * t * t;
  if (t <= 1 - a) return 0.5 * a * v + (t - a) * v;
  const q = 1 - t;
  return 1 - 0.5 * (v / a) * q * q;
}

/* Per-column centre and half-thickness of the wavy band for this frame. */
function prepareSwitchCols(tr, left, right) {
  if (tr.center.length < cols) {
    tr.center = new Float32Array(cols);
    tr.half = new Float32Array(cols);
  }
  const t = realT, seed = tr.seed, phase = tr.phase;
  const breath = 0.88 + 0.12 * Math.sin(t * 1.8 + phase);
  const base = bandCenter(tr.vis);
  const minHalf = CFG.bandMinRows * 0.5;
  const hi = Math.min(right, cols);
  for (let i = left; i < hi; i++) {
    tr.center[i] = base +
      (fbm(i * 0.13 + seed, t * 0.2, 91.7 + seed) - 0.5) * 2 * CFG.bandFlowRows * breath +
      1.05 * Math.sin(i * 0.21 + t * 1.25 + phase) +
      0.4 * Math.sin(i * 0.46 - t * 0.75 + seed);
    const thick = (fbm(i * 0.14 + seed * 0.5, t * 0.17, 119.3 + seed) - 0.5) * 2 * CFG.bandFlexRows +
      0.7 * Math.sin(i * 0.27 - t + phase);
    const half = CFG.bandRows * 0.5 * breath + thick;
    tr.half[i] = half > minHalf ? half : minHalf;
  }
}

/* The incoming page is revealed top-down to the band's centre line, which is
   always hidden under the band itself: new page above, old page below. */
function updateSwitchClip(tr) {
  const cut = clamp((bandCenter(tr.vis) - 1) * cell, 0, paneH);
  const inset = Math.round(Math.max(0, paneH - cut) * 10) / 10;
  if (inset !== tr.clip) {
    tr.clip = inset;
    tr.layer.style.clipPath = "inset(0 0 " + inset + "px 0)";
  }
}

function advanceSwitches(dt) {
  const dur = reducedMotion ? 0.01 : CFG.switchIn;
  for (let d = 1; d < paneStates.length; d++) {
    const state = paneStates[d];
    if (!state || !state.switches.length) continue;
    for (let k = state.switches.length - 1; k >= 0; k--) {
      const tr = state.switches[k];
      tr.p = Math.min(1, tr.p + dt / dur);
      tr.vis = reducedMotion ? tr.p : glide(tr.p);
      updateSwitchClip(tr);
      if (tr.p >= 1) finishSwitch(state, tr);
      else {
        const left = homeRight + (d - 1) * paneCols;
        prepareSwitchCols(tr, left, left + paneCols);
      }
    }
  }
}

/* ======================================================================
   9. Page stack
   ====================================================================== */

const paneStates = [];   // per depth: { depth, id, shell, body, article, intentOpen, switches, inert }
let mountedIds = [];     // pages with DOM (closing panes stay until fully covered)
let desiredIds = [];     // where navigation is heading
let pendingIds = null;   // a request queued behind a running close
let closingRange = null; // { start, end, keep } while a close is in flight
let focusAfterOpen = null;

function mountedDepth() { return Math.max(0, mountedIds.length - 1); }
function intendedDepth() { return Math.max(0, desiredIds.length - 1); }

function createPaneState(id, depth) {
  const page = pageById[id];
  if (!page) return null;
  mountedIds[depth] = id;
  const article = renderPage(page, depth);
  let state;
  if (depth === 0) {
    strip.replaceChildren(article);
    state = { depth, id, shell: deck, body: strip, article, intentOpen: true, switches: [], inert: false };
  } else {
    // The pane is placed at its final position, under the canvas, and is
    // revealed only by the canvas clearing cells over it.
    const shell = el("section", "pane-shell");
    shell.style.setProperty("--pane-depth", String(depth));
    shell.dataset.depth = String(depth);
    shell.setAttribute("role", "region");
    shell.setAttribute("aria-label", page.title);
    const body = el("div", "pane-body");
    body.appendChild(article);
    shell.appendChild(body);
    paneStack.appendChild(shell);
    state = { depth, id, shell, body, article, intentOpen: true, switches: [], inert: null };
  }
  paneStates[depth] = state;
  return state;
}

function removePaneState(depth) {
  const state = paneStates[depth];
  if (!state || depth === 0) return;
  state.shell.remove();
  paneStates[depth] = undefined;
}

function settleLayers(state, resetScroll) {
  const keep = state.article;
  for (const layer of Array.from(state.body.children)) if (layer !== keep) layer.remove();
  keep.inert = false;
  keep.removeAttribute("aria-hidden");
  keep.style.clipPath = "";
  keep.style.pointerEvents = "";
  if (resetScroll) keep.scrollTop = 0;
  state.switches.length = 0;
}

function finishSwitch(state, tr) {
  const index = state.switches.indexOf(tr);
  if (index < 0) return;
  tr.layer.style.clipPath = "";
  let older = tr.layer.previousElementSibling;
  while (older) {
    const previous = older.previousElementSibling;
    older.remove();
    older = previous;
  }
  state.switches.splice(index, 1);
  if (!state.switches.length) settleLayers(state, true);
}

/* Render the new page as a clipped layer on top of the old one. A switch
   during a switch replaces the incoming layer and keeps the band's progress. */
function startSwitch(depth, id) {
  const state = paneStates[depth];
  const page = pageById[id];
  if (!state || !page || depth === 0) return;
  mountedIds[depth] = id;
  const layer = renderPage(page, depth);
  layer.style.clipPath = "inset(0 0 100% 0)";
  layer.style.pointerEvents = "auto";
  for (const old of Array.from(state.body.children)) {
    old.style.pointerEvents = "none";
    old.inert = true;
    old.setAttribute("aria-hidden", "true");
  }
  const running = state.switches[0];
  if (running) {
    running.layer.replaceWith(layer);
    running.layer = layer;
    running.to = id;
    running.clip = -1;
    updateSwitchClip(running);
  } else {
    state.body.appendChild(layer);
    const tr = {
      to: id, layer, p: 0, vis: 0, clip: -1,
      seed: Math.random() * 1000,
      phase: Math.random() * TAU,
      center: new Float32Array(Math.max(1, cols)),
      half: new Float32Array(Math.max(1, cols))
    };
    const left = homeRight + (depth - 1) * paneCols;
    prepareSwitchCols(tr, left, left + paneCols);
    state.switches.push(tr);
  }
  state.id = id;
  state.article = layer;
  state.shell.setAttribute("aria-label", page.title);
}

/* Unmount panes once their tiles have fully covered them, then run any
   request that was queued behind the close. */
function finishClosedSuffix() {
  if (!closingRange) return;
  const start = closingRange.start, end = closingRange.end, keep = closingRange.keep;
  for (let d = start; d <= end; d++) if (paneStates[d] && paneStates[d].switches.length) return;
  if (!bandIs(false, start, end)) return;
  markBand(start, end, false);
  for (let d = end; d >= start; d--) removePaneState(d);
  mountedIds.length = keep + 1;
  paneStates.length = keep + 1;
  closingRange = null;
  refreshGeometry();
  syncActiveLinks();
  syncPaneInteractivity();
  if (stage.scrollLeft > clampCamera(stage.scrollLeft) + 0.5) panToDepth(keep);
  const pending = pendingIds;
  pendingIds = null;
  if (pending) requestPageStack(pending, { focusHeading: true });
}

/* The heart of navigation. Given the stack the user asked for:
     initial load       mount everything, no waves (the bloom is the only motion)
     close running      queue the request (latest wins)
     sibling, deepest   in-place switch band
     diverges earlier   close the old branch first, then open the new one
     shorter            one close wave across every removed pane
     longer             one open wave across every new pane
   The palette heads for the destination immediately, whatever happens. */
function requestPageStack(requested, { initial = false, focusHeading = false } = {}) {
  const next = validStack(requested);
  if (!next.length) return;
  desiredIds = next.slice();
  applyPalette(paletteForStack(next), true, CFG.revealIn);

  if (initial || !mountedIds.length) {
    paneStack.replaceChildren();
    paneStates.length = 0;
    mountedIds = [];
    for (let d = 0; d < next.length; d++) createPaneState(next[d], d);
    pendingIds = null;
    closingRange = null;
    focusAfterOpen = null;
    syncActiveLinks();
    return;
  }

  if (closingRange) {
    pendingIds = next.slice();
    return;
  }

  const common = commonPrefix(mountedIds, next);
  const oldDepth = mountedDepth();
  const nextDepth = next.length - 1;

  if (common < mountedIds.length && common < next.length) {
    if (common === oldDepth && next.length === mountedIds.length) {
      startSwitch(common, next[common]);
      if (focusHeading) focusAfterOpen = { depth: common, id: next[common] };
      refreshGeometry();
      panToDepth(common, { opening: true });
      syncActiveLinks();
      return;
    }
    pendingIds = next.slice();
    desiredIds = mountedIds.slice(0, common);
    const duration = emitCascadeClose(common - 1);
    panToDepth(Math.max(0, common - 1), { duration });
    syncActiveLinks();
    return;
  }

  if (next.length < mountedIds.length) {
    const duration = emitCascadeClose(nextDepth);
    panToDepth(nextDepth, { duration });
    syncActiveLinks();
    return;
  }

  if (next.length > mountedIds.length) {
    const first = mountedIds.length;
    for (let d = first; d < next.length; d++) createPaneState(next[d], d);
    refreshGeometry();
    emitWave(true, first, nextDepth, null);
    if (focusHeading) focusAfterOpen = { depth: nextDepth, id: next[nextDepth] };
    panToDepth(nextDepth, { opening: true });
    syncActiveLinks();
    return;
  }

  syncActiveLinks();
}

/* Closing panes become inert at once; a newly opened pane's title takes
   focus once its text is fully uncovered. */
function syncPaneInteractivity() {
  const depth = mountedDepth();
  for (let d = 1; d <= depth; d++) {
    const state = paneStates[d];
    if (!state) continue;
    const inert = state.intentOpen === false;
    if (state.inert !== inert) {
      state.inert = inert;
      state.shell.inert = inert;
      state.shell.setAttribute("aria-hidden", inert ? "true" : "false");
    }
  }
  if (focusAfterOpen) {
    const state = paneStates[focusAfterOpen.depth];
    if (state && state.id === focusAfterOpen.id && state.intentOpen !== false && !state.switches.length &&
        bandIs(true, focusAfterOpen.depth, focusAfterOpen.depth)) {
      focusAfterOpen = null;
      requestAnimationFrame(() => {
        const heading = state.article.querySelector(".name[tabindex]");
        if (heading && state.shell.isConnected) heading.focus({ preventScroll: true });
      });
    }
  }
}

/* Focus inside a closing pane would be lost when the pane goes inert, so it
   moves back to the link that opened the pane. The ring shows only if the
   focus it replaces was showing one (a keyboard user), never for a mouse. */
function restoreFocus(closingId, keepDepth) {
  const active = doc.activeElement;
  const shell = active && active.closest ? active.closest(".pane-shell") : null;
  const state = paneStates[keepDepth];
  if (!shell || !(Number(shell.dataset.depth) > keepDepth) || !state) return;
  let visible = false;
  try { visible = active.matches(":focus-visible"); } catch (_) {}
  const links = state.article.querySelectorAll("a[data-page-id]");
  for (let k = 0; k < links.length; k++) {
    if (links[k].dataset.pageId === closingId) {
      links[k].focus({ preventScroll: true, focusVisible: visible });
      return;
    }
  }
}

/* ======================================================================
   10. Layout
   ====================================================================== */

let viewportW = 0, H = 0, W = 0, worldW = 0;
let cols = 0, rows = 0, viewCols = 0;
let paneCols = 15, homeRight = 16, colorLeft = 16;
let paneW = 299, paneH = 0, paneStride = 300, sidePad = cell, paneTop = cell;
let setupPending = false;
let si = 0, sj = 0, maxRevealD = 1;
let jag = new Float32Array(0), jagCols = 0, jagRows = 0;
let dprWatch = null;

/* Lit columns right of the last pane: 80% of a viewport, border included. */
function ambientCols() {
  return Math.max(1, Math.round((viewportW * 0.8 - cell) / cell));
}

/* Panes are one fixed 300px unit (299 + 1px gap) whenever that unit plus its
   border cells fits; narrower screens use the nearest grid width to 90%. */
function layoutDeck() {
  const fixedCols = Math.round((300 + gap) / cell);
  const fits = cell + (fixedCols * cell - gap) + cell <= viewportW;
  const compact = Math.max(1, Math.round((viewportW * 0.9 + gap) / cell));
  const visible = Math.max(1, Math.floor((viewportW - 2 * cell + gap) / cell));
  paneCols = fits ? fixedCols : Math.min(compact, visible);
  homeRight = 1 + paneCols;
  const depth = mountedDepth();
  colorLeft = homeRight + depth * paneCols;
  sidePad = cell;
  paneTop = cell;
  paneW = paneCols * cell - gap;
  paneH = Math.max(tile, H - paneTop - cell);
  paneStride = paneCols * cell;

  // The world always runs 80% of a viewport past the last pane, and stays
  // wide enough for any live wave's tail.
  const lastPaneRight = sidePad + paneStride * depth + paneW;
  let waveRight = 0;
  for (let k = 0; k < waves.length; k++) waveRight = Math.max(waveRight, waves[k].right * cell);
  const desired = Math.max(viewportW, lastPaneRight + viewportW * 0.8, waveRight + viewportW * 0.8);
  cols = Math.max(viewCols, Math.ceil((desired + gap) / cell));
  worldW = W = cols * cell - gap;

  const s = rootEl.style;
  s.setProperty("--world-w", worldW + "px");
  s.setProperty("--pane-w", paneW + "px");
  s.setProperty("--pane-h", paneH + "px");
  s.setProperty("--pane-gap", gap + "px");
  s.setProperty("--pane-stride", paneStride + "px");
  s.setProperty("--pane-top", paneTop + "px");
  s.setProperty("--side-pad", sidePad + "px");
  s.setProperty("--strip-x", "0px");
  for (const state of paneStates) {
    if (state) for (const tr of state.switches) { tr.clip = -1; updateSwitchClip(tr); }
  }
  syncCloseControls();
}

function syncGrid() {
  const ratio = window.devicePixelRatio || 1;
  const dpr = Math.max(0.5, Math.min(
    ratio, 2,
    Math.sqrt(16e6 / Math.max(1, W * H)),
    16384 / Math.max(1, W),
    16384 / Math.max(1, H)
  ));
  const bw = Math.max(1, Math.round(W * dpr));
  const bh = Math.max(1, Math.round(H * dpr));
  if (wall.width !== bw) wall.width = bw;   // assigning clears the bitmap, so only on change
  if (wall.height !== bh) wall.height = bh;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = rootEl.style;
  s.setProperty("--tile", tile + "px");
  s.setProperty("--gap", gap + "px");
  s.setProperty("--cell", cell + "px");
  syncMask();
  updateReveal();
  watchDpr(ratio);
}

/* Commit layout, canvas and mask together so nothing ever paints with a
   stale row stride. */
function refreshGeometry() {
  layoutDeck();
  syncGrid();
}

/* The bloom grows from the middle of the lit runway (not the viewport). */
function updateReveal() {
  const right = Math.max(colorLeft, Math.min(cols - 2, colorLeft + ambientCols() - 1));
  si = (colorLeft + right) / 2;
  sj = (rows - 1) / 2;
  const dx = Math.max(Math.abs(colorLeft - si), Math.abs(right - si));
  const dy = Math.max(Math.abs(1 - sj), Math.abs(rows - 2 - sj));
  maxRevealD = Math.sqrt(dx * dx + dy * dy) + CFG.jagAmp * 0.5 + CFG.revealSoft;
  if (!sweepDone && (jagCols !== cols || jagRows !== rows)) {
    // The rim's raggedness is a frozen noise pattern: it never flickers.
    jag = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) jag[j * cols + i] = (fbm(i * 0.3, j * 0.3, 5.7) - 0.5) * CFG.jagAmp;
    }
    jagCols = cols;
    jagRows = rows;
  }
}

function scheduleSetup() {
  setupPending = true;
}

/* Moving the window to a screen with another pixel ratio fires no resize. */
function watchDpr(ratio) {
  if (!window.matchMedia || (dprWatch && dprWatch.ratio === ratio)) return;
  if (dprWatch) {
    if (dprWatch.query.removeEventListener) dprWatch.query.removeEventListener("change", scheduleSetup);
    else if (dprWatch.query.removeListener) dprWatch.query.removeListener(scheduleSetup);
  }
  const query = matchMedia("(resolution: " + ratio + "dppx)");
  if (query.addEventListener) query.addEventListener("change", scheduleSetup);
  else if (query.addListener) query.addListener(scheduleSetup);
  dprWatch = { query, ratio };
}

function setup() {
  const nextW = stage.clientWidth, nextH = stage.clientHeight;
  const hadLayout = viewportW > 0 && H > 0;
  const prevStride = paneStride;
  const prevScroll = stage.scrollLeft;
  const widthChanged = hadLayout && Math.abs(nextW - viewportW) > 0.5;
  const wasAnimating = camT < 1;
  const wasOpening = wasAnimating && camOpening;
  const inherited = camVelocity() || camInertia;

  viewportW = nextW;
  H = nextH;
  viewCols = Math.max(1, Math.ceil(viewportW / cell));
  rows = Math.max(1, Math.ceil(H / cell));
  if (widthChanged) {
    for (const state of paneStates) if (state && state.switches.length) settleLayers(state, false);
  }
  layoutDeck();
  syncGrid();

  const activeDepth = closingRange ? closingRange.keep : intendedDepth();
  if (!hadLayout) {
    panToDepth(activeDepth, { animate: false });
  } else if (widthChanged) {
    stage.scrollLeft = clampCamera(prevScroll);
    let reanchored = false;
    if (!wasAnimating) {
      const target = activeDepth > 0 ? targetForOpening(activeDepth) : 0;
      reanchored = Math.abs(target - stage.scrollLeft) > 0.5;
      stage.scrollLeft = target;
    }
    camT = 1;
    camFrom = camTarget = stage.scrollLeft;
    camV0 = 0;
    camInertia = reanchored ? 0 : inherited * (prevStride > 0 ? paneStride / prevStride : 1);
    if (wasAnimating) panToDepth(activeDepth, { opening: wasOpening });
  } else {
    // Height-only changes (browser chrome, keyboard) never move the camera.
    stage.scrollLeft = clampCamera(prevScroll);
  }
}

/* ======================================================================
   11. Camera (stage.scrollLeft; the only thing in the DOM that moves)
   ====================================================================== */

let camFrom = 0, camTarget = 0, camT = 1, camDur = 0, camV0 = 0, camInertia = 0;
let camOpening = false;
let stackClipped = false;

/* Never show more than the lit runway. */
function clampCamera(x) {
  const worldMax = Math.max(0, worldW - viewportW);
  const lightEnd = (colorLeft + ambientCols()) * cell + tile;
  const max = Math.min(worldMax, Math.max(0, lightEnd - viewportW));
  return x < 0 ? 0 : x > max ? max : x;
}

function targetForDepth(d) {
  if (d <= 0) return 0;
  const left = sidePad + d * paneStride;
  const right = left + paneW;
  // A surviving first pane lands one cell in from the left, so a sliver of
  // the sidebar keeps it visibly connected.
  if (d === 1 && right + cell > viewportW) return clampCamera(left - cell);
  return clampCamera(right + cell - viewportW);
}

function targetForCenter(d) {
  return clampCamera(sidePad + d * paneStride + paneW / 2 - viewportW / 2);
}

/* Keep the pane plus ~100px of lights in view; don't move if that already holds.
   Below 400px wide, centre the pane instead. */
function targetForOpening(d) {
  const current = clampCamera(stage.scrollLeft);
  const left = sidePad + d * paneStride;
  if (viewportW >= CFG.roomPx) {
    const first = left + CFG.roomPx - viewportW;
    if (current < first - 0.5) return clampCamera(first);
    if (current > left + 0.5) return clampCamera(left);
    return current;
  }
  return targetForCenter(d);
}

function wavePixelSpeed() {
  return (paneCols + 2 * LEAD) * cell / CFG.revealIn;
}

/* The camera's average pace matches the wipe front. */
function travelTime(target) {
  const dist = Math.abs(target - stage.scrollLeft);
  if (dist < 0.5) return 0;
  return Math.max(0.28, dist / (1 - CFG.glide) / wavePixelSpeed());
}

/* Cubic Hermite from camFrom to camTarget, starting at camV0 and ending at rest. */
function camPosition(u) {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * camFrom + (u3 - 2 * u2 + u) * camDur * camV0 + (3 * u2 - 2 * u3) * camTarget;
}

function camVelocity() {
  if (camT >= 1 || camDur <= 0) return 0;
  const u = camT, u2 = u * u;
  return ((6 * u2 - 6 * u) * camFrom + (3 * u2 - 4 * u + 1) * camDur * camV0 + (6 * u - 6 * u2) * camTarget) / camDur;
}

function cancelPan() {
  camT = 1;
  camV0 = 0;
  camInertia = 0;
  camOpening = false;
  camFrom = camTarget = stage.scrollLeft;
}

function panToDepth(d, { animate = true, duration = null, opening = false } = {}) {
  const next = opening ? targetForOpening(d) : targetForDepth(d);
  const inherited = camVelocity() || camInertia;
  camOpening = opening;
  camFrom = stage.scrollLeft;
  camTarget = next;
  camInertia = 0;
  const natural = travelTime(next);
  // A close pan never outlasts its wave.
  camDur = duration == null ? natural : Math.min(natural || duration, Math.max(0, duration));
  if (!animate || reducedMotion || Math.abs(camTarget - camFrom) < 0.5) {
    camT = 1;
    camV0 = 0;
    stage.scrollLeft = camTarget;
    syncCloseControls();
    return;
  }
  camDur = Math.max(0.01, camDur);
  const delta = camTarget - camFrom;
  const directed = inherited * delta > 0 ? inherited : 0;
  const limit = Math.min(wavePixelSpeed() * 1.25, 3 * Math.abs(delta) / camDur); // stays monotonic
  camV0 = clamp(directed, -limit, limit);
  camT = 0;
}

function stepCamera(dt) {
  if (camT < 1) {
    camT = Math.min(1, camT + dt / (reducedMotion ? 0.01 : camDur || 0.52));
    stage.scrollLeft = clampCamera(reducedMotion ? camTarget : camPosition(camT));
    if (camT >= 1) {
      stage.scrollLeft = camTarget;
      camV0 = 0;
      camFrom = camTarget;
    }
  } else if (camInertia !== 0) {
    const before = stage.scrollLeft;
    const after = clampCamera(before + camInertia * dt);
    stage.scrollLeft = after;
    if (Math.abs(after - before) < 0.01) camInertia = 0;
    else {
      camInertia *= Math.exp(-dt / 0.24);
      if (Math.abs(camInertia) < 12) camInertia = 0;
    }
  }
}

/* Pane close controls show only while the stack doesn't fit (and stay up
   through a close that started clipped). */
function syncCloseControls() {
  const depth = mountedDepth();
  const left = stage.scrollLeft;
  const stackRight = sidePad + depth * paneStride + paneW;
  const allVisible = sidePad >= left - 0.5 && stackRight <= left + viewportW + 0.5;
  const next = depth > 0 && (!allVisible || (!!closingRange && stackClipped));
  if (next !== stackClipped) {
    stackClipped = next;
    stage.classList.toggle("stack-clipped", next);
  }
}

let wheelAxis = null, wheelTimer = 0;
function onWheel(e) {
  if (stage.scrollWidth - stage.clientWidth < 1) return;
  const unit = mode => (mode === 1 ? cell : mode === 2 ? 0 : 1);
  const dx = e.deltaMode === 2 ? e.deltaX * viewportW : e.deltaX * unit(e.deltaMode);
  const dy = e.deltaMode === 2 ? e.deltaY * H : e.deltaY * unit(e.deltaMode);
  if (!wheelAxis) {
    if (e.shiftKey || Math.abs(dx) > Math.abs(dy) * 1.15) wheelAxis = "x";
    else if (Math.abs(dy) > Math.abs(dx) * 1.15) wheelAxis = "y";
    else wheelAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
  }
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { wheelAxis = null; }, 120);
  if (wheelAxis === "x" || e.shiftKey) {
    e.preventDefault();
    cancelPan();
    stage.scrollLeft = clampCamera(stage.scrollLeft + (e.shiftKey ? dy : dx));
  }
  // Vertical wheel belongs to the pane under the pointer; it never pans.
}

let touch = null, suppressClickUntil = 0;
function findTouch(list, id) {
  for (let k = 0; k < list.length; k++) if (list[k].identifier === id) return list[k];
  return null;
}
function onTouchStart(e) {
  if (e.touches.length !== 1) { touch = null; return; }
  cancelPan();
  const t = e.touches[0];
  touch = {
    id: t.identifier, x: t.clientX, y: t.clientY, scroll: stage.scrollLeft,
    mode: null, moved: false, samples: [{ t: performance.now(), scroll: stage.scrollLeft }]
  };
}
function onTouchMove(e) {
  if (!touch || e.touches.length !== 1) return;
  const t = findTouch(e.touches, touch.id);
  if (!t) return;
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  if (!touch.mode && Math.hypot(dx, dy) >= 7) {
    if (Math.abs(dx) > Math.abs(dy) * 1.1) { touch.mode = "x"; cancelPan(); }
    else if (Math.abs(dy) > Math.abs(dx) * 1.1) touch.mode = "y";
  }
  if (touch.mode !== "x") return;
  e.preventDefault();
  touch.moved = touch.moved || Math.abs(dx) >= 9;
  stage.scrollLeft = clampCamera(touch.scroll - dx);
  const now = performance.now();
  touch.samples.push({ t: now, scroll: stage.scrollLeft });
  while (touch.samples.length > 2 && now - touch.samples[0].t > 90) touch.samples.shift();
}
function onTouchEnd(e) {
  if (!touch) return;
  if (touch.mode === "x" && touch.moved) {
    const samples = touch.samples;
    if (samples.length >= 2) {
      const first = samples[0], lastSample = samples[samples.length - 1];
      if (performance.now() - lastSample.t > 80) camInertia = 0; // a finger that paused doesn't fling
      else {
        const seconds = Math.max(0.016, (lastSample.t - first.t) / 1000);
        const limit = viewportW * 2.5;
        camInertia = clamp((lastSample.scroll - first.scroll) / seconds, -limit, limit);
      }
    }
    // Swallow only the synthetic click from this drag, never a real tap.
    suppressClickUntil = performance.now() + 80;
    if (e.cancelable) e.preventDefault();
  }
  touch = null;
}

/* ======================================================================
   12. Router
   ====================================================================== */

/* The page path the address bar names. Hosted, that's the address with the
   site's folder taken off ("/portfolio/work/x/" -> "/work/x"); an address
   outside the folder names nothing, so it shows the home page. */
function routePathFromLocation() {
  if (FILE_MODE) {
    let hash = location.hash.replace(/^#!?/, "");
    try { hash = decodeURIComponent(hash); } catch (_) {}
    return normalizePath(hash || "/");
  }
  const inner = stripBase(location.pathname);
  return inner == null ? "/" : normalizePath(inner);
}

/* Unknown addresses show the home page and quietly become the site's own
   address ("/portfolio/"); near misses like "/portfolio" or a trailing slash
   are tidied the same way. */
function routeFromLocation() {
  const path = routePathFromLocation();
  const page = pageById[path] || home;
  const needsReplace = FILE_MODE
    ? page.path !== path
    : location.pathname !== addressFor(page.path) || !!location.hash;
  return { page, needsReplace };
}

/* True when the address bar already shows exactly this page. */
function isCurrentAddress(page) {
  return FILE_MODE
    ? routePathFromLocation() === page.path
    : location.pathname === addressFor(page.path) && !location.hash && !location.search;
}

function commitHistory(mode, path, stack, keepSearch, extra) {
  const state = Object.assign({ siteRoute: path, siteStack: stack.slice() }, extra || null);
  const base = location.pathname + location.search;
  const url = FILE_MODE
    ? (path === "/" && mode === "replace" && !location.hash ? base : base + "#" + path)
    : addressFor(path) + (keepSearch ? location.search : "");
  try {
    if (mode === "replace") history.replaceState(state, "", url);
    else history.pushState(state, "", url);
  } catch (_) {
    // Some browsers refuse history entries on file:// pages; fall back to the hash.
    if (FILE_MODE && mode === "push") location.hash = path;
  }
}

function setMeta(selector, attr, value) {
  const node = doc.querySelector(selector);
  if (node && value != null) node.setAttribute(attr, value);
}

function syncMetadata(page) {
  const title = page === home ? siteName : page.title + " | " + siteName;
  const description = page.description || siteDescription;
  const canonical = siteURL ? siteURL + (page.path === "/" ? "/" : page.path) : null;
  doc.title = title;
  setMeta('meta[name="description"]', "content", description);
  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[property="og:description"]', "content", description);
  setMeta('meta[name="twitter:title"]', "content", title);
  setMeta('meta[name="twitter:description"]', "content", description);
  if (canonical) {
    setMeta('link[rel="canonical"]', "href", canonical);
    setMeta('meta[property="og:url"]', "content", canonical);
  }
}

function navigateTo(path, { stack = null, focusHeading = false, historyMode = "push" } = {}) {
  const page = pageById[normalizePath(path)] || home;
  const next = validStack(stack || primaryChainFor(page));
  const alreadyThere = isCurrentAddress(page);
  requestPageStack(next, { focusHeading });
  // Same address but maybe a different stack: update this entry in place, so
  // Back / forward later restore the panes that are actually open.
  commitHistory(historyMode === "replace" || alreadyThere ? "replace" : "push", page.path, next, false);
  syncMetadata(page);
}

/* Back / forward animate exactly like clicks, using the stack saved in history.
   The Manifesto's entry keeps the stack that was open under it. */
function onHistoryChange() {
  if (isManifestoPath(routePathFromLocation())) {
    const hs = history.state;
    const saved = hs && Array.isArray(hs.siteStack) ? validStack(hs.siteStack) : null;
    const stack = saved || (desiredIds.length ? desiredIds.slice() : [home.id]);
    requestPageStack(stack, {});
    // Reached through history, so an earlier entry exists: closing goes back to it.
    const back = !(hs && hs.manifestoBack === false);
    if (!hs || hs.siteRoute !== MANIFESTO_PATH) commitHistory("replace", MANIFESTO_PATH, stack, true, { manifestoBack: back });
    openManifesto({ back });
    return;
  }
  if (manifestoState) closeManifesto();
  const route = routeFromLocation();
  const saved = history.state && Array.isArray(history.state.siteStack) ? validStack(history.state.siteStack) : null;
  const stack = saved && saved[saved.length - 1] === route.page.id ? saved : primaryChainFor(route.page);
  requestPageStack(stack, {});
  if (route.needsReplace || !history.state || history.state.siteRoute !== route.page.path) {
    commitHistory("replace", route.page.path, stack, true);
  }
  syncMetadata(route.page);
}

function onContentClick(e) {
  const target = e.target instanceof Element ? e.target : null;
  const a = target && target.closest("a[data-page-id], a[data-close-depth], a[data-route], a[data-manifesto]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
  e.preventDefault();

  if (a.hasAttribute("data-manifesto")) {
    openManifesto({ push: true });
    return;
  }

  if (a.hasAttribute("data-close-depth")) {
    const depth = Math.max(1, Number(a.dataset.closeDepth) || 1);
    const closingId = mountedIds[depth];
    const stack = mountedIds.slice(0, depth);
    const parent = pageById[stack[stack.length - 1]] || home;
    navigateTo(parent.path, { stack });
    restoreFocus(closingId, depth - 1);
    return;
  }

  const id = a.dataset.pageId || a.dataset.route;
  const page = pageById[id];
  if (!page) return;
  // A link inside a page body opens its target where it always lives (the
  // same stack a reload of that address shows), not beside the page it's in.
  if (!a.hasAttribute("data-page-id")) {
    navigateTo(page.path, { stack: primaryChainFor(page), focusHeading: true });
    return;
  }
  const source = Math.max(0, Number(a.dataset.sourceDepth) || 0);
  const prefix = mountedIds.slice(0, source + 1);
  const next = paneStates[source + 1];
  // Clicking the link of the page that is open closes it (and anything deeper).
  const active = mountedIds[source + 1] === id && !!next && next.intentOpen !== false;
  let stack, destination;
  if (active) {
    stack = prefix;
    destination = pageById[prefix[prefix.length - 1]] || home;
  } else {
    const at = prefix.indexOf(id);
    stack = at >= 0 ? prefix.slice(0, at + 1) : prefix.concat(id);
    destination = page;
  }
  navigateTo(destination.path, { stack, focusHeading: !active });
}

function closeDeepest() {
  if (intendedDepth() <= 0) return;
  const closingId = desiredIds[desiredIds.length - 1];
  const stack = desiredIds.slice(0, -1);
  const page = pageById[stack[stack.length - 1]] || home;
  navigateTo(page.path, { stack });
  restoreFocus(closingId, stack.length - 1);
}

function injectStructuredData() {
  if (!siteURL) return;
  const sameAs = socialLinks.map(s => s.url).filter(u => /^https?:\/\//.test(u));
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": siteURL + "/#website", url: siteURL + "/", name: siteName },
      {
        "@type": "ProfilePage", "@id": siteURL + "/#profile", url: siteURL + "/",
        mainEntity: {
          "@type": "Person", "@id": siteURL + "/#person", name: siteName,
          url: siteURL + "/", description: siteDescription, sameAs
        }
      }
    ]
  };
  const script = el("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(data);
  doc.head.appendChild(script);
}

/* ======================================================================
   12b. Manifesto overlay
   ====================================================================== */

/* /manifesto is a full-screen dialog above the whole stage, not a pane. This
   section owns its element, its address and the wall: the wall stops while
   it is open and carries on where it was on close, with the stack underneath
   untouched. What happens inside (the opening sequence, the title card, the
   collage and the text) is assets/manifesto.js, fetched on first open along
   with assets/manifesto.css and the text (manifesto.js at the site's root;
   the module adds its own fonts). The module registers
   window.SiteManifesto = { mount(root, api) } and mount returns { destroy }.
   The api it gets: markdown, config (content.js `manifesto`, addresses
   resolved), siteName, renderMarkdown (the safe renderer above),
   reducedMotion() and close({ keyboard }). */

let manifestoState = null;   // { root, instance, back, keyboard, backTimer, closing } while open
const assetLoads = Object.create(null);
let manifestoPrefetched = false;   // the opening picture and font hosts, started once
let manifestoPicture = null;       // (held, so the fetch can't be collected midway)

/* A <script> or stylesheet, once (works over http and from disk alike). A
   failed load is forgotten, so the next open tries again. */
function loadAsset(tag, url) {
  if (!assetLoads[url]) {
    assetLoads[url] = new Promise((resolve, reject) => {
      const node = doc.createElement(tag);
      node.onload = () => resolve();
      node.onerror = () => {
        node.remove();
        reject(new Error("Could not load " + url + "."));
      };
      if (tag === "link") {
        node.rel = "stylesheet";
        node.href = url;
      } else {
        node.async = true;
        node.src = url;
      }
      doc.head.appendChild(node);
    });
    assetLoads[url].catch(() => { delete assetLoads[url]; });
  }
  return assetLoads[url];
}

/* The module, its styles and the text, in parallel. The opening picture and
   the connections to Google Fonts (the module adds its typefaces) start at
   the same time, without holding anything up. */
function loadManifestoAssets() {
  if (!manifestoPrefetched) {
    manifestoPrefetched = true;
    if (manifestoConfig.image) {
      manifestoPicture = new Image();
      manifestoPicture.decoding = "async";
      manifestoPicture.src = manifestoConfig.image;
    }
    for (const [href, cors] of [["https://fonts.googleapis.com", false], ["https://fonts.gstatic.com", true]]) {
      const hint = doc.createElement("link");
      hint.rel = "preconnect";
      hint.href = href;
      if (cors) hint.crossOrigin = "anonymous";
      doc.head.appendChild(hint);
    }
  }
  const jobs = [loadAsset("link", assetURL("assets/manifesto.css"))];
  if (!window.SiteManifesto) jobs.push(loadAsset("script", assetURL("assets/manifesto.js")));
  if (typeof window.MANIFESTO_MD !== "string") jobs.push(loadAsset("script", assetURL("manifesto.js")));
  return Promise.all(jobs).then(() => {
    if (!window.SiteManifesto || typeof window.SiteManifesto.mount !== "function") {
      throw new Error("assets/manifesto.js did not register itself.");
    }
    if (typeof window.MANIFESTO_MD !== "string") {
      throw new Error("manifesto.js did not define window.MANIFESTO_MD. Look for an unescaped backtick (write \\`) or ${ (write \\${) in it.");
    }
  });
}

/* The italic line under the title: the page's description. */
function manifestoSubtitle(md) {
  let seenTitle = false;
  for (const line of dedent(md)) {
    if (RE_BLANK.test(line)) continue;
    if (!seenTitle && /^ {0,3}#[ \t]/.test(line)) { seenTitle = true; continue; }
    const m = /^\s*([*_])(.+)\1\s*$/.exec(line);
    return m ? plainText(m[2]) : "";
  }
  return "";
}

/* push: a new history entry (opened from a link). back: closing returns to
   the entry before it; otherwise closing replaces this entry with the page
   underneath (the Manifesto was the first page of the visit). */
function openManifesto({ push = false, back = true } = {}) {
  if (!manifestoPage) return;
  if (push) commitHistory("push", MANIFESTO_PATH, desiredIds, false, { manifestoBack: true });
  syncMetadata(manifestoPage);
  if (manifestoState) return;

  const root = el("div", "manifesto");
  root.id = "manifesto";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", manifestoConfig.label);
  root.tabIndex = -1;
  // Black at once, with a way out and a sign of life, until
  // assets/manifesto.css and the module take over.
  root.style.cssText = "position:fixed;inset:0;z-index:1000;background:#000";
  root.appendChild(manifestoPlaceholder());
  const st = { root, instance: null, back: push || back, keyboard: false, backTimer: 0, closing: false };
  manifestoState = st;
  pauseWall();
  // The dialog takes the place of any pane heading still waiting for focus.
  focusAfterOpen = null;
  stage.inert = true;
  stage.setAttribute("aria-hidden", "true");
  doc.body.appendChild(root);
  doc.addEventListener("focusin", keepManifestoFocus, true);
  root.focus({ preventScroll: true });

  loadManifestoAssets().then(() => {
    if (manifestoState !== st) return;
    const subtitle = manifestoSubtitle(window.MANIFESTO_MD);
    if (subtitle) {
      manifestoPage.description = subtitle;
      syncMetadata(manifestoPage);
    }
    root.style.cssText = "";
    st.instance = window.SiteManifesto.mount(root, {
      markdown: window.MANIFESTO_MD,
      config: manifestoConfig,
      siteName,
      renderMarkdown,
      reducedMotion: () => reducedMotion,
      close: opts => requestManifestoClose(opts)
    });
    // The placeholder's button may have had focus.
    if (!root.contains(doc.activeElement)) root.focus({ preventScroll: true });
  }).catch(err => {
    if (manifestoState !== st) return;
    warn("Manifesto: " + (err && err.message ? err.message : err));
    showManifestoError(st);
  });
}

/* CLOSE, Escape and RETURN. Opened from inside the site, that's Back (so
   Forward opens it again); as the first page of a visit, it becomes the
   page underneath in place. */
function requestManifestoClose(opts) {
  const st = manifestoState;
  // Once Back is on its way, further requests wait for it (two quick ones
  // would otherwise go back twice, past the page underneath).
  if (!st || st.closing) return;
  st.keyboard = !!(opts && opts.keyboard);
  const hs = history.state;
  if (st.back && hs && hs.siteRoute === MANIFESTO_PATH) {
    st.closing = true;
    // popstate closes it; if no earlier entry answers, close in place.
    st.backTimer = setTimeout(() => { if (manifestoState === st) closeManifestoInPlace(); }, 700);
    history.back();
    return;
  }
  closeManifestoInPlace();
}

function closeManifestoInPlace() {
  closeManifesto();
  const stack = desiredIds.length ? desiredIds : [home.id];
  const page = pageById[stack[stack.length - 1]] || home;
  commitHistory("replace", page.path, stack, false);
  syncMetadata(page);
}

function closeManifesto() {
  const st = manifestoState;
  if (!st) return;
  manifestoState = null;
  clearTimeout(st.backTimer);
  if (st.instance && typeof st.instance.destroy === "function") {
    try { st.instance.destroy(); } catch (err) { warn("Manifesto: " + (err && err.message)); }
  }
  doc.removeEventListener("focusin", keepManifestoFocus, true);
  st.root.remove();
  stage.inert = false;
  stage.removeAttribute("aria-hidden");
  resumeWall();
  const link = deck.querySelector("a[data-manifesto]");
  if (link) link.focus({ preventScroll: true, focusVisible: st.keyboard });
}

/* Focus stays inside the dialog (the stage is inert too; this is the net). */
function keepManifestoFocus(e) {
  const st = manifestoState;
  if (st && e.target instanceof Node && !st.root.contains(e.target)) st.root.focus({ preventScroll: true });
}

/* What shows while the Manifesto's files load: CLOSE (styled like the real
   one) and a blinking green cursor where the terminal will type. */
function manifestoPlaceholder() {
  const box = el("div");
  const close = el("button", null, "CLOSE \u00d7");
  close.type = "button";
  close.setAttribute("aria-label", "Close the manifesto");
  close.style.cssText = "position:absolute;top:max(4px,env(safe-area-inset-top));right:max(6px,env(safe-area-inset-right));" +
    "margin:0;padding:11px 12px;min-height:34px;border:0;background:none;color:rgba(255,255,255,.6);" +
    "font:700 11.5px/1 var(--font);letter-spacing:.18em;cursor:pointer";
  close.addEventListener("click", e => requestManifestoClose({ keyboard: e.detail === 0 }));
  const cursor = el("span");
  cursor.setAttribute("aria-hidden", "true");
  cursor.style.cssText = "position:absolute;left:max(20px,4.2vw);bottom:max(26px,6.5vh);width:8px;height:14px;" +
    "background:#74ffab;box-shadow:0 0 8px rgba(60,255,140,.6)";
  if (!reducedMotion && typeof cursor.animate === "function") {
    cursor.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }],
      { duration: 1060, iterations: Infinity });
  }
  box.append(close, cursor);
  return box;
}

function showManifestoError(st) {
  const box = el("div");
  box.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;" +
    "justify-content:center;gap:1em;padding:24px;color:#fff;font:400 1rem/1.5 var(--font);text-align:center";
  box.appendChild(el("p", null, "The manifesto could not be loaded. Check the connection and try again."));
  const button = el("button", null, "Close");
  button.type = "button";
  button.style.cssText = "font:inherit;color:inherit;background:none;border:1px solid currentColor;padding:0.35em 1em;cursor:pointer";
  button.addEventListener("click", () => requestManifestoClose());
  box.appendChild(button);
  st.root.replaceChildren(box);
  button.focus({ preventScroll: true });
}

/* ======================================================================
   13. Pointer (wake trail and sparks; fixed-size ring buffers)
   ====================================================================== */

const WAKE_MAX = 28, WAKE_GAP = 0.62, WAKE_LIFE = 0.52, WAKE_DELAY = 0.07;
const WAKE_FADE = WAKE_LIFE - WAKE_DELAY;
const wakeX = new Float64Array(WAKE_MAX), wakeY = new Float64Array(WAKE_MAX), wakeT = new Float64Array(WAKE_MAX);
let wakeHead = 0, wakeCount = 0;

const SPARK_MAX = 60;
const sparkX = new Float64Array(SPARK_MAX), sparkY = new Float64Array(SPARK_MAX);
const sparkAge = new Float64Array(SPARK_MAX), sparkR = new Float64Array(SPARK_MAX), sparkA = new Float64Array(SPARK_MAX);
let sparkHead = 0, sparkCount = 0;

// Per-frame scratch: the live points with their frame constants.
const wkX = new Float64Array(WAKE_MAX), wkY = new Float64Array(WAKE_MAX);
const wkFade = new Float64Array(WAKE_MAX), wkInv = new Float64Array(WAKE_MAX), wkRing = new Float64Array(WAKE_MAX);
let wkN = 0;
const spX = new Float64Array(SPARK_MAX), spY = new Float64Array(SPARK_MAX);
const spInvR = new Float64Array(SPARK_MAX), spAmp = new Float64Array(SPARK_MAX);
let spN = 0;

let dragging = false, lastSparkKey = -1, ptX = 0, ptY = 0;

/* Pointer position in world cells (ptX, ptY); false over the sidebar, the
   frame, or uncovered page text. */
function pointerOnField(cx, cy) {
  if (!cols) return false;
  const x = (cx + stage.scrollLeft) / cell, y = cy / cell;
  ptX = x;
  ptY = y;
  const i = Math.floor(x), j = Math.floor(y);
  if (j >= 1 && j < rows - 1 && i >= homeRight && i < colorLeft && cellOpen[j * cols + i] === 1) return false;
  return x >= homeRight && x < cols - 1 && y >= 1 && y < rows - 1;
}

function stampWake(cx, cy, force) {
  if (!pointerOnField(cx, cy)) return;
  if (!force && wakeCount) {
    const s = (wakeHead + wakeCount - 1) % WAKE_MAX;
    // A new point every 0.62 cells of travel or every 35ms.
    if (Math.hypot(ptX - wakeX[s], ptY - wakeY[s]) < WAKE_GAP && realT - wakeT[s] < 0.035) return;
  }
  let slot;
  if (wakeCount < WAKE_MAX) { slot = (wakeHead + wakeCount) % WAKE_MAX; wakeCount++; }
  else { slot = wakeHead; wakeHead = (wakeHead + 1) % WAKE_MAX; }
  wakeX[slot] = ptX;
  wakeY[slot] = ptY;
  wakeT[slot] = realT;
}

function addSpark(cx, cy, strong, force) {
  if (!pointerOnField(cx, cy)) return;
  // One spark per half-cell entered.
  const key = ((ptX * 2) | 0) + ((ptY * 2) | 0) * 4096;
  if (key === lastSparkKey && !force) return;
  lastSparkKey = key;
  let slot;
  if (sparkCount < SPARK_MAX) { slot = (sparkHead + sparkCount) % SPARK_MAX; sparkCount++; }
  else { slot = sparkHead; sparkHead = (sparkHead + 1) % SPARK_MAX; }
  sparkX[slot] = ptX;
  sparkY[slot] = ptY;
  sparkAge[slot] = 0;
  sparkR[slot] = strong ? 12 : 6.5;
  sparkA[slot] = strong ? 0.85 : 0.38;
}

function onPointerDown(e) {
  if (manifestoState) return;
  const t = e.target;
  if (t instanceof Node && (deck.contains(t) || paneStack.contains(t))) return;
  dragging = true;
  stampWake(e.clientX, e.clientY, true);
  addSpark(e.clientX, e.clientY, true, true);
}
function onPointerMove(e) {
  if (manifestoState) return;
  const t = e.target;
  if (t instanceof Node && paneStack.contains(t)) return;
  stampWake(e.clientX, e.clientY, false);
  addSpark(e.clientX, e.clientY, dragging, false);
}
function endDrag() {
  dragging = false;
}

function preparePointer(dt) {
  while (wakeCount && realT - wakeT[wakeHead] > WAKE_LIFE) {
    wakeHead = (wakeHead + 1) % WAKE_MAX;
    wakeCount--;
  }
  wkN = 0;
  for (let n = 0; n < wakeCount; n++) {
    const s = (wakeHead + n) % WAKE_MAX;
    const delayed = realT - wakeT[s] - WAKE_DELAY;   // each point lights 70ms late
    if (delayed < 0) continue;
    const life = 1 - delayed / WAKE_FADE;
    if (life <= 0) continue;
    const spread = 0.42 + delayed * 2.1;
    wkX[wkN] = wakeX[s];
    wkY[wkN] = wakeY[s];
    wkFade[wkN] = life * life;
    wkInv[wkN] = 1 / (spread * spread * 0.28);
    wkRing[wkN] = delayed * 6.5;                     // ring radius, 6.5 cells/s
    wkN++;
  }
  for (let n = 0; n < sparkCount; n++) sparkAge[(sparkHead + n) % SPARK_MAX] += dt;
  while (sparkCount && sparkAge[sparkHead] > 1.5) {
    sparkHead = (sparkHead + 1) % SPARK_MAX;
    sparkCount--;
  }
  spN = 0;
  for (let n = 0; n < sparkCount; n++) {
    const s = (sparkHead + n) % SPARK_MAX;
    spX[spN] = sparkX[s];
    spY[spN] = sparkY[s];
    spInvR[spN] = 1 / sparkR[s];
    spAmp[spN] = Math.exp(-sparkAge[s] / 0.55) * sparkA[s];
    spN++;
  }
}

/* ======================================================================
   14. Sound
   ====================================================================== */

const soundConfig = SITE.sound === false ? null : SITE.sound && typeof SITE.sound === "object" ? SITE.sound : {};
const AudioCtor = window.AudioContext || window.webkitAudioContext || null;
const soundSrc = soundConfig ? txt(soundConfig.src) : "";
const soundEnabled = !!soundConfig && (!!AudioCtor || (!!soundSrc && typeof Audio === "function"));
const soundVolume = soundConfig && typeof soundConfig.volume === "number" ? clamp(soundConfig.volume, 0, 1) : 0.8;
const soundShortcut = soundEnabled && soundConfig.shortcut !== false; // the M key
const SOUND_KEY = slugify(siteName) + "-sound";
const PAD_LEVEL = 0.55;
/* A slow cycle of warm, open chords (MIDI notes): Dmaj9, Bm11, Gmaj9, A add9. */
const PAD_CHORDS = [[50, 57, 61, 64, 66], [47, 54, 57, 62, 64], [43, 50, 54, 57, 59], [45, 52, 57, 59, 61]];

let soundPref = null;        // "on" | "off" | null, remembered per browser
let soundOn = false;         // actually playing (drives the icon)
let soundPending = false;
let soundArmed = false;
let soundBroken = false;     // the audio file can't be decoded or found
let soundInterrupted = false; // the OS suspended playback (iOS lock screen, a call)
let actx = null, master = null, padInput = null, padBank = null, padChord = 0, padTimer = 0, sleepTimer = 0;
let media = null, mediaRouted = false, mediaFadeTimer = 0;

function readSoundPref() {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch (_) { return null; }
}
function writeSoundPref(v) {
  soundPref = v;
  try { localStorage.setItem(SOUND_KEY, v); } catch (_) {}
}
function dataSaving() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (c && c.saveData) return true;
  try { return !!(window.matchMedia && matchMedia("(prefers-reduced-data: reduce)").matches); } catch (_) { return false; }
}
function hasActivation() {
  const ua = navigator.userActivation;
  return ua ? ua.isActive : true;
}
function isEditable(t) {
  return t instanceof Element && !!t.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

/* The icon shows "on" from the moment a start is requested, so a second
   click reads as "turn it off" rather than "nothing happened, try again". */
function renderSound() {
  const button = doc.getElementById("sound-toggle");
  if (!button) return;
  const on = soundOn || soundPending;
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.title = on ? "Turn sound off" : "Turn sound on";
}

function ensureAudioGraph() {
  if (actx || !AudioCtor) return actx;
  try { actx = new AudioCtor(); } catch (_) { actx = null; return null; }
  master = actx.createGain();
  master.gain.value = 0;
  master.connect(actx.destination);
  actx.onstatechange = onAudioState;
  return actx;
}

/* The browser can suspend a running context on its own (iOS does on screen
   lock, app switch or a call). Show "off" without touching the visitor's
   saved choice, and resume on their next gesture, or by itself if the
   system hands the audio back. */
function onAudioState() {
  if (!actx || (soundSrc && !mediaRouted)) return;
  if (actx.state === "running") {
    if (soundInterrupted && !soundOn && !soundPending) {
      soundInterrupted = false;
      disarmSound();
      soundOn = true;
      renderSound();
      if (!soundSrc) schedulePad();
    }
    return;
  }
  if (!soundOn || soundPending) return;
  soundInterrupted = true;
  soundOn = false;
  clearTimeout(padTimer);
  renderSound();
  armSound(true);
}

function rampMaster(target, seconds) {
  if (!actx || !master) return;
  const now = actx.currentTime, g = master.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(target, now + seconds);
}

function makeImpulse(seconds) {
  const rate = actx.sampleRate, length = Math.max(1, Math.floor(rate * seconds));
  const buffer = actx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let n = 0; n < length; n++) data[n] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, 3.2);
  }
  return buffer;
}

/* Soft lowpassed pad with a slow filter sweep and a little room. */
function buildPadChain() {
  if (padInput) return;
  const filter = actx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  filter.Q.value = 0.5;
  const sweep = actx.createOscillator();
  sweep.frequency.value = 0.043;
  const sweepDepth = actx.createGain();
  sweepDepth.gain.value = 380;
  sweep.connect(sweepDepth);
  sweepDepth.connect(filter.frequency);
  sweep.start();
  const dry = actx.createGain();
  dry.gain.value = 0.75;
  const wet = actx.createGain();
  wet.gain.value = 0.5;
  const room = actx.createConvolver();
  room.buffer = makeImpulse(3.4);
  filter.connect(dry);
  dry.connect(master);
  filter.connect(room);
  room.connect(wet);
  wet.connect(master);
  padInput = filter;
}

const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

/* Each chord is a bank of detuned sine + triangle voices, each swelling on
   its own slow cycle; banks crossfade over several seconds. */
function playPadChord(index, fade) {
  const now = actx.currentTime;
  const bank = actx.createGain();
  bank.gain.setValueAtTime(0, now);
  bank.gain.linearRampToValueAtTime(1, now + fade);
  bank.connect(padInput);
  const nodes = [];
  const chord = PAD_CHORDS[index];
  for (let k = 0; k < chord.length; k++) {
    const hz = midiHz(chord[k]);
    const amp = k === 0 ? 0.05 : 0.034;
    const voice = actx.createGain();
    voice.gain.value = amp;
    voice.connect(bank);
    const swell = actx.createOscillator();
    swell.frequency.value = 0.023 + k * 0.011;
    const swellDepth = actx.createGain();
    swellDepth.gain.value = amp * 0.45;
    swell.connect(swellDepth);
    swellDepth.connect(voice.gain);
    const sine = actx.createOscillator();
    sine.type = "sine";
    sine.frequency.value = hz;
    sine.detune.value = -6;
    const tri = actx.createOscillator();
    tri.type = "triangle";
    tri.frequency.value = hz;
    tri.detune.value = 7;
    const triLevel = actx.createGain();
    triLevel.gain.value = 0.3;
    sine.connect(voice);
    tri.connect(triLevel);
    triLevel.connect(voice);
    sine.start(now);
    tri.start(now);
    swell.start(now);
    nodes.push(sine, tri, swell);
  }
  const previous = padBank;
  padBank = { gain: bank, nodes };
  if (previous) {
    const g = previous.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade + 1);
    for (const node of previous.nodes) {
      try { node.stop(now + fade + 1.2); } catch (_) {}
    }
    setTimeout(() => { try { previous.gain.disconnect(); } catch (_) {} }, (fade + 2) * 1000);
  }
}

function schedulePad() {
  clearTimeout(padTimer);
  padTimer = setTimeout(() => {
    if (!soundOn || !actx || soundSrc) return;
    padChord = (padChord + 1) % PAD_CHORDS.length;
    playPadChord(padChord, 5);
    schedulePad();
  }, 12000);
}

/* "/assets/soundtrack.mp3" is relative to the site's folder, like every
   root-relative address in content.js; full URLs are used as they are. */
function mediaSource() {
  if (soundSrc[0] === "/" && soundSrc[1] !== "/") return siteHref(soundSrc);
  return soundSrc;
}

function ensureMedia() {
  if (media) return media;
  media = new Audio();
  media.loop = true;
  media.preload = "none";
  media.setAttribute("playsinline", "");
  media.src = mediaSource();
  media.addEventListener("error", () => {
    const err = media.error;
    soundBroken = !!err && (err.code === 3 || err.code === 4); // decode / unsupported (includes 404s)
    soundPending = false;
    soundOn = false;
    renderSound();
  });
  media.addEventListener("pause", () => {
    // Paused from outside (media keys, headphones out): just show "off".
    if (soundOn && media.paused) {
      soundOn = false;
      renderSound();
    }
  });
  return media;
}

/* Route a same-origin file through Web Audio so fades work everywhere
   (iOS ignores element volume). Cross-origin files play directly. */
function routeMedia() {
  if (mediaRouted || !media) return;
  let sameOrigin = false;
  try { sameOrigin = !FILE_MODE && new URL(media.src, location.href).origin === location.origin; } catch (_) {}
  if (!sameOrigin || !ensureAudioGraph()) return;
  try {
    actx.createMediaElementSource(media).connect(master);
    mediaRouted = true;
  } catch (_) {}
}

function fadeMediaVolume(target, seconds, done) {
  clearInterval(mediaFadeTimer);
  const from = media.volume, started = performance.now();
  mediaFadeTimer = setInterval(() => {
    const u = Math.min(1, (performance.now() - started) / (seconds * 1000));
    try { media.volume = from + (target - from) * u; } catch (_) {}
    if (u >= 1) {
      clearInterval(mediaFadeTimer);
      if (done) done();
    }
  }, 40);
}

function playSound(remember) {
  if (!soundEnabled) return;
  if (!remember && soundBroken) return;
  if (remember) soundBroken = false;
  clearTimeout(sleepTimer);
  disarmSound();
  soundPending = true;
  renderSound();
  const started = () => {
    if (!soundPending) return;
    soundPending = false;
    soundInterrupted = false;
    soundOn = true;
    if (remember) writeSoundPref("on");
    renderSound();
  };
  const failed = err => {
    soundPending = false;
    soundOn = false;
    renderSound();
    // An automatic start that the browser refused retries on the next gesture.
    if (!remember && !soundBroken && err && err.name !== "AbortError") armSound(soundInterrupted);
  };

  if (soundSrc) {
    ensureMedia();
    routeMedia();
    if (mediaRouted) {
      media.volume = 1;
      actx.resume().catch(() => {});
      rampMaster(soundVolume, 1.2);
    } else {
      try { media.volume = 0; } catch (_) {}
    }
    let promise;
    try { promise = media.play(); } catch (err) { failed(err); return; }
    Promise.resolve(promise).then(() => {
      started();
      if (!mediaRouted && soundOn) fadeMediaVolume(soundVolume, 1.2);
    }, failed);
    return;
  }

  if (!ensureAudioGraph()) { failed({ name: "NotSupportedError" }); return; }
  buildPadChain();
  if (!padBank) playPadChord(padChord, 2.5);
  rampMaster(PAD_LEVEL * soundVolume, 1.2);
  actx.resume().then(() => {
    if (actx.state === "running") {
      started();
      if (soundOn) schedulePad();
    } else {
      failed({ name: "NotAllowedError" });
    }
  }, failed);
}

function pauseSound(remember) {
  soundPending = false;
  soundOn = false;
  soundInterrupted = false;
  disarmSound();
  if (remember) writeSoundPref("off");
  clearTimeout(padTimer);
  if (media && !mediaRouted) {
    fadeMediaVolume(0, 1, () => { if (!soundOn && !soundPending) media.pause(); });
  } else {
    rampMaster(0, 1);
  }
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    if (soundOn || soundPending) return;
    if (media && !media.paused) media.pause();
    if (actx && actx.state === "running") actx.suspend().catch(() => {});
  }, 1100);
  renderSound();
}

function toggleSound() {
  if (!soundEnabled) return;
  if (soundOn || soundPending) pauseSound(true);
  else playSound(true);
}

/* Browsers only allow sound after a gesture. Visitors who turned sound on
   before (or every visitor, with autoStart) get it on their first click or key.
   `resume` re-arms after an interruption, whatever started the sound. */
function armSound(resume) {
  if (soundArmed || !soundEnabled || soundBroken) return;
  const wanted = resume === true || soundPref === "on" ||
    (soundConfig.autoStart === true && soundPref !== "off" && !dataSaving());
  if (!wanted) return;
  soundArmed = true;
  doc.addEventListener("pointerdown", onSoundGesture, { capture: true, passive: true });
  doc.addEventListener("click", onSoundGesture, { capture: true, passive: true });
  doc.addEventListener("keydown", onSoundGesture, true);
}
function disarmSound() {
  if (!soundArmed) return;
  soundArmed = false;
  doc.removeEventListener("pointerdown", onSoundGesture, true);
  doc.removeEventListener("click", onSoundGesture, true);
  doc.removeEventListener("keydown", onSoundGesture, true);
}
function onSoundGesture(e) {
  if (e.type === "keydown" && (e.repeat || isEditable(e.target))) return;
  // The toggle and the M key handle themselves.
  if (e.target instanceof Element && e.target.closest(".sound-toggle")) return;
  if (soundShortcut && e.type === "keydown" && String(e.key || "").toLowerCase() === "m") return;
  // A touch pointerdown carries no activation; wait for the click after it.
  if (!hasActivation()) return;
  disarmSound();
  if (soundPref !== "off") playSound(false);
}

function initSound() {
  if (!soundEnabled) return;
  soundPref = readSoundPref();
  renderSound();
  armSound();
  if (soundSrc) {
    const wanted = soundPref === "on" || (soundConfig.autoStart === true && soundPref !== "off" && !dataSaving());
    if (!wanted) return;
    const preload = () => {
      ensureMedia();
      if (media.preload !== "auto") {
        media.preload = "auto";
        try { media.load(); } catch (_) {}
      }
    };
    const idle = () => {
      if (window.requestIdleCallback) requestIdleCallback(preload, { timeout: 1800 });
      else setTimeout(preload, 800);
    };
    if (doc.readyState === "complete") idle();
    else addEventListener("load", idle, { once: true });
  }
}

/* Email button: copy to the clipboard, say so for 3.5s. If copying isn't
   possible, the button turns into the address itself, as a mailto: link. */
let emailTimer = 0;
function legacyCopy(value) {
  const previous = doc.activeElement;
  const area = el("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  // 16px keeps iOS from zooming in on the (invisible) field.
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px";
  doc.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, value.length); // iOS selects nothing without this
  let ok = false;
  try { ok = doc.execCommand("copy"); } catch (_) {}
  area.remove();
  if (previous && previous.focus) previous.focus({ preventScroll: true });
  return ok;
}
async function copyEmail(button) {
  clearTimeout(emailTimer);
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(email);
      ok = true;
    }
  } catch (_) {}
  if (!ok) ok = legacyCopy(email);
  if (!ok) {
    showEmailAddress(button);
    return;
  }
  button.textContent = "Email copied";
  button.setAttribute("aria-label", "Email copied");
  emailTimer = setTimeout(() => {
    button.textContent = "Email";
    button.setAttribute("aria-label", "Copy email address");
  }, 3500);
}
function showEmailAddress(button) {
  const link = el("a", "email-copy email-address", email);
  link.href = "mailto:" + email;
  const hadFocus = doc.activeElement === button;
  button.replaceWith(link);
  if (hadFocus) link.focus({ preventScroll: true });
}

/* ======================================================================
   15. Favicon (a squircle in the colour of the bottom-right tile)
   ====================================================================== */

let favLink = doc.querySelector('link[rel~="icon"]');
const favCanvas = doc.createElement("canvas");
favCanvas.width = favCanvas.height = 64;
const favCtx = favCanvas.getContext("2d");
const FAV_FALLBACK = assetURL("assets/favicon.svg");
const SQUIRCLE = new Float32Array(130);
(() => {
  const n = 3.6, r = 30, c = 32;
  for (let k = 0; k <= 64; k++) {
    const t = (k / 64) * TAU, ct = Math.cos(t), st = Math.sin(t);
    SQUIRCLE[k * 2] = c + r * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n);
    SQUIRCLE[k * 2 + 1] = c + r * Math.sign(st) * Math.pow(Math.abs(st), 2 / n);
  }
})();
let cornerFill = ACCENT, favShown = "", favAt = -1, favURL = "", favBusy = false;

function setFavicon(href, type) {
  const next = doc.createElement("link");
  next.rel = "icon";
  next.type = type;
  if (type === "image/png") next.setAttribute("sizes", "64x64");
  next.href = href;
  // Replacing the element (not its href) is what makes tabs refresh the icon.
  if (favLink && favLink.parentNode) favLink.replaceWith(next);
  else doc.head.appendChild(next);
  favLink = next;
}

function updateFavicon() {
  if (doc.hidden || !favCtx || !favCanvas.toBlob || favBusy) return;
  if (cornerFill === favShown || realT - favAt < 0.24) return;
  favShown = cornerFill;
  favAt = realT;
  favBusy = true;
  favCtx.clearRect(0, 0, 64, 64);
  favCtx.fillStyle = cornerFill;
  favCtx.beginPath();
  favCtx.moveTo(SQUIRCLE[0], SQUIRCLE[1]);
  for (let k = 1; k <= 64; k++) favCtx.lineTo(SQUIRCLE[k * 2], SQUIRCLE[k * 2 + 1]);
  favCtx.closePath();
  favCtx.fill();
  favCanvas.toBlob(blob => {
    favBusy = false;
    if (!blob || doc.hidden) return;
    const url = URL.createObjectURL(blob);
    setFavicon(url, "image/png");
    if (favURL) URL.revokeObjectURL(favURL);
    favURL = url;
  }, "image/png");
}

function showFallbackFavicon() {
  favShown = "";
  setFavicon(FAV_FALLBACK, "image/svg+xml");
  if (favURL) {
    URL.revokeObjectURL(favURL);
    favURL = "";
  }
}

/* ======================================================================
   16. Frame loop and renderer
   ====================================================================== */

let raf = 0, last = 0;
let realT = 0;        // real seconds (clamped per frame), pauses while hidden
let openT = 0;        // intro clock
let fieldT = 0;       // field clock: 1.3675x real time, frozen under reduced motion
let hueSpin = 0;
let revealP = 0, sweepDone = false;

/* The bloom opens on the palette's brightest colours (lemon, for amber):
   once, before the first splash frame, pick the hue phase that makes the
   early bloom disk (centre-weighted) as luminous as possible. */
let bloomAimed = false;
const AIM_R = 18, AIM_STEPS = 128;
function aimBloom() {
  bloomAimed = true;
  if (reducedMotion || sweepDone) return;
  const lum = new Float32Array(LUT_SIZE);
  for (let k = 0; k < LUT_SIZE; k++) {
    const o = k * 3;
    lum[k] = 0.2126 * lut[o] + 0.7152 * lut[o + 1] + 0.0722 * lut[o + 2];
  }
  const T = fieldT, base = T * CFG.hueCycle + hueSpin;
  const pos = [], wt = [];
  for (let dj = -AIM_R; dj <= AIM_R; dj += 2) {
    for (let di = -AIM_R; di <= AIM_R; di += 2) {
      const d = Math.hypot(di, dj);
      if (d > AIM_R) continue;
      const i = si + di, j = sj + dj;
      pos.push(fbm(i * CFG.colorScale + T * CFG.colorDrift, j * CFG.colorScale + T * CFG.colorDriftY, T * CFG.colorEvolve) + base);
      wt.push(1 - d / (AIM_R + 1));
    }
  }
  let bestO = 0, bestScore = -1;
  for (let s = 0; s < AIM_STEPS; s++) {
    const o = s / AIM_STEPS;
    let score = 0;
    for (let k = 0; k < pos.length; k++) {
      const p = pos[k] + o;
      score += wt[k] * lum[((p - Math.floor(p)) * LUT_SIZE) | 0];
    }
    if (score > bestScore) { bestScore = score; bestO = o; }
  }
  hueSpin += bestO;
}

// Per-frame field constants, shared with baseFill().
let fBx = 0, fBy = 0, fBz = 0, fCx = 0, fCy = 0, fCz = 0, fHue = 0, fDim = CFG.dim;

function tileFill(s, b) {
  if (b > 1) b = 1;
  else if (b < 0) b = 0;
  s -= Math.floor(s);
  const idx = (s * LUT_SIZE) | 0, bq = (b * 63) | 0, key = (idx << 6) | bq;
  if (fillStamp[key] === fillEpoch) return fillCache[key];
  // Brightness is a plain multiply: a dim tile is a darker shade of its hue.
  const m = (bq + 0.5) / 64, o = idx * 3;
  const fill = "rgb(" + ((lut[o] * m) | 0) + "," + ((lut[o + 1] * m) | 0) + "," + ((lut[o + 2] * m) | 0) + ")";
  fillCache[key] = fill;
  fillStamp[key] = fillEpoch;
  return fill;
}

function baseBrightness(i, j) {
  let b = fbm(i * CFG.waveScale + fBx, j * CFG.waveScale + fBy, fBz);
  b = (b - CFG.threshold) / (1 - CFG.threshold);
  b = b <= 0 ? 0 : Math.pow(b, CFG.gamma);
  return (CFG.floor + (1 - CFG.floor) * (b > 1 ? 1 : b)) * fDim;
}
function basePosition(i, j) {
  return fbm(i * CFG.colorScale + fCx, j * CFG.colorScale + fCy, fCz) + fHue;
}

function draw() {
  const colsL = cols, rowsL = rows, open = cellOpen;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Only columns near the viewport are drawn (with a generous margin).
  const scroll = stage.scrollLeft;
  const iMin = Math.max(0, Math.floor(scroll / cell) - CFG.cullCells);
  const iMax = Math.min(colsL - 1, Math.ceil((scroll + viewportW) / cell) + CFG.cullCells);

  // Holes: clear whole cells (gap included) wherever a page is uncovered.
  if (mountedDepth() > 0) {
    const a = Math.max(homeRight, iMin), z = Math.min(colorLeft - 1, iMax);
    for (let j = 1; j < rowsL - 1; j++) {
      const row = j * colsL;
      let run = -1;
      for (let i = a; i <= z + 1; i++) {
        if (i <= z && open[row + i] === 1) {
          if (run < 0) run = i;
        } else if (run >= 0) {
          ctx.clearRect(run * cell, j * cell, (i - run) * cell, cell);
          run = -1;
        }
      }
    }
  }

  let fieldEdge = colorLeft;
  for (let k = 0; k < waves.length; k++) {
    const r = waves[k].right + WAVE_FIELD_PAD;
    if (r > fieldEdge) fieldEdge = r;
  }
  const lightRight = Math.min(colsL - 1, Math.max(colorLeft + ambientCols(), fieldEdge));

  // Unlit tiles: the outer ring and the column that bounds the light field.
  ctx.fillStyle = UNLIT;
  const bottomY = (rowsL - 1) * cell;
  for (let i = iMin; i <= iMax; i++) {
    ctx.fillRect(i * cell, 0, tile, tile);
    ctx.fillRect(i * cell, bottomY, tile, tile);
  }
  for (let j = 1; j < rowsL - 1; j++) {
    const y = j * cell;
    if (iMin === 0) ctx.fillRect(0, y, tile, tile);
    if (iMax === colsL - 1) ctx.fillRect((colsL - 1) * cell, y, tile, tile);
    if (lightRight < colsL - 1 && lightRight >= iMin && lightRight <= iMax) ctx.fillRect(lightRight * cell, y, tile, tile);
  }

  // Field constants for this frame.
  const T = fieldT;
  fBx = T * CFG.waveDriftX;
  fBy = T * CFG.waveDriftY;
  fBz = T * CFG.waveEvolve + 47.1 + fieldSeed;
  fCx = T * CFG.colorDrift;
  fCy = T * CFG.colorDriftY;
  fCz = T * CFG.colorEvolve;
  fHue = T * CFG.hueCycle + hueSpin;
  fDim = reducedMotion ? 1 : CFG.dim;
  const bx = fBx, by = fBy, bz = fBz, cx = fCx, cy = fCy, cz = fCz, hue = fHue, dim = fDim;
  const WS = CFG.waveScale, CS = CFG.colorScale, TH = CFG.threshold, INV_TH = 1 / (1 - CFG.threshold);
  const GAMMA = CFG.gamma, FLOOR = CFG.floor;
  const splashing = !sweepDone, radius = revealP * maxRevealD, sx = si, sy = sj, jagL = jag;
  const hasWaves = waves.length > 0, wakeN = wkN, sparkN = spN;
  const favI = colsL - 2, favJ = rowsL - 2;
  let favSeen = false;

  const i0 = Math.max(iMin, homeRight), i1 = Math.min(iMax, lightRight - 1);
  for (let j = 1; j < rowsL - 1; j++) {
    const py = j * cell, row = j * colsL;
    for (let i = i0; i <= i1; i++) {
      let paneDepth = 0, state = null;
      if (i < colorLeft) {
        paneDepth = ((i - homeRight) / paneCols | 0) + 1;
        state = paneStates[paneDepth];
        if (!state) continue;
      }
      const px = i * cell;

      // 1. Ambient field: brightness (floored, never dark) and palette position.
      let b = fbm(i * WS + bx, j * WS + by, bz);
      b = (b - TH) * INV_TH;
      b = b <= 0 ? 0 : Math.pow(b, GAMMA);
      b = (FLOOR + (1 - FLOOR) * (b > 1 ? 1 : b)) * dim;
      let s = fbm(i * CS + cx, j * CS + cy, cz) + hue;

      // 2. Pointer wake: a delayed glow plus a ring expanding at 6.5 cells/s.
      if (wakeN) {
        let g = 0;
        const tx = i + 0.5, ty = j + 0.5;
        for (let k = 0; k < wakeN; k++) {
          const dx = tx - wkX[k], dy = ty - wkY[k];
          if (dx > 5 || dx < -5 || dy > 5 || dy < -5) continue;
          const d2 = dx * dx + dy * dy;
          const ring = Math.sqrt(d2) - wkRing[k];
          g += wkFade[k] * (0.22 * Math.exp(-d2 * wkInv[k]) + 0.28 * Math.exp(-(ring * ring) / 0.7));
        }
        if (g > 0.004) { b += g; s += g * 0.09; }
      }

      // 3. Sparks.
      for (let k = 0; k < sparkN; k++) {
        const ax = i - spX[k], ay = j - spY[k];
        if (ax > 8 || ax < -8 || ay > 8 || ay < -8) continue;
        const g = Math.exp(-(ax * ax + ay * ay) * spInvR[k]) * spAmp[k];
        b += g;
        s += g * 0.1;
      }

      // 4. Wipe crests, switch band, and the pane mask.
      const glow = hasWaves ? waveLight(i, j, paneDepth) : 0;
      if (!paneDepth) {
        if (glow > 0.002) b = expose(b, glow);
      } else {
        let cover = 0, edge = 0;
        const switches = state.switches;
        for (let k = 0; k < switches.length; k++) {
          const tr = switches[k];
          const c = tr.center[i], h = tr.half[i];
          const e = Math.min(j - (c - h), (c + h) - j);
          const cv = sm(clamp01(e + 1));
          if (cv > cover) cover = cv;
          const q = e / 2.2;
          const eg = 0.85 * Math.exp(-2.2 * q * q);
          if (eg > edge) edge = eg;
        }
        if (cover > 0.01) {
          // The band is opaque between tiles too, so text never leaks through gaps.
          ctx.fillStyle = BG;
          ctx.fillRect(px, py, cell, cell);
          b = expose(b * cover, edge);
        } else if (open[row + i] === 1) {
          // Uncovered text stays visible unless a crest is passing over it;
          // then a full field tile is drawn (this trails the text edge ~6 cols).
          if (glow <= 0.012) continue;
          ctx.fillStyle = BG;
          ctx.fillRect(px, py, cell, cell);
          b = expose(b, glow);
        } else {
          b = expose(b, glow);
        }
      }

      // 5. Intro bloom: a smoothstep-growing disc with a frozen ragged rim
      //    and a bright ring riding the front. Tiles outside stay background.
      if (splashing) {
        const dx = i - sx, dy = j - sy;
        const e = radius - Math.sqrt(dx * dx + dy * dy) + jagL[row + i];
        b = b * sm(e / CFG.revealSoft) + 0.8 * Math.exp(-(e * e) / 5);
        if (b < 0.02) continue;
      }

      const fill = tileFill(s, b);
      ctx.fillStyle = fill;
      ctx.fillRect(px, py, tile, tile);
      if (i === favI && j === favJ) {
        cornerFill = fill;
        favSeen = true;
      }
    }
  }

  // The favicon follows the bottom-right tile even when it's culled.
  if (!favSeen && sweepDone && favI >= colorLeft && favI < lightRight && (favI < i0 || favI > i1)) {
    cornerFill = tileFill(basePosition(favI, favJ), baseBrightness(favI, favJ));
  }
}

function frame(now) {
  raf = 0;
  if (setupPending) {
    setupPending = false;
    setup();
  }
  let dt = (now - last) / 1000;
  if (!(dt > 0)) dt = 0;
  else if (dt > 0.05) dt = 0.05; // a hitch slows animation instead of skipping it
  last = now;
  realT += dt;
  if (!reducedMotion) hueSpin += dt * CFG.hueSpin;
  openT += dt;

  updateWaves(reducedMotion ? Math.max(dt, 1) : dt);
  colorLeft = homeRight + mountedDepth() * paneCols;
  advanceSwitches(dt);
  finishClosedSuffix();
  syncPaneInteractivity();
  stepPalette(dt);
  stepCamera(dt);
  syncCloseControls();

  if (!reducedMotion) fieldT += dt * CFG.timeScale;
  if (!bloomAimed) aimBloom();
  revealP = reducedMotion ? 1 : sm(openT / CFG.revealIn);
  if (revealP >= 1) sweepDone = true;

  preparePointer(dt);
  draw();
  updateFavicon();
  raf = requestAnimationFrame(frame);
}

/* The Manifesto covers the whole screen, so the wall stops underneath it and
   resumes exactly where it was (the clock skips the time it was away). */
let wallPaused = false;
function pauseWall() {
  wallPaused = true;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}
function resumeWall() {
  if (!wallPaused) return;
  wallPaused = false;
  if (raf || doc.hidden) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function onMotionChange() {
  reducedMotion = !!(motionQuery && motionQuery.matches);
  if (!reducedMotion) return;
  for (let d = 1; d <= mountedDepth(); d++) {
    settleBand(d, d, !paneStates[d] || paneStates[d].intentOpen !== false);
  }
  finishClosedSuffix();
  panToDepth(intendedDepth(), { animate: false, opening: camT < 1 && camOpening });
}

/* ======================================================================
   17. Events and boot
   ====================================================================== */

deck.addEventListener("click", onContentClick);
paneStack.addEventListener("click", onContentClick);
deck.addEventListener("click", e => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  if (t.closest(".sound-toggle")) toggleSound();
  else {
    const button = t.closest("button.email-copy");
    if (button) copyEmail(button);
  }
});

// Hovering a sidebar link previews its page's palette, unless a page with a
// palette of its own is already open.
deck.addEventListener("pointerover", e => {
  const a = e.target instanceof Element ? e.target.closest("a[data-page-id]") : null;
  if (!a || paletteLocked) return;
  const page = pageById[a.dataset.pageId];
  if (page && page.palette) applyPalette(page.palette, false);
});
deck.addEventListener("pointerout", e => {
  const a = e.target instanceof Element ? e.target.closest("a[data-page-id]") : null;
  if (!a || paletteLocked) return;
  if (e.relatedTarget instanceof Node && a.contains(e.relatedTarget)) return;
  applyPalette(null, false);
});

doc.addEventListener("pointerdown", onPointerDown, { passive: true });
doc.addEventListener("pointermove", onPointerMove, { passive: true });
doc.addEventListener("pointerup", endDrag, { passive: true });
doc.addEventListener("pointercancel", endDrag, { passive: true });

stage.addEventListener("wheel", onWheel, { passive: false });
stage.addEventListener("touchstart", onTouchStart, { passive: true });
stage.addEventListener("touchmove", onTouchMove, { passive: false });
stage.addEventListener("touchend", onTouchEnd, { passive: false });
stage.addEventListener("touchcancel", () => { camInertia = 0; touch = null; }, { passive: true });
stage.addEventListener("click", e => {
  if (performance.now() >= suppressClickUntil) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isEditable(e.target)) return;
  if (manifestoState) {
    // The open Manifesto handles its own keys; until it has loaded, Escape closes it.
    if (e.key === "Escape" && !manifestoState.instance) {
      e.preventDefault();
      requestManifestoClose({ keyboard: true });
    }
    return;
  }
  if (e.key === "Escape") {
    if (intendedDepth() > 0) {
      e.preventDefault();
      closeDeepest();
    }
  } else if (soundShortcut && (e.key === "m" || e.key === "M")) {
    toggleSound();
  }
});

addEventListener("popstate", onHistoryChange);
if (FILE_MODE) addEventListener("hashchange", onHistoryChange);

addEventListener("resize", scheduleSetup);
addEventListener("orientationchange", scheduleSetup);
if (window.visualViewport) visualViewport.addEventListener("resize", scheduleSetup);
// Only the stage scrolls; keep the document pinned.
addEventListener("scroll", () => { if (window.scrollX || window.scrollY) scrollTo(0, 0); }, { passive: true });

// No context menu on the wall; pages (and the Manifesto) keep theirs.
doc.addEventListener("contextmenu", e => {
  if (!(e.target instanceof Element) || !e.target.closest(".pane, #manifesto")) e.preventDefault();
});

if (motionQuery) {
  if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotionChange);
  else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
}

doc.addEventListener("visibilitychange", () => {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  if (doc.hidden) {
    showFallbackFavicon();
    return;
  }
  if (wallPaused) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
});
addEventListener("pageshow", e => {
  if (e.persisted) last = performance.now();
});

/* Boot: mount the route's whole stack at once (no wipes), lay out, snap the
   palette and camera. The intro bloom is the only motion on load. A deep link
   to /manifesto boots the stack it was opened over (just the sidebar on a
   first visit) and opens the Manifesto on top; the bloom then plays when it
   closes. */
const startManifesto = isManifestoPath(routePathFromLocation());
const bootState = history.state;
const startRoute = startManifesto ? { page: home, needsReplace: false } : routeFromLocation();
const savedStack = startManifesto && bootState && Array.isArray(bootState.siteStack) ? validStack(bootState.siteStack) : null;
requestPageStack(savedStack || primaryChainFor(startRoute.page), { initial: true });
initSound();
setup();
snapPalette();
panToDepth(mountedDepth(), { animate: false, opening: mountedDepth() > 0 });
syncPaneInteractivity();
// A reload keeps the entry's own way back.
const startBack = !!(startManifesto && bootState && bootState.manifestoBack === true);
commitHistory("replace", startManifesto ? MANIFESTO_PATH : startRoute.page.path, desiredIds, true,
  startManifesto ? { manifestoBack: startBack } : null);
syncMetadata(startRoute.page);
injectStructuredData();
deck.classList.add("show");
deck.setAttribute("aria-hidden", "false");
last = performance.now();
raf = requestAnimationFrame(frame);
if (startManifesto) openManifesto({ back: startBack });
}
})();

/*!
 * manifesto.js - the Manifesto overlay of the light-wall portfolio.
 *
 * assets/site.js loads this file the first time /manifesto opens, together
 * with assets/manifesto.css and the text (manifesto.js at the site's root).
 * site.js owns the overlay element (#manifesto, a full-screen dialog), the
 * address, history and the paused wall; this file owns what happens inside:
 *
 *   A  GHOST        ~4.4s  black; the opening picture warms up like a CRT and
 *                          pushes in; green data streams sweep across it;
 *                          terminal lines type out; a glitch; hard cut.
 *   B  TITLE CARD   ~3.5s  black; the title cuts in line by line, each with a
 *                          one-frame flash; a flickering hold; hard cut.
 *   C  COLLAGE      rest   a dense typographic poster cuts in block by block;
 *                          below it, just the manifesto: its title centred on
 *                          a screen of its own, then the text in one centred
 *                          column, then RETURN and REPLAY.
 *
 * One clock drives A, B and C's entrance. It only advances inside
 * requestAnimationFrame (so it stops while the tab is hidden) and the loop
 * ends as soon as C has settled. Click, tap, Space or Enter skip ahead;
 * Escape closes. With reduced motion, C shows at once and REPLAY plays a
 * calm version (fades only: no flicker, glitch, grain, streams or montage).
 *
 * Registers window.SiteManifesto = { mount(root, api) }; mount returns
 * { destroy, replay }. See section 12b of site.js for the api.
 */
(() => {
"use strict";

if (window.SiteManifesto) return;

const doc = document;

/* Shippori Mincho B1 (the closest free relative of the Matisse EB of the
   original title cards) for Latin and Japanese; Archivo, whose width axis
   gives the condensed labels; IBM Plex Mono for the terminal. All from
   Google Fonts, fetched on first open. */
const FONTS_HREF = "https://fonts.googleapis.com/css2" +
  "?family=Archivo:wdth,wght@62..125,500..900" +
  "&family=IBM+Plex+Mono:wght@500" +
  "&family=Shippori+Mincho+B1:wght@500;700" +
  "&display=swap";
/* The heavy 800 weight (the title card, the collage, the title of the text)
   comes cut to exactly the characters used (Google's text=), in two
   small files instead of dozens of Japanese slices: first the Latin one the
   title card waits for, then the collage's Japanese. */
const HEAVY_HREF = "https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@800&display=swap&text=";
const LATIN_SET = (() => {
  let t = "";
  for (let c = 0x20; c < 0x7f; c++) t += String.fromCharCode(c);
  for (let c = 0xc0; c <= 0xff; c++) t += String.fromCharCode(c);
  return t + "\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u00b7\u00d7";
})();
/* The title card waits for its fonts at most this long after B starts, and
   (so an early SKIP can't cut the wait short) until this long after the
   opening started. */
const CARD_FONT_WAIT = 3600;

/* Timeline, in ms of the sequence clock. */
const A = {
  image: 380,        // the picture starts to warm up
  steady: 1150,      // ...and holds from here
  streams: 700,      // first data stream (the others follow, staggered)
  term: 1250,        // terminal typing starts
  charMs: 24,
  linePause: 210,
  glitch: 4250,      // the cut out: slices and an RGB split...
  end: 4420          // ...then black
};
const B = { lead: 220, step: 125, hold: 2750, cut: 120, fontWait: 1500 };
const C_MONTAGE = 1400;
/* Blocks larger than this (px²) never flash inverted in the montage. */
const MONTAGE_INVERT_AREA = 20000;
const SKIP_AFTER = 600;
const CALM = { aIn: 900, aHold: 2300, aOut: 500, bIn: 500, bHold: 2300, bOut: 400 };

/* CRT warm-up: [ms, opacity, brightness, vertical scale]. A bright line
   opens into the picture, dips once, steadies. Never more than two flashes
   in any second (WCAG 2.3.1 allows three). */
const CRT = [
  [0, 0, 1, 0.004],
  [380, 0, 1, 0.004],
  [381, 1, 2.2, 0.004],
  [470, 1, 1.6, 1],
  [560, 0.3, 1, 1],
  [700, 1, 1.2, 1],
  [1150, 1, 1, 1]
];
/* The longest the opening waits, black, for its picture to arrive. */
const IMAGE_WAIT = 2200;

const GLYPHS = Array.from("0101010110" + "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ" + "0123456789ABCDEF");

/* ----------------------------------------------------------------------
   The collage: a hand-built poster in the manner of the Evangelion text
   collages, made only from the manifesto's own ideas. Blocks sit in nested
   columns and rows; every line in a block is scaled to the block's full
   width (in a vertical block, its full height), so the blocks tile the
   poster with no empty space. Track sizes follow from the text itself, so
   the composition keeps its proportions at any size, and blocks marked opt()
   join in, in order, while they bring the poster closer to the screen's
   shape. Three arrangements: wide screens, squarish ones, tall ones; the
   one that needs the least stretching wins. The letters are never
   distorted by more than a little (see fitCollage): past that, the poster
   keeps its shape and a thin black margin takes up the rest.
     J  horizontal Japanese    E  Latin capitals    V  vertical Japanese
     "|" breaks a line (a column, in V); "q" is a small annotation.
   ---------------------------------------------------------------------- */
const J = (t, x) => ({ t, k: "jp", x });
const E = (t, x) => ({ t, k: "lat", x });
const V = (t, x) => ({ t, k: "v", x });
const row = (...kids) => ({ dir: "row", kids });
const col = (...kids) => ({ dir: "col", kids });
const opt = node => Object.assign({}, node, { opt: true });

const LAND = row(
  col(
    E("THE|JEWEL"),
    J("「似ていることと、|続いていることは違う」", "q"),
    E("PROCEDURE: PROGRESSIVE INCORPORATION"),
    J("意識"),
    opt(J("「計算だけで、意識は生まれるか」", "q")),
    E("CONTINUITY|OF A PERSON"),
    row(J("神経補綴"), V("記憶")),
    opt(E("SUBJECT: EXISTING PERSON")),
    opt(J("生涯の仕事")),
    opt(J("いま、ここにいる人から始める", "q"))
  ),
  col(
    row(V("生物学的|自然主義"), col(J("漸進的置換"), J("機能的統合"), E("HYPOTHESIS 01"))),
    E("A CONVINCING SUCCESSOR|IS INSUFFICIENT EVIDENCE"),
    row(J("複製"), col(J("生存"), J("主体"))),
    E("TWO INDEPENDENTLY|OPERATING SYSTEMS"),
    opt(J("「複製ではなく、継続を」", "q")),
    J("同一性"),
    opt(E("RESEMBLANCE IS NOT CONTINUATION")),
    opt(J("意識の物理的条件", "q")),
    opt(J("仮説")),
    opt(E("THE BURDEN OF EVIDENCE MUST GROW"))
  ),
  col(
    J("可逆性"),
    opt(J("「可逆性を、可能な限り」", "q")),
    E("THE PERSON MUST|REMAIN THE BENEFICIARY"),
    row(col(J("相互作用"), E("2021 · BIDIRECTIONAL BCI"), J("海馬活動由来のパターンによる|記憶課題成績の向上", "q")), V("証拠")),
    J("「その人は、|まだここにいるか」", "q"),
    E("ALLOWED TO FAIL|IN INFORMATIVE WAYS"),
    opt(E("NEUROSCIENCE · ENGINEERING · MEDICINE · PHILOSOPHY")),
    J("統合型神経補綴"),
    opt(J("人工触覚フィードバック・神経データの保護", "q")),
    opt(E("LEARNING TO BE ME|BORDER GUARDS")),
    opt(J("老化・損傷"))
  ),
  opt(col(
    J("「信頼に足る未来を」", "q"),
    E("A FUTURE THEY HAVE|REASON TO TRUST"),
    J("インフォームド・コンセント"),
    opt(J("「自分の心への変更は、自分が決める」", "q")),
    opt(E("NOT A DISCOVERED LAW|OF CONSCIOUSNESS")),
    opt(J("変容")),
    opt(E("WHAT MUST BE MAINTAINED,|AND WHAT CAN BE CHANGED"))
  )),
  opt(col(
    J("主観性"),
    J("「最初の設計が誤りだと|知るための忍耐」", "q"),
    opt(E("A LIFE'S WORK")),
    opt(row(J("知覚・学習|記憶・行為"), V("主体性"))),
    opt(J("不確かさを率直に伝える", "q")),
    opt(E("FUNCTIONAL|INCORPORATION"))
  )),
  col(V("宝石"), row(V("「わたしは、わたしのままか」", "q"), V("連続性は未検証"))),
  V("人格の連続性")
);

const MID = row(
  col(
    E("THE|JEWEL"),
    J("「似ていることと、|続いていることは違う」", "q"),
    row(J("意識"), V("記憶")),
    opt(J("「計算だけで、意識は生まれるか」", "q")),
    E("CONTINUITY|OF A PERSON"),
    opt(row(J("神経補綴"), col(J("生存"), J("主体")))),
    opt(E("SUBJECT: EXISTING PERSON")),
    opt(E("A CONVINCING SUCCESSOR|IS INSUFFICIENT EVIDENCE")),
    opt(J("「複製ではなく、継続を」", "q")),
    opt(J("生涯の仕事")),
    opt(E("NEUROSCIENCE · ENGINEERING · MEDICINE · PHILOSOPHY")),
    opt(J("統合型神経補綴")),
    opt(E("A FUTURE THEY HAVE|REASON TO TRUST")),
    opt(J("「信頼に足る未来を」", "q")),
    opt(J("インフォームド・コンセント")),
    opt(E("LEARNING TO BE ME|BORDER GUARDS"))
  ),
  col(
    row(V("生物学的|自然主義"), col(J("漸進的置換"), J("機能的統合"), E("HYPOTHESIS 01"))),
    E("TWO INDEPENDENTLY|OPERATING SYSTEMS"),
    row(J("複製"), J("同一性")),
    opt(E("THE PERSON MUST|REMAIN THE BENEFICIARY")),
    opt(row(col(J("相互作用"), E("2021 · BIDIRECTIONAL BCI")), V("証拠"))),
    opt(J("「その人は、|まだここにいるか」", "q")),
    opt(E("ALLOWED TO FAIL|IN INFORMATIVE WAYS")),
    opt(J("可逆性")),
    opt(J("「可逆性を、可能な限り」", "q")),
    opt(E("PROCEDURE: PROGRESSIVE INCORPORATION")),
    opt(J("人工触覚フィードバック・神経データの保護", "q")),
    opt(J("仮説")),
    opt(E("THE BURDEN OF EVIDENCE MUST GROW")),
    opt(J("老化・損傷")),
    opt(E("NOT A DISCOVERED LAW|OF CONSCIOUSNESS"))
  ),
  opt(col(
    J("主観性"),
    E("RESEMBLANCE IS NOT CONTINUATION"),
    J("変容"),
    opt(J("意識の物理的条件", "q")),
    opt(E("WHAT MUST BE MAINTAINED,|AND WHAT CAN BE CHANGED")),
    opt(J("「自分の心への変更は、自分が決める」", "q"))
  )),
  opt(col(V("宝石"), row(V("「わたしは、わたしのままか」", "q"), V("連続性は未検証")))),
  V("人格の連続性")
);

const PORT = row(
  col(
    E("THE|JEWEL"),
    J("「似ていることと、|続いていることは違う」", "q"),
    row(J("意識"), V("記憶")),
    E("CONTINUITY|OF A PERSON"),
    opt(J("「計算だけで、意識は生まれるか」", "q")),
    opt(row(J("神経補綴"), col(J("生存"), J("主体")))),
    opt(E("A CONVINCING SUCCESSOR|IS INSUFFICIENT EVIDENCE")),
    opt(row(V("生物学的|自然主義"), col(J("漸進的置換"), J("機能的統合"), E("HYPOTHESIS 01")))),
    opt(J("「複製ではなく、継続を」", "q")),
    opt(row(J("複製"), J("同一性"))),
    opt(E("PROCEDURE: PROGRESSIVE INCORPORATION")),
    opt(E("THE PERSON MUST|REMAIN THE BENEFICIARY")),
    opt(row(col(J("相互作用"), E("2021 · BIDIRECTIONAL BCI")), V("証拠"))),
    opt(E("ALLOWED TO FAIL|IN INFORMATIVE WAYS")),
    opt(J("「その人は、|まだここにいるか」", "q")),
    opt(J("生涯の仕事")),
    opt(E("A FUTURE THEY HAVE|REASON TO TRUST"))
  ),
  V("宝石と、人格の連続性")
);

const POSTERS = [["land", LAND], ["mid", MID], ["port", PORT]];

/* The letters' own proportions: Shippori's capitals are wide and its kana
   and kanji square, where the Evangelion collages set both condensed. */
const SQUEEZE = { lat: 0.78, jp: 0.9, v: 1 };
/* How far a poster may be stretched (wider than its natural shape) or
   squeezed (narrower) to fill the screen before a black margin takes over. */
const STRETCH_MAX = 1.12, SQUEEZE_MAX = 1.2;
const FIT_GOOD = Math.log(1.03), DENSER_TOL = Math.log(1.02);
/* Leading between stacked lines (px at the lines' 100px size), and the gap
   between the columns of a vertical block (px on screen). */
const LEAD = 12, COL_GAP = 2;

/* Fonts load once per visit. `card`: what the title card needs (it waits
   for them, briefly); `all`: everything, the collage's Japanese last. */
let fontLoad = null;
function loadFonts(card, cardText, collageText) {
  if (fontLoad) return fontLoad;
  const sheet = (id, href) => new Promise(resolve => {
    if (doc.getElementById(id)) return resolve();
    const link = doc.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    link.onload = link.onerror = () => resolve();
    doc.head.appendChild(link);
  });
  const load = list => (doc.fonts && doc.fonts.load
    ? Promise.all(list.map(([font, text]) => text ? doc.fonts.load(font, text).catch(() => null) : null))
    : Promise.resolve()).then(() => {});
  const cardReady = Promise.all([
    sheet("manifesto-fonts", FONTS_HREF),
    sheet("manifesto-fonts-heavy", HEAVY_HREF + encodeURIComponent(cardText))
  ]).then(() => Promise.all([
    load([
      ['800 100px "Shippori Mincho B1"', card.series.join("")],
      ['800 100px "Archivo"', card.label],
      ['500 16px "IBM Plex Mono"', "> 0123456789ABCDEF"]
    ]),
    loadLatin("Shippori Mincho B1", "700")
  ]));
  const allReady = cardReady.then(() => collageText ? sheet("manifesto-fonts-heavy-ja", HEAVY_HREF + encodeURIComponent(collageText)) : null)
    .then(() => Promise.all([
      load([['800 100px "Shippori Mincho B1"', collageText]]),
      loadLatin("Shippori Mincho B1", "500")
    ]));
  fontLoad = { card: cardReady, all: allReady };
  return fontLoad;
}

/* Google splits Japanese families into ~120 slices, several of which also
   cover plain ASCII; document.fonts.load() would fetch every one of them
   that overlaps its sample, where rendering only uses the "latin" one. So
   for the Latin text, load just the faces that cover all of A-Z and a-z. */
function loadLatin(family, weight) {
  if (!doc.fonts || typeof doc.fonts.forEach !== "function") return Promise.resolve();
  const jobs = [];
  doc.fonts.forEach(face => {
    if (face.family.replace(/["']/g, "") !== family || String(face.weight) !== weight) return;
    const ranges = String(face.unicodeRange || "U+0-10FFFF").split(",").map(r => {
      const m = /U\+([0-9a-f]+)(?:-([0-9a-f]+))?/i.exec(r);
      return m ? [parseInt(m[1], 16), parseInt(m[2] || m[1], 16)] : [0, -1];
    });
    const covers = (a, b) => ranges.some(([lo, hi]) => lo <= a && hi >= b);
    if (covers(0x41, 0x5a) && covers(0x61, 0x7a)) jobs.push(face.load().catch(() => null));
  });
  return Promise.all(jobs).then(() => {});
}

/* Each character once, in order. */
function charsOf(text) {
  return Array.from(new Set(Array.from(String(text)))).join("");
}

/* A tile of film grain, made once. */
let grainURL = "";
function grain() {
  if (grainURL) return grainURL;
  try {
    const size = 180;
    const c = doc.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const data = g.createImageData(size, size);
    const d = data.data;
    for (let k = 0; k < d.length; k += 4) {
      const v = (Math.random() * 255) | 0;
      d[k] = d[k + 1] = d[k + 2] = v;
      d[k + 3] = 255;
    }
    g.putImageData(data, 0, 0);
    grainURL = c.toDataURL("image/png");
  } catch (_) {}
  return grainURL;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = u => clamp(u, 0, 1);
const easeOut = u => 1 - Math.pow(1 - u, 3);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function h(tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className, text, label) {
  const b = h("button", "mf-btn " + className, text);
  b.type = "button";
  if (label) b.setAttribute("aria-label", label);
  return b;
}

function shuffle(list) {
  for (let k = list.length - 1; k > 0; k--) {
    const j = (Math.random() * (k + 1)) | 0;
    const tmp = list[k];
    list[k] = list[j];
    list[j] = tmp;
  }
  return list;
}

function mount(root, api) {
  const cfg = api.config;
  const reducedNow = () => !!api.reducedMotion();
  let destroyed = false;

  root.classList.add("mf");
  root.replaceChildren();
  const grainImage = grain();
  if (grainImage) root.style.setProperty("--mf-grain", `url("${grainImage}")`);

  /* ---------- DOM ---------- */

  const closeBtn = button("mf-close", "CLOSE ×", "Close the manifesto");
  const skipBtn = button("mf-skip", "SKIP ›", "Skip the opening");

  const seq = h("div", "mf-seq");
  seq.setAttribute("aria-hidden", "true");
  const ghost = h("div", "mf-ghost");
  const shot = h("div", "mf-shot");
  const img = h("img", "mf-img");
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  try { img.fetchPriority = "high"; } catch (_) {}
  // site.js starts fetching the picture with this file; A waits for it.
  let imageReady = !cfg.image;
  if (cfg.image) {
    const ready = () => { imageReady = true; };
    img.src = cfg.image;
    if (typeof img.decode === "function") img.decode().then(ready, ready);
    else {
      img.addEventListener("load", ready);
      img.addEventListener("error", ready);
      if (img.complete) ready();
    }
  }
  shot.appendChild(img);
  const canvas = h("canvas", "mf-streams");
  const term = h("div", "mf-term");
  const termLines = cfg.terminal.map(text => {
    const line = h("div", "mf-term-line");
    const typed = h("span", "mf-term-text");
    const cursor = h("span", "mf-cursor");
    line.append(typed, cursor);
    term.appendChild(line);
    return { text, line, typed, cursor, shown: -1, cursorOn: null };
  });
  ghost.append(shot, canvas, term, h("div", "mf-scanlines"), h("div", "mf-vignette"));

  const card = buildCard(cfg.titleCard);
  seq.append(ghost, card.el, h("div", "mf-grain"));

  const page = h("div", "mf-page is-veiled");
  const first = h("div", "mf-first");
  const top = h("div", "mf-top", `${api.siteName} \u00b7 ${cfg.label}`);
  top.setAttribute("aria-hidden", "true");
  const collage = buildCollage();
  const bar = h("div", "mf-bar");
  const replayBtn = button("mf-replay", "↺ REPLAY", "Replay the opening");
  const readBtn = button("mf-read", "↓ READ", "Read the manifesto");
  const meta = h("span", "mf-bar-meta");
  meta.setAttribute("aria-hidden", "true");
  bar.append(replayBtn, readBtn, meta);
  first.append(top, collage.el, bar);
  const text = buildText(api.markdown);
  page.append(first, text.el, text.end);
  const words = (String(api.markdown).replace(/\]\([^)]*\)/g, "]").match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length;
  meta.textContent = `${words} WORDS · ${Math.max(1, Math.round(words / 230))} MIN`;

  // For screen readers: what is happening, while the opening plays.
  const note = h("p", "mf-sr");
  note.id = "manifesto-note";
  note.setAttribute("role", "status");
  root.setAttribute("aria-describedby", note.id);
  let announceTimer = 0;
  function announce(message) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { note.textContent = message; }, 60);
  }

  root.append(note, closeBtn, skipBtn, seq, page);

  /* ---------- Title card ---------- */

  function buildCard(tc) {
    const el = h("div", "mf-card");
    el.hidden = true;
    const inner = h("div", "mf-card-in");
    const lines = [];
    tc.series.forEach((s, k) => {
      lines.push(h("div", "mf-card-series" + (k === tc.series.length - 1 ? " is-giant" : ""), s));
    });
    if (tc.label) lines.push(h("div", "mf-card-label", tc.label));
    if (tc.episode) lines.push(h("div", "mf-card-episode", tc.episode));
    lines.forEach(line => inner.appendChild(line));
    el.appendChild(inner);
    return { el, inner, lines: lines.map(node => ({ node, on: null, flash: 0, flashOn: null })) };
  }

  /* ---------- Text ----------
     Just the manifesto, exactly as written and only once: the title and
     the subtitle centred on a screen of their own, then the paragraphs in
     one centred column. After it, only RETURN and REPLAY. */

  function buildText(md) {
    const art = h("article", "mf-text");
    art.lang = "en";
    art.appendChild(api.renderMarkdown(md));

    const h1 = art.querySelector("h1");
    if (h1) {
      const head = h("header", "mf-head");
      const inner = h("div", "mf-head-in");
      art.insertBefore(head, h1);
      inner.appendChild(h1);
      // An italic line right under the title is its subtitle.
      const next = head.nextElementSibling;
      if (next && next.tagName === "P" && next.childElementCount === 1 &&
          next.firstElementChild.tagName === "EM" &&
          next.textContent.trim() === next.firstElementChild.textContent.trim()) {
        next.classList.add("mf-sub");
        inner.appendChild(next);
      }
      head.appendChild(inner);
    }

    art.querySelectorAll("a[href]").forEach(a => {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });

    const end = h("div", "mf-end");
    end.append(
      button("mf-return", "← RETURN", "Return to the site"),
      button("mf-replay", "↺ REPLAY", "Replay the opening")
    );
    return { el: art, end };
  }

  /* ---------- Collage ---------- */

  function buildCollage() {
    const el = h("div", "mf-collage");
    el.setAttribute("aria-hidden", "true");
    const posters = [];
    for (const [name, spec] of POSTERS) {
      const poster = h("div", "mf-poster");
      poster.dataset.layout = name;
      const leaves = [], flex = [];
      const top = buildNode(spec, leaves, flex);
      poster.appendChild(top.el);
      el.appendChild(poster);
      posters.push({ name, el: poster, top, leaves, flex, measured: false, options: null });
    }
    return { el, posters, active: null, showing: null };
  }

  function buildNode(spec, leaves, flex) {
    if (spec.t != null) {
      const el = h("div", "mf-leaf mf-" + spec.k + (spec.x ? " mf-" + spec.x : ""));
      const q = SQUEEZE[spec.k] || 1;
      const lines = spec.t.split("|").map(s => {
        const line = h("span", "mf-line", s);
        el.appendChild(line);
        return { el: line, w: 1, h: 1, x: 0, y: 0, q };
      });
      const leaf = { el, leaf: true, vertical: spec.k === "v", lines, aspect: 1, on: true, opt: !!spec.opt };
      leaves.push(leaf);
      return leaf;
    }
    const el = h("div", "mf-node is-" + spec.dir);
    const node = { el, dir: spec.dir, kids: spec.kids.map(k => buildNode(k, leaves, flex)), aspect: 1, on: true, opt: !!spec.opt };
    node.kids.forEach(k => el.appendChild(k.el));
    node.optional = node.kids.filter(k => k.opt);
    node.extra = 0;   // how many optional kids are in
    if (node.optional.length) flex.push(node);
    return node;
  }

  /* Which kids are in: every required one, plus the first `extra` optional ones. */
  function syncOn(node) {
    if (node.leaf) return;
    let n = 0;
    for (const k of node.kids) {
      k.on = !k.opt || n++ < node.extra;
      syncOn(k);
    }
  }

  /* Natural aspect (width / height) of a block when every line fills it. */
  function aspectOf(node) {
    if (node.leaf) {
      let sum = 0;
      if (node.vertical) {
        for (const l of node.lines) sum += l.w / l.h;
        node.aspect = sum;
      } else {
        node.lines.forEach((l, k) => { sum += (l.h + (k ? LEAD : 0)) / l.w; });
        node.aspect = 1 / sum;
      }
      return node.aspect;
    }
    let sum = 0;
    for (const k of node.kids) {
      const a = aspectOf(k);
      if (k.on) sum += node.dir === "row" ? a : 1 / a;
    }
    node.aspect = node.dir === "row" ? sum : 1 / sum;
    return node.aspect;
  }

  /* Every shape a block can take: for each count of its optional kids that
     are in, every combination of its kids' own shapes. Kids are independent,
     so this is a product of short lists; near-duplicates are merged and long
     lists thinned (never the top one). Each option records how many
     optional kids every flex block takes. */
  const OPTION_CAP = 40;
  function optionsOf(node, top) {
    if (node.leaf) return [{ a: node.aspect, n: 1, set: null }];
    let out = [];
    for (let extra = 0; extra <= node.optional.length; extra++) {
      let n = 0;
      const lists = [];
      for (const k of node.kids) if (!k.opt || n++ < extra) lists.push(optionsOf(k, false));
      // Row: widths add up (at height 1). Column: heights add up (at width 1).
      let acc = [{ sum: 0, n: 0, set: node.optional.length ? [[node, extra]] : [] }];
      for (const list of lists) {
        const next = [];
        for (const partial of acc) for (const o of list) {
          next.push({ sum: partial.sum + (node.dir === "row" ? o.a : 1 / o.a), n: partial.n + o.n, set: o.set ? partial.set.concat(o.set) : partial.set });
        }
        acc = next;
      }
      for (const c of acc) out.push({ a: node.dir === "row" ? c.sum : 1 / c.sum, n: c.n, set: c.set });
    }
    if (top) return out;
    out.sort((p, q) => p.a - q.a);
    const merged = [];
    for (const o of out) if (!merged.length || o.a / merged[merged.length - 1].a > 1.004) merged.push(o);
    if (merged.length <= OPTION_CAP) return merged;
    const thin = [];
    for (let k = 0; k < OPTION_CAP; k++) thin.push(merged[Math.round((k * (merged.length - 1)) / (OPTION_CAP - 1))]);
    return thin;
  }

  /* Pick the optional blocks that bring the poster closest to the screen's
     shape. Of those within a hair of the closest, the one with the most
     blocks, or on a short screen the fewest (so the type stays legible).
     Returns how far off it stays (a log ratio). */
  function arrange(poster, target, more) {
    if (!poster.options) {
      aspectOf(poster.top);   // the leaves' own shapes
      poster.options = optionsOf(poster.top, true);
    }
    let minErr = Infinity;
    for (const o of poster.options) minErr = Math.min(minErr, Math.abs(Math.log(o.a / target)));
    let best = null, bestErr = Infinity;
    for (const o of poster.options) {
      const err = Math.abs(Math.log(o.a / target));
      if (err > minErr + DENSER_TOL) continue;
      if (!best || (more ? o.n > best.n : o.n < best.n) || (o.n === best.n && err < bestErr)) { best = o; bestErr = err; }
    }
    for (const n of poster.flex) n.extra = 0;
    if (best) for (const [node, extra] of best.set) node.extra = extra;
    syncOn(poster.top);
    aspectOf(poster.top);
    return bestErr;
  }

  function applyTracks(node) {
    if (node.leaf) return;
    const sizes = [];
    for (const k of node.kids) {
      k.el.hidden = !k.on;
      if (!k.on) continue;
      sizes.push(node.dir === "row" ? k.aspect : 1 / k.aspect);
      applyTracks(k);
    }
    // Normalised: flex factors that add up to less than 1 leave space unused.
    const sum = sizes.reduce((a, b) => a + b, 0) || 1;
    const tracks = sizes.map(v => "minmax(0," + ((v / sum) * 100).toFixed(4) + "fr)");
    if (node.dir === "row") node.el.style.gridTemplateColumns = tracks.join(" ");
    else node.el.style.gridTemplateRows = tracks.join(" ");
  }

  function unhide(node) {
    node.el.hidden = false;
    if (!node.leaf) node.kids.forEach(unhide);
  }

  /* A leaf is showing when it and every block around it are in. */
  function showing(poster) {
    const out = [];
    const walk = node => {
      if (!node.on) return;
      if (node.leaf) out.push(node);
      else node.kids.forEach(walk);
    };
    walk(poster.top);
    return out;
  }

  /* A line's box, or for horizontal lines its ink: Shippori's capitals rise
     above the cap height its metrics declare, so boxes alone would overlap
     and leave uneven gaps. Canvas measures the real glyphs (at the line's
     own 100px size, line-height 1). Sizes are in px at that size, with the
     line already condensed by its SQUEEZE. */
  const inkCtx = doc.createElement("canvas").getContext("2d");
  function measureLine(leaf, l) {
    l.x = 0;
    l.y = 0;
    l.w = l.el.offsetWidth || 1;
    l.h = l.el.offsetHeight || 1;
    if (leaf.vertical) return;
    l.w *= l.q;
    if (!inkCtx || typeof inkCtx.measureText !== "function") return;
    const cs = getComputedStyle(l.el);
    inkCtx.font = `${cs.fontWeight} 100px ${cs.fontFamily}`;
    const m = inkCtx.measureText(l.el.textContent);
    const ascent = m.actualBoundingBoxAscent, descent = m.actualBoundingBoxDescent;
    const fa = m.fontBoundingBoxAscent, fd = m.fontBoundingBoxDescent;
    const width = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    if (!(ascent + descent > 1) || !(fa + fd > 1) || !(width > 1)) return;
    const baseline = (100 - (fa + fd)) / 2 + fa;
    l.x = -m.actualBoundingBoxLeft * l.q;
    l.w = width * l.q;
    l.y = baseline - ascent;
    l.h = ascent + descent;
  }

  function fitLeaf(leaf, W, H) {
    const lines = leaf.lines, n = lines.length;
    if (W < 1 || H < 1) return;
    if (!leaf.vertical) {
      let total = 0;
      lines.forEach((l, k) => { total += (l.h + (k < n - 1 ? LEAD : 0)) * (W / l.w); });
      const sy = clamp(H / total, 0.5, 2);
      let y = 0;
      for (const l of lines) {
        const s = W / l.w, t = s * sy;
        l.el.style.transform = `translate(${(-l.x * s).toFixed(2)}px,${(y - l.y * t).toFixed(2)}px) scale(${(s * l.q).toFixed(5)},${t.toFixed(5)})`;
        y += (l.h + LEAD) * t;
      }
      leaf.stretch = sy;
    } else {
      let total = 0;
      for (const l of lines) total += l.w * (H / l.h);
      const sx = clamp((W - COL_GAP * (n - 1)) / total, 0.5, 2);
      let x = W;
      for (const l of lines) {
        const s = H / l.h;
        x -= l.w * s * sx;
        l.el.style.transform = `translate(${x.toFixed(2)}px,0px) scale(${(s * sx).toFixed(5)},${s.toFixed(5)})`;
        x -= COL_GAP;
      }
      leaf.stretch = sx;
    }
  }

  /* Lay the poster out for the current screen: pick the arrangement and
     its optional blocks, set the tracks, then scale every line into its
     block. Two reads (natural sizes, once; block sizes), everything else
     writes. Runs on entering C, on resize and once the fonts arrive. */
  function fitCollage() {
    const el = collage.el;
    const W = el.clientWidth, H = el.clientHeight;
    if (W < 2 || H < 2) return;
    for (const p of collage.posters) {
      if (p.measured) continue;
      p.el.hidden = false;
      unhide(p.top);
      for (const leaf of p.leaves) for (const l of leaf.lines) measureLine(leaf, l);
      p.measured = true;
      p.options = null;
    }
    const pad = 6;
    const target = (W - pad) / (H - pad);
    // The first arrangement (wide, squarish, tall) that fits well, or else
    // the one that fits best.
    const more = H >= 600;
    let best = null, bestErr = Infinity;
    for (const p of collage.posters) {
      const err = arrange(p, target, more);
      if (err < bestErr) { bestErr = err; best = p; }
      if (err <= FIT_GOOD) { best = p; break; }
    }
    for (const p of collage.posters) p.el.hidden = p !== best;
    arrange(best, target, more);
    applyTracks(best.top);
    // Stretch or squeeze the letters a little to fill the screen, no more:
    // past that the poster keeps its shape, centred on a thin black margin.
    const natural = best.top.aspect;
    const shape = clamp(target, natural / SQUEEZE_MAX, natural * STRETCH_MAX);
    let mx = 0, my = 0;
    if (shape < target) mx = ((W - pad) - (H - pad) * shape) / 2;
    else if (shape > target) my = ((H - pad) - (W - pad) / shape) / 2;
    best.el.style.inset = `${my.toFixed(1)}px ${mx.toFixed(1)}px`;
    collage.active = best;
    collage.showing = showing(best);
    const sizes = collage.showing.map(leaf => leaf.el.getBoundingClientRect());
    collage.showing.forEach((leaf, k) => {
      leaf.area = sizes[k].width * sizes[k].height;
      fitLeaf(leaf, sizes[k].width, sizes[k].height);
    });
  }

  /* ---------- Phase A canvas: data streams, scan streaks, glitch ---------- */

  const ctx = canvas.getContext("2d");
  let vw = 0, vh = 0, dpr = 1, sq = 0, sqX = 0, sqY = 0;
  let streams = [], streaks = [], maskLines = [];
  let channels = null, glitchStrips = null;

  function layoutGhost() {
    vw = root.clientWidth || innerWidth;
    vh = root.clientHeight || innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(vw * dpr));
    canvas.height = Math.max(1, Math.round(vh * dpr));
    // The picture: fitted to the height on wide screens, a little wider than
    // the screen on tall ones (its edges melt into black either way).
    sq = vw >= vh ? vh : Math.min(vw * 1.22, vh);
    sqX = (vw - sq) / 2;
    sqY = (vh - sq) / 2;
    root.style.setProperty("--mf-sq", sq.toFixed(1) + "px");
    channels = null;
    makeStreams();
  }

  /* Two ribbons of fine parallel rows, as in the still: a long one from the
     left edge into the mask, a shorter one behind the ear. Each ribbon is one
     tile of tiny glyphs (a row per strip) repeated seamlessly; every row
     scrolls at its own speed, and the whole ribbon shares one gentle tilt.
     Over the mask the left ribbon's rows carry on as fine white lines. */
  function makeStreams() {
    streams = [];
    streaks = [];
    maskLines = [];
    if (!ctx) return;
    const pitch = sq * 0.017;
    const fs = clamp(sq * 0.0062, 4.5, 7);
    const specs = [
      { x0: -24, x1: sqX + sq * 0.3, yc: sqY + sq * 0.6, rows: 13, tilt: 0.045, at: A.streams, fin: 0.3, fout: 0.2 },
      { x0: sqX + sq * 0.6, x1: Math.max(vw + 24, sqX + sq * 0.9), yc: sqY + sq * 0.56, rows: 9, tilt: 0.05, at: A.streams + 280, fin: 0.16, fout: 0.14 }
    ];
    for (const sp of specs) {
      const len = Math.max(40, sp.x1 - sp.x0);
      const hgt = sp.rows * pitch;
      const cw = fs * 0.64;
      const chars = Math.max(24, Math.round(Math.min(len, 520) / cw));
      const tileW = chars * cw;
      const tile = doc.createElement("canvas");
      tile.width = Math.ceil(tileW * dpr);
      tile.height = Math.ceil(hgt * dpr);
      const buf = doc.createElement("canvas");
      buf.width = Math.ceil(len * dpr);
      buf.height = tile.height;
      const s = {
        x0: sp.x0, yc: sp.yc, len, hgt, rows: sp.rows, pitch, fs, cw, chars, tileW, tile, buf,
        tctx: tile.getContext("2d"), bctx: buf.getContext("2d"), tilt: sp.tilt, at: sp.at,
        speeds: Array.from({ length: sp.rows }, () => (sq / 900) * 60 * rand(0.85, 1.15)),
        alphas: Array.from({ length: sp.rows }, (_, r) => (r === 0 || r === sp.rows - 1 ? 0.45 : rand(0.7, 1))),
        fade: null
      };
      if (!s.tctx || !s.bctx) continue;
      bakeStream(s);
      const g = s.bctx.createLinearGradient(0, 0, buf.width, 0);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(sp.fin, "rgba(0,0,0,1)");
      g.addColorStop(1 - sp.fout, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      s.fade = g;
      streams.push(s);
    }
    // The left ribbon's upper rows, carried across the mask as white lines.
    const left = streams[0];
    if (left) {
      for (let r = 1; r < 10; r++) {
        maskLines.push({
          r,
          x: sqX + sq * rand(0.15, 0.19) - left.x0,
          w: sq * rand(0.34, 0.42),
          alpha: rand(0.16, 0.34),
          phase: rand(0, 6.28)
        });
      }
    }
    // Thin bright streaks sliding across the mask (clipped to it).
    streaks = [0, 1, 2].map(k => ({
      r: 1 + ((Math.random() * 9) | 0),
      h: rand(1, 2),
      len: sq * rand(0.14, 0.26),
      speed: sq * rand(0.3, 0.55) * (k === 1 ? -1 : 1),
      at: 1300 + k * 560 + rand(0, 300),
      alpha: rand(0.55, 0.9)
    }));
  }

  function glyph() {
    return GLYPHS[(Math.random() * GLYPHS.length) | 0];
  }

  /* One tile of tiny glowing glyphs, a row per strip, at a fixed pitch so it
     repeats seamlessly. */
  function bakeStream(s) {
    const g = s.tctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, s.tileW, s.hgt);
    g.font = `500 ${s.fs.toFixed(1)}px "IBM Plex Mono", Menlo, Consolas, "Hiragino Sans", "MS Gothic", monospace`;
    g.textBaseline = "middle";
    for (let r = 0; r < s.rows; r++) {
      g.fillStyle = `rgba(90,255,120,${(0.95 * s.alphas[r]).toFixed(3)})`;
      const y = (r + 0.5) * s.pitch;
      for (let c = 0; c < s.chars; c++) {
        if (Math.random() < 0.14) continue;   // gaps, like packets
        g.fillText(glyph(), c * s.cw, y);
      }
    }
    // Glow: a blurred copy of the glyphs added underneath.
    if ("filter" in g) {
      const glow = doc.createElement("canvas");
      glow.width = s.tile.width;
      glow.height = s.tile.height;
      const gg = glow.getContext("2d");
      if (gg) {
        gg.filter = `blur(${(1.4 * dpr).toFixed(1)}px)`;
        gg.drawImage(s.tile, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = "destination-over";
        g.globalAlpha = 0.9;
        g.drawImage(glow, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }
    }
  }

  /* A few glyphs change every frame, as if the data were live. */
  function mutateStreams() {
    for (let n = 0; n < 6; n++) {
      const s = streams[(Math.random() * streams.length) | 0];
      if (!s) return;
      const g = s.tctx;
      const r = (Math.random() * s.rows) | 0, c = (Math.random() * s.chars) | 0;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(c * s.cw - 0.3, r * s.pitch + 0.5, s.cw + 0.6, s.pitch - 1);
      g.fillStyle = "rgba(170,255,190,0.95)";
      g.fillText(glyph(), c * s.cw, (r + 0.5) * s.pitch);
    }
  }

  function drawStreams(t) {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    const sec = t / 1000;
    for (const s of streams) {
      const u = clamp01((t - s.at) / 320);
      if (u <= 0) continue;
      // Each row of the tile, repeated across the ribbon at its own offset.
      const b = s.bctx;
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.globalCompositeOperation = "source-over";
      b.clearRect(0, 0, s.buf.width, s.buf.height);
      const tw = s.tile.width;
      const rh = s.tile.height / s.rows;
      for (let r = 0; r < s.rows; r++) {
        const off = ((sec * s.speeds[r] * dpr) % tw + tw) % tw;
        const sy = Math.round(r * rh), sh = Math.round((r + 1) * rh) - sy;
        for (let x = off - tw; x < s.buf.width; x += tw) b.drawImage(s.tile, 0, sy, tw, sh, x, sy, tw, sh);
      }
      b.globalCompositeOperation = "destination-in";
      b.fillStyle = s.fade;
      b.fillRect(0, 0, s.buf.width, s.buf.height);
      // Onto the screen, tilted, flickering a little.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(s.x0, s.yc);
      ctx.rotate(s.tilt);
      ctx.globalAlpha = u * (0.86 + Math.random() * 0.14);
      ctx.drawImage(s.buf, 0, -s.hgt / 2, s.len, s.hgt);
    }
    const left = streams[0];
    if (left) {
      // Clip the white lines to the mask; the streaks slide along the rows.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(sqX + sq * 0.12, sqY, sq * 0.5, sq);
      ctx.clip();
      ctx.translate(left.x0, left.yc);
      ctx.rotate(left.tilt);
      const rowY = r => (r + 0.5) * left.pitch - left.hgt / 2;
      const lines = clamp01((t - 1000) / 450);
      if (lines > 0) {
        ctx.fillStyle = "#effff5";
        for (const m of maskLines) {
          ctx.globalAlpha = m.alpha * lines * (0.65 + 0.35 * Math.sin(sec * 6 + m.phase)) * (0.85 + Math.random() * 0.15);
          ctx.fillRect(m.x + Math.sin(sec * 1.3 + m.phase) * sq * 0.01, rowY(m.r) - 0.5, m.w, 1);
        }
      }
      const from = sqX + sq * 0.12 - left.x0, span = sq * 0.5;
      for (const k of streaks) {
        if (t < k.at) continue;
        const p = (((t - k.at) / 1000) * Math.abs(k.speed)) % (span + k.len);
        const head = k.speed > 0 ? from + p : from + span - p;
        const tail = k.speed > 0 ? head - k.len : head + k.len;
        const g = ctx.createLinearGradient(tail, 0, head, 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.85, "rgba(235,255,245,0.55)");
        g.addColorStop(1, "rgba(255,255,255,1)");
        ctx.globalAlpha = k.alpha * clamp01((t - k.at) / 200);
        ctx.fillStyle = g;
        ctx.fillRect(Math.min(head, tail), rowY(k.r) - k.h / 2, k.len, k.h);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* The picture split into red, green and blue, for the glitch. */
  function makeChannels() {
    if (!ctx || !img.complete || !img.naturalWidth) return null;
    const size = Math.min(1024, Math.max(64, Math.round(sq * dpr)));
    const make = color => {
      const c = doc.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, size, size);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = color;
      g.fillRect(0, 0, size, size);
      return c;
    };
    try {
      return { size, r: make("#ff0000"), g: make("#00ff00"), b: make("#0000ff") };
    } catch (_) { return null; }
  }

  function makeStrips() {
    const out = [];
    let y = 0;
    while (y < sq) {
      const hgt = Math.min(sq - y, sq * rand(0.015, 0.11));
      const shifted = Math.random() < 0.6;
      out.push({
        y, h: hgt,
        dx: shifted ? rand(-0.16, 0.16) * sq : rand(-0.01, 0.01) * sq,
        split: rand(3, 13)
      });
      y += hgt;
    }
    return out;
  }

  function drawGlitch(frameNo) {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!channels) channels = makeChannels();
    if (!channels) return;
    if (!glitchStrips || frameNo % 2 === 0) glitchStrips = makeStrips();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    const c = channels, k = c.size / sq;
    for (const s of glitchStrips) {
      const sy = s.y * k, sh = Math.max(1, s.h * k);
      ctx.drawImage(c.r, 0, sy, c.size, sh, sqX + s.dx - s.split, sqY + s.y, sq, s.h);
      ctx.drawImage(c.g, 0, sy, c.size, sh, sqX + s.dx, sqY + s.y, sq, s.h);
      ctx.drawImage(c.b, 0, sy, c.size, sh, sqX + s.dx + s.split, sqY + s.y, sq, s.h);
    }
    // Melt the edges like the picture's vignette.
    ctx.globalCompositeOperation = "destination-in";
    const g = ctx.createRadialGradient(vw / 2, vh / 2, sq * 0.2, vw / 2, vh / 2, sq * 0.56);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    ctx.globalCompositeOperation = "source-over";
  }

  function clearCanvas() {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /* ---------- Sequence state and clock ---------- */

  let raf = 0, looping = false, lastNow = 0, clock = 0, frameNo = 0;
  let phase = "", phaseAt = 0, calm = false;
  let cardStart = -1, aStart = 0;
  let montage = null;
  let cardFontsReady = false;
  let shotState = "";

  function startLoop() {
    if (looping || destroyed) return;
    looping = true;
    lastNow = 0;
    raf = requestAnimationFrame(loop);
  }
  function stopLoop() {
    looping = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function loop(now) {
    raf = 0;
    if (!looping || destroyed) return;
    // A hidden tab gets no frames, so the clock simply waits.
    const dt = lastNow ? clamp(now - lastNow, 0, 50) : 16;
    lastNow = now;
    clock += dt;
    frameNo++;
    const t = clock - phaseAt;
    if (phase === "A") stepA(t);
    else if (phase === "B") stepB(t);
    else if (phase === "C") stepC();
    if (looping && !destroyed) raf = requestAnimationFrame(loop);
  }

  function setShot(opacity, transform, filter) {
    const key = opacity + "|" + transform + "|" + filter;
    if (key === shotState) return;
    shotState = key;
    shot.style.opacity = opacity;
    shot.style.transform = transform;
    shot.style.filter = filter;
  }

  function crtAt(t) {
    for (let k = 1; k < CRT.length; k++) {
      const b = CRT[k];
      if (t <= b[0]) {
        const a = CRT[k - 1];
        const u = b[0] === a[0] ? 1 : (t - a[0]) / (b[0] - a[0]);
        return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
      }
    }
    return [1, 1, 1];
  }

  /* Terminal lines typed character by character from A.term. */
  function typeTerminal(t, all) {
    let at = A.term;
    let key = "";
    termLines.forEach((line, k) => {
      const len = line.text.length;
      const n = all ? len : clamp(Math.floor((t - at) / A.charMs), 0, len);
      const typing = !all && t >= at && n < len;
      const last = k === termLines.length - 1;
      const current = all ? last : t >= at && (typing || last || t < at + len * A.charMs + A.linePause);
      const blink = Math.floor(t / 270) % 2 === 0;
      const cursorOn = all ? last : t >= at && current && (typing || blink);
      if (n !== line.shown) {
        line.shown = n;
        line.typed.textContent = line.text.slice(0, n);
      }
      if (cursorOn !== line.cursorOn) {
        line.cursorOn = cursorOn;
        line.cursor.style.visibility = cursorOn ? "visible" : "hidden";
      }
      key += n;
      at += len * A.charMs + A.linePause;
    });
    return key;
  }

  function resetTerminal() {
    termLines.forEach(line => {
      line.shown = -1;
      line.cursorOn = null;
      line.typed.textContent = "";
      line.cursor.style.visibility = "hidden";
    });
    term.style.transform = "";
    term.style.opacity = "";
  }

  function setPhase(name) {
    phase = name;
    root.dataset.phase = name;
  }

  function enterA() {
    setPhase("A");
    phaseAt = clock;
    aStart = clock;
    seq.hidden = false;
    ghost.hidden = false;
    card.el.hidden = true;
    shotState = "";
    setShot("0", "scale(1.06)", "");
    glitchStrips = null;
    resetTerminal();
    clearCanvas();
  }

  function stepA(t) {
    const since = clock - aStart;
    skipBtn.classList.toggle("is-shown", since >= SKIP_AFTER);
    // Black until the picture is decoded (at most IMAGE_WAIT), so the
    // warm-up never plays on an empty frame.
    const gate = calm ? 200 : A.image;
    if (!imageReady && t >= gate) {
      if (since < IMAGE_WAIT) { phaseAt = clock - gate; return; }
      imageReady = true;   // play on without it
    }
    if (calm) {
      const end = CALM.aIn + CALM.aHold;
      const o = t < 200 ? 0 : t < end ? clamp01((t - 200) / CALM.aIn) : 1 - clamp01((t - end) / CALM.aOut);
      setShot(o.toFixed(3), "none", "");
      term.style.opacity = o.toFixed(3);
      seq.classList.toggle("is-grainy", o > 0);
      typeTerminal(t, true);
      if (t >= end + CALM.aOut) enterB();
      return;
    }
    seq.classList.toggle("is-grainy", t >= A.image && t < A.glitch);
    if (t < A.glitch) {
      const [o, bright, sy] = crtAt(t);
      const push = 1.06 - 0.06 * easeOut(clamp01((t - A.image) / (A.glitch - A.image)));
      const flutter = t > A.steady ? 1 - Math.random() * 0.035 : o;
      setShot(flutter.toFixed(3), `scale(${push.toFixed(4)}) scaleY(${sy.toFixed(3)})`,
        bright > 1.001 ? `brightness(${bright.toFixed(2)})` : "");
      if (t >= A.streams) {
        drawStreams(t);
        mutateStreams();
      }
      typeTerminal(t, false);
      // Build the glitch's colour channels ahead of time, off the critical frame.
      if (!channels && t > 3400) channels = makeChannels();
      return;
    }
    if (t < A.end) {
      setShot("0", "none", "");
      drawGlitch(frameNo);
      term.style.transform = `translateX(${rand(-14, 14).toFixed(1)}px)`;
      return;
    }
    enterB();
  }

  function enterB() {
    setPhase("B");
    phaseAt = clock;
    ghost.hidden = true;
    clearCanvas();
    card.el.hidden = false;
    card.inner.style.opacity = "";
    seq.classList.remove("is-grainy");
    cardStart = -1;
    card.lines.forEach(line => {
      line.on = false;
      line.flash = 0;
      line.flashOn = false;
      line.node.style.visibility = "hidden";
      line.node.classList.remove("is-flash");
    });
  }

  /* As on the original cards, the giant line is the widest: a long episode
     line wraps (balanced) to end under it rather than run past it. */
  function balanceCard() {
    const giant = card.inner.querySelector(".is-giant");
    const episode = card.inner.querySelector(".mf-card-episode");
    if (!giant || !episode) return;
    episode.classList.remove("is-wrapped");
    episode.style.maxWidth = "";
    const indent = parseFloat(getComputedStyle(episode).marginLeft) || 0;
    const room = giant.offsetWidth - indent;
    if (room > 0 && episode.offsetWidth > room * 1.06) {
      episode.classList.add("is-wrapped");
      episode.style.maxWidth = Math.ceil(room) + "px";
    }
  }

  function stepB(t) {
    skipBtn.classList.toggle("is-shown", true);
    if (cardStart < 0) {
      // Black first, and the title's fonts: for at most B.fontWait, and in
      // any case until CARD_FONT_WAIT into the opening (an early SKIP).
      const fontsOk = cardFontsReady || (t >= B.fontWait && clock >= CARD_FONT_WAIT);
      if (t >= B.lead && fontsOk) {
        cardStart = t;
        balanceCard();
      } else return;
    }
    const u = t - cardStart;
    const n = card.lines.length;
    seq.classList.add("is-grainy");
    if (calm) {
      const end = CALM.bIn + CALM.bHold;
      const o = u < end ? clamp01(u / CALM.bIn) : 1 - clamp01((u - end) / CALM.bOut);
      card.inner.style.opacity = o.toFixed(3);
      card.lines.forEach(line => {
        if (!line.on) { line.on = true; line.node.style.visibility = "visible"; }
      });
      if (u >= end + CALM.bOut) enterC(true);
      return;
    }
    card.lines.forEach((line, k) => {
      if (!line.on && u >= k * B.step) {
        line.on = true;
        line.flash = 2;   // over-bright for two frames
        line.node.style.visibility = "visible";
      }
      const flashing = line.flash > 0;
      if (flashing !== line.flashOn) {
        line.flashOn = flashing;
        line.node.classList.toggle("is-flash", flashing);
      }
      if (line.flash > 0) line.flash--;
    });
    const allIn = (n - 1) * B.step;
    // A faint projector flicker (a few percent, a few times a second).
    if (u > allIn + 60 && frameNo % 5 === 0) {
      card.inner.style.opacity = (0.97 + Math.random() * 0.03).toFixed(3);
    }
    if (u >= allIn + B.hold) {
      card.el.hidden = true;   // hard cut
      seq.classList.remove("is-grainy");
    }
    if (u >= allIn + B.hold + B.cut) enterC(false);
  }

  function enterC(instant) {
    setPhase("C");
    phaseAt = clock;
    seq.hidden = true;
    card.el.hidden = true;
    skipBtn.hidden = true;
    releaseGhost();
    root.classList.add("is-reading");
    page.classList.remove("is-veiled");
    fitCollage();
    const leaves = collage.showing ? collage.showing.slice() : [];
    for (const p of collage.posters) for (const l of p.leaves) {
      l.el.classList.remove("is-off", "is-flash", "is-bloom");
    }
    if (instant || calm || reducedNow()) {
      montage = null;
      settle();
    } else {
      const order = shuffle(leaves.slice());
      const step = C_MONTAGE / Math.max(1, order.length);
      // Only small blocks flash inverted (white), and only a few of them;
      // the rest cut in with a bloom.
      let inverts = 0;
      montage = order.map((leaf, k) => {
        const invert = leaf.area < MONTAGE_INVERT_AREA && inverts < 6 && Math.random() < 0.5;
        if (invert) inverts++;
        return { leaf, at: k * step + rand(0, step * 0.6), on: false, flash: 0, invert };
      });
      for (const m of montage) m.leaf.el.classList.add("is-off");
    }
    const active = doc.activeElement;
    if (!active || active === skipBtn || active === doc.body || !root.contains(active)) root.focus({ preventScroll: true });
    announce("The manifesto is ready to read.");
    if (!montage) stopLoop();
  }

  /* The opening's canvases are not needed while reading (REPLAY rebuilds them). */
  function releaseGhost() {
    canvas.width = canvas.height = 0;
    channels = null;
    glitchStrips = null;
    streams = [];
    streaks = [];
    maskLines = [];
  }

  function stepC() {
    if (!montage) return;
    const u = clock - phaseAt;
    let pending = 0;
    for (const m of montage) {
      if (m.flash > 0) {
        m.flash--;
        if (!m.flash) m.leaf.el.classList.remove("is-flash", "is-bloom");
      }
      if (!m.on) {
        if (u >= m.at) {
          m.on = true;
          m.flash = 1;   // one frame
          m.leaf.el.classList.remove("is-off");
          m.leaf.el.classList.add(m.invert ? "is-flash" : "is-bloom");
        } else pending++;
      }
      if (m.flash > 0) pending++;
    }
    if (!pending) {
      montage = null;
      settle();
      stopLoop();
    }
  }

  function settle() {
    root.classList.add("is-settled");
  }

  /* ---------- Controls ---------- */

  function skip() {
    if (phase === "A") enterB();
    else if (phase === "B") enterC(false);
  }

  function startSequence() {
    stopLoop();
    calm = reducedNow();
    root.classList.remove("is-reading", "is-settled");
    root.classList.toggle("is-calm", calm);
    root.scrollTop = 0;
    page.classList.add("is-veiled");
    skipBtn.hidden = false;
    skipBtn.classList.remove("is-shown");
    montage = null;
    layoutGhost();
    enterA();
    startLoop();
  }

  function replay() {
    if (destroyed) return;
    startSequence();
    root.focus({ preventScroll: true });
  }

  function onClick(e) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest(".mf-close") || t.closest(".mf-return")) {
      if (e.detail > 1) return;   // the second click of a double click
      api.close({ keyboard: e.detail === 0 });
      return;
    }
    if (t.closest(".mf-replay")) { replay(); return; }
    if (t.closest(".mf-read")) {
      const head = text.el.firstElementChild;
      if (head) head.scrollIntoView({ behavior: reducedNow() ? "auto" : "smooth", block: "start" });
      // Reading (and a screen reader) starts at the title.
      const h1 = text.el.querySelector("h1");
      if (h1) {
        h1.tabIndex = -1;
        h1.focus({ preventScroll: true });
      }
      return;
    }
    if (phase === "A" || phase === "B") skip();
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) api.close({ keyboard: true });
      return;
    }
    if ((phase === "A" || phase === "B") && (e.key === " " || e.key === "Enter" || e.key === "Spacebar")) {
      const t = e.target instanceof Element ? e.target : null;
      if (t && t.closest("button, a")) return;   // they activate themselves
      e.preventDefault();
      if (!e.repeat) skip();
    }
  }

  let resizeRaf = 0;
  function onResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (destroyed) return;
      if (phase === "A") layoutGhost();
      if (phase === "B" && cardStart >= 0) balanceCard();
      if (phase === "C" || !page.classList.contains("is-veiled")) fitCollage();
    });
  }

  root.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKey, true);
  addEventListener("resize", onResize);

  /* ---------- Start ---------- */

  const tc = cfg.titleCard;
  const collageText = collage.posters.map(p => p.leaves.map(l => l.lines.map(x => x.el.textContent).join("")).join("")).join("");
  const cardText = charsOf(LATIN_SET + tc.series.join("") + tc.episode +
    String(api.markdown).replace(/\]\([^)]*\)/g, "]"));
  const fonts = loadFonts(tc, cardText, charsOf(Array.from(collageText).filter(c => cardText.indexOf(c) < 0).join("")));
  fonts.card.then(() => {
    cardFontsReady = true;
    if (!destroyed && phase === "B" && cardStart >= 0) balanceCard();
  });
  fonts.all.then(() => {
    if (destroyed) return;
    // Natural sizes change with the real fonts.
    for (const p of collage.posters) p.measured = false;
    if (!page.classList.contains("is-veiled")) fitCollage();
  });

  if (reducedNow()) {
    // Straight to the text; wait (briefly) for the fonts so nothing jumps.
    calm = true;
    root.classList.add("is-calm");
    seq.hidden = true;
    skipBtn.hidden = true;
    let shown = false;
    const show = () => {
      if (shown || destroyed) return;
      shown = true;
      enterC(true);
    };
    fonts.all.then(show);
    setTimeout(show, 1200);
  } else {
    startSequence();
  }
  announce(reducedNow()
    ? "Press Escape to close."
    : "An opening of about eight seconds plays first. Press Enter to skip it, Escape to close.");

  return {
    replay,
    destroy() {
      destroyed = true;
      stopLoop();
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      root.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKey, true);
      removeEventListener("resize", onResize);
      clearTimeout(announceTimer);
      releaseGhost();
    }
  };
}

window.SiteManifesto = { mount };
})();

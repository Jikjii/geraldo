#!/usr/bin/env node
/*
 * dev.mjs - a tiny local server for previewing the site. No dependencies.
 *
 *   node dev.mjs                 -> http://localhost:4321/portfolio/
 *   PORT=8080 node dev.mjs       -> another port
 *
 * Serves this folder with the right content types, under the same folder the
 * site uses when hosted: the <base href> at the top of index.html
 * ("/portfolio/" serves it at http://localhost:4321/portfolio/, "/" at the
 * root). "/" redirects to that folder. Page addresses without a file extension
 * (like /portfolio/work/company-one) get index.html, as 404.html does on GitHub
 * Pages. Missing files are 404s, and so are files spelled with the wrong
 * letter case (assets/Photo.JPG for assets/photo.jpg): GitHub Pages is
 * case-sensitive even where your disk is not.
 */
import http from "node:http";
import { createReadStream, readFileSync, realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// The folder as the disk spells it (and with any symlinks resolved), to
// compare the real spelling of each file against the one requested.
const ROOT_REAL = (() => { try { return realpathSync.native(ROOT); } catch (_) { return ROOT; } })();
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || "localhost";

/* The site's folder, read from `<base href="...">` in index.html and
   normalised the way the page does it: "/portfolio/", or "/" for the root. */
function readBase() {
  let raw = "/";
  try {
    const html = readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const m = /<base\s[^>]*?\bhref\s*=\s*(["'])([^"'\n]*)\1/i.exec(html);
    if (m) raw = m[2];
  } catch (_) {}
  let base = raw.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(base)) base = base.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*/i, "");
  return ("/" + base + "/").replace(/\/{2,}/g, "/");
}
const BASE = readBase();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf"
};

function send(res, status, body, type = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", ...headers });
  res.end(res.req.method === "HEAD" ? undefined : body);
}

function redirect(res, location) {
  return send(res, 302, `Found: ${location}\n`, undefined, { Location: location });
}

async function fileAt(filePath) {
  try {
    const info = await stat(filePath);
    if (info.isFile()) return exactly({ filePath, size: info.size });
    if (info.isDirectory()) {
      const index = path.join(filePath, "index.html");
      const inner = await stat(index).catch(() => null);
      if (inner && inner.isFile()) return exactly({ filePath: index, size: inner.size });
    }
  } catch (_) {}
  return null;
}

/* Only the exact spelling on disk counts. macOS and Windows disks ignore
   letter case, but GitHub Pages doesn't, so /assets/Photo.JPG must be a 404
   here too when the file is assets/photo.jpg. Symlinks are refused as well,
   so nothing outside this folder can be served through one. */
async function exactly(found) {
  try {
    const real = await realpath(found.filePath);
    return path.relative(ROOT_REAL, real) === path.relative(ROOT, found.filePath) ? found : null;
  } catch (_) { return null; }
}

function serveFile(req, res, found, status = 200) {
  const type = TYPES[path.extname(found.filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": found.size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(found.filePath).on("error", () => res.destroy()).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
  });

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return send(res, 405, "Method Not Allowed\n");
  }

  // Decode the raw path ourselves so "..", encoded or not, is refused
  // before anything is normalised away.
  const [rawPath, ...rest] = (req.url || "/").split("?");
  const search = rest.length ? "?" + rest.join("?") : "";
  let pathname;
  try { pathname = decodeURIComponent(rawPath.split("#")[0]); } catch (_) { return send(res, 400, "Bad Request\n"); }
  if (pathname.includes("\0") || /(^|[\\/])\.\.([\\/]|$)/.test(pathname)) return send(res, 403, "Forbidden\n");

  // The site lives under BASE, as it will when hosted. The bare domain and
  // the folder without its slash lead into it (GitHub Pages adds the slash too).
  if (BASE !== "/") {
    if (pathname === "/" || pathname === BASE.slice(0, -1)) return redirect(res, BASE + search);
    if (!pathname.startsWith(BASE)) {
      return send(res, 404, `Not Found. This site is served under ${BASE}: http://${HOST}:${PORT}${BASE}\n`);
    }
    pathname = pathname.slice(BASE.length - 1);
  }
  if (pathname.split(/[\\/]/).some(part => part.startsWith("."))) return send(res, 404, "Not Found\n");

  const filePath = path.resolve(ROOT, "." + path.posix.normalize("/" + pathname.replace(/\\/g, "/")));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden\n");

  const found = await fileAt(filePath);
  if (found) return serveFile(req, res, found);

  // Page addresses have no extension: hand them to the single-page app.
  if (!path.extname(pathname)) {
    const index = await fileAt(path.join(ROOT, "index.html"));
    if (index) return serveFile(req, res, index);
  }
  return send(res, 404, "Not Found\n");
});

server.on("error", err => {
  console.error(err.code === "EADDRINUSE"
    ? `Port ${PORT} is already in use. Try another one: PORT=${PORT + 1} node dev.mjs`
    : `Could not start the server: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT}\n  -> http://${HOST}:${PORT}${BASE}\nPress Ctrl+C to stop.`);
});

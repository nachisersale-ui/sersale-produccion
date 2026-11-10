// Tiny static file server for the CRM pages.
//
//   root   directory to serve (default: env CRM_ROOT, else crm/src), so the same
//          tests can run against a built crm/dist later
//   port   0 = any free port
//
// Mimics what Netlify does for this site: "/" serves index.html and extensionless
// paths serve the matching .html ("/pedidos" -> pedidos.html), because the bottom
// navigation bar links to those pretty URLs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CRM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function defaultRoot() {
  return path.resolve(CRM_DIR, process.env.CRM_ROOT || "src");
}

export const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function contentType(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

// Blank same-origin page used by the harness (to prepare sessionStorage before the real page loads).
export const BLANK_PATH = "/__harness/blank";
const BLANK_HTML = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>harness</title></head><body></body></html>';

async function resolveFile(root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  const abs = path.join(root, path.normalize("/" + rel));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;

  const isFile = async (p) => (await fs.promises.stat(p).catch(() => null))?.isFile() || false;
  if (rel.endsWith("/")) {
    const index = path.join(abs, "index.html");
    return (await isFile(index)) ? index : null;
  }
  if (await isFile(abs)) return abs;
  if (await isFile(abs + ".html")) return abs + ".html"; // pretty URL
  if (await isFile(path.join(abs, "index.html"))) return path.join(abs, "index.html");
  return null;
}

/**
 * Starts the server. Returns { url, origin, port, root, requests, close() }.
 * `requests` is a live log of { method, path, status } (handy to assert what a page loaded).
 */
export async function startServer({ root = defaultRoot(), port = 0, host = "127.0.0.1" } = {}) {
  root = path.resolve(root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`La carpeta a servir no existe: ${root} (CRM_ROOT=${process.env.CRM_ROOT || ""})`);
  }
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, headers, body) => {
      requests.push({ method: req.method, path: url.pathname + url.search, status });
      res.writeHead(status, { "Cache-Control": "no-store", ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    try {
      if (req.method !== "GET" && req.method !== "HEAD") return send(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" }, "Method Not Allowed");
      if (url.pathname === BLANK_PATH) return send(200, { "Content-Type": "text/html; charset=utf-8" }, BLANK_HTML);
      const file = await resolveFile(root, url.pathname);
      if (!file) return send(404, { "Content-Type": "text/html; charset=utf-8" }, "<!doctype html><title>404</title><h1>404 - Not Found</h1>");
      const body = await fs.promises.readFile(file);
      send(200, { "Content-Type": contentType(file), "Content-Length": body.length }, body);
    } catch (e) {
      send(500, { "Content-Type": "text/plain; charset=utf-8" }, String(e && e.stack ? e.stack : e));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  const origin = `http://${host}:${actualPort}`;
  return {
    origin,
    url: origin + "/",
    port: actualPort,
    root,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// CLI: `node tests/lib/server.mjs [root] [port]` (npm run serve). Note: opened like this the pages talk to
// the REAL Firebase project; use the harness for anything that writes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const srv = await startServer({ root: process.argv[2] ? path.resolve(process.argv[2]) : defaultRoot(), port: Number(process.argv[3] || process.env.PORT || 8080) });
  console.log(`Sirviendo ${srv.root} en ${srv.url}`);
}

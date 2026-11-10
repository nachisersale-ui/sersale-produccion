// Resolves Playwright WITHOUT listing it in package.json.
//
// Playwright (and its Chromium) is expected to be installed globally on the
// machine that runs the tests. ESM `import "playwright"` ignores NODE_PATH, so
// a bare import only works when the package sits in a parent node_modules.
// We therefore try, in order:
//   1. a normal resolution from this file (local install, if someone adds one),
//   2. CommonJS resolution, which honours NODE_PATH,
//   3. the global npm root (`npm root -g`) and a few well-known locations.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);

function tryRequire(id) {
  try {
    return require(id);
  } catch (e) {
    if (e && (e.code === "MODULE_NOT_FOUND" || e.code === "ERR_MODULE_NOT_FOUND")) return null;
    throw e;
  }
}

function globalRoots() {
  const roots = [];
  for (const p of (process.env.NODE_PATH || "").split(path.delimiter)) if (p) roots.push(p);
  try {
    roots.push(execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {}
  roots.push("/opt/node-tools/node_modules", "/usr/local/lib/node_modules", "/usr/lib/node_modules");
  return [...new Set(roots)];
}

function load() {
  let pw = tryRequire("playwright");
  if (pw) return pw;
  for (const root of globalRoots()) {
    const dir = path.join(root, "playwright");
    if (fs.existsSync(path.join(dir, "package.json"))) {
      pw = tryRequire(dir);
      if (pw) return pw;
    }
  }
  throw new Error(
    "No se encontró Playwright. Instalalo de forma global (npm i -g playwright && npx playwright install chromium) " +
      "o exportá NODE_PATH apuntando al node_modules que lo contiene. No se agrega a package.json a propósito."
  );
}

const pw = load();
export const chromium = pw.chromium;
export const devices = pw.devices;
export default pw;

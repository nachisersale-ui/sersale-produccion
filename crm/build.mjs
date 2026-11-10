// Arma el sitio publicable en crm/dist a partir de crm/src.
//
//   node build.mjs
//
// Qué hace:
//   1. Copia las páginas, estilos, scripts e imágenes tal cual.
//   2. Compila el JSX de pedidos/ y produccion/ a JavaScript común, para que
//      el teléfono no tenga que descargar Babel (3 MB) y compilar miles de
//      líneas cada vez que abre la página. Se usa la MISMA versión fijada de
//      Babel (7.26.4) y las mismas opciones que usaba el navegador.
//   3. Copia las librerías (React, jsPDF, Chart.js, XLSX, EmailJS, Firebase) y
//      las tipografías al propio sitio: ya no depende de servidores externos.
//   4. Genera el service worker con la lista de archivos y un número de
//      versión que cambia cuando cambia cualquier archivo.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(RAIZ, "src");
const DIST = path.join(RAIZ, "dist");
const NM = path.join(RAIZ, "node_modules");

const Babel = require("@babel/standalone");
if (Babel.version !== "7.26.4") throw new Error("Babel debe ser 7.26.4 (hay " + Babel.version + "). No actualizar.");

// Mismas opciones que aplicaba @babel/standalone a <script type="text/babel">.
const BABEL_OPTS = {
  presets: ["react", "env"],
  plugins: ["transform-class-properties", "transform-object-rest-spread", "transform-flow-strip-types"],
};

// Carpetas de JSX -> un solo archivo compilado por aplicación.
const APPS = ["pedidos", "produccion"];

const VENDOR = {
  "react.production.min.js": "react/umd/react.production.min.js",
  "react-dom.production.min.js": "react-dom/umd/react-dom.production.min.js",
  "jspdf.umd.min.js": "jspdf/dist/jspdf.umd.min.js",
  "chart.umd.min.js": "chart.js/dist/chart.umd.js",
  "xlsx.full.min.js": "xlsx/dist/xlsx.full.min.js",
  "email.min.js": "@emailjs/browser/dist/email.min.js",
  "firebase-app.js": "firebase/firebase-app.js",
  "firebase-firestore.js": "firebase/firebase-firestore.js",
  "firebase-app-compat.js": "firebase/firebase-app-compat.js",
  "firebase-firestore-compat.js": "firebase/firebase-firestore-compat.js",
};

const FUENTES = [
  { paquete: "barlow-condensed", familia: "Barlow Condensed", pesos: [500, 600, 700] },
  { paquete: "ibm-plex-sans", familia: "IBM Plex Sans", pesos: [400, 500, 600, 700] },
  { paquete: "ibm-plex-mono", familia: "IBM Plex Mono", pesos: [400, 500, 600] },
];

function leer(f) {
  return fs.readFileSync(f, "utf8");
}
function escribir(f, contenido) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenido);
}
function copiar(desde, hasta) {
  fs.mkdirSync(path.dirname(hasta), { recursive: true });
  fs.copyFileSync(desde, hasta);
}
function listar(dir, base = dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listar(p, base));
    else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out.sort();
}

const t0 = Date.now();
fs.rmSync(DIST, { recursive: true, force: true });

// 1. Archivos tal cual (menos el JSX y la plantilla del service worker).
for (const rel of listar(SRC)) {
  if (rel === "sw.js") continue;
  if (APPS.some((a) => rel.startsWith(a + "/"))) continue;
  copiar(path.join(SRC, rel), path.join(DIST, rel));
}

// 2. JSX -> JS. Los archivos de cada carpeta se unen en orden alfabético y se
//    compilan juntos, como cuando eran un solo bloque dentro de la página.
for (const app of APPS) {
  const dir = path.join(SRC, app);
  const partes = fs.readdirSync(dir).filter((f) => f.endsWith(".jsx")).sort();
  const fuente = partes.map((f) => leer(path.join(dir, f))).join("");
  const { code } = Babel.transform(fuente, { ...BABEL_OPTS, filename: app + ".jsx", sourceType: "module" });
  escribir(path.join(DIST, "js", app + ".js"), "/* Generado por build.mjs desde src/" + app + "/*.jsx — no editar. */\n" + code + "\n");
  console.log(`  js/${app}.js  ←  ${partes.length} archivo(s) JSX, ${(code.length / 1024).toFixed(0)} KB`);
}

// 3. Librerías.
for (const [destino, origen] of Object.entries(VENDOR)) {
  let contenido = fs.readFileSync(path.join(NM, origen));
  if (destino === "firebase-firestore.js") {
    // El módulo de Firestore importa firebase-app.js desde el CDN de Google:
    // tiene que usar la misma copia local, o habría dos Firebase distintos.
    const texto = contenido.toString("utf8");
    const re = /from\s*"https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app\.js"/g;
    if ((texto.match(re) || []).length !== 1) throw new Error("No se encontró el import de firebase-app.js en firebase-firestore.js");
    contenido = Buffer.from(texto.replace(re, 'from"./firebase-app.js"'));
  }
  escribir(path.join(DIST, "vendor", destino), contenido);
}
for (const f of fs.readdirSync(path.join(DIST, "vendor"))) {
  const t = fs.readFileSync(path.join(DIST, "vendor", f), "utf8");
  if (/sourceMappingURL=/.test(t)) fs.writeFileSync(path.join(DIST, "vendor", f), t.replace(/\n?\/\/# sourceMappingURL=.*$/gm, ""));
}

// Tipografías (solo el juego de caracteres latino, que incluye acentos y ñ).
let cssFuentes = "/* Generado por build.mjs — tipografías servidas desde el propio sitio. */\n";
for (const { paquete, familia, pesos } of FUENTES) {
  for (const peso of pesos) {
    const archivo = `${paquete}-latin-${peso}-normal.woff2`;
    copiar(path.join(NM, "@fontsource", paquete, "files", archivo), path.join(DIST, "assets", "fonts", archivo));
    cssFuentes += `@font-face{font-family:"${familia}";font-style:normal;font-weight:${peso};font-display:swap;src:url("../assets/fonts/${archivo}") format("woff2")}\n`;
  }
}
escribir(path.join(DIST, "css", "fonts.css"), cssFuentes);

// Reglas de caché de Netlify: las páginas y el service worker se revalidan
// siempre; el resto lo administra el service worker por versión.
escribir(
  path.join(DIST, "_headers"),
  ["/*", "  Cache-Control: no-cache", "  X-Content-Type-Options: nosniff", "  Referrer-Policy: strict-origin-when-cross-origin", "/sw.js", "  Cache-Control: no-cache, no-store, must-revalidate", ""].join("\n")
);

// 4. Service worker: versión = huella de todo el contenido publicado.
const archivos = listar(DIST).filter((f) => f !== "_headers" && !f.endsWith(".map"));
const huella = crypto.createHash("sha256");
for (const f of archivos) {
  huella.update(f);
  huella.update(fs.readFileSync(path.join(DIST, f)));
}
const plantilla = leer(path.join(SRC, "sw.js"));
huella.update(plantilla);
const version = huella.digest("hex").slice(0, 12);
if (!plantilla.includes('"__VERSION__"') || !plantilla.includes("__ARCHIVOS__")) throw new Error("sw.js perdió sus marcadores");
escribir(path.join(DIST, "sw.js"), plantilla.replace('"__VERSION__"', JSON.stringify(version)).replace("__ARCHIVOS__", JSON.stringify(archivos)));
escribir(path.join(DIST, "version.json"), JSON.stringify({ version, archivos: archivos.length }) + "\n");

// Control: ninguna página debe depender de servidores externos para arrancar.
const EXTERNOS = /(src|href)\s*=\s*["']https?:\/\/|from\s*["']https?:\/\//;
for (const f of archivos.filter((f) => f.endsWith(".html") || (f.startsWith("js/") && f.endsWith(".js")))) {
  const lineas = leer(path.join(DIST, f)).split("\n");
  lineas.forEach((l, i) => {
    if (EXTERNOS.test(l) && !/wa\.me|google\.com\/maps|maps\.google/.test(l) && !/^\s*(\/\/|\*|["'`+])/.test(l) && /<(script|link)\b|^\s*import\b/.test(l)) {
      throw new Error(`${f}:${i + 1} carga un recurso externo: ${l.trim().slice(0, 120)}`);
    }
  });
}

const peso = archivos.reduce((s, f) => s + fs.statSync(path.join(DIST, f)).size, 0);
console.log(`dist listo: ${archivos.length} archivos, ${(peso / 1024 / 1024).toFixed(1)} MB, versión ${version}, ${Date.now() - t0} ms`);

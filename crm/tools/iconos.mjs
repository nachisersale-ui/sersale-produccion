// Genera los íconos de la app (pantalla de inicio del teléfono) a partir de
// src/assets/logo.png sobre fondo carbón. Solo hace falta correrlo si cambia
// el logo:  node tools/iconos.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../tests/lib/playwright.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logo = "data:image/png;base64," + fs.readFileSync(path.join(RAIZ, "src/assets/logo.png")).toString("base64");
const SALIDA = path.join(RAIZ, "src/assets/icons");
// proporción = cuánto del lado ocupa el sello (los "maskable" dejan más margen
// porque el sistema les recorta los bordes).
const ICONOS = [
  { archivo: "apple-touch-icon.png", lado: 180, proporcion: 0.74 },
  { archivo: "icon-192.png", lado: 192, proporcion: 0.74 },
  { archivo: "icon-512.png", lado: 512, proporcion: 0.74 },
  { archivo: "icon-maskable-512.png", lado: 512, proporcion: 0.58 },
];

const browser = await chromium.launch();
for (const { archivo, lado, proporcion } of ICONOS) {
  const page = await browser.newPage({ viewport: { width: lado, height: lado }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;width:${lado}px;height:${lado}px;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(circle at 50% 38%, #2a1b1f 0%, #12161A 68%)">
    <img src="${logo}" style="height:${Math.round(lado * proporcion)}px;width:auto;filter:drop-shadow(0 ${Math.round(lado / 40)}px ${Math.round(lado / 16)}px rgba(0,0,0,.55))"></body>`);
  await page.waitForFunction(() => document.images[0].complete);
  await page.screenshot({ path: path.join(SALIDA, archivo) });
  await page.close();
  console.log("  " + archivo);
}
await browser.close();

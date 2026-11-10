// La app instalada: el service worker guarda el sitio en el teléfono, abre
// sin señal y se actualiza cuando se publica una versión nueva.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, erroresReales } from "./lib/harness.mjs";

const DIST = new URL("../dist/", import.meta.url).pathname;

async function swActivo(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
  });
}

test("abre y navega sin señal con los datos guardados", async () => {
  const h = await launch({
    rol: "director",
    sw: true,
    etiqueta: "sw",
    seed: { clientes: { c1: { nombre: "Almacén Don Pepe", direccion: "Caseros 100" } } },
  });
  try {
    await h.ir("index.html");
    await swActivo(h.page);
    await h.ir("pedidos.html");
    await h.sincronizar();

    await h.sinRed(true);
    for (const p of ["index.html", "dashboard.html", "ventas.html", "produccion.html", "presupuestos.html", "pedidos.html"]) {
      await h.ir(p);
      assert.ok(h.page.url().endsWith(p), "sin señal no abrió " + p);
    }
    // direcciones "lindas" como las sirve Netlify
    await h.page.goto(h.origin + "/pedidos");
    await h.esperarApp();
    await h.page.getByText("Clientes", { exact: false }).first().click();
    await h.page.getByText("Almacén Don Pepe").first().waitFor();
    await h.page.locator(".ss-sin-conexion").waitFor();
    assert.deepEqual(erroresReales(h.errores).filter((e) => !/ERR_INTERNET_DISCONNECTED|Could not reach Cloud Firestore|WebChannel|offline/i.test(e.texto)), []);
  } finally {
    await h.close();
  }
});

test("al publicar una versión nueva, la app la toma sola", async () => {
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), "sersale-dist-"));
  fs.cpSync(DIST, copia, { recursive: true });
  const h = await launch({ rol: "director", sw: true, etiqueta: "swv", root: copia });
  try {
    await h.ir("index.html");
    await swActivo(h.page);
    const v1 = JSON.parse(fs.readFileSync(path.join(copia, "version.json"), "utf8")).version;

    // "Publicar": cambia un archivo y el service worker lleva otra versión.
    const sw = fs.readFileSync(path.join(copia, "sw.js"), "utf8");
    fs.writeFileSync(path.join(copia, "sw.js"), sw.replace(JSON.stringify(v1), JSON.stringify("nueva-version")));
    const index = fs.readFileSync(path.join(copia, "index.html"), "utf8");
    fs.writeFileSync(path.join(copia, "index.html"), index.replace("<title>", '<meta name="prueba" content="v2"><title>'));

    await h.ir("index.html"); // al volver a abrir busca actualizaciones y recarga
    await h.page.waitForFunction(() => !!document.querySelector('meta[name="prueba"][content="v2"]'), null, { timeout: 15000 });
    const caches = await h.page.evaluate(() => caches.keys());
    assert.deepEqual(caches.filter((k) => k.startsWith("sersale-crm-")), ["sersale-crm-nueva-version"]);
  } finally {
    await h.close();
    fs.rmSync(copia, { recursive: true, force: true });
  }
});

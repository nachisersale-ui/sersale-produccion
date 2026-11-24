// Catálogo (catalogo.html): versiones del catálogo mayorista en PDF con aumento
// general o a algunos productos, precios puntuales, selección de productos,
// versión sin precios, registro de emitidos y precios base compartidos con
// Presupuestos.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

// "Hoy" en las pruebas es el martes 10/11/2026.
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const toast = (p, t) => p.locator(".ss-toast", { hasText: t }).first();
const fila = (p, art) => p.locator(`.pr[data-art="${art}"]`);
const catalogosDe = (db) => Object.entries(db.catalogos || {}).map(([id, x]) => ({ id, ...x }));

async function abrir(extra = {}, opts = {}) {
  const seed = Object.assign(buildSeed(), extra.colecciones || {});
  if (extra.config) Object.assign(seed.config, extra.config);
  const h = await launch({ rol: "director", etiqueta: "cat", seed, ...opts });
  await h.ir("catalogo.html");
  await fila(h.page, 304).waitFor();
  return h;
}
async function generar(p) {
  await p.locator("#cat-generar").click();
  await p.locator("#cat-listo").waitFor({ state: "visible", timeout: 60000 });
  return p.evaluate(() => window.__catUltimo);
}
const textosDe = (u) => u.textos.map((t) => t.texto);
async function esperar(h, cond, ms = 15000) {
  const fin = Date.now() + ms;
  for (;;) {
    const db = await h.dump();
    if (cond(db)) return db;
    if (Date.now() > fin) throw new Error("no se cumplió a tiempo");
    await new Promise((r) => setTimeout(r, 120));
  }
}

test("catálogo: aumento a todos con redondeo y un precio puntual; el PDF sale con esos precios, se comparte solo y queda en Emitidos", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    assert.equal(await p.locator("#cat-vigencia").inputValue(), "Noviembre 2026");
    await fila(p, 304).getByText("base $12.470").waitFor();
    await p.locator("#cat-resumen").getByText("Sin cambios: salen los precios base").waitFor();

    // 8% a todos, redondeado a $10: 12.470 → 13.467,6 → 13.470.
    await p.locator("#cat-pct").fill("8");
    await fila(p, 304).getByText("$13.470").waitFor();
    assert.equal(await fila(p, 304).locator("input").getAttribute("placeholder"), "13.470");
    // Un corte fresco sin precio sigue "Consultar".
    await fila(p, 709).getByText("base Consultar").waitFor();
    await p.locator("#cat-resumen").getByText("Cambian 43 de 48 precios").waitFor();

    // Precio puntual: le gana al aumento.
    await fila(p, 301).locator("input").fill("7500");
    await fila(p, 301).locator("input").blur();
    await fila(p, 301).getByText("puntual").waitFor();
    await fila(p, 301).getByText("$7.500").waitFor();
    assert.equal(await fila(p, 301).locator("input").inputValue(), "7.500");
    await p.locator("#cat-resumen").getByText("Cambian 43 de 48 precios · 1 puntual").waitFor();

    const u = await generar(p);
    assert.equal(u.paginas.length, 16);
    assert.deepEqual(u.paginas.slice(0, 7), ["tapa", "frase", "historia", "hacemos", "lineas", "prod", "destacado"]);
    const t = textosDe(u);
    assert.ok(t.includes("$ 13.470"), "el Sublime sale con el aumento");
    assert.ok(t.includes("$ 7.500"), "el de pata sale con el precio puntual");
    assert.ok(!t.includes("$ 12.470") && !t.includes("$ 7.290"), "no queda ningún precio viejo");
    assert.ok(t.includes("NOVIEMBRE 2026"));
    assert.ok(t.includes("CONSULTAR"));
    assert.ok(t.includes("48 productos, 9 líneas"));
    assert.ok(u.bytes > 1500000, "el PDF lleva las fotos");
    await p.locator("#cat-listo-d").getByText("16 páginas").waitFor();

    // Compartir: solo el archivo, sin texto ni dirección.
    await p.locator("#cat-compartir").click();
    await p.waitForFunction(() => window.__compartidos.length === 1);
    const c = await h.compartidos();
    assert.deepEqual([c[0].titulo, c[0].texto, c[0].url], [null, null, null]);
    assert.deepEqual(c[0].archivos.map((a) => [a.nombre, a.tipo]), [["Catalogo_Mayorista_Sersale_Noviembre_2026.pdf", "application/pdf"]]);

    // Queda el registro con todos los precios que salieron.
    const db = await esperar(h, (d) => catalogosDe(d).length === 1);
    const g = catalogosDe(db)[0];
    assert.equal(g.vigencia, "Noviembre 2026");
    assert.equal(g.fecha, "2026-11-10");
    assert.deepEqual(g.aumento, { pct: 8, alcance: "todos", arts: [] });
    assert.equal(g.redondeo, 10);
    assert.deepEqual(g.manuales, { 301: 7500 });
    assert.equal(g.precios[304], 13470);
    assert.equal(g.precios[301], 7500);
    assert.equal(g.precios[709], null);
    assert.equal(g.creadoPor, await p.evaluate(() => sessionStorage.getItem("sersale_usuario") || ""));
    assert.equal(db.config.catalogo_precios, undefined, "emitir no toca los precios base");

    await p.getByRole("tab", { name: "Emitidos" }).click();
    await p.locator(".emi").getByText("Aumento 8% a todos · 1 precio puntual · todos los productos").waitFor();
  } finally {
    await h.close();
  }
});

test("catálogo: aumento solo a una línea, emitir solo algunos productos y la versión sin precios", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    // Aumento a algunos: se abre el selector; se elige toda la línea de jamones cocidos.
    await p.getByRole("button", { name: "Algunos" }).first().click();
    await p.locator("#sel.on").waitFor();
    await p.locator(".sel-f", { hasText: "Jamones cocidos" }).getByRole("button").click();
    await p.getByRole("button", { name: "Listo · 3 elegidos" }).click();
    await p.getByRole("button", { name: "Aumento a 3 productos · cambiar" }).waitFor();
    await p.locator("#cat-pct").fill("10");
    await p.locator("#cat-redondeo").selectOption("100");
    await fila(p, 304).getByText("$13.700").waitFor(); // 13.717 → 13.700
    await fila(p, 401).getByText("base $6.290").waitFor();
    assert.equal(await fila(p, 401).locator("b").count(), 0, "a la paleta no le toca el aumento");
    await p.locator("#cat-resumen").getByText("Cambian 3 de 48 precios").waitFor();

    // Solo dos productos, sin páginas de presentación.
    await p.locator("#cat-cuales").getByRole("button", { name: "Algunos" }).click();
    await p.locator("#sel.on").waitFor();
    await p.locator("#sel-buscar").fill("sublime");
    await p.locator(".sel-p", { hasText: "Sublime" }).locator("input").check();
    await p.locator("#sel-buscar").fill("401");
    await p.locator(".sel-p", { hasText: "Art. 401" }).locator("input").check();
    await p.getByRole("button", { name: "Listo · 2 elegidos" }).click();
    await p.locator("#cat-presentacion").getByRole("button", { name: "Solo productos" }).click();
    await p.locator("#cat-vigencia").fill("Diciembre 2026 · Fiestas");

    let u = await generar(p);
    assert.deepEqual(u.paginas, ["tapa", "prod", "contra"]);
    let t = textosDe(u);
    assert.ok(t.includes("$ 13.700") && t.includes("$ 6.290"));
    assert.ok(!t.includes("ART. 303") && t.includes("ART. 304") && t.includes("ART. 401"), "solo salen los elegidos");
    assert.ok(t.includes("DICIEMBRE 2026 · FIESTAS"));
    assert.equal(u.nombre, "Catalogo_Mayorista_Sersale_Diciembre_2026_Fiestas.pdf");

    // Cambiar algo esconde el PDF anterior: no se comparte uno que ya no coincide.
    await p.locator("#cat-conprecios").getByRole("button", { name: "Sin precios" }).click();
    await p.locator("#cat-listo").waitFor({ state: "hidden" });
    u = await generar(p);
    t = textosDe(u);
    assert.ok(!t.some((x) => /^\$ /.test(x)) && !t.includes("PRECIO") && !t.includes("POR KILO"), "sin ningún precio");
    assert.equal(u.nombre, "Catalogo_Mayorista_Sersale_Diciembre_2026_Fiestas_Sin_Precios.pdf");

    const db = await esperar(h, (d) => catalogosDe(d).length === 2);
    const sin = catalogosDe(db).find((x) => x.sinPrecios);
    assert.deepEqual(sin.arts, [304, 401]);
    assert.equal(sin.presentacion, false);
    assert.deepEqual(sin.aumento, { pct: 10, alcance: "algunos", arts: [304, 303, 301] });
  } finally {
    await h.close();
  }
});

test("catálogo: «dejar como precios base» actualiza el catálogo y también Presupuestos", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    assert.equal(await p.locator("#cat-fijar").isVisible(), false, "sin cambios no hay nada que fijar");
    await p.locator("#cat-pct").fill("5");
    await fila(p, 304).getByText("$13.090").waitFor(); // 13.093,5 → 13.090
    await p.locator("#cat-fijar").click();
    await p.getByText("Cambian 43 precios. Desde ahora el catálogo y Presupuestos usan estos valores.").waitFor();
    await p.getByRole("button", { name: "Sí, actualizar" }).click();
    await toast(p, "Precios base actualizados.").waitFor();

    const db = await esperar(h, (d) => d.config && d.config.catalogo_precios);
    assert.equal(db.config.catalogo_precios.precios[304], 13090);
    assert.equal(db.config.catalogo_precios.precios[709], undefined, "los que son «Consultar» siguen así");
    // La pantalla queda en limpio sobre la base nueva.
    await fila(p, 304).getByText("base $13.090").waitFor();
    assert.equal(await p.locator("#cat-pct").inputValue(), "");
    await p.locator("#cat-resumen").getByText("Sin cambios: salen los precios base").waitFor();

    // Presupuestos cotiza con el precio nuevo.
    await h.ir("presupuestos.html");
    await p.locator("#cot-buscar").waitFor();
    await p.getByText("Catálogo Noviembre 2026").waitFor();
    await p.locator("#cot-buscar").fill("jamon sublime");
    await p.locator("#cot-resultados button").getByText("$13.090").waitFor();
  } finally {
    await h.close();
  }
});

test("catálogo: un emitido se puede volver a emitir tal cual o usar de base para otro", async () => {
  const precios = { 304: 15000, 303: 9890, 401: 6290 };
  const h = await abrir({
    colecciones: {
      catalogos: {
        viejo: { fecha: "2026-10-02", vigencia: "Octubre 2026", sinPrecios: false, presentacion: false, arts: [304, 303, 401], aumento: { pct: 0, alcance: "todos", arts: [] }, redondeo: 10, manuales: { 304: 15000 }, precios, paginas: 3, creadoEn: "2026-10-02T13:00:00.000Z", creadoPor: "nacho" },
      },
    },
  });
  const p = h.page;
  try {
    await p.getByRole("tab", { name: "Emitidos" }).click();
    const tarjeta = p.locator(".emi", { hasText: "Octubre 2026" });
    await tarjeta.getByText("02/10/2026").waitFor();
    await tarjeta.getByText("1 precio puntual · 3 productos · solo productos").waitFor();

    await tarjeta.getByRole("button", { name: "Volver a emitir" }).click();
    await p.locator("#cat-listo").waitFor({ state: "visible", timeout: 60000 });
    let u = await p.evaluate(() => window.__catUltimo);
    assert.deepEqual(u.paginas, ["tapa", "prod", "contra"]);
    assert.ok(textosDe(u).includes("$ 15.000") && textosDe(u).includes("OCTUBRE 2026"));
    assert.equal(catalogosDe(await h.dump()).length, 1, "volver a emitir no crea otro registro");

    await p.getByRole("tab", { name: "Emitidos" }).click();
    await tarjeta.getByRole("button", { name: "Usar de base" }).click();
    assert.equal(await fila(p, 304).locator("input").inputValue(), "15.000");
    assert.equal(await fila(p, 303).locator("input").inputValue(), "", "los que coinciden con la base no quedan como puntuales");
    assert.equal(await p.locator("#cat-vigencia").inputValue(), "Octubre 2026");
    await p.getByRole("button", { name: "Salen 3 productos · cambiar" }).waitFor();

    await p.getByRole("tab", { name: "Emitidos" }).click();
    await tarjeta.getByRole("button", { name: "Borrar" }).click();
    await p.getByRole("button", { name: "Sí, borrar" }).click();
    await esperar(h, (d) => catalogosDe(d).length === 0);
    await p.getByText("Todavía no emitiste ningún catálogo desde acá.").waitFor();
  } finally {
    await h.close();
  }
});

test("catálogo: con una selección chica las páginas se reacomodan y «Nuestras líneas» cuenta solo lo elegido", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    const plan = await p.evaluate(() => {
      const C = window.SersaleCatalogoCompleto;
      const todos = C.paginas.flatMap((pg) => pg.flatMap((f) => f.productos.map((x) => x.art)));
      const secos = C.paginas.flatMap((pg) => pg.filter((f) => f.nombre === "Embutidos secos").flatMap((f) => f.productos.map((x) => x.art)));
      const resumen = (o) => {
        const pl = window.SersaleCatalogoPDF.planear(C, o);
        return { tipos: pl.map((x) => x.tipo), prods: pl.filter((x) => x.tipo === "prod").map((x) => x.familias.map((f) => [f.id, f.productos.length, f.continua])), lineas: pl.lineas };
      };
      return { completo: resumen({}), chico: resumen({ arts: [304, 401, 102, 510] }), secos: resumen({ arts: secos, presentacion: false }), total: todos.length };
    });
    assert.equal(plan.total, 48);
    assert.equal(plan.completo.tipos.length, 16);
    assert.equal(plan.completo.lineas.reduce((a, l) => a + l.cantidad, 0), 48);
    assert.deepEqual(plan.completo.lineas.find((l) => l.nombre === "Embutidos secos"), { id: "secos", nombre: "Embutidos secos", cantidad: 12, pagina: 10 });
    // 4 productos de 4 líneas entran en una sola página, con el destacado adelante (lleva el art. 102).
    assert.deepEqual(plan.chico.tipos, ["tapa", "frase", "historia", "hacemos", "lineas", "destacado", "prod", "como", "contra"]);
    assert.deepEqual(plan.chico.prods, [[["cocidos", 1, false], ["paletas", 1, false], ["crudos", 1, false], ["ahumados", 1, false]]]);
    assert.deepEqual(plan.chico.lineas.map((l) => [l.cantidad, l.pagina]), [[1, 7], [1, 7], [1, 7], [1, 7]]);
    // Una línea de 12 se parte en dos páginas parejas.
    assert.deepEqual(plan.secos.prods, [[["secos", 6, false]], [["secos", 6, true]]]);
  } finally {
    await h.close();
  }
});

test("catálogo: las fotos y tipografías del PDF se publican pero no se guardan en cada teléfono", () => {
  const sw = fs.readFileSync(path.join(DIST, "sw.js"), "utf8");
  assert.ok(!sw.includes("catalogo-pdf/"), "no van a la lista que cada teléfono guarda");
  assert.ok(sw.includes('"catalogo.html"') && sw.includes('"js/catalogo-pdf.js"'), "la pantalla sí");
  for (const f of ["pag-tapa.jpg", "cab-cocidos.jpg", "p-304.jpg", "linea-secos.jpg", "Poppins-800.ttf", "Montserrat-400.ttf", "sin-gluten.png"]) {
    assert.ok(fs.existsSync(path.join(DIST, "catalogo-pdf", f)), f);
  }
});

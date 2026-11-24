// Presupuestos, pestaña «Cotización»: productos del catálogo con unidades y kilos,
// totales, IVA, validez opcional, PDF con fotos y presupuestos guardados.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

// "Hoy" en las pruebas es el martes 10/11/2026.
const toast = (p, t) => p.locator(".ss-toast", { hasText: t }).first();
const presupuestosDe = (db) => Object.entries(db.presupuestos || {}).map(([id, x]) => ({ id, ...x })).sort((a, b) => a.nro - b.nro);
const pdfTexto = async (d) => fs.readFileSync(await d.path()).toString("latin1");
const imagenes = (t) => (t.match(/\/Subtype\s*\/Image/g) || []).length;

async function abrir(presupuestos = null, opts = {}) {
  const seed = buildSeed();
  if (presupuestos) seed.presupuestos = presupuestos;
  const h = await launch({ rol: "director", etiqueta: "cot", seed, compartir: false, ...opts }); // sin menú de compartir: el PDF se descarga
  await h.ir("presupuestos.html");
  await h.page.locator("#cot-cli").waitFor();
  return h;
}
async function agregar(p, buscar, nombre) {
  await p.locator("#cot-buscar").fill(buscar);
  await p.getByRole("button", { name: "Agregar " + nombre, exact: true }).click();
}
const campo = (p, cual, nombre) => p.getByLabel(cual + " de " + nombre, { exact: true });
async function escribir(loc, texto) {
  await loc.fill("");
  await loc.pressSequentially(texto);
}
async function esperar(h, cond, ms = 15000) {
  const fin = Date.now() + ms;
  for (;;) {
    const db = await h.dump();
    if (cond(presupuestosDe(db), db)) return db;
    if (Date.now() > fin) throw new Error("no se cumplió a tiempo: " + JSON.stringify(presupuestosDe(db)));
    await new Promise((r) => setTimeout(r, 120));
  }
}
const SUBLIME = 'JAMÓN COCIDO NATURAL "SUBLIME"';

test("cotización: productos del catálogo con unidades y kilos, totales, IVA y validez; queda guardada y el PDF lleva las fotos", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    assert.equal(await p.getByRole("tab", { name: "Cotización" }).getAttribute("aria-selected"), "true");
    await p.getByText("Catálogo Noviembre 2026").waitFor();

    // Buscar sin acentos: aparece con el precio del catálogo y su foto.
    await p.locator("#cot-buscar").fill("jamon sublime");
    const res = p.getByRole("button", { name: "Agregar " + SUBLIME, exact: true });
    await res.getByText("$12.470").waitFor();
    assert.equal(await res.locator("img").getAttribute("src"), "assets/productos/p-304.jpg");
    assert.equal(await p.locator("#cot-resultados button").count(), 1);
    await res.click();

    // 6 piezas de 6 kg: propone 36 kg y calcula el renglón.
    assert.equal(await campo(p, "Precio por kilo", SUBLIME).inputValue(), "12.470");
    await escribir(campo(p, "Unidades", SUBLIME), "6");
    assert.equal(await campo(p, "Kilos", SUBLIME).inputValue(), "36");
    const renglon = p.locator('[data-linea="304"]');
    await renglon.getByText("$448.920").waitFor();
    await renglon.getByText("Kilos estimados por el peso de la pieza").waitFor();
    // Los kilos se pueden corregir a mano (y ya no los pisa un cambio de unidades).
    await escribir(campo(p, "Kilos", SUBLIME), "34.5");
    assert.equal(await campo(p, "Kilos", SUBLIME).inputValue(), "34,5");
    await renglon.getByText("$430.215").waitFor();
    await escribir(campo(p, "Unidades", SUBLIME), "5");
    assert.equal(await campo(p, "Kilos", SUBLIME).inputValue(), "34,5");

    // Un seco de 300 g: 10 unidades son 3 kg. Y un corte fresco sin precio de lista.
    await agregar(p, "602", "SALAMÍN PICADO FINO");
    await escribir(campo(p, "Unidades", "SALAMÍN PICADO FINO"), "10");
    assert.equal(await campo(p, "Kilos", "SALAMÍN PICADO FINO").inputValue(), "3");
    await p.locator('[data-linea="602"]').getByText("$44.970").waitFor();
    await agregar(p, "bondiola fresca", "BONDIOLA FRESCA");
    assert.equal(await campo(p, "Precio por kilo", "BONDIOLA FRESCA").inputValue(), "");
    await escribir(campo(p, "Unidades", "BONDIOLA FRESCA"), "2");
    await p.locator('[data-linea="707"]').getByText("Precio a confirmar: no suma al total").waitFor();
    // El mismo producto no se agrega dos veces.
    await agregar(p, "sublime", SUBLIME);
    await toast(p, "ya está en la cotización").waitFor();
    assert.equal(await p.locator(".cot-linea").count(), 3);

    assert.equal(await p.locator("#cot-subtotal").innerText(), "$475.185");
    assert.equal(await p.locator("#cot-total").innerText(), "$475.185");
    await p.locator("#cot-ajuste-tipo").selectOption("bonif");
    await escribir(p.locator("#cot-ajuste-pct"), "10");
    assert.equal(await p.locator("#cot-ajuste").innerText(), "-$47.519");
    assert.equal(await p.locator("#cot-total").innerText(), "$427.666");
    await p.getByText("Precios finales, IVA incluido.").waitFor();
    await p.locator("#cot-iva-mas").click();
    await p.getByText("Total + IVA").waitFor();
    await p.getByText("Los precios no incluyen IVA.").waitFor();
    await p.locator("#cot-validez").fill("7");
    await p.locator("#cot-obs").fill("Entrega en 48 h");

    // Sin cliente no guarda.
    await p.locator("#cot-generar").click();
    await toast(p, "Poné el nombre del cliente").waitFor();
    assert.deepEqual(presupuestosDe(await h.dump()), []);
    await p.locator("#cot-cli").fill("  Parrilla   Don Tito ");

    let [d] = await Promise.all([p.waitForEvent("download"), p.locator("#cot-generar").click()]);
    assert.equal(d.suggestedFilename(), "Presupuesto_P-0001_Parrilla_Don_Tito_10-11-2026.pdf");
    await toast(p, "Presupuesto P-0001 guardado y PDF generado").waitFor();
    const db = await esperar(h, (ps) => ps.length === 1);
    const g = presupuestosDe(db)[0];
    assert.equal(db.config.contador_presupuestos.ultimo, 1);
    assert.deepEqual(
      { nro: g.nro, fecha: g.fecha, cliente: g.cliente, iva: g.iva, validezDias: g.validezDias, obs: g.obs, ajuste: g.ajuste, subtotal: g.subtotal, ajusteMonto: g.ajusteMonto, total: g.total, creadoPor: g.creadoPor },
      { nro: 1, fecha: "2026-11-10", cliente: "Parrilla Don Tito", iva: "mas", validezDias: 7, obs: "Entrega en 48 h", ajuste: { tipo: "bonif", pct: 10 }, subtotal: 475185, ajusteMonto: -47519, total: 427666, creadoPor: "nacho" }
    );
    assert.deepEqual(g.items.map((it) => [it.art, it.nombre, it.peso, it.unidad, it.unidades, it.kg, it.precio, it.subtotal, it.foto]), [
      [304, SUBLIME, "6 kg", "pieza", 5, 34.5, 12470, 430215, "p-304.jpg"],
      [602, "SALAMÍN PICADO FINO", "300 g", "pieza", 10, 3, 14990, 44970, "p-602.jpg"],
      [707, "BONDIOLA FRESCA", "2 kg", "pieza", 2, 4, null, null, "p-707.jpg"],
    ]);

    const t = await pdfTexto(d);
    for (const x of ["PRESUPUESTO", "P-0001", "Parrilla Don Tito", "10/11/2026", "FRIGORÍFICO SERSALE S.R.L.", "CUIT 30-70227633-7", "SENASA Est. 3839", "JAMÓN COCIDO NATURAL", "Art. 304", "34,5 kg", "$12.470", "$430.215", "SALAMÍN PICADO FINO", "$44.970", "BONDIOLA FRESCA", "A confirmar", "$475.185", "Bonificación 10%", "-$47.519", "TOTAL + IVA", "$427.666", "Los precios no incluyen IVA.", "7 días", "hasta el 17/11/2026", "Entrega en 48 h", "peso real de la mercadería"]) {
      assert.ok(t.includes(x), "el PDF dice «" + x + "»");
    }
    assert.equal(imagenes(t), 4, "el logo y una foto por producto");

    // Corregir y volver a generar actualiza el MISMO presupuesto (no toma otro número).
    await p.getByText("Guardado como P-0001").waitFor();
    await p.locator("#cot-iva-final").click();
    await p.locator("#cot-validez").fill("");
    [d] = await Promise.all([p.waitForEvent("download"), p.locator("#cot-generar").click()]);
    assert.equal(d.suggestedFilename(), "Presupuesto_P-0001_Parrilla_Don_Tito_10-11-2026.pdf");
    const db2 = await esperar(h, (ps) => ps.length === 1 && ps[0].iva === "final");
    assert.equal(presupuestosDe(db2)[0].validezDias, null);
    assert.equal(db2.config.contador_presupuestos.ultimo, 1);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(presupuestosDe(db2)[0].actualizadoEn));
    const t2 = await pdfTexto(d);
    assert.ok(t2.includes("Precios finales, IVA incluido.") && !t2.includes("TOTAL + IVA") && !t2.includes("VALIDEZ"), "sin IVA aparte y sin validez");

    // «Empezar un presupuesto nuevo» deja todo en blanco y el siguiente toma el número que sigue.
    await p.locator("#cot-nuevo").click();
    assert.equal(await p.locator(".cot-linea").count(), 0);
    assert.equal(await p.locator("#cot-cli").inputValue(), "");
    await p.locator("#cot-cli").fill("Almacén Doña Rosa");
    await agregar(p, "mortadela bocha", "MORTADELA BOCHA");
    await escribir(campo(p, "Kilos", "MORTADELA BOCHA"), "5");
    [d] = await Promise.all([p.waitForEvent("download"), p.locator("#cot-generar").click()]);
    assert.equal(d.suggestedFilename(), "Presupuesto_P-0002_Almacen_Dona_Rosa_10-11-2026.pdf");
    const db3 = await esperar(h, (ps) => ps.length === 2);
    assert.deepEqual(presupuestosDe(db3).map((x) => [x.nro, x.cliente, x.total]), [[1, "Parrilla Don Tito", 427666], [2, "Almacén Doña Rosa", 34950]]);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("artículos fuera del catálogo y validaciones: no guarda con datos a medias", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    await p.locator("#cot-cli").fill("Cliente de prueba");
    await p.locator("#cot-generar").click();
    await toast(p, "Agregá al menos un producto").waitFor();

    await p.getByRole("button", { name: "+ Agregar un artículo que no está en el catálogo" }).click();
    await escribir(p.getByLabel("Kilos de artículo 1"), "2");
    await p.locator("#cot-generar").click();
    await toast(p, "Escribí la descripción del artículo").waitFor();
    await p.getByLabel("Descripción del artículo 1").fill("Queso de cabra");
    await p.getByLabel("Presentación del artículo 1").fill("horma de 2 kg");
    await escribir(p.getByLabel("Precio por kilo de artículo 1"), "8990");
    assert.equal(await p.getByLabel("Precio por kilo de artículo 1").inputValue(), "8.990");
    await p.locator('[data-linea="vario"]').getByText("$17.980").waitFor();

    await agregar(p, "panceta ahumada", "PANCETA AHUMADA");
    await p.locator("#cot-generar").click();
    await toast(p, "Poné las unidades o los kilos de PANCETA AHUMADA").waitFor();
    await p.locator("#cot-ajuste-tipo").selectOption("bonif");
    await escribir(p.locator("#cot-ajuste-pct"), "100");
    await p.getByText("Revisá el porcentaje").waitFor();
    await escribir(campo(p, "Kilos", "PANCETA AHUMADA"), "1,5");
    await p.locator("#cot-generar").click();
    await toast(p, "Revisá el porcentaje").waitFor();
    assert.deepEqual(presupuestosDe(await h.dump()), [], "nada guardado hasta que está todo bien");

    await p.locator("#cot-ajuste-tipo").selectOption("recargo");
    await escribir(p.locator("#cot-ajuste-pct"), "5");
    assert.equal(await p.locator("#cot-total").innerText(), "$43.433"); // (17.980 + 23.385) + 5 % = 41.365 + 2.068
    // Quitar un renglón saca también su importe.
    await p.getByRole("button", { name: "Quitar PANCETA AHUMADA" }).click();
    assert.equal(await p.locator("#cot-total").innerText(), "$18.879");
    const [d] = await Promise.all([p.waitForEvent("download"), p.locator("#cot-generar").click()]);
    const db = await esperar(h, (ps) => ps.length === 1);
    const g = presupuestosDe(db)[0];
    assert.deepEqual(g.items.map((it) => [it.art, it.nombre, it.peso, it.unidades, it.kg, it.precio, it.subtotal, it.foto]), [[null, "Queso de cabra", "horma de 2 kg", 0, 2, 8990, 17980, null]]);
    assert.deepEqual([g.ajuste, g.ajusteMonto, g.total], [{ tipo: "recargo", pct: 5 }, 899, 18879]);
    const t = await pdfTexto(d);
    assert.ok(t.includes("Queso de cabra") && t.includes("horma de 2 kg") && t.includes("Recargo 5%") && t.includes("$18.879"));
    assert.equal(imagenes(t), 1, "solo el logo: un artículo aparte no tiene foto");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("sin conexión: avisa que no se puede guardar y deja generar el PDF sin número", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    await p.locator("#cot-cli").fill("Cliente sin señal");
    await agregar(p, "mortadela bocha", "MORTADELA BOCHA");
    await escribir(campo(p, "Kilos", "MORTADELA BOCHA"), "5");
    await h.sinRed(true);
    await p.locator("#cot-generar").click();
    await p.getByText("No se pudo guardar").waitFor({ timeout: 30000 });
    // «Volver» no genera nada.
    await p.locator(".ss-hoja .ss-btn", { hasText: "Volver" }).tap();
    await p.locator("#cot-generar").click();
    await p.getByText("No se pudo guardar").waitFor({ timeout: 30000 });
    const [d] = await Promise.all([p.waitForEvent("download"), p.locator(".ss-hoja .ss-btn", { hasText: "Generar sin guardar" }).tap()]);
    assert.equal(d.suggestedFilename(), "Presupuesto_Cliente_sin_senal_10-11-2026.pdf");
    const t = await pdfTexto(d);
    assert.ok(t.includes("MORTADELA BOCHA") && t.includes("$34.950") && !t.includes("P-0001"));
    await toast(p, "PDF generado sin guardar").waitFor();
    await h.sinRed(false);
    assert.deepEqual(presupuestosDe(await h.dump()), []);
  } finally {
    await h.close();
  }
});

test("guardados: historial de lo enviado, volver a sacar el PDF, modificar con el mismo número y eliminar", async () => {
  const item = (art, nombre, peso, unidades, kg, precio) => ({ art, nombre, peso, unidad: "pieza", unidades, kg, precio, subtotal: Math.round(kg * precio), foto: "p-" + art + ".jpg" });
  const h = await abrir({
    a: { nro: 3, fecha: "2026-11-04", cliente: "Almacén Doña Rosa", iva: "final", validezDias: null, obs: "", ajuste: { tipo: "", pct: 0 }, items: [item(614, "MORTADELA BOCHA", "5 kg", 2, 10, 6990)], subtotal: 69900, ajusteMonto: 0, total: 69900, creadoEn: "2026-11-04T12:00:00.000Z", creadoPor: "nacho" },
    b: { nro: 7, fecha: "2026-11-09", cliente: "Parrilla Don Tito", iva: "mas", validezDias: 5, obs: "Pago a 15 días", ajuste: { tipo: "bonif", pct: 10 }, items: [item(304, SUBLIME, "6 kg", 2, 12, 12470), item(501, "PANCETA AHUMADA", "1,5 kg", 4, 6, 15590)], subtotal: 243180, ajusteMonto: -24318, total: 218862, creadoEn: "2026-11-09T12:00:00.000Z", creadoPor: "nacho" },
  });
  const p = h.page;
  const tarjetas = () => p.locator("[data-presupuesto]").evaluateAll((els) => els.map((e) => e.getAttribute("data-presupuesto")));
  try {
    await p.getByRole("tab", { name: "Guardados" }).click();
    await p.locator('[data-presupuesto="P-0007"]').waitFor();
    assert.deepEqual(await tarjetas(), ["P-0007", "P-0003"], "el más nuevo primero");
    await p.locator('[data-presupuesto="P-0007"]').getByText("2 productos · $218.862 + IVA").waitFor();
    await p.locator('[data-presupuesto="P-0003"]').getByText("1 producto · $69.900").waitFor();
    await p.locator("#gua-buscar").fill("dona rosa");
    assert.deepEqual(await tarjetas(), ["P-0003"]);
    await p.locator("#gua-buscar").fill("panceta");
    assert.deepEqual(await tarjetas(), ["P-0007"]);
    await p.locator("#gua-buscar").fill("");

    // El PDF de uno guardado sale igual que cuando se envió.
    const [d] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "PDF del presupuesto P-0007" }).click()]);
    assert.equal(d.suggestedFilename(), "Presupuesto_P-0007_Parrilla_Don_Tito_09-11-2026.pdf");
    const t = await pdfTexto(d);
    for (const x of ["P-0007", "09/11/2026", "Parrilla Don Tito", "PANCETA AHUMADA", "$218.862", "TOTAL + IVA", "5 días", "hasta el 14/11/2026", "Pago a 15 días"]) assert.ok(t.includes(x), "el PDF dice «" + x + "»");

    // Modificar: abre la cotización con todo cargado y guarda sobre el mismo número.
    await p.getByRole("button", { name: "Modificar el presupuesto P-0007" }).click();
    await p.getByText("Estás modificando el presupuesto P-0007").waitFor();
    assert.equal(await p.locator("#cot-cli").inputValue(), "Parrilla Don Tito");
    assert.equal(await campo(p, "Kilos", SUBLIME).inputValue(), "12");
    assert.equal(await campo(p, "Unidades", "PANCETA AHUMADA").inputValue(), "4");
    assert.equal(await p.locator("#cot-total").innerText(), "$218.862");
    assert.equal(await p.locator("#cot-validez").inputValue(), "5");
    await escribir(campo(p, "Kilos", SUBLIME), "10");
    const [d2] = await Promise.all([p.waitForEvent("download"), p.locator("#cot-generar").click()]);
    assert.equal(d2.suggestedFilename(), "Presupuesto_P-0007_Parrilla_Don_Tito_10-11-2026.pdf");
    const db = await esperar(h, (ps) => ps.find((x) => x.nro === 7).total !== 218862);
    const g = presupuestosDe(db).find((x) => x.nro === 7);
    assert.deepEqual([g.items[0].kg, g.subtotal, g.total, g.creadoEn, presupuestosDe(db).length], [10, 218240, 196416, "2026-11-09T12:00:00.000Z", 2]);

    // Eliminar pide confirmación.
    await p.getByRole("tab", { name: "Guardados" }).click();
    await p.getByRole("button", { name: "Eliminar el presupuesto P-0003" }).click();
    await p.locator(".ss-hoja .ss-btn", { hasText: "Cancelar" }).tap();
    assert.equal(presupuestosDe(await h.dump()).length, 2);
    await p.getByRole("button", { name: "Eliminar el presupuesto P-0003" }).click();
    await p.locator(".ss-hoja .ss-btn", { hasText: "Eliminar" }).tap();
    await toast(p, "Presupuesto eliminado").waitFor();
    await esperar(h, (ps) => ps.length === 1);
    assert.deepEqual(await tarjetas(), ["P-0007"]);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("en el teléfono el PDF se comparte como archivo solo: sin link del CRM, sin texto y sin título", async () => {
  const h = await abrir(null, { compartir: true });
  const p = h.page;
  try {
    await p.locator("#cot-cli").fill("Parrilla Don Tito");
    await agregar(p, "mortadela bocha", "MORTADELA BOCHA");
    await escribir(campo(p, "Kilos", "MORTADELA BOCHA"), "5");
    await p.locator("#cot-generar").click();
    await toast(p, "Presupuesto P-0001 guardado y PDF generado").waitFor();
    let c = await h.compartidos();
    assert.equal(c.length, 1);
    assert.deepEqual({ titulo: c[0].titulo, texto: c[0].texto, url: c[0].url }, { titulo: null, texto: null, url: null }, "al cliente le llega solo el PDF");
    assert.deepEqual(c[0].archivos.map((a) => [a.nombre, a.tipo]), [["Presupuesto_P-0001_Parrilla_Don_Tito_10-11-2026.pdf", "application/pdf"]]);
    assert.ok(c[0].archivos[0].bytes > 5000);
    assert.equal(h.llamadas.descargas.length, 0, "no se descarga: se comparte");

    // Desde Guardados y desde la lista de precios, lo mismo.
    await p.getByRole("tab", { name: "Guardados" }).click();
    await p.getByRole("button", { name: "PDF del presupuesto P-0001" }).click();
    await p.waitForFunction(() => window.__compartidos.length === 2);
    await p.getByRole("tab", { name: "Lista de precios" }).click();
    await p.locator("#cli").fill("Parrilla Don Tito");
    await p.locator("#btnGen").click();
    await p.waitForFunction(() => window.__compartidos.length === 3);
    c = await h.compartidos();
    for (const x of c) assert.deepEqual([x.titulo, x.texto, x.url, x.archivos.length], [null, null, null, 1]);
    assert.equal(c[2].archivos[0].nombre, "Presupuesto_Sersale_Parrilla_Don_Tito_10-11-2026.pdf");

    // Si el iPhone no deja abrir el menú porque el toque "venció" (el guardado tardó), se pide
    // un toque más en vez de descargar (que era lo que terminaba mandando el link).
    await p.evaluate(() => {
      const real = navigator.share;
      let primera = true;
      navigator.share = (d) => {
        if (primera) { primera = false; return Promise.reject(new DOMException("hace falta un toque", "NotAllowedError")); }
        return real(d);
      };
    });
    await p.locator("#btnGen").click();
    await p.getByText("El PDF está listo").waitFor();
    await p.locator(".ss-hoja .ss-btn", { hasText: "Compartir" }).tap();
    await p.waitForFunction(() => window.__compartidos.length === 4);
    assert.equal(h.llamadas.descargas.length, 0);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});
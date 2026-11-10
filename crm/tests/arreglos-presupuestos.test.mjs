// Arreglos de Presupuestos (presupuestos.html): cada prueba arma el presupuesto
// como lo hace el director en el iPhone y revisa lo que le llega al cliente (el
// PDF y el CSV descargados) y lo que queda a la vista. La página no guarda nada
// en la base: también se revisa que siga sin escribir.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const NOCHE = "2026-11-10T22:30:00-03:00"; // en UTC ya es 11/11

async function abrir(opts = {}) {
  const h = await launch({ rol: "director", etiqueta: "presup", seed: buildSeed(), ...opts });
  await h.ir("presupuestos.html");
  await h.page.waitForSelector("#p-0");
  return h;
}

/** Textos del PDF en el orden en que se dibujaron (jsPDF los escribe sin comprimir). */
function textosPdf(bytes) {
  const t = bytes.toString("latin1");
  const out = [];
  const re = /\(((?:\\.|[^\\()])*)\) Tj/g;
  let m;
  while ((m = re.exec(t))) out.push(m[1].replace(/\\([\\()])/g, "$1"));
  return out;
}
/** Fila de un producto en el PDF: después del nombre vienen artículo y peso (si tiene) y el precio. */
function filaPdf(pdf, nombre) {
  const i = pdf.textos.indexOf(nombre);
  assert.ok(i >= 0, `falta en el PDF: ${nombre}\n${pdf.textos.join(" | ")}`);
  const j = pdf.textos.findIndex((t, k) => k > i && /^(\$.*|Consultar)$/.test(t));
  assert.ok(j > i && j - i <= 3, `no se encontró el precio de ${nombre}`);
  return { datos: pdf.textos.slice(i + 1, j), precio: pdf.textos[j] };
}
const estaEnPdf = (pdf, texto) => pdf.textos.includes(texto);
/** Tamaño de letra con el que se dibujó un texto. */
function tamanioEnPdf(pdf, texto) {
  const t = pdf.bytes.toString("latin1");
  const i = t.indexOf(`(${texto}) Tj`);
  assert.ok(i >= 0, "falta en el PDF: " + texto);
  const tf = [...t.slice(0, i).matchAll(/\/F\d+ ([\d.]+) Tf/g)].pop();
  return Number(tf[1]);
}

/** Toca el botón como en el iPhone: Safari no le saca el cursor al campo que se estaba escribiendo. */
const tocarSinSacarElCursor = (h, sel) => h.page.locator(sel).dispatchEvent("click");

async function descargar(h, accion) {
  const [descarga] = await Promise.all([h.page.waitForEvent("download"), accion()]);
  const bytes = fs.readFileSync(await descarga.path());
  return { nombre: descarga.suggestedFilename(), bytes };
}
/** Genera el PDF y lo devuelve leído. `tocar` permite simular el toque sin sacar el cursor. */
async function generarPdf(h, tocar = () => h.page.tap("#btnGen")) {
  const d = await descargar(h, tocar);
  assert.equal(d.bytes.subarray(0, 5).toString("latin1"), "%PDF-");
  await h.page.waitForFunction(() => !document.getElementById("btnGen").disabled);
  return { ...d, textos: textosPdf(d.bytes) };
}
async function exportarCsv(h) {
  const d = await descargar(h, () => h.page.tap('.hdr button:has-text("Exportar CSV")'));
  const texto = d.bytes.toString("utf8").replace(/^﻿/, "");
  const fila = (producto) => {
    const l = texto.split("\n").find((x) => x.startsWith(producto + ";"));
    assert.ok(l, `falta en el CSV: ${producto}\n${texto}`);
    return l.split(";");
  };
  return { ...d, texto, fila };
}

async function escribir(h, sel, texto) {
  await h.page.tap(sel);
  await h.page.keyboard.type(texto);
}
const cliente = (h, nombre) => h.page.fill("#cli", nombre);
/** Agrega un artículo vario escribiendo tecla por tecla; devuelve el selector de su fila. */
async function agregarVario(h, { desc, peso, precio }) {
  await h.page.tap(".btn-add-custom");
  const n = await h.page.locator("#custom-list .custom-row").count();
  const fila = `#custom-list .custom-row:nth-child(${n})`;
  if (desc) await escribir(h, `${fila} .ci-desc`, desc);
  if (peso) await escribir(h, `${fila} .ci-peso`, peso);
  if (precio) await escribir(h, `${fila} .ci-precio`, precio);
  return fila;
}
const uidDe = (h, nombre) =>
  h.page.evaluate((nombre) => {
    for (const c of CATS) for (const p of c.prods) if (p.n === nombre) return p.uid;
    return null;
  }, nombre);
const abrirCategoria = (h, nombre) => h.page.tap(`.sec-hdr:has(.sec-nombre:text-is("${nombre}")) .sec-nombre`);

// ── Precios que le llegan al cliente ────────────────────────────────────────

test('artículo vario: el precio "8.990" sale $8.990 en el PDF (no $9)', async () => {
  const h = await abrir();
  try {
    await cliente(h, "Almacén Don Pepe");
    const f1 = await agregarVario(h, { desc: "Queso Tybo", peso: "4 KG", precio: "8.990" });
    const f2 = await agregarVario(h, { desc: "Queso Sardo", peso: "5 KG", precio: "$ 12.500" });
    const f3 = await agregarVario(h, { desc: "Aceitunas rellenas", peso: "balde", precio: "1250,50" });
    const f4 = await agregarVario(h, { desc: "Pickles", peso: "frasco", precio: "950" });

    // En pantalla el precio queda escrito con el punto de miles, como los del catálogo.
    assert.equal(await h.page.inputValue(`${f1} .ci-precio`), "8.990");
    assert.equal(await h.page.inputValue(`${f2} .ci-precio`), "12.500");
    assert.equal(await h.page.inputValue(`${f3} .ci-precio`), "1.250,5");
    assert.equal(await h.page.inputValue(`${f4} .ci-precio`), "950");
    assert.equal((await h.page.textContent("#custom-count")).trim(), "4 agregados");
    assert.equal(await h.page.getAttribute(`${f1} .ci-precio`, "inputmode"), "decimal");

    const pdf = await generarPdf(h);
    assert.deepEqual(filaPdf(pdf, "Queso Tybo"), { datos: ["4 KG"], precio: "$8.990" });
    assert.equal(filaPdf(pdf, "Queso Sardo").precio, "$12.500");
    assert.equal(filaPdf(pdf, "Aceitunas rellenas").precio, "$1.251");
    assert.equal(filaPdf(pdf, "Pickles").precio, "$950");
    await h.page.waitForSelector('.ss-toast:has-text("PDF generado")');

    const csv = await exportarCsv(h);
    assert.deepEqual(csv.fila("Queso Tybo"), ["Queso Tybo", "", "4 KG", "8990"]);
    assert.equal(csv.fila("Queso Sardo")[3], "12500");

    // Con un aumento general del 10 % el artículo vario también sube.
    await h.page.fill("#ajuste-pct", "10");
    const pdf2 = await generarPdf(h);
    assert.equal(filaPdf(pdf2, "Queso Tybo").precio, "$9.889");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test('un precio del catálogo borrado ("Consultar") sale "Consultar" en el PDF, no el precio de lista', async () => {
  const h = await abrir();
  try {
    await cliente(h, "Carnicería El Toro");
    const pata = await uidDe(h, "JAMÓN COCIDO DE PATA");
    const sodio = await uidDe(h, "JAMÓN COCIDO ESPECIAL BAJO SODIO");

    // Borra el precio del jamón de pata y cambia el del bajo sodio.
    await h.page.tap(`#p-${pata}`);
    await h.page.locator(`#p-${pata}`).selectText();
    await h.page.keyboard.press("Backspace");
    await h.page.tap(`#p-${sodio}`);
    await h.page.locator(`#p-${sodio}`).selectText();
    await h.page.keyboard.type("7500");
    await h.page.tap(".hdr-t"); // toca afuera: se cierra el teclado
    assert.equal(await h.page.inputValue(`#p-${pata}`), "Consultar");
    assert.equal(await h.page.inputValue(`#p-${sodio}`), "$ 7.500");

    // Además, un aumento general del 10 %.
    await h.page.fill("#ajuste-pct", "10");
    assert.match(await h.page.innerText("#ajuste-preview"), /un aumento del \+10% a todos los precios/);

    const pdf = await generarPdf(h);
    assert.equal(filaPdf(pdf, "JAMÓN COCIDO DE PATA").precio, "Consultar");
    assert.deepEqual(filaPdf(pdf, "JAMÓN COCIDO ESPECIAL BAJO SODIO"), { datos: ["Art. 303", "6 KG"], precio: "$8.250" });
    assert.equal(filaPdf(pdf, 'JAMÓN COCIDO NATURAL "SUBLIME"').precio, "$12.749");
    assert.equal(filaPdf(pdf, "PERNIL FRESCO").precio, "Consultar"); // nunca tuvo precio de lista
    // El catálogo completo trae todos los productos, con el nombre entero.
    const nombres = await h.page.evaluate(() => CATS.flatMap((c) => c.prods.map((p) => p.n)));
    assert.equal(nombres.length, 45);
    for (const n of nombres) assert.ok(estaEnPdf(pdf, n), "falta en el PDF: " + n);

    const csv = await exportarCsv(h);
    assert.equal(csv.fila("JAMÓN COCIDO DE PATA")[3], "Consultar");
    assert.equal(csv.fila("JAMÓN COCIDO ESPECIAL BAJO SODIO")[3], "8250");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("los ajustes por categoría y por producto no se cuelan en el catálogo completo del cliente siguiente", async () => {
  const h = await abrir();
  try {
    const sublime = await uidDe(h, 'JAMÓN COCIDO NATURAL "SUBLIME"');
    const paleta = await uidDe(h, "FIAMBRE COCIDO DE PALETA DE CERDO");
    const emparedados = await uidDe(h, "FIAMBRE DE CERDO P/EMPAREDADOS");

    // Cliente A: presupuesto por selección con 10 % de bonificación en Paletas y +20 % en el Sublime.
    await cliente(h, "Cliente A");
    await h.page.tap("#b-sel");
    await abrirCategoria(h, "PALETAS COCIDAS");
    await h.page.check(`#cb-${sublime}`);
    await h.page.check(`#cb-${paleta}`);
    await h.page.check(`#cb-${emparedados}`);
    await h.page.selectOption("#cat-tipo-1", "bonif");
    await h.page.fill("#cat-pct-1", "10");
    await h.page.fill(`#prod-pct-${sublime}`, "20");
    assert.match(await h.page.innerText("#ajuste-preview"), /Ajuste propio en 1 categoría y 1 producto/);

    const pdfA = await generarPdf(h);
    assert.equal(filaPdf(pdfA, "FIAMBRE COCIDO DE PALETA DE CERDO").precio, "$5.391");
    assert.equal(filaPdf(pdfA, "FIAMBRE DE CERDO P/EMPAREDADOS").precio, "$4.491");
    assert.equal(filaPdf(pdfA, 'JAMÓN COCIDO NATURAL "SUBLIME"').precio, "$13.908");
    // Portada y páginas de productos llevan el mismo título.
    assert.equal(pdfA.textos.filter((t) => t === "PRESUPUESTO").length, 2);
    assert.ok(!estaEnPdf(pdfA, "LISTA DE PRECIOS"));

    // Cliente B: lista de precios completa. Los campos de ajuste quedan ocultos y no tienen que aplicarse.
    await h.page.tap("#b-comp");
    await cliente(h, "Cliente B");
    assert.equal(await h.page.isVisible("#cat-pct-1"), false);
    assert.equal(await h.page.isVisible("#ajuste-preview"), false, "en catálogo completo no hay ajustes activos");

    const pdfB = await generarPdf(h);
    assert.ok(estaEnPdf(pdfB, "Cliente B"));
    assert.equal(filaPdf(pdfB, "FIAMBRE COCIDO DE PALETA DE CERDO").precio, "$5.990");
    assert.equal(filaPdf(pdfB, "FIAMBRE DE CERDO P/EMPAREDADOS").precio, "$4.990");
    assert.equal(filaPdf(pdfB, 'JAMÓN COCIDO NATURAL "SUBLIME"').precio, "$11.590");
    assert.equal(pdfB.textos.filter((t) => t === "LISTA DE PRECIOS").length >= 2, true);
    const csvB = await exportarCsv(h);
    assert.equal(csvB.fila("FIAMBRE COCIDO DE PALETA DE CERDO")[3], "5990");

    // Al volver a selección los ajustes siguen cargados, y se avisa.
    await h.page.tap("#b-sel");
    assert.match(await h.page.innerText("#ajuste-preview"), /Ajuste propio en 1 categoría y 1 producto/);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test('artículo vario sin precio sale "Consultar" (no $0)', async () => {
  const h = await abrir();
  try {
    await cliente(h, "Fiambrería Nueva");
    await agregarVario(h, { desc: "Pechito ahumado", peso: "2 KG" });
    await agregarVario(h, { desc: "Queso Cremoso", peso: "4 KG", precio: "0" });
    const pdf = await generarPdf(h);
    assert.equal(filaPdf(pdf, "Pechito ahumado").precio, "Consultar");
    assert.equal(filaPdf(pdf, "Queso Cremoso").precio, "Consultar");
    assert.ok(!estaEnPdf(pdf, "$0"), "ningún producto se ofrece a $0");
    const csv = await exportarCsv(h);
    assert.equal(csv.fila("Pechito ahumado")[3], "Consultar");
  } finally {
    await h.close();
  }
});

test("lo último que se escribió entra al PDF aunque no se haya salido del campo", async () => {
  const h = await abrir();
  try {
    await cliente(h, "Almacén Don Pepe");
    await h.page.tap(".btn-add-custom");
    await h.page.keyboard.type("Queso Tybo"); // el cursor ya está en la descripción del artículo nuevo
    await escribir(h, "#custom-list .custom-row:nth-child(1) .ci-precio", "8990");
    // Sin salir del precio toca "+ Agregar artículo": lo escrito no se borra.
    await tocarSinSacarElCursor(h, ".btn-add-custom");
    await h.page.waitForSelector("#custom-list .custom-row:nth-child(2)");
    assert.equal(await h.page.inputValue("#custom-list .custom-row:nth-child(1) .ci-desc"), "Queso Tybo");
    assert.equal(await h.page.inputValue("#custom-list .custom-row:nth-child(1) .ci-precio"), "8.990");
    await escribir(h, "#custom-list .custom-row:nth-child(2) .ci-desc", "Queso Sardo");
    await escribir(h, "#custom-list .custom-row:nth-child(2) .ci-precio", "12500");
    assert.equal((await h.page.textContent("#custom-count")).trim(), "2 agregados");

    // Con el teclado todavía abierto en el precio, toca "Generar".
    const pdf = await generarPdf(h, () => tocarSinSacarElCursor(h, "#btnGen"));
    assert.equal(filaPdf(pdf, "Queso Tybo").precio, "$8.990");
    assert.equal(filaPdf(pdf, "Queso Sardo").precio, "$12.500");

    // Lo mismo con un precio del catálogo recién cambiado.
    const sodio = await uidDe(h, "JAMÓN COCIDO ESPECIAL BAJO SODIO");
    await h.page.tap(`#p-${sodio}`);
    await h.page.locator(`#p-${sodio}`).selectText();
    await h.page.keyboard.type("9500");
    const pdf2 = await generarPdf(h, () => tocarSinSacarElCursor(h, "#btnGen"));
    assert.equal(filaPdf(pdf2, "JAMÓN COCIDO ESPECIAL BAJO SODIO").precio, "$9.500");
  } finally {
    await h.close();
  }
});

test("un porcentaje imposible (bonificación de 150 %) no genera precios negativos: avisa y no descarga", async () => {
  const h = await abrir();
  try {
    await cliente(h, "Carnicería El Toro");
    await h.page.tap("#b-bonif");
    await h.page.fill("#ajuste-pct", "150");
    assert.match(await h.page.innerText("#ajuste-preview"), /Revisá los porcentajes/);
    await h.page.tap("#btnGen");
    await h.page.waitForSelector('.ss-toast-error:has-text("Revisá los porcentajes")');
    await h.page.waitForFunction(() => !document.getElementById("btnGen").disabled);
    await h.page.tap('.hdr button:has-text("Exportar CSV")');
    await h.page.waitForFunction(() => document.querySelectorAll(".ss-toast-error").length >= 1);
    assert.equal(h.llamadas.descargas.length, 0, "no se descargó nada");

    // Corregido a 10 %: sale la bonificación bien calculada.
    await h.page.fill("#ajuste-pct", "10");
    assert.match(await h.page.innerText("#ajuste-preview"), /una bonificación del -10%/);
    const pdf = await generarPdf(h);
    assert.equal(filaPdf(pdf, "JAMÓN COCIDO ESPECIAL BAJO SODIO").precio, "$8.091");
    assert.ok(!pdf.textos.some((t) => /^\$-/.test(t)), "no hay precios negativos");

    // En modo selección también se controla el porcentaje propio de un producto marcado.
    await h.page.fill("#ajuste-pct", "0");
    await h.page.tap("#b-sel");
    const sodio = await uidDe(h, "JAMÓN COCIDO ESPECIAL BAJO SODIO");
    await h.page.check(`#cb-${sodio}`);
    await h.page.selectOption(`#prod-tipo-${sodio}`, "bonif");
    await h.page.fill(`#prod-pct-${sodio}`, "200");
    assert.match(await h.page.innerText("#ajuste-preview"), /Revisá los porcentajes/);
    await h.page.tap("#btnGen");
    await h.page.waitForFunction(() => !document.getElementById("btnGen").disabled);
    await h.page.fill(`#prod-pct-${sodio}`, "20");
    const pdfSel = await generarPdf(h);
    assert.equal(filaPdf(pdfSel, "JAMÓN COCIDO ESPECIAL BAJO SODIO").precio, "$7.192");
    assert.equal(h.llamadas.descargas.length, 2, "solo se descargaron los dos PDF válidos");
  } finally {
    await h.close();
  }
});

// ── Fechas, portada y uso en el teléfono ────────────────────────────────────

test("a las 22:30 el PDF y el CSV llevan la fecha de hoy en Buenos Aires, no la de mañana", async () => {
  const h = await abrir({ now: NOCHE });
  try {
    await cliente(h, "Almacén Don Pepe");
    const csv = await exportarCsv(h);
    assert.equal(csv.nombre, "Presupuesto_Almacen_Don_Pepe_2026-11-10.csv"); // sin acentos: hay navegadores que si no bajan el archivo sin nombre
    assert.match(csv.texto, /^Generado: 10\/11\/2026$/m);
    await h.page.waitForSelector('.ss-toast:has-text("CSV exportado")');
    const pdf = await generarPdf(h);
    assert.equal(pdf.nombre, "Presupuesto_Sersale_Almacen_Don_Pepe_10-11-2026.pdf");
    assert.ok(estaEnPdf(pdf, "10 de noviembre de 2026"), pdf.textos.slice(0, 6).join(" | "));
  } finally {
    await h.close();
  }
});

test("un nombre de cliente largo entra en la portada del PDF", async () => {
  const h = await abrir();
  try {
    const nombre = "DISTRIBUIDORA LA NUEVA ESPERANZA SRL";
    await cliente(h, nombre);
    const pdf = await generarPdf(h);
    const tam = tamanioEnPdf(pdf, nombre);
    const ancho = await h.page.evaluate(
      ({ nombre, tam }) => new window.jspdf.jsPDF({ unit: "pt", format: "a4" }).setFont("helvetica", "bold").setFontSize(tam).getTextWidth(nombre),
      { nombre, tam }
    );
    assert.ok(ancho <= 515, `el nombre mide ${Math.round(ancho)} pt y la hoja tiene 515 pt útiles (letra ${tam})`);

    // Un nombre más largo todavía va en más de un renglón, entero.
    const largo = "DISTRIBUIDORA DE FIAMBRES Y QUESOS LA NUEVA ESPERANZA DEL SUR SOCIEDAD ANONIMA";
    await cliente(h, largo);
    const pdf2 = await generarPdf(h);
    assert.ok(!estaEnPdf(pdf2, largo), "no va en un solo renglón");
    const i = pdf2.textos.findIndex((t) => t.startsWith("DISTRIBUIDORA DE FIAMBRES"));
    assert.equal(pdf2.textos.slice(i, i + 2).join(" "), largo);
    assert.equal(pdf2.nombre, "Presupuesto_Sersale_" + largo.replace(/ /g, "_") + "_10-11-2026.pdf");
  } finally {
    await h.close();
  }
});

test("sin nombre de cliente pregunta antes de generar, y la página no escribe nada en la base", async () => {
  const h = await abrir();
  try {
    const antes = await h.dump();
    await h.page.tap("#btnGen");
    await h.page.waitForSelector('.ss-hoja:has-text("Falta el nombre del cliente")');
    await h.page.tap('.ss-hoja .ss-btn:has-text("Volver")');
    await h.page.waitForSelector(".ss-hoja", { state: "detached" });
    await h.page.waitForFunction(() => !document.getElementById("btnGen").disabled);
    assert.equal(h.llamadas.descargas.length, 0);

    const pdf = await generarPdf(h, async () => {
      await h.page.tap("#btnGen");
      await h.page.waitForSelector(".ss-hoja");
      await h.page.tap('.ss-hoja .ss-btn:has-text("Generar igual")');
    });
    assert.ok(estaEnPdf(pdf, "Cliente"));
    assert.equal(h.llamadas.dialogos.length, 0, "no se usan los diálogos del navegador");
    assert.deepEqual(await h.dump(), antes, "presupuestos no guarda nada en la base");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("en el iPhone: modo selección legible, la flecha abre la categoría y tocar el nombre marca el producto", async () => {
  const h = await abrir();
  try {
    const ancho = () => h.page.evaluate(() => document.documentElement.scrollWidth);
    await h.page.tap("#b-sel");
    const sublime = await uidDe(h, 'JAMÓN COCIDO NATURAL "SUBLIME"');
    const nombre = await h.page.locator(`.prod-row:has(#cb-${sublime}) .prod-n`).boundingBox();
    assert.ok(nombre.width >= 200, `el nombre del producto tiene ${Math.round(nombre.width)} px de ancho`);
    assert.ok(nombre.height <= 40, `el nombre ocupa ${Math.round(nombre.height)} px de alto (no una palabra por renglón)`);
    assert.ok((await ancho()) <= 390, "la página no se ensancha");

    // Tocar el nombre marca el producto.
    await h.page.tap(`.prod-row:has(#cb-${sublime}) .prod-n`);
    assert.equal(await h.page.isChecked(`#cb-${sublime}`), true);
    assert.match(await h.page.innerText("#inf-txt"), /1 categoría · 1 producto/);

    // La flecha de la categoría abre y cierra.
    assert.equal(await h.page.isVisible("#sec-1"), false);
    await h.page.tap("#arr-1");
    assert.equal(await h.page.isVisible("#sec-1"), true);
    // Tocar el campo de % de la categoría no la cierra.
    await h.page.tap("#cat-pct-1");
    assert.equal(await h.page.isVisible("#sec-1"), true);

    // La fila de artículos varios entra en la tarjeta.
    await h.page.tap(".btn-add-custom");
    const tarjeta = await h.page.locator(".custom-items").boundingBox();
    const quitar = await h.page.locator("#custom-list .ci-del").boundingBox();
    assert.ok(quitar.x + quitar.width <= tarjeta.x + tarjeta.width, "el botón × queda dentro de la tarjeta");
    assert.ok(quitar.height >= 44 && quitar.width >= 44);
    assert.ok((await ancho()) <= 390);
  } finally {
    await h.close();
  }
});

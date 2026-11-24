// Muestras: certificado de entrega (alta, número correlativo, firma, PDF con
// original y duplicado), seguimiento de cada muestra por cliente y hoja en el backup.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const XLSX = createRequire(import.meta.url)("xlsx");
const HOY = "2026-11-10";
const boton = (h, t) => h.page.getByRole("button", { name: t, exact: true });
const toast = (h, t) => h.page.locator(".ss-toast", { hasText: t });
const muestrasDe = (db) => Object.entries(db.muestras || {}).map(([id, m]) => ({ id, ...m })).sort((a, b) => a.nro - b.nro);
const CLIENTE = Object.values(buildSeed().clientes)[0].nombre;

function muestra(extra) {
  const en = "2026-11-05T12:00:00.000Z";
  return {
    nro: 1, fecha: "2026-11-05", cliente: "Cliente", contacto: "", entrega: "Nacho", obs: "", firma: "", aclaracion: "", creadoEn: en, creadoPor: "nacho",
    items: [{ id: "a1", producto: "Jamón Cocido Natural Sublime", cantidad: 0.5, unidad: "kg", nota: "", estado: "entregada", estadoEn: en, historial: [{ estado: "entregada", en, nota: "", por: "nacho" }] }],
    ...extra,
  };
}

async function abrir(muestras = {}, opts = {}) {
  const seed = buildSeed();
  seed.muestras = muestras;
  const h = await launch({ rol: "director", etiqueta: "mue", seed, ...opts });
  h.seed = seed;
  await h.ir("pedidos.html");
  await h.page.getByText("Certificado de entrega y seguimiento por cliente").first().click();
  await h.page.getByRole("button", { name: "+ Nueva", exact: true }).waitFor();
  return h;
}
async function esperar(h, cond, ms = 15000) {
  const fin = Date.now() + ms;
  let db;
  for (;;) {
    db = await h.dump();
    if (cond(muestrasDe(db), db)) return db;
    if (Date.now() > fin) throw new Error("no se cumplió a tiempo: " + JSON.stringify(muestrasDe(db)));
    await new Promise((r) => setTimeout(r, 120));
  }
}
async function elegirCliente(h, nombre, libre) {
  const p = h.page;
  await p.getByRole("button", { name: /Elegí el cliente|▼/ }).first().click();
  await p.getByPlaceholder("Buscar cliente...").fill(libre != null ? libre : nombre);
  if (libre != null) await p.getByRole("button", { name: "➕ Otro (cliente nuevo)" }).click();
  else await p.getByRole("button", { name: nombre, exact: true }).click();
}
async function fila(h, n, { producto, buscar, otro, cantidad, unidad, nota }) {
  const p = h.page;
  // El producto se elige con el buscador: `buscar` es lo que se escribe (por defecto, el nombre entero).
  if (producto != null) {
    await p.getByRole("button", { name: "Producto de la muestra " + n, exact: true }).click();
    const campo = p.getByLabel("Buscar producto de la muestra " + n);
    if (producto === "__otro__") {
      if (otro != null) await campo.fill(otro);
      await p.getByRole("button", { name: /^➕ Otro/ }).click();
      otro = null; // ya quedó cargado con lo que se buscó
    } else {
      await campo.fill(buscar != null ? buscar : producto);
      await p.getByRole("button", { name: producto, exact: true }).click();
    }
  }
  if (otro != null) await p.getByLabel("Nombre de la muestra " + n).fill(otro);
  if (cantidad != null) { await p.getByLabel("Cantidad de la muestra " + n).fill(""); await p.getByLabel("Cantidad de la muestra " + n).pressSequentially(cantidad); }
  if (unidad != null) await p.getByLabel("Unidad de la muestra " + n).selectOption(unidad);
  if (nota != null) await p.getByLabel("Nota de la muestra " + n).fill(nota);
}
/** Texto que quedó escrito en un PDF hecho con jsPDF (sin comprimir). */
async function textoDelPdf(descarga) {
  const ruta = await descarga.path();
  return fs.readFileSync(ruta).toString("latin1");
}

test("alta: certificado con número correlativo, cliente de la lista, varias muestras y validaciones", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    await p.getByText("Todavía no hay muestras entregadas").waitFor();
    await boton(h, "+ Nueva").click();
    assert.equal(await p.locator("#mue-fecha").inputValue(), HOY, "propone la fecha de hoy");
    assert.equal(await p.locator("#mue-entrega").inputValue(), "Nacho", "propone como quien entrega al usuario que ingresó");

    // Sin cliente y sin muestras no guarda, y dice qué falta.
    await boton(h, "✓ Guardar certificado").click();
    await toast(h, "Elegí a qué cliente va dirigida").waitFor();
    await elegirCliente(h, CLIENTE);
    await boton(h, "✓ Guardar certificado").click();
    await toast(h, "Cargá al menos una muestra").waitFor();
    // El producto se busca por nombre, sin acentos ni mayúsculas: quedan solo los que coinciden.
    await p.getByRole("button", { name: "Producto de la muestra 1", exact: true }).click();
    await p.getByRole("button", { name: "Queso Mozzarella", exact: true }).waitFor();
    await p.getByLabel("Buscar producto de la muestra 1").fill("jamon cocido nat");
    await p.getByRole("button", { name: "Jamón Cocido Natural Sublime", exact: true }).waitFor();
    assert.equal(await p.getByRole("button", { name: "Queso Mozzarella", exact: true }).count(), 0);
    await p.getByRole("button", { name: "Jamón Cocido Natural Sublime", exact: true }).click();
    assert.equal(await p.getByLabel("Buscar producto de la muestra 1").count(), 0, "al elegir se cierra el buscador");
    await boton(h, "✓ Guardar certificado").click();
    await toast(h, "Poné la cantidad de Jamón Cocido Natural Sublime").waitFor();
    assert.deepEqual(muestrasDe(await h.dump()), [], "todavía no se guardó nada");

    await fila(h, 1, { cantidad: "0,5", nota: "Feteado" });
    await boton(h, "+ Agregar otra muestra").click();
    await fila(h, 2, { producto: "__otro__", otro: "Bondiola curada  nueva", cantidad: "2", unidad: "piezas" });
    await p.locator("#mue-obs").fill("Para la carta de verano");
    await boton(h, "✓ Guardar certificado").click();
    await toast(h, "Certificado M-0001 guardado: " + CLIENTE).waitFor();

    const db = await esperar(h, (ms) => ms.length === 1);
    const m = muestrasDe(db)[0];
    assert.equal(m.nro, 1);
    assert.equal(db.config.contador_muestras.ultimo, 1);
    assert.deepEqual(
      { fecha: m.fecha, cliente: m.cliente, entrega: m.entrega, obs: m.obs, firma: m.firma, creadoPor: m.creadoPor },
      { fecha: HOY, cliente: CLIENTE, entrega: "Nacho", obs: "Para la carta de verano", firma: "", creadoPor: "nacho" }
    );
    assert.deepEqual(m.items.map((it) => [it.producto, it.cantidad, it.unidad, it.nota, it.estado, it.historial.length]), [
      ["Jamón Cocido Natural Sublime", 0.5, "kg", "Feteado", "entregada", 1],
      ["Bondiola curada nueva", 2, "piezas", "", "entregada", 1],
    ]);
    assert.notEqual(m.items[0].id, m.items[1].id);

    // Queda abierto el certificado recién guardado.
    await p.getByText("Certificado M-0001", { exact: true }).waitFor();
    await p.getByText("Sin firma en el teléfono").waitFor();
    // El gesto «atrás» del teléfono vuelve a la lista (no sale de Muestras).
    await p.goBack();
    await p.getByRole("button", { name: "Abrir el certificado M-0001" }).waitFor();
    await p.getByRole("button", { name: "Abrir el certificado M-0001" }).click();
    await p.getByText("Certificado M-0001", { exact: true }).waitFor();

    // El siguiente toma el número que sigue, con un cliente que todavía no está en el CRM.
    await p.getByRole("button", { name: "Volver" }).click();
    await boton(h, "+ Nueva").click();
    await elegirCliente(h, null, "Parrilla Don Tito");
    assert.equal(await p.getByLabel("Nombre del cliente").inputValue(), "Parrilla Don Tito");
    await fila(h, 1, { producto: "Queso Mozzarella", cantidad: "1" });
    await boton(h, "✓ Guardar certificado").click();
    await toast(h, "Certificado M-0002 guardado: Parrilla Don Tito").waitFor();
    const db2 = await esperar(h, (ms) => ms.length === 2);
    assert.deepEqual(muestrasDe(db2).map((x) => [x.nro, x.cliente]), [[1, CLIENTE], [2, "Parrilla Don Tito"]]);
    assert.equal(db2.config.contador_muestras.ultimo, 2);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("firma en el teléfono con aclaración, y PDF con original y duplicado, logo y datos del frigorífico", async () => {
  const h = await abrir({ m1: muestra({ nro: 7, cliente: "Almacén Doña Rosa", contacto: "11 5555-0000", obs: "Probar en fiambrera", items: [
    { id: "a1", producto: "Jamón Cocido Natural Sublime", cantidad: 0.5, unidad: "kg", nota: "Feteado", estado: "entregada", estadoEn: "2026-11-05T12:00:00.000Z", historial: [] },
    { id: "a2", producto: "Salamín Picado Fino", cantidad: 1, unidad: "piezas", nota: "", estado: "entregada", estadoEn: "2026-11-05T12:00:00.000Z", historial: [] },
  ] }) });
  const p = h.page;
  try {
    await p.getByRole("button", { name: "Abrir el certificado M-0007" }).click();
    await p.getByText("Sin firma en el teléfono").waitFor();

    // Sin firma: el PDF sale igual, con las líneas para firmar a mano.
    let [descarga] = await Promise.all([p.waitForEvent("download"), boton(h, "🖨️ PDF para imprimir").click()]);
    assert.equal(descarga.suggestedFilename(), "Certificado de muestras M-0007 - Almacén Doña Rosa.pdf");
    let pdf = await textoDelPdf(descarga);
    for (const esperado of ["ORIGINAL", "DUPLICADO", "CERTIFICADO DE ENTREGA DE MUESTRAS", "M-0007", "CUIT 30-70227633-7", "SENASA Est. 3839", "24 de Noviembre 1926, Parque Patricios, CABA", "6763-7860", "@sersalefrigorifico", "Jamón Cocido Natural Sublime", "0,5 kg", "1 pieza", "Feteado", "05/11/2026", "Aclaración"]) {
      assert.ok(pdf.includes(esperado), "el PDF dice «" + esperado + "»");
    }
    assert.equal(pdf.split("Almacén Doña Rosa").length - 1, 2, "el cliente figura una vez en cada copia");
    assert.equal((pdf.match(/\/Type\s*\/Page\b/g) || []).length, 1, "las dos copias entran en una hoja");
    assert.equal((pdf.match(/\/Subtype\s*\/Image/g) || []).length, 1, "lleva el logo (una sola imagen, usada en las dos copias)");

    // Firmar: sin trazo o sin aclaración no guarda.
    await boton(h, "✍️ Firmar en el teléfono").click();
    await boton(h, "✓ Guardar firma").click();
    await toast(h, "Falta la firma").waitFor();
    const caja = await p.locator("#mue-firma").boundingBox();
    await p.mouse.move(caja.x + 40, caja.y + 90);
    await p.mouse.down();
    await p.mouse.move(caja.x + 120, caja.y + 50, { steps: 6 });
    await p.mouse.move(caja.x + 200, caja.y + 120, { steps: 6 });
    await p.mouse.up();
    await boton(h, "✓ Guardar firma").click();
    await toast(h, "Escribí la aclaración").waitFor();
    await p.locator("#mue-aclaracion").fill("  Rosa   Giménez ");
    await boton(h, "✓ Guardar firma").click();
    await toast(h, "Firma guardada").waitFor();
    const db = await esperar(h, (ms) => !!ms[0].firma);
    const m = muestrasDe(db)[0];
    assert.match(m.firma, /^data:image\/png;base64,/);
    assert.ok(m.firma.length > 500 && m.firma.length < 200000, "la firma pesa poco: " + m.firma.length);
    assert.equal(m.aclaracion, "Rosa Giménez");
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(m.firmadoEn));
    assert.equal(m.items.length, 2, "firmar no toca las muestras");

    // Vuelve al certificado, ya firmado, y el PDF lleva la firma y la aclaración.
    await p.getByText("✓ Firmado por Rosa Giménez").waitFor();
    [descarga] = await Promise.all([p.waitForEvent("download"), boton(h, "🖨️ PDF para imprimir").click()]);
    pdf = await textoDelPdf(descarga);
    assert.equal(pdf.split("Rosa Giménez").length - 1, 2, "la aclaración va en las dos copias");
    assert.ok((pdf.match(/\/Subtype\s*\/Image/g) || []).length >= 2, "lleva la imagen de la firma además del logo");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("un certificado con muchas muestras pone el original y el duplicado en hojas separadas", async () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: "x" + i, producto: "Producto de prueba " + (i + 1), cantidad: i + 1, unidad: "unidades", nota: "", estado: "entregada", estadoEn: "2026-11-05T12:00:00.000Z", historial: [] }));
  const h = await abrir({ m1: muestra({ nro: 3, items }), m2: muestra({ nro: 2, items: items.slice(0, 6) }), m3: muestra({ nro: 1, items: items.slice(0, 7) }) });
  const p = h.page;
  const hojas = async (nro) => {
    await p.getByRole("button", { name: "Abrir el certificado " + nro }).click();
    const [d] = await Promise.all([p.waitForEvent("download"), boton(h, "🖨️ PDF para imprimir").click()]);
    const texto = await textoDelPdf(d);
    await p.getByRole("button", { name: "Volver" }).click();
    return (texto.match(/\/Type\s*\/Page\b/g) || []).length;
  };
  try {
    // Hasta 6 muestras entran las dos copias en una hoja; con 7 ya no queda lugar para las firmas.
    assert.equal(await hojas("M-0002"), 1);
    assert.equal(await hojas("M-0001"), 2);
    await p.getByRole("button", { name: "Abrir el certificado M-0003" }).click();
    const [descarga] = await Promise.all([p.waitForEvent("download"), boton(h, "🖨️ PDF para imprimir").click()]);
    const pdf = await textoDelPdf(descarga);
    assert.equal((pdf.match(/\/Type\s*\/Page\b/g) || []).length, 2);
    assert.equal(pdf.split("Producto de prueba 12").length - 1, 2, "ninguna muestra queda afuera, en ninguna de las dos copias");
    assert.ok(pdf.includes("ORIGINAL") && pdf.includes("DUPLICADO"));
  } finally {
    await h.close();
  }
});

test("seguimiento: cada muestra evoluciona por separado, queda el historial, se agrupa por cliente y avisa las que hay que recontactar", async () => {
  const viejo = "2026-10-28T12:00:00.000Z"; // 13 días antes de "hoy"
  const h = await abrir({
    m1: muestra({ nro: 1, fecha: "2026-10-28", cliente: "Almacén Doña Rosa", items: [
      { id: "a1", producto: "Jamón Cocido Natural Sublime", cantidad: 0.5, unidad: "kg", nota: "", estado: "entregada", estadoEn: viejo, historial: [{ estado: "entregada", en: viejo, nota: "", por: "nacho" }] },
      { id: "a2", producto: "Queso Tybo", cantidad: 1, unidad: "kg", nota: "", estado: "no_interesa", estadoEn: viejo, historial: [{ estado: "no_interesa", en: viejo, nota: "Ya tiene proveedor", por: "nacho" }] },
    ] }),
    m2: muestra({ nro: 2, fecha: "2026-11-09", cliente: "Parrilla Don Tito", items: [
      { id: "b1", producto: "Chorizo Puro Cerdo", cantidad: 2, unidad: "kg", nota: "", estado: "probada", estadoEn: "2026-11-09T15:00:00.000Z", historial: [] },
    ] }),
  });
  const p = h.page;
  try {
    // Aviso de la que lleva más de 7 días sin novedad (la cerrada no cuenta; la de ayer tampoco).
    await p.getByText("1 muestra lleva 7 días o más sin novedad").click();
    const grupo = (c) => p.locator('[data-mue-cliente="' + c + '"]');
    await grupo("Almacén Doña Rosa").getByText("13 días sin novedad").waitFor();
    assert.equal(await grupo("Parrilla Don Tito").count(), 0);
    assert.equal(await grupo("Almacén Doña Rosa").getByText("Queso Tybo").count(), 0, "la que no le interesó no se recontacta");

    // «En curso»: las dos abiertas, cada una con su cliente.
    await p.getByRole("button", { name: "En curso (2)" }).click();
    await grupo("Parrilla Don Tito").getByText("Chorizo Puro Cerdo").waitFor();
    await grupo("Almacén Doña Rosa").getByText("Jamón Cocido Natural Sublime").waitFor();
    assert.equal(await p.getByRole("button", { name: "No le interesó (1)" }).count(), 1);

    // Anotar una novedad del jamón: no cambia el queso.
    await p.getByRole("button", { name: "Ver Jamón Cocido Natural Sublime de Almacén Doña Rosa" }).click();
    await p.getByText("Hace 13 días que no hay novedad").waitFor();
    await p.getByRole("button", { name: "Anotar novedad de Jamón Cocido Natural Sublime" }).click();
    await boton(h, "Guardar novedad").click();
    await toast(h, "Elegí otro estado o escribí una nota").waitFor();
    await boton(h, "Pidió precio").click();
    await p.getByLabel("Nota de la novedad de Jamón Cocido Natural Sublime").fill("Quiere precio por 20 kg semanales");
    await boton(h, "Guardar novedad").click();
    await toast(h, "Jamón Cocido Natural Sublime: Pidió precio").waitFor();
    let db = await esperar(h, (ms) => ms[0].items[0].estado === "pidio_precio");
    let [jamon, queso] = muestrasDe(db)[0].items;
    assert.deepEqual(jamon.historial.map((x) => [x.estado, x.nota]), [["entregada", ""], ["pidio_precio", "Quiere precio por 20 kg semanales"]]);
    assert.equal(jamon.historial[1].por, "nacho");
    assert.equal(jamon.estadoEn, jamon.historial[1].en);
    assert.deepEqual([queso.estado, queso.historial.length], ["no_interesa", 1], "la otra muestra queda como estaba");
    await p.getByText("Quiere precio por 20 kg semanales").waitFor();
    assert.equal(await p.getByText("Hace 13 días que no hay novedad").count(), 0, "con la novedad de hoy ya no pide recontacto");

    // Después compra: queda cerrada y sale de «En curso».
    await p.getByRole("button", { name: "Anotar novedad de Jamón Cocido Natural Sublime" }).click();
    await boton(h, "Compró").click();
    await boton(h, "Guardar novedad").click();
    db = await esperar(h, (ms) => ms[0].items[0].estado === "compro");
    assert.equal(muestrasDe(db)[0].items[0].historial.length, 3);
    await p.getByRole("button", { name: "Volver" }).click();
    await p.getByRole("tab", { name: "Seguimiento (1)" }).waitFor();
    await p.getByRole("button", { name: "Compró (1)" }).waitFor();
    assert.equal(await p.getByText("sin novedad. Tocá para verlas").count(), 0);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("editar un certificado no pisa el seguimiento, y eliminar pide confirmación", async () => {
  const en = "2026-11-06T12:00:00.000Z";
  const h = await abrir({ m1: muestra({ nro: 4, cliente: "Parrilla Don Tito", items: [
    { id: "a1", producto: "Queso Mozzarella", cantidad: 1, unidad: "kg", nota: "", estado: "interesa", estadoEn: en, historial: [{ estado: "entregada", en: "2026-11-05T12:00:00.000Z", nota: "", por: "nacho" }, { estado: "interesa", en, nota: "Le gustó", por: "nacho" }] },
  ] }) });
  const p = h.page;
  try {
    await p.getByRole("button", { name: "Abrir el certificado M-0004" }).click();
    await boton(h, "Editar").click();
    assert.equal(await p.getByLabel("Nombre del cliente").inputValue(), "Parrilla Don Tito", "un cliente que no está en el CRM vuelve como texto");
    assert.equal(await p.getByLabel("Cantidad de la muestra 1").inputValue(), "1");
    await fila(h, 1, { cantidad: "1,5", nota: "En horma" });
    await boton(h, "+ Agregar otra muestra").click();
    await fila(h, 2, { producto: "Queso Tybo", cantidad: "1" });
    await boton(h, "✓ Guardar cambios").click();
    await toast(h, "Certificado actualizado").waitFor();
    const db = await esperar(h, (ms) => ms[0].items.length === 2);
    const m = muestrasDe(db)[0];
    assert.equal(m.nro, 4, "el número no cambia");
    assert.deepEqual([m.items[0].id, m.items[0].cantidad, m.items[0].nota, m.items[0].estado, m.items[0].historial.length], ["a1", 1.5, "En horma", "interesa", 2]);
    assert.deepEqual([m.items[1].producto, m.items[1].estado, m.items[1].historial.length], ["Queso Tybo", "entregada", 1]);

    // Salir del formulario con cambios pregunta antes de perderlos.
    await boton(h, "Editar").click();
    await p.locator("#mue-obs").fill("algo a medio escribir");
    await p.getByRole("button", { name: "Volver" }).click();
    await p.getByText("¿Salir sin guardar?").waitFor();
    await p.locator(".ss-hoja .ss-btn", { hasText: "Salir" }).tap();
    await p.getByText("Certificado M-0004", { exact: true }).waitFor();
    assert.equal(muestrasDe(await h.dump())[0].obs, "");

    // Eliminar: «Cancelar» no borra; confirmar sí.
    await p.getByRole("button", { name: "Volver" }).click();
    await p.getByRole("button", { name: "Eliminar el certificado M-0004" }).click();
    await p.getByText("Se pierde también su seguimiento").waitFor();
    await p.locator(".ss-hoja .ss-btn", { hasText: "Cancelar" }).tap();
    assert.equal(muestrasDe(await h.dump()).length, 1);
    await p.getByRole("button", { name: "Eliminar el certificado M-0004" }).click();
    await p.locator(".ss-hoja .ss-btn", { hasText: "Eliminar" }).tap();
    await toast(h, "Certificado eliminado").waitFor();
    await esperar(h, (ms) => ms.length === 0);
    await p.getByText("Todavía no hay muestras entregadas").waitFor();
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("acceso rápido desde el panel y hoja «Muestras» en el backup de Excel", async () => {
  const en = "2026-11-06T12:00:00.000Z";
  const seed = buildSeed();
  seed.muestras = { m1: muestra({ nro: 5, cliente: "Almacén Doña Rosa", aclaracion: "Rosa Giménez", firma: "data:image/png;base64,AAAA", items: [
    { id: "a1", producto: "Queso Mozzarella", cantidad: 1.5, unidad: "kg", nota: "En horma", estado: "interesa", estadoEn: en, historial: [{ estado: "entregada", en: "2026-11-05T12:00:00.000Z", nota: "", por: "nacho" }, { estado: "interesa", en, nota: "Le gustó", por: "nacho" }] },
    { id: "a2", producto: "Queso Tybo", cantidad: 2, unidad: "piezas", nota: "", estado: "entregada", estadoEn: "2026-11-05T12:00:00.000Z", historial: [] },
  ] }) };
  const h = await launch({ rol: "director", etiqueta: "mue-bk", seed });
  const p = h.page;
  try {
    await h.ir("index.html");
    await p.getByText("Entrega de muestras").first().click();
    await p.waitForURL(/pedidos\.html$/);
    await p.getByRole("button", { name: "Abrir el certificado M-0005" }).waitFor();

    await h.ir("backup.html");
    const [descarga] = await Promise.all([p.waitForEvent("download"), p.locator("#btnBackup").click()]);
    const libro = XLSX.read(fs.readFileSync(await descarga.path()));
    assert.ok(libro.SheetNames.includes("Muestras"));
    const filas = XLSX.utils.sheet_to_json(libro.Sheets.Muestras, { header: 1, range: 3 });
    assert.deepEqual(filas[0], ["ID", "N°", "Fecha de entrega", "Cliente", "Contacto", "Entregó", "Muestra", "Cantidad", "Unidad", "Nota", "Estado", "Última novedad", "Historial", "Firmado por", "Observaciones"]);
    assert.deepEqual(filas.slice(1).map((f) => [f[1], f[2], f[3], f[6], f[7], f[8], f[10], f[11], f[13]]), [
      ["M-0005", "2026-11-05", "Almacén Doña Rosa", "Queso Mozzarella", 1.5, "kg", "Le interesó", "2026-11-06", "Rosa Giménez"],
      ["M-0005", "2026-11-05", "Almacén Doña Rosa", "Queso Tybo", 2, "piezas", "Entregada", "2026-11-05", "Rosa Giménez"],
    ]);
    assert.match(filas[1][12], /2026-11-05 Entregada \| 2026-11-06 Le interesó \(Le gustó\)/);
    const resumen = XLSX.utils.sheet_to_json(libro.Sheets.Resumen, { header: 1 });
    assert.ok(resumen.some((f) => f[0] === "Muestras" && f[1] === 2), "el resumen cuenta las muestras");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

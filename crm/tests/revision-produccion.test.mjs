// Revisión independiente de los arreglos de Producción (produccion.html).
// Cada prueba reproduce, con la pantalla y una red que falla a propósito, un
// defecto que quedaba después de los arreglos. Detalle en
// docs/auditoria/revision-produccion.md.
import test from "node:test";
import assert from "node:assert/strict";
import { launch } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const HOY = "2026-11-10";

// ── Ayudas ───────────────────────────────────────────────────────────────────

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
/** Espera (consultando cada tanto) a que `fn` devuelva algo verdadero. */
async function hasta(fn, que = "la condición", ms = 20000) {
  const fin = Date.now() + ms;
  let ultimo;
  for (;;) {
    try {
      ultimo = await fn();
      if (ultimo) return ultimo;
    } catch (e) {
      ultimo = e;
    }
    if (Date.now() > fin) throw new Error("No se cumplió: " + que + " (último valor: " + (ultimo instanceof Error ? ultimo.message : JSON.stringify(ultimo)) + ")");
    await pausa(80);
  }
}
/** Igual que `hasta`, pero adelantando el reloj de la página (las esperas y reintentos internos duran varios segundos). */
async function adelantandoHasta(p, fn, que, pasos = 60) {
  for (let i = 0; i < pasos; i++) {
    if (await fn()) return;
    await p.clock.runFor(1500);
    await pausa(200);
  }
  throw new Error("No se cumplió: " + que);
}
const idStock = (db, nombre) => {
  const e = Object.entries(db.stock_produccion).find(([, s]) => s.nombre === nombre);
  if (!e) throw new Error("no hay stock de " + nombre);
  return e[0];
};
const hayToast = (p, texto) => async () => (await p.locator(".ss-toast", { hasText: texto }).count()) > 0;

async function abrir({ seed, vista = "director", antes } = {}) {
  const h = await launch({ rol: "director", etiqueta: "revprod", seed });
  if (antes) await antes(h.page);
  await h.ir("produccion.html");
  if (vista === "director") {
    await h.page.getByRole("button", { name: "Vista Director" }).click();
    await h.page.getByText("Panel Director").waitFor();
  }
  return h;
}
async function irAStock(h) {
  await h.page.getByRole("button", { name: /📦 Stock/ }).first().click();
}
function itemStock(h, nombre) {
  const bloque = h.page.getByText(nombre, { exact: true }).locator("xpath=..");
  return { menos: bloque.getByRole("button", { name: "−", exact: true }), cantidad: bloque.locator("span").first() };
}
async function cargarReporte(p, { encargado, producto, cantidad }) {
  await p.getByRole("button", { name: /Secos/ }).click();
  await p.getByPlaceholder("Ej: Roberto Gómez").fill(encargado);
  await p.locator("select").nth(0).selectOption(producto);
  await p.getByPlaceholder("Cantidad").fill(String(cantidad));
  await p.locator("select").nth(1).selectOption("piezas");
}
async function cargarSalida(p, { producto, cantidad }) {
  await p.getByRole("button", { name: /Salida/ }).click();
  const modal = p.getByText("Registrar salida").locator("xpath=../..");
  await modal.getByPlaceholder(/Nombre del producto/).fill(producto);
  await modal.getByPlaceholder("Cantidad").fill(String(cantidad));
  return modal;
}

/**
 * Señal que se corta en el peor momento. Las transacciones de la página van al
 * servidor en dos pedidos: leer (batchGet) y confirmar (commit).
 *   red.perder = n      las próximas n confirmaciones LLEGAN al servidor y se guardan, pero la
 *                       respuesta no vuelve al teléfono (se cortó la señal justo después de enviar).
 *   red.luegoSinSenal   después de eso, ningún pedido de transacción llega (hasta red.caida = false).
 */
async function redQueSeCorta(p) {
  const red = { perder: 0, luegoSinSenal: false, caida: false, perdidas: 0 };
  await p.route(/documents:(commit|batchGet)/, async (route) => {
    if (red.caida) return route.abort("connectionfailed");
    if (red.perder > 0 && /documents:commit/.test(route.request().url())) {
      red.perder--;
      red.perdidas++;
      if (red.luegoSinSenal) red.caida = true;
      await route.fetch().catch(() => null);
      return route.abort("connectionreset");
    }
    return route.continue();
  });
  return red;
}
/** El canal por el que la página escucha los cambios (y hace las consultas) no conecta; los pedidos sueltos sí pasan. */
async function cortarEscucha(p) {
  const corte = { activo: true };
  await p.route(/\/Listen\/channel/, (route) => (corte.activo ? route.abort("connectionfailed") : route.continue()));
  return corte;
}

// ── 1. La respuesta del servidor se pierde: no se aplica dos veces ───────────

test("reporte: si la señal se corta justo al enviar (el servidor guardó, la respuesta no llegó), el stock suma una sola vez", async () => {
  const seed = buildSeed();
  const id = idStock(seed, "Salame Tipo Milán");
  const inicial = seed.stock_produccion[id].cantidad;
  const h = await abrir({ seed, vista: "encargado" });
  const p = h.page;
  try {
    const red = await redQueSeCorta(p);
    await cargarReporte(p, { encargado: "Revisión Corte", producto: "Salame Tipo Milán", cantidad: 7 });
    red.perder = 1;
    await p.getByRole("button", { name: /Enviar reporte/ }).click();
    await p.getByText("¡Reporte enviado!").waitFor();
    assert.equal(red.perdidas, 1, "la prueba cortó la respuesta de la primera confirmación");

    const db = await h.dump();
    const mios = Object.entries(db.reportes).filter(([, r]) => r.encargado === "Revisión Corte");
    assert.equal(mios.length, 1, "un solo reporte");
    assert.equal(db.stock_produccion[id].cantidad, inicial + 7, "7 piezas suman 7 (antes, al reintentar sola la operación, sumaban 14)");
    const movs = Object.values(db.stock_movimientos).filter((m) => m.ref === mios[0][0]);
    assert.deepEqual(movs.map((m) => m.cantidad), [7], "un solo movimiento de entrada");
  } finally {
    await h.close();
  }
});

test("reporte: dice 'No se pudo enviar' pero el servidor lo había guardado: al tocar Enviar de nuevo no se duplica", async () => {
  const seed = buildSeed();
  const id = idStock(seed, "Salame Tipo Milán");
  const inicial = seed.stock_produccion[id].cantidad;
  const h = await abrir({ seed, vista: "encargado" });
  const p = h.page;
  const mios = (db) => Object.entries(db.reportes).filter(([, r]) => r.encargado === "Revisión Reintento");
  try {
    const red = await redQueSeCorta(p);
    await cargarReporte(p, { encargado: "Revisión Reintento", producto: "Salame Tipo Milán", cantidad: 7 });
    red.perder = 1;
    red.luegoSinSenal = true; // el servidor guarda, la respuesta se pierde y después no hay señal
    await p.getByRole("button", { name: /Enviar reporte/ }).click();
    await adelantandoHasta(p, hayToast(p, "No se pudo enviar el reporte"), "el aviso de que no se pudo enviar");
    let db = await h.dump();
    assert.equal(mios(db).length, 1, "el servidor sí lo había guardado (es lo que la persona no puede saber)");
    assert.equal(db.stock_produccion[id].cantidad, inicial + 7);
    assert.equal(await p.getByPlaceholder("Cantidad").inputValue(), "7", "el formulario queda como estaba");

    // Vuelve la señal y la persona hace lo que le pide el cartel: probar de nuevo.
    red.caida = false;
    await p.getByRole("button", { name: /Enviar reporte/ }).click();
    await p.getByText("¡Reporte enviado!").waitFor();
    db = await h.dump();
    assert.equal(mios(db).length, 1, "sigue habiendo un solo reporte (antes quedaban dos)");
    assert.equal(db.stock_produccion[id].cantidad, inicial + 7, "y el stock sumó una sola vez (antes, 14)");
    assert.equal(Object.values(db.stock_movimientos).filter((m) => m.encargado === "Revisión Reintento").length, 1);

    // Una tanda nueva con lo mismo, cargada después, sí es otro reporte.
    await p.getByRole("button", { name: "+ Nueva tanda" }).click();
    await cargarReporte(p, { encargado: "Revisión Reintento", producto: "Salame Tipo Milán", cantidad: 7 });
    await p.getByRole("button", { name: /Enviar reporte/ }).click();
    await p.getByText("¡Reporte enviado!").waitFor();
    db = await h.dump();
    assert.equal(mios(db).length, 2, "la tanda siguiente no se confunde con un reintento");
    assert.equal(db.stock_produccion[id].cantidad, inicial + 14);
  } finally {
    await h.close();
  }
});

test("salida: con la señal cortada al confirmar descuenta una sola vez, también si hay que reintentar a mano", async () => {
  const seed = buildSeed();
  const idPanceta = idStock(seed, "Panceta Ahumada");
  const idJamon = idStock(seed, "Jamón Cocido Natural Sublime");
  const panceta = seed.stock_produccion[idPanceta].cantidad;
  const jamon = seed.stock_produccion[idJamon].cantidad;
  const h = await abrir({ seed });
  const p = h.page;
  const salidasDe = async (stockId) => Object.values((await h.dump()).stock_movimientos).filter((m) => m.tipo === "salida" && m.stockId === stockId && m.createdAt > "2026-11-10T13:00");
  try {
    await irAStock(h);
    await itemStock(h, "Panceta Ahumada").menos.waitFor();
    const red = await redQueSeCorta(p);

    // A. La respuesta se pierde y la operación se reintenta sola.
    let modal = await cargarSalida(p, { producto: "Panceta Ahumada", cantidad: 3 });
    red.perder = 1;
    await modal.getByRole("button", { name: "Confirmar salida" }).click();
    await p.locator(".ss-toast", { hasText: "Salida registrada" }).waitFor();
    assert.equal(red.perdidas, 1);
    assert.equal((await h.doc("stock_produccion/" + idPanceta)).cantidad, panceta - 3, "salen 3, bajan 3 (antes bajaban 6)");
    assert.deepEqual((await salidasDe(idPanceta)).map((m) => m.cantidad), [3], "un solo movimiento de salida");
    await p.getByText("Registrar salida").waitFor({ state: "detached" });

    // B. La respuesta se pierde, no hay señal para el reintento y la pantalla dice que no se guardó.
    modal = await cargarSalida(p, { producto: "Jamón Cocido Natural Sublime", cantidad: 4 });
    red.perder = 1;
    red.luegoSinSenal = true;
    await modal.getByRole("button", { name: "Confirmar salida" }).click();
    await adelantandoHasta(p, hayToast(p, "No se pudo guardar"), "el aviso de que no se pudo guardar");
    assert.equal((await h.doc("stock_produccion/" + idJamon)).cantidad, jamon - 4, "el servidor ya había descontado");
    assert.equal(await modal.getByPlaceholder("Cantidad").inputValue(), "4", "el formulario sigue abierto con lo escrito");
    red.caida = false;
    await modal.getByRole("button", { name: "Confirmar salida" }).click();
    await p.locator(".ss-toast", { hasText: "Salida registrada" }).waitFor();
    assert.equal((await h.doc("stock_produccion/" + idJamon)).cantidad, jamon - 4, "al confirmar de nuevo no descuenta otra vez (antes bajaba 8)");
    assert.deepEqual((await salidasDe(idJamon)).map((m) => m.cantidad), [4]);
  } finally {
    await h.close();
  }
});

test("stock: un toque en − descuenta 1 aunque la respuesta del servidor no llegue", async () => {
  const seed = buildSeed();
  const id = idStock(seed, "Panceta Ahumada");
  const inicial = seed.stock_produccion[id].cantidad;
  const h = await abrir({ seed });
  const p = h.page;
  try {
    await irAStock(h);
    const it = itemStock(h, "Panceta Ahumada");
    await it.menos.waitFor();
    const red = await redQueSeCorta(p);
    red.perder = 1;
    await it.menos.click();
    await hasta(async () => !(await it.cantidad.innerText()).startsWith(String(inicial)), "que cambie el número en pantalla");
    assert.equal(red.perdidas, 1);
    assert.equal((await h.doc("stock_produccion/" + id)).cantidad, inicial - 1, "un toque, una pieza menos (antes bajaban 2)");
    assert.ok((await it.cantidad.innerText()).startsWith(String(inicial - 1)), "y la pantalla muestra lo mismo que la base");

    // El toque siguiente sigue descontando de a uno.
    await it.menos.click();
    await hasta(async () => (await h.doc("stock_produccion/" + id)).cantidad === inicial - 2, "el segundo toque");
  } finally {
    await h.close();
  }
});

// ── 2. Corregir o eliminar un reporte con datos viejos del teléfono ──────────

test("reporte: no se corrige ni se elimina si no se pueden consultar sus movimientos en el servidor (antes se borraba sin descontar el stock)", async () => {
  const seed = buildSeed();
  const [idRep, rep] = Object.entries(seed.reportes).find(([, r]) => r.area === "cocidos" && r.fechaISO.startsWith(HOY));
  const ids = rep.items.map((it) => idStock(seed, it.producto)); // tres productos en piezas, los tres con stock
  const antes = ids.map((id) => seed.stock_produccion[id].cantidad);
  const h = await abrir({ seed });
  const p = h.page;
  const estado = async () => {
    const db = await h.dump();
    return { reporte: db.reportes[idRep] || null, stock: ids.map((id) => db.stock_produccion[id].cantidad), movs: Object.values(db.stock_movimientos).filter((m) => m.ref === idRep).length };
  };
  try {
    await p.getByText("Reportes (3)").waitFor();
    await p.getByRole("button", { name: /📦 Stock\s*\d+/ }).waitFor(); // el stock ya está en el teléfono
    // Señal entrecortada: el canal de escucha se cayó y no reconecta. Este teléfono nunca bajó los movimientos.
    const corte = await cortarEscucha(p);
    await p.getByText(rep.encargado, { exact: true }).click();

    // Corregir la primera línea (14 -> 4 piezas).
    await p.getByRole("button", { name: /Editar/ }).click();
    await p.getByText("Editar Reporte").waitFor();
    await p.getByPlaceholder("Cantidad").first().fill("4");
    await p.getByRole("button", { name: /Guardar cambios/ }).click();
    await adelantandoHasta(p, async () => (await hayToast(p, "No se pudo guardar")()) || !(await p.getByText("Editar Reporte").count()), "que termine de guardar o avise");
    let e = await estado();
    assert.equal(e.reporte.items[0].cantidad, rep.items[0].cantidad, "sin poder ver cuánto había sumado al stock, el reporte no se cambia (antes se cambiaba y el stock quedaba igual)");
    assert.deepEqual(e.stock, antes);
    assert.equal(await p.getByPlaceholder("Cantidad").first().inputValue(), "4", "lo escrito queda para reintentar");

    // Eliminarlo.
    await p.getByRole("button", { name: "←" }).click();
    await p.getByRole("button", { name: /Eliminar/ }).click();
    await p.locator(".ss-hoja .ss-btn", { hasText: "Eliminar" }).click();
    await adelantandoHasta(p, async () => (await hayToast(p, "No se pudo eliminar")()) || (await hayToast(p, "Reporte eliminado")()), "que termine de eliminar o avise");
    const aviso = await p.locator(".ss-toast").allInnerTexts();
    e = await estado();
    assert.ok(e.reporte, "el reporte no se elimina si no se puede descontar lo que había sumado (antes desaparecía y el stock quedaba con sus piezas)");
    assert.deepEqual(e.stock, antes, "el stock no se tocó");
    assert.equal(e.movs, 3, "y sus movimientos siguen ahí");
    assert.ok(aviso.some((t) => t.includes("No se pudo eliminar")), "se avisa: " + aviso.join(" | "));

    // Vuelve la señal: ahora sí se elimina, y descuenta las piezas de las tres líneas.
    corte.activo = false;
    for (let intento = 0; intento < 8 && (await estado()).reporte; intento++) {
      await p.clock.runFor(8000);
      await pausa(300);
      await p.getByRole("button", { name: /Eliminar/ }).click();
      await p.locator(".ss-hoja .ss-btn", { hasText: "Eliminar" }).click();
      await adelantandoHasta(p, async () => (await hayToast(p, "No se pudo eliminar")()) || !(await estado()).reporte, "el reintento");
    }
    e = await estado();
    assert.equal(e.reporte, null, "con señal, se elimina");
    assert.deepEqual(e.stock, antes.map((c, i) => c - parseFloat(rep.items[i].cantidad)), "y el stock baja lo que el reporte había sumado");
    assert.equal(e.movs, 0);
  } finally {
    await h.close();
  }
});

test("reporte: con la copia de stock del teléfono vacía no se guarda diciendo que el producto 'no figura en Stock'", async () => {
  const seed = buildSeed();
  const id = idStock(seed, "Salame Tipo Milán");
  const inicial = seed.stock_produccion[id].cantidad;
  let corte;
  // El teléfono del encargado nunca bajó el stock y el canal de escucha no conecta.
  const h = await abrir({ seed, vista: "encargado", antes: async (p) => { corte = await cortarEscucha(p); } });
  const p = h.page;
  const mios = async () => Object.values((await h.dump()).reportes).filter((r) => r.encargado === "Revisión Copia");
  try {
    await cargarReporte(p, { encargado: "Revisión Copia", producto: "Salame Tipo Milán", cantidad: 7 });
    await p.getByRole("button", { name: /Enviar reporte/ }).click();
    await adelantandoHasta(p, async () => (await hayToast(p, "No se pudo enviar el reporte")()) || (await p.getByText("¡Reporte enviado!").count()) > 0, "que termine de enviar o avise");
    const guardados = await mios();
    const stock = (await h.doc("stock_produccion/" + id)).cantidad;
    assert.ok(
      guardados.length === 0 || stock === inicial + 7,
      "Salame Tipo Milán está en Stock: o el reporte no se guarda, o suma. Antes se guardaba sin sumar, con el cartel 'no figuran en Stock de Producción'. Reportes: " + guardados.length + ", stock: " + stock
    );
    assert.equal(await p.locator(".ss-hoja", { hasText: "no figuran en Stock" }).count(), 0, "sin el cartel equivocado");

    // Vuelve la señal: se envía y suma una sola vez.
    corte.activo = false;
    for (let intento = 0; intento < 8 && !(await p.getByText("¡Reporte enviado!").count()); intento++) {
      await p.clock.runFor(8000);
      await pausa(300);
      await p.getByRole("button", { name: /Enviar reporte/ }).click();
      await adelantandoHasta(p, async () => (await hayToast(p, "No se pudo enviar el reporte")()) || (await p.getByText("¡Reporte enviado!").count()) > 0, "el reintento");
    }
    await p.getByText("¡Reporte enviado!").waitFor();
    assert.equal((await mios()).length, 1);
    assert.equal((await h.doc("stock_produccion/" + id)).cantidad, inicial + 7);
  } finally {
    await h.close();
  }
});

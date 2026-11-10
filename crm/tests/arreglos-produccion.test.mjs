// Arreglos de la auditoría de Producción (produccion.html): cada prueba usa la
// pantalla como una persona con el iPhone y después mira los documentos de
// Firestore. Detalle de cada defecto en docs/auditoria/produccion.md.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const NOCHE = "2026-11-10T22:30:00-03:00"; // en UTC ya es 11/11
const HOY = "2026-11-10";

// ── Ayudas ───────────────────────────────────────────────────────────────────

/** Espera (consultando cada tanto) a que `fn` devuelva algo verdadero. */
async function hasta(fn, que = "la condición", ms = 15000) {
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
    await new Promise((r) => setTimeout(r, 80));
  }
}
const idStock = (db, nombre) => {
  const e = Object.entries(db.stock_produccion).find(([, s]) => s.nombre === nombre);
  if (!e) throw new Error("no hay stock de " + nombre);
  return e[0];
};
const cantidadDe = async (h, id) => (await h.doc("stock_produccion/" + id)).cantidad;
const whatsapps = (h) => h.llamadas.terceros.filter((t) => t.url.includes("callmebot")).map((t) => new URL(t.url).searchParams);

async function abrir({ seed = buildSeed(), now, vista = "director" } = {}) {
  const h = await launch({ rol: "director", etiqueta: "prod", seed, ...(now ? { now } : {}) });
  await h.ir("produccion.html");
  if (vista === "director") await irADirector(h);
  return h;
}
async function irADirector(h) {
  await h.page.getByRole("button", { name: "Vista Director" }).click();
  await h.page.getByText("Panel Director").waitFor();
}
async function irATab(h, nombre) {
  await h.page.getByRole("button", { name: new RegExp(nombre) }).first().click();
}
/** Renglón de un ítem en la pestaña Stock: el bloque con el nombre, la cantidad y los botones − y +. */
function itemStock(h, nombre) {
  const bloque = h.page.getByText(nombre, { exact: true }).locator("xpath=..");
  return {
    bloque,
    menos: bloque.getByRole("button", { name: "−", exact: true }),
    mas: bloque.getByRole("button", { name: "+", exact: true }),
    cantidad: bloque.locator("span").first(),
    tarjeta: bloque.locator("xpath=.."),
  };
}
const hojaAbierta = (h) => h.page.locator(".ss-hoja");
async function tocarEnHoja(h, texto) {
  await hojaAbierta(h).locator(".ss-btn", { hasText: texto }).click();
  await hojaAbierta(h).waitFor({ state: "detached" });
}
async function sinErrores(h) {
  assert.deepEqual(erroresReales(h.errores), [], "errores en la página");
  assert.deepEqual(h.inesperados, [], "pedidos a servidores externos");
}

// ── Stock: botones + y − ─────────────────────────────────────────────────────

test("stock: tres toques seguidos en − descuentan tres, y un toque no pisa lo que cargó otro teléfono", async () => {
  const seed = buildSeed();
  const id = idStock(seed, "Panceta Ahumada");
  const inicial = seed.stock_produccion[id].cantidad;
  const h = await abrir({ seed });
  try {
    await irATab(h, "📦 Stock");
    const it = itemStock(h, "Panceta Ahumada");
    await it.menos.waitFor();
    // Tres toques antes de que termine de guardarse el primero.
    await it.menos.evaluate((b) => { b.click(); b.click(); b.click(); });
    await hasta(async () => (await cantidadDe(h, id)) === inicial - 3, "que el stock baje 3");
    await hasta(async () => (await it.cantidad.innerText()).startsWith(String(inicial - 3)), "que la pantalla muestre " + (inicial - 3));
    assert.equal(await cantidadDe(h, id), inicial - 3);

    // Otro teléfono suma producción: la pantalla de este quedó vieja. Un toque en + suma 1 a lo real.
    await h.sembrar({ stock_produccion: { [id]: { ...seed.stock_produccion[id], cantidad: 70 } } });
    await it.mas.click();
    await hasta(async () => (await cantidadDe(h, id)) === 71, "que quede en 71 (70 del otro teléfono + 1)");
    await hasta(async () => (await it.cantidad.innerText()).startsWith("71"), "que la pantalla muestre 71");
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

test("stock: el WhatsApp de stock bajo sale una vez, al cruzar el mínimo, y con el texto bien armado", async () => {
  const seed = buildSeed();
  const a = idStock(seed, "Mortadela Bocha"); // mínimo 8
  const b = idStock(seed, "Film termocontraíble"); // mínimo 2
  seed.stock_produccion[a].cantidad = 9;
  seed.stock_produccion[b].cantidad = 3;
  const h = await abrir({ seed });
  try {
    await irATab(h, "📦 Stock");
    const mort = itemStock(h, "Mortadela Bocha");
    await mort.menos.waitFor();
    await mort.menos.click(); // 9 -> 8: llega al mínimo, avisa
    await hasta(async () => (await cantidadDe(h, a)) === 8, "Mortadela en 8");
    await mort.menos.click(); // 8 -> 7: ya estaba en el mínimo, no vuelve a avisar
    await hasta(async () => (await cantidadDe(h, a)) === 7, "Mortadela en 7");
    await itemStock(h, "Film termocontraíble").menos.click(); // 3 -> 2: avisa
    await hasta(() => whatsapps(h).some((p) => p.get("text").includes("Film termocontraíble")), "el aviso del film");

    const avisos = whatsapps(h);
    assert.equal(avisos.length, 2, "un aviso por cada producto que cruzó su mínimo: " + avisos.map((p) => p.get("text")).join(" || "));
    const texto = avisos[0].get("text");
    assert.match(texto, /STOCK BAJO — Frigorífico Sersale\n⚠️ Mortadela Bocha: 8 piezas \(mín\. 8\)\nFecha: 10\/11\/2026/);
    assert.ok(!texto.includes("%0A"), "los saltos de línea no llegan como %0A escrito");
    assert.equal(avisos[0].get("phone"), "5491155550101");
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

// ── Reportes: enviar, corregir y eliminar mueven el stock ────────────────────

test("reporte de las 22:30: suma al stock una sola vez con la fecha de hoy; corregirlo y eliminarlo ajustan stock y movimiento", async () => {
  const seed = buildSeed();
  const id = idStock(seed, "Salame Tipo Milán");
  const inicial = seed.stock_produccion[id].cantidad;
  const h = await abrir({ seed, now: NOCHE, vista: "encargado" });
  const p = h.page;
  try {
    // El encargado carga 200 piezas (quiso poner 20) y toca dos veces "Enviar".
    await p.getByText(/Reporte de Producción · 10\/11\/2026/).waitFor(); // a las 22:30 sigue siendo 10/11
    await p.getByRole("button", { name: /Secos/ }).click();
    await p.getByPlaceholder("Ej: Roberto Gómez").fill("Prueba Auditoría");
    await p.locator("select").nth(0).selectOption("Salame Tipo Milán");
    await p.getByPlaceholder("Cantidad").fill("200");
    await p.locator("select").nth(1).selectOption("piezas");
    await p.getByRole("button", { name: /Enviar reporte/ }).evaluate((b) => { b.click(); b.click(); });
    await p.getByText("¡Reporte enviado!").waitFor();

    let db = await h.dump();
    const mios = Object.entries(db.reportes).filter(([, r]) => r.encargado === "Prueba Auditoría");
    assert.equal(mios.length, 1, "dos toques, un solo reporte");
    const [idRep, rep] = mios[0];
    assert.equal(rep.area, "secos");
    assert.deepEqual(rep.items, [{ producto: "Salame Tipo Milán", cantidad: "200", unidad: "piezas", obs: "" }]);
    assert.equal(db.stock_produccion[id].cantidad, inicial + 200);
    let movs = Object.entries(db.stock_movimientos).filter(([, m]) => m.ref === idRep);
    assert.equal(movs.length, 1);
    assert.deepEqual(
      { ...movs[0][1], createdAt: "" },
      { stockId: id, nombre: "Salame Tipo Milán", tipo: "entrada", subtipo: "produccion", cantidad: 200, unidad: "piezas", ref: idRep, encargado: "Prueba Auditoría", fecha: HOY, createdAt: "" },
      "el movimiento queda con la fecha de Buenos Aires, no la de UTC"
    );

    // El director lo ve en el día de hoy (el filtro arranca en 10/11, no en 11/11) y corrige a 20.
    await p.getByRole("button", { name: "+ Nueva tanda" }).click();
    await irADirector(h);
    assert.equal(await p.locator('input[type="date"]').inputValue(), HOY);
    await p.getByText("Reportes (4)").waitFor(); // los tres de la mañana y el de recién
    assert.equal(await p.evaluate(() => window.innerWidth), 390, "la pantalla de reportes entra en el ancho del teléfono (antes quedaba más ancha y achicada)");
    await p.getByText("Prueba Auditoría").click();
    await p.getByRole("button", { name: /Editar/ }).click();
    await p.getByText("Editar Reporte").waitFor();
    await p.getByPlaceholder("Cantidad").fill("20");
    await p.getByRole("button", { name: /Guardar cambios/ }).click();
    await p.locator(".ss-toast", { hasText: "Stock corregido: Salame Tipo Milán −180" }).waitFor();

    db = await h.dump();
    assert.equal(db.reportes[idRep].items[0].cantidad, "20");
    assert.ok(db.reportes[idRep].editadoEn);
    assert.equal(db.stock_produccion[id].cantidad, inicial + 20, "el stock baja las 180 que sobraban");
    movs = Object.entries(db.stock_movimientos).filter(([, m]) => m.ref === idRep);
    assert.equal(movs.length, 1);
    assert.equal(movs[0][1].cantidad, 20, "el movimiento queda con la cantidad corregida");

    // Lo elimina: el stock vuelve a donde estaba y no queda un movimiento apuntando a un reporte que no existe.
    await p.getByText("Reportes (4)").waitFor();
    await p.getByRole("button", { name: /Eliminar/ }).click();
    await hojaAbierta(h).getByText("se descuentan").waitFor();
    await tocarEnHoja(h, "Eliminar");
    await p.getByText("Reportes (3)").waitFor();

    db = await h.dump();
    assert.equal(db.reportes[idRep], undefined);
    assert.equal(db.stock_produccion[id].cantidad, inicial);
    assert.equal(Object.values(db.stock_movimientos).filter((m) => m.ref === idRep).length, 0);
    assert.equal(h.llamadas.dialogos.length, 0, "sin confirm() ni alert() del navegador");
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

test("corregir un reporte: tocar el nombre no mueve stock; pasar una línea a kg o a un producto sin stock descuenta lo que había sumado", async () => {
  const seed = buildSeed();
  const [idRep, rep] = Object.entries(seed.reportes).find(([, r]) => r.area === "cocidos" && r.fechaISO.startsWith(HOY));
  const ids = rep.items.map((it) => idStock(seed, it.producto)); // sublime, paleta, pata: las tres en piezas
  const antes = ids.map((id) => seed.stock_produccion[id].cantidad);
  const movs = async () => Object.values((await h.dump()).stock_movimientos).filter((m) => m.ref === idRep);
  const stock = async () => Promise.all(ids.map((id) => cantidadDe(h, id)));
  const h = await abrir({ seed });
  const p = h.page;
  const editar = async () => {
    await p.getByRole("button", { name: /Editar/ }).click();
    await p.getByText("Editar Reporte").waitFor();
  };
  try {
    await p.getByText("Reportes (3)").waitFor();
    await p.getByText(rep.encargado, { exact: true }).click();

    // A. Solo corrige el nombre del encargado.
    await editar();
    await p.locator("input").first().fill("Ramón G.");
    await p.getByRole("button", { name: /Guardar cambios/ }).click();
    await p.getByText("Ramón G.", { exact: true }).waitFor();
    assert.equal((await h.doc("reportes/" + idRep)).encargado, "Ramón G.");
    assert.deepEqual(await stock(), antes, "el stock no se toca");
    assert.equal((await movs()).length, 3);

    // B. La tercera línea (Jamón Cocido de Pata, 6 piezas) en realidad eran kg.
    await editar();
    await p.locator("select").nth(5).selectOption("kg");
    await p.getByRole("button", { name: /Guardar cambios/ }).click();
    await p.locator(".ss-toast", { hasText: "Stock corregido: Jamón Cocido de Pata −6" }).waitFor();
    assert.deepEqual(await stock(), [antes[0], antes[1], antes[2] - 6]);
    assert.deepEqual((await movs()).map((m) => m.nombre).sort(), ["Fiambre Cocido de Paleta de Cerdo", "Jamón Cocido Natural Sublime"]);

    // C. La segunda línea era otro producto, que no está cargado en Stock.
    const paleta = parseFloat(rep.items[1].cantidad);
    await editar();
    await p.locator("select").nth(2).selectOption("Jamón Cocido Especial Bajo Sodio");
    await p.getByRole("button", { name: /Guardar cambios/ }).click();
    await hojaAbierta(h).getByText("Jamón Cocido Especial Bajo Sodio").waitFor();
    await hojaAbierta(h).getByText("No figuran en Stock de Producción").waitFor();
    await tocarEnHoja(h, "Entendido");
    assert.deepEqual(await stock(), [antes[0], antes[1] - paleta, antes[2] - 6]);
    const quedan = await movs();
    assert.deepEqual(quedan.map((m) => [m.nombre, m.cantidad]), [["Jamón Cocido Natural Sublime", parseFloat(rep.items[0].cantidad)]], "solo queda el movimiento de la línea que no se tocó");
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

test("reporte: al cambiar de área no viajan productos de la otra, y una fila sin producto frena el envío", async () => {
  const seed = buildSeed();
  const idJamon = idStock(seed, "Jamón Cocido Natural Sublime");
  const h = await abrir({ seed, vista: "encargado" });
  const p = h.page;
  try {
    await p.getByRole("button", { name: /Cocidos/ }).click();
    await p.getByPlaceholder("Ej: Roberto Gómez").fill("Prueba Área");
    await p.locator("select").nth(0).selectOption("Jamón Cocido Natural Sublime");
    await p.getByPlaceholder("Cantidad").fill("10");
    await p.locator("select").nth(1).selectOption("piezas");
    await p.getByRole("button", { name: "←" }).click(); // se equivocó de área
    await p.getByRole("button", { name: /Secos/ }).click();
    assert.equal(await p.locator("select").nth(0).inputValue(), "", "el jamón no queda escondido en el formulario de Secos");

    await p.getByRole("button", { name: /Enviar reporte/ }).click();
    await p.locator(".ss-toast", { hasText: "Falta elegir el producto 1" }).waitFor();
    assert.equal(Object.values((await h.dump()).reportes).filter((r) => r.encargado === "Prueba Área").length, 0, "no se envió nada");

    await p.locator("select").nth(0).selectOption("Salamín Picado Fino");
    await p.getByRole("button", { name: /Enviar reporte/ }).click();
    await p.getByText("¡Reporte enviado!").waitFor();
    const db = await h.dump();
    const rep = Object.values(db.reportes).find((r) => r.encargado === "Prueba Área");
    assert.equal(rep.area, "secos");
    assert.deepEqual(rep.items.map((i) => i.producto), ["Salamín Picado Fino"]);
    assert.equal(db.stock_produccion[idJamon].cantidad, seed.stock_produccion[idJamon].cantidad, "el stock de jamón no se tocó");
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

test("sin señal: se avisa, no se guarda nada a medias y lo escrito queda para reintentar", async () => {
  const seed = buildSeed();
  const id = idStock(seed, "Salame Tipo Milán");
  const inicial = seed.stock_produccion[id].cantidad;
  const h = await abrir({ seed, vista: "encargado" });
  const p = h.page;
  try {
    await p.getByRole("button", { name: /Secos/ }).click();
    await p.getByPlaceholder("Ej: Roberto Gómez").fill("Prueba Sin Señal");
    await p.locator("select").nth(0).selectOption("Salame Tipo Milán");
    await p.getByPlaceholder("Cantidad").fill("7");
    await p.locator("select").nth(1).selectOption("piezas");
    await h.sinRed(true);
    await p.getByRole("button", { name: /Enviar reporte/ }).click();
    await p.locator(".ss-toast", { hasText: "Sin conexión: el reporte no se envió" }).waitFor();
    assert.equal(await p.getByPlaceholder("Cantidad").inputValue(), "7", "el formulario queda como estaba");
    await p.getByRole("button", { name: /Enviar reporte/ }).waitFor(); // el botón vuelve a estar disponible

    await h.sinRed(false);
    await p.getByRole("button", { name: /Enviar reporte/ }).click();
    await p.getByText("¡Reporte enviado!").waitFor();
    const db = await h.dump();
    assert.equal(Object.values(db.reportes).filter((r) => r.encargado === "Prueba Sin Señal").length, 1, "un solo reporte, sin duplicar por el reintento");
    assert.equal(db.stock_produccion[id].cantidad, inicial + 7, "y el stock sumó una sola vez");

    // En el panel, un toque en − sin señal avisa y no cambia el número.
    await p.getByRole("button", { name: "+ Nueva tanda" }).click();
    await irADirector(h);
    await irATab(h, "📦 Stock");
    const it = itemStock(h, "Salame Tipo Milán");
    await it.menos.waitFor();
    await h.sinRed(true);
    await it.menos.click();
    await p.locator(".ss-toast", { hasText: "Sin conexión: el stock no se cambió" }).waitFor();
    assert.ok((await it.cantidad.innerText()).startsWith(String(inicial + 7)));
    await h.sinRed(false);
    assert.equal(await cantidadDe(h, id), inicial + 7);
  } finally {
    await h.close();
  }
});

// ── Salidas de stock ─────────────────────────────────────────────────────────

test("salida: si un nombre no figura no se descuenta nada y el formulario queda; corregido, descuenta una sola vez", async () => {
  const seed = buildSeed();
  const idPanceta = idStock(seed, "Panceta Ahumada");
  const idChorizo = idStock(seed, "Chorizo Puro Cerdo");
  const panceta = seed.stock_produccion[idPanceta].cantidad;
  const chorizo = seed.stock_produccion[idChorizo].cantidad;
  const movsAntes = Object.keys(seed.stock_movimientos).length;
  const h = await abrir({ seed, now: NOCHE });
  const p = h.page;
  try {
    await irATab(h, "📦 Stock");
    await itemStock(h, "Panceta Ahumada").menos.waitFor();
    await p.getByRole("button", { name: /Salida/ }).click();
    await p.getByText("Registrar salida").waitFor();
    const modal = p.getByText("Registrar salida").locator("xpath=../..");
    assert.equal(await modal.locator('input[type="date"]').inputValue(), HOY, "la fecha propuesta es la de hoy en Buenos Aires");

    const nombres = modal.getByPlaceholder(/Nombre del producto/);
    const cantidades = modal.getByPlaceholder("Cantidad");
    await nombres.nth(0).fill("panceta ahumada "); // minúsculas y el espacio que agrega el teclado del iPhone
    await cantidades.nth(0).fill("3");
    await modal.getByRole("button", { name: "+ Agregar producto" }).click();
    await nombres.nth(1).fill("Chorizo de Cerdo"); // así no figura en Stock
    await cantidades.nth(1).fill("2.5");
    await modal.getByRole("button", { name: "Confirmar salida" }).click();

    await hojaAbierta(h).getByText("No se registró la salida").waitFor();
    await hojaAbierta(h).getByText("Chorizo de Cerdo").waitFor();
    await tocarEnHoja(h, "Entendido");
    let db = await h.dump();
    assert.equal(db.stock_produccion[idPanceta].cantidad, panceta, "no se descontó la línea que sí coincidía");
    assert.equal(Object.keys(db.stock_movimientos).length, movsAntes, "no se registró ningún movimiento");
    assert.equal(await nombres.nth(0).inputValue(), "panceta ahumada ", "lo escrito sigue en el formulario");
    assert.equal(await cantidades.nth(1).inputValue(), "2.5");

    // Corrige el nombre: la unidad pasa sola a la del ítem (kg).
    await nombres.nth(1).fill("Chorizo Puro Cerdo");
    assert.equal(await modal.locator("select").nth(3).inputValue(), "kg");
    await modal.getByRole("button", { name: "Confirmar salida" }).click();
    await p.locator(".ss-toast", { hasText: "Salida registrada" }).waitFor();
    await p.getByText("Registrar salida").waitFor({ state: "detached" });

    db = await h.dump();
    assert.equal(db.stock_produccion[idPanceta].cantidad, panceta - 3);
    assert.equal(db.stock_produccion[idChorizo].cantidad, chorizo - 2.5);
    const nuevos = Object.values(db.stock_movimientos).filter((m) => m.tipo === "salida" && m.createdAt > "2026-11-11T01:00");
    assert.deepEqual(
      nuevos.map((m) => ({ ...m, createdAt: "" })).sort((x, y) => x.nombre.localeCompare(y.nombre)),
      [
        { stockId: idChorizo, nombre: "Chorizo Puro Cerdo", tipo: "salida", subtipo: "despacho", destino: "PP", cantidad: 2.5, unidad: "kg", fecha: HOY, obs: "", createdAt: "" },
        { stockId: idPanceta, nombre: "Panceta Ahumada", tipo: "salida", subtipo: "despacho", destino: "PP", cantidad: 3, unidad: "piezas", fecha: HOY, obs: "", createdAt: "" },
      ]
    );
    await hasta(async () => (await itemStock(h, "Panceta Ahumada").cantidad.innerText()).startsWith(String(panceta - 3)), "la lista actualizada");
    assert.equal(whatsapps(h).length, 0, "ningún producto cruzó su mínimo: no se manda WhatsApp por los que ya estaban bajos");
    assert.equal(h.llamadas.dialogos.length, 0);
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

test("salida: no deja descontar piezas de un ítem que se lleva en kg, y avisa si sale más de lo que hay", async () => {
  const seed = buildSeed();
  const idMorcilla = idStock(seed, "Morcilla Criolla"); // en kg
  const idFilm = idStock(seed, "Film termocontraíble"); // 3 unidades, mínimo 2
  const morcilla = seed.stock_produccion[idMorcilla].cantidad;
  const h = await abrir({ seed });
  const p = h.page;
  try {
    await irATab(h, "📦 Stock");
    await itemStock(h, "Morcilla Criolla").menos.waitFor();
    await p.getByRole("button", { name: /Salida/ }).click();
    const modal = p.getByText("Registrar salida").locator("xpath=../..");
    await modal.getByPlaceholder(/Nombre del producto/).fill("Morcilla Criolla");
    await modal.getByPlaceholder("Cantidad").fill("10");
    await modal.locator("select").nth(2).selectOption("piezas"); // la cambia a mano por una que no es la del ítem
    await modal.getByRole("button", { name: "Confirmar salida" }).click();
    await hojaAbierta(h).getByText("en Stock se lleva en kg, no en piezas").waitFor();
    await tocarEnHoja(h, "Entendido");
    assert.equal(await cantidadDe(h, idMorcilla), morcilla, "no se descontó nada");

    // Sale más film del que figura: pregunta antes; el stock queda en 0 y el movimiento por lo que salió.
    await modal.getByPlaceholder(/Nombre del producto/).fill("Film termocontraíble");
    await modal.getByPlaceholder("Cantidad").fill("5");
    await modal.getByRole("button", { name: "Confirmar salida" }).click();
    await hojaAbierta(h).getByText("hay 3 unidades y salen 5").waitFor();
    await tocarEnHoja(h, "Registrar igual");
    await p.locator(".ss-toast", { hasText: "Salida registrada" }).waitFor();
    assert.equal(await cantidadDe(h, idFilm), 0);
    await hasta(() => whatsapps(h).length === 1, "el aviso por el film, que cruzó su mínimo");
    assert.match(whatsapps(h)[0].get("text"), /Film termocontraíble: 0 unidades \(mín\. 2\)/);
    assert.ok(!whatsapps(h)[0].get("text").includes("Tripa natural"), "no repite los que ya estaban bajos");
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

// ── Editar un ítem de stock ──────────────────────────────────────────────────

test("stock: cambiar solo el mínimo de un ítem no pisa la cantidad que cargó otro teléfono; no deja crear un nombre repetido", async () => {
  const seed = buildSeed();
  const id = idStock(seed, "Panceta Ahumada");
  const h = await abrir({ seed });
  const p = h.page;
  try {
    await irATab(h, "📦 Stock");
    const it = itemStock(h, "Panceta Ahumada");
    await it.menos.waitFor();
    await it.tarjeta.getByRole("button", { name: /Editar/ }).click();
    const modal = p.getByText("Editar ítem").locator("xpath=../..");
    await modal.getByPlaceholder("0 = sin alerta").waitFor();
    // Con el formulario ya abierto, otro teléfono carga producción: 20 piezas más.
    const real = seed.stock_produccion[id].cantidad + 20;
    await h.sembrar({ stock_produccion: { [id]: { ...seed.stock_produccion[id], cantidad: real } } });
    await modal.getByPlaceholder("0 = sin alerta").fill("15");
    await modal.getByRole("button", { name: "Guardar" }).click();
    await p.locator(".ss-toast", { hasText: "Ítem guardado" }).waitFor();
    const doc = await h.doc("stock_produccion/" + id);
    assert.equal(doc.minimo, 15);
    assert.equal(doc.cantidad, real, "la cantidad que cargó el otro teléfono sigue ahí");

    // Nombre repetido (aunque cambien mayúsculas o acentos): no se crea.
    await p.getByRole("button", { name: "+ Nuevo" }).click();
    const alta = p.getByText("Nuevo ítem de stock").locator("xpath=../..");
    await alta.getByPlaceholder("Ej: Jamón Cocido Natural Sublime").fill("jamon cocido de pata");
    await alta.getByPlaceholder("0", { exact: true }).fill("4");
    await alta.getByRole("button", { name: "Guardar" }).click();
    await p.locator(".ss-toast", { hasText: 'Ya hay un ítem que se llama "Jamón Cocido de Pata"' }).waitFor();
    assert.equal(Object.keys((await h.dump()).stock_produccion).length, Object.keys(seed.stock_produccion).length);
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

test("stock: el panel de WhatsApp no se cierra ni pierde lo escrito cuando cambia la pantalla", async () => {
  const seed = buildSeed();
  const id = idStock(seed, "Mortadela Bocha");
  const h = await abrir({ seed });
  const p = h.page;
  try {
    await irATab(h, "📦 Stock");
    await p.getByRole("button", { name: /Config/ }).click();
    const tel = p.getByPlaceholder(/Número WhatsApp/);
    await tel.fill("5491144440000");
    await itemStock(h, "Mortadela Bocha").mas.click(); // cualquier cambio en la pantalla de atrás
    await hasta(async () => (await cantidadDe(h, id)) === seed.stock_produccion[id].cantidad + 1, "el +1");
    await hasta(async () => (await itemStock(h, "Mortadela Bocha").cantidad.innerText()).startsWith(String(seed.stock_produccion[id].cantidad + 1)), "la pantalla actualizada");
    assert.equal(await tel.inputValue(), "5491144440000", "el número a medio escribir sigue ahí");
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

// ── Faena ────────────────────────────────────────────────────────────────────

test("faena: el promedio acompaña a las cabezas, la fecha propuesta es hoy y editar no cambia la fecha de carga", async () => {
  const seed = buildSeed();
  const h = await abrir({ seed, now: NOCHE });
  const p = h.page;
  try {
    await irATab(h, "🐖 Faena");
    await p.getByRole("button", { name: "+ Registrar" }).click();
    const modal = p.getByText("Registrar faena").locator("xpath=../..");
    assert.equal(await modal.locator('input[type="date"]').inputValue(), HOY);
    const num = modal.locator('input[type="number"]'); // cabezas, peso total, promedio
    await num.nth(0).fill("10");
    await num.nth(1).fill("1000");
    assert.equal(await num.nth(2).inputValue(), "100");
    await num.nth(0).fill("12"); // corrige las cabezas
    assert.equal(await num.nth(2).inputValue(), "83.3");
    await modal.getByRole("button", { name: "Guardar" }).click();
    await p.locator(".ss-toast", { hasText: "Faena guardada" }).waitFor();
    let db = await h.dump();
    const nueva = Object.values(db.faenas).find((f) => f.fecha === HOY);
    assert.deepEqual({ ...nueva, createdAt: "" }, { fecha: HOY, tipo: "Cerdo", cantidad: 12, pesoTotal: 1000, pesoPromedio: 83.3, obs: "", createdAt: "" });

    // Editar la de ayer: createdAt queda como estaba.
    const [idAyer, ayer] = Object.entries(seed.faenas).find(([, f]) => f.fecha === "2026-11-09");
    const tarjeta = p.getByText("09/11/2026").locator("xpath=../../..");
    await tarjeta.getByRole("button", { name: "✏️" }).click();
    const edicion = p.getByText("Editar faena").locator("xpath=../..");
    await edicion.getByPlaceholder(/animales de primer calidad/).fill("Tropa revisada");
    await edicion.getByRole("button", { name: "Guardar" }).click();
    await p.locator(".ss-toast", { hasText: "Faena guardada" }).last().waitFor();
    await hasta(async () => (await h.doc("faenas/" + idAyer)).obs === "Tropa revisada", "la observación guardada");
    const despues = await h.doc("faenas/" + idAyer);
    assert.equal(despues.createdAt, ayer.createdAt, "la fecha de carga no cambia al editar");
    assert.equal(despues.pesoPromedio, ayer.pesoPromedio);
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

// ── Lotes ────────────────────────────────────────────────────────────────────

test("lotes: el vencimiento sigue a la fecha de elaboración, 'vence hoy' es hoy también de noche, y el número no se repite", async () => {
  const seed = buildSeed();
  seed.trazabilidad_lotes.lot_hoy = {
    nroLote: "20261105-009", fechaElab: "2026-11-05", fechaVenc: HOY, operario: "Vence Hoy",
    materiasPrimas: [{ tipo: "cerdo", corte: "Recorte", proveedor: "Frigorífico La Pompeya", kg: 50 }],
    productos: [{ nombre: "Chorizo Puro Cerdo", cantidad: 45, unidad: "kg" }], obs: "", createdAt: "2026-11-05T15:00:00.000Z",
  };
  const h = await abrir({ seed, now: NOCHE });
  const p = h.page;
  try {
    await irATab(h, "🏷️ Lotes");
    const tarjeta = p.getByText("Vence Hoy").locator("xpath=../../..");
    await tarjeta.getByText("(hoy)").waitFor(); // antes, a las 22:30 decía "vencido hace 1d"

    await p.getByRole("button", { name: "+ Nuevo Lote" }).click();
    const modal = p.getByText("Nuevo Lote", { exact: true }).locator("xpath=../..");
    const fechas = modal.locator('input[type="date"]');
    assert.equal(await fechas.nth(0).inputValue(), HOY, "propone hoy");
    assert.equal(await fechas.nth(1).inputValue(), "2026-12-10", "y vencimiento a 30 días");
    await fechas.nth(0).fill("2026-11-03"); // se equivoca de día...
    assert.equal(await fechas.nth(1).inputValue(), "2026-12-03");
    await fechas.nth(0).fill("2026-11-05"); // ...y lo corrige: el vencimiento acompaña
    assert.equal(await fechas.nth(1).inputValue(), "2026-12-05");
    await modal.getByPlaceholder("Nombre del operario").fill("Prueba Lote");
    await modal.getByPlaceholder("Proveedor / tropa").fill("Porcinos Roque Pérez");
    await modal.getByPlaceholder("Kg").fill("120.5");
    await modal.getByPlaceholder("Nombre del producto").fill("Salame Tipo Milán");
    await modal.getByPlaceholder("Cant.").fill("60");
    await modal.getByRole("button", { name: /Registrar Lote/ }).click();
    await p.locator(".ss-toast", { hasText: "Lote 20261105-010 registrado" }).waitFor(); // ya existía el 009: sigue el 010

    const lote = Object.values((await h.dump()).trazabilidad_lotes).find((l) => l.operario === "Prueba Lote");
    assert.deepEqual(
      { ...lote, createdAt: "" },
      {
        nroLote: "20261105-010", fechaElab: "2026-11-05", fechaVenc: "2026-12-05", operario: "Prueba Lote",
        materiasPrimas: [{ tipo: "cerdo", corte: "", proveedor: "Porcinos Roque Pérez", kg: 120.5 }],
        productos: [{ nombre: "Salame Tipo Milán", cantidad: 60, unidad: "piezas" }], obs: "", createdAt: "",
      }
    );
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

// ── PDF y Excel ──────────────────────────────────────────────────────────────

test("exportar sin haber abierto Stock, Faena ni Lotes: el Excel y el PDF salen completos, con la faena del mes y la fecha de hoy", async () => {
  const seed = buildSeed();
  const idChorizo = idStock(seed, "Chorizo Puro Cerdo");
  seed.stock_produccion[idChorizo].cantidad = 62.5;
  const [idFaena] = Object.entries(seed.faenas).find(([, f]) => f.fecha === "2026-11-09");
  seed.faenas[idFaena].obs = "tropa 4512; frigorífico La Pampa";
  seed.trazabilidad_lotes.lot_largo = {
    nroLote: "20261109-005", fechaElab: "2026-11-09", fechaVenc: "2026-12-09", operario: "Ramón",
    materiasPrimas: [{ tipo: "cerdo", corte: "Paleta", proveedor: "Porcinos Roque Pérez", kg: 200 }],
    productos: [{ nombre: "=Fiambre Cocido de Paleta de Cerdo Especial Feteado Fino", cantidad: 40, unidad: "piezas" }], obs: "", createdAt: "2026-11-09T15:00:00.000Z",
  };
  const h = await abrir({ seed, now: NOCHE });
  const p = h.page;
  const bajar = async (boton) => {
    await p.getByRole("button", { name: "📄", exact: true }).click();
    const [descarga] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: boton }).click()]);
    return { nombre: descarga.suggestedFilename(), datos: fs.readFileSync(await descarga.path()) };
  };
  try {
    // Recién llegado al panel (pestaña Reportes): el aviso de stock bajo ya está en la pestaña Stock.
    await p.getByRole("button", { name: /📦 Stock\s*\d+/ }).waitFor();

    const excel = await bajar(/Excel/);
    assert.equal(excel.nombre, "Sersale_Produccion_2026-11-10.csv", "nombre con la fecha de Buenos Aires");
    const csv = excel.datos.toString("utf8");
    assert.match(csv, /STOCK ACTUAL\nProducto;Categoría;Cantidad;Unidad;Mínimo\n/);
    assert.match(csv, /\nChorizo Puro Cerdo;Frescos;62,5;kg;50\n/, "decimales con coma");
    assert.match(csv, /STOCK BAJO MÍNIMO\n.*\n(.*\n)*Tripa natural calibre 32;9;10;bolsas\n/);
    const faena = csv.slice(csv.indexOf("FAENA — 2026-11"), csv.indexOf("LOTES DE TRAZABILIDAD"));
    assert.match(faena, /\n09\/11\/2026;Cerdo;47;5381;114,5;"tropa 4512; frigorífico La Pampa"\n/, "el ; de la observación no corre las columnas");
    assert.match(faena, /\n02\/11\/2026;/);
    assert.ok(!/\/10\/2026;/.test(faena), "la faena de octubre no entra en el bloque de noviembre");
    assert.match(csv, /\n20261109-005;09\/11\/2026;09\/12\/2026;Ramón;'=Fiambre Cocido de Paleta de Cerdo Especial Feteado Fino;40;piezas;/, "un texto que empieza con = no queda como fórmula");

    const pdf = await bajar(/PDF/);
    assert.equal(pdf.nombre, "Sersale_Produccion_2026-11-10.pdf");
    const crudo = pdf.datos.toString("latin1");
    for (const t of ["STOCK ACTUAL", "STOCK BAJO M\xcdNIMO", "FAENA - 11/2026", "LOTES DE TRAZABILIDAD", "Panceta Ahumada", "20261109-005", "62,5"]) {
      assert.ok(crudo.includes("(" + t), "el PDF trae legible: " + t);
    }
    assert.ok(!/29\/10\/2026/.test(crudo), "sin faenas de otros meses");
    assert.ok(/\(=Fiambre Cocido de Paleta de Cerdo[^)]*\.\.\.\)/.test(crudo), "el nombre largo se corta en su columna en vez de pisar la cantidad");
    await sinErrores(h);
  } finally {
    await h.close();
  }
});

// Revisión independiente de cuentas corrientes, remitos y vista comercial
// (src/pedidos/00, 03 y 06). Cada prueba reproduce, con la pantalla real y una
// red que falla a propósito o con datos del sistema anterior, un defecto que
// quedaba después de los arreglos. Detalle en docs/auditoria/revision-cc.md.
import test from "node:test";
import assert from "node:assert/strict";
import { launch } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const HOY = "2026-11-10";

const DISTRI = "Distribuidora Mayorista del Sur S.R.L.";
const TREBOL = "Carnicería El Trébol";
const DAGOSTINO = "Almacén D'Agostino";
const SABOR = "Rotisería El Buen Sabor";
const NATA = "Fiambrería La Ñata";

const VISTAS = { comercial: "Cargar y gestionar pedidos", director: "Panel general y cuentas corrientes" };

// ── Ayudas ──────────────────────────────────────────────────────────────────
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
const valores = (o) => Object.values(o || {});
const entradas = (o) => Object.entries(o || {});

async function abrir(seed, vista, opts = {}) {
  const h = await launch({ rol: "director", etiqueta: "revcc", seed, ...opts });
  await h.ir("pedidos.html");
  await h.sincronizar();
  await h.page.getByText("¿Quién sos?").waitFor();
  await h.page.locator("button", { hasText: VISTAS[vista] }).click();
  if (vista === "comercial") await h.page.getByText(/Activos \(\d+\)/).waitFor();
  return h;
}
const boton = (h, t) => h.page.locator("button", { hasText: t });
const toast = (h, t) => h.page.locator(".ss-toast", { hasText: t });
const hayToast = (h, t) => async () => (await toast(h, t).count()) > 0;
const botonHoja = (h, t) => h.page.locator(".ss-hoja .ss-btn", { hasText: t });
const nroRemito = (h) => h.page.locator('input[aria-label="Número de remito"]');

/** Anota en window.__toasts el texto de cada aviso que aparezca (duran unos segundos y se van). */
async function anotarToasts(h) {
  await h.page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => {
      document.querySelectorAll(".ss-toast").forEach((t) => {
        const x = t.textContent.trim();
        if (x && !window.__toasts.includes(x)) window.__toasts.push(x);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
const toastsVistos = (h) => h.page.evaluate(() => window.__toasts.slice());

/** Espera adelantando el reloj de la página (las esperas y reintentos internos duran varios segundos). */
async function adelantandoHasta(h, fn, que, pasos = 80) {
  for (let i = 0; i < pasos; i++) {
    if (await fn()) return;
    await h.page.clock.runFor(1500);
    await pausa(150);
  }
  throw new Error("No se cumplió: " + que);
}

/** Comercial → tocar la tarjeta del cliente → «🧾 Remito». */
async function abrirRemito(h, cliente) {
  await h.page.locator("span", { hasText: cliente }).first().click();
  await boton(h, "🧾 Remito").click();
  await h.page.getByText("Remito — " + cliente).waitFor();
  await adelantandoHasta(h, () => h.page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Número de remito"]');
    const precios = [...document.querySelectorAll('input[placeholder="$ / kg"]')];
    return !!i && precios.some((p) => p.value !== "");
  }), "que el remito muestre los precios");
}
/** Abre el remito de un pedido, espera el número y vuelve a la lista sin guardar. */
async function mirarUnRemito(h, cliente) {
  await abrirRemito(h, cliente);
  await h.page.waitForFunction(() => document.querySelector('input[aria-label="Número de remito"]').value !== "");
  await boton(h, "←").first().click();
  await h.page.getByText(/Activos \(\d+\)/).waitFor();
}
/** Toca «Guardar» en el remito hasta que quede guardado (cada intento puede terminar en error o en un aviso). */
async function guardarRemitoHasta(h, exito) {
  await h.page.clock.runFor(10000); // se van los avisos de antes
  await pausa(200);
  for (let intento = 0; intento < 8; intento++) {
    if (await boton(h, "💾 Guardar").isEnabled()) await boton(h, "💾 Guardar").click();
    await adelantandoHasta(h, async () => (await hayToast(h, exito)()) || (await hayToast(h, "No se pudo guardar el remito")()) || (await hayToast(h, "ya tiene el Remito")()), "que el intento de guardar termine");
    if (await hayToast(h, exito)()) return;
    await h.page.clock.runFor(10000);
    await pausa(200);
  }
  throw new Error("El remito no se pudo guardar con la señal de vuelta");
}
/** Director → pestaña CC. */
async function abrirCC(h) {
  await h.page.getByText("Activos", { exact: true }).first().waitFor();
  await boton(h, "💳 CC").click();
  await h.page.getByText("Deuda total").waitFor();
}
const tarjetaCC = (h, nombre) =>
  h.page.locator("div", { has: h.page.getByText(nombre, { exact: true }) }).filter({ has: boton(h, "Ver movimientos") }).last();

/**
 * Señal entrecortada: el canal por el que el teléfono escucha los cambios se cae y no
 * vuelve a conectar (los pedidos sueltos —guardar, transacciones— sí pasan). Desde acá
 * la copia del teléfono queda vieja: lo que haga otro teléfono no le llega.
 */
async function dejarSinEscucha(h) {
  const corte = await h.cortarEscucha();
  await h.sinRed(true); // un corte corto tira el canal que ya estaba abierto…
  await pausa(300);
  await h.sinRed(false); // …y al volver ya no puede reconectar
  await adelantandoHasta(h, () => h.page.evaluate(() => {
    const e = window.__sersaleDatos.estado();
    return Object.keys(e).length > 0 && Object.values(e).every((x) => !x.sincronizado);
  }), "que el teléfono note que dejó de recibir cambios");
  return corte;
}
/** Vuelve el canal de escucha y se espera a que el teléfono se ponga al día. */
async function volverEscucha(h, corte) {
  corte.activo = false;
  await adelantandoHasta(h, () => h.page.evaluate(() => {
    const e = window.__sersaleDatos.estado();
    return Object.keys(e).length > 0 && Object.values(e).every((x) => x.sincronizado);
  }), "que el teléfono vuelva a estar al día");
}

function ultimosPrecios(seed, cliente) {
  const out = {};
  valores(seed.precios_cliente)
    .filter((p) => p.cliente === cliente)
    .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""))
    .forEach((p) => { if (!out[p.producto]) out[p.producto] = p.precio; });
  return out;
}
const kgDe = (it) => (it.kgReal != null && it.kgReal !== "" ? Number(it.kgReal) : parseFloat(it.cantidad) || 0);
const totalEsperado = (pedido, precios) => r2(pedido.items.reduce((s, it) => s + r2(kgDe(it) * (precios[it.producto] || 0)), 0));
const cuentasDe = (db, nombre) => entradas(db.cuentas_corrientes).filter(([, c]) => c.nombre === nombre);
const movsDe = (db, nombre) => valores(db.cc_movimientos).filter((m) => m.cliente === nombre);
const remitosDe = (db, pedidoId) => entradas(db.remitos).filter(([, r]) => r.pedidoId === pedidoId);
const pedidoDe = (seed, cliente, filtro = () => true) => entradas(seed.pedidos).find(([, p]) => p.cliente === cliente && filtro(p));

/**
 * Lo que escribe el sitio ANTERIOR (el que sigue usando el resto del personal) cuando
 * guarda el remito de un pedido: remito con id al azar, contador, cargo en la cuenta
 * (un movimiento nuevo si el pedido no tenía "Pendiente de facturar") y saldo recalculado.
 */
function remitoDelSitioAnterior(seed, pedidoId, precios) {
  const pedido = seed.pedidos[pedidoId];
  const nro = seed.config.contador_remitos.ultimo + 1;
  const total = pedido.items.reduce((s, it) => s + (it.kgReal || parseFloat(it.cantidad) || 0) * (precios[it.producto] || 0), 0);
  const monto = Math.round(total);
  const [ccId, cc] = cuentasDe(seed, pedido.cliente)[0];
  return {
    nro, monto,
    escribe: {
      remitos: { rem_del_otro: {
        nro, pedidoId, cliente: pedido.cliente, fecha: HOY,
        items: pedido.items.map((it) => ({ producto: it.producto, kg: it.kgReal || it.cantidad || 0, unidad: it.unidad, precio: precios[it.producto] || 0, total: (it.kgReal || parseFloat(it.cantidad) || 0) * (precios[it.producto] || 0) })),
        total, createdAt: "2026-11-10T13:20:00.000Z",
      } },
      config: { contador_remitos: { ultimo: nro, updatedAt: "2026-11-10T13:20:00.000Z" } },
      cc_movimientos: { ccm_del_otro: {
        cliente: pedido.cliente, tipo: "pedido", monto, movimiento: monto, fecha: pedido.fechaEntrega,
        detalle: pedido.items.map((it) => it.producto).join(", "), obs: "Remito N° " + String(nro).padStart(4, "0"), origen: "remito", remitoNro: nro, createdAt: "2026-11-10T13:20:01.000Z",
      } },
      cuentas_corrientes: { [ccId]: { ...cc, saldo: cc.saldo + monto, ultimoMovimiento: HOY } },
    },
  };
}

// ── 1. Remito con la copia del teléfono vieja ───────────────────────────────

test("remito: si otro teléfono ya hizo el remito y este no se enteró (señal entrecortada), no se emite otro ni se cobra dos veces", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = pedidoDe(seed, DISTRI, (p) => p.estado === "listo");
  // El pedido se cargó sin tildar "cuenta corriente" (el cliente igual tiene cuenta): no dejó "Pendiente de facturar".
  pedido.cuentaCorriente = false;
  for (const [id, m] of entradas(seed.cc_movimientos)) if (m.cliente === DISTRI && m.monto === 0 && m.fecha === pedido.fechaEntrega) delete seed.cc_movimientos[id];
  const precios = ultimosPrecios(seed, DISTRI);
  const [ccId, cc] = cuentasDe(seed, DISTRI)[0];
  const h = await abrir(seed, "comercial");
  try {
    await mirarUnRemito(h, SABOR); // como cualquier mañana: ya se abrió algún remito en este teléfono
    const corte = await dejarSinEscucha(h);
    // Mientras tanto, en el depósito guardan el remito de ese pedido con el sitio anterior.
    const otro = remitoDelSitioAnterior(seed, pedidoId, precios);
    await h.sembrar(otro.escribe);
    const saldoBien = cc.saldo + otro.monto;

    // En este teléfono el pedido sigue figurando sin remito. Se abre y se guarda.
    await abrirRemito(h, DISTRI);
    await boton(h, "💾 Guardar").click();
    await adelantandoHasta(h, async () => (await hayToast(h, "No se pudo guardar el remito")()) || (await hayToast(h, /Remito N° \d+ (guardado|corregido)/)()), "que termine de guardar o avise");

    let db = await h.dump();
    assert.equal(remitosDe(db, pedidoId).length, 1, "el pedido sigue con UN remito (antes quedaban dos: el 0040 del depósito y un 0041 nuevo)");
    assert.equal(db.config.contador_remitos.ultimo, otro.nro, "no se gastó otro número");
    assert.equal(movsDe(db, DISTRI).filter((m) => m.tipo === "pedido" && m.fecha === pedido.fechaEntrega && m.monto > 0).length, 1, "un solo cargo por el pedido");
    assert.equal(db.cuentas_corrientes[ccId].saldo, saldoBien, "el saldo tiene el cargo una sola vez (antes quedaba cobrado dos veces)");

    // Vuelve la señal: ahora la pantalla puede corregir el remito que ya existe.
    await volverEscucha(h, corte);
    await guardarRemitoHasta(h, /Remito N° 0040 (guardado|corregido)/);
    assert.equal(await nroRemito(h).inputValue(), "0040", "queda con el número del remito que ya existía");
    db = await h.dump();
    assert.equal(remitosDe(db, pedidoId).length, 1);
    assert.equal(remitosDe(db, pedidoId)[0][0], "rem_del_otro", "se corrigió el remito que había hecho el depósito");
    assert.equal(db.config.contador_remitos.ultimo, otro.nro);
    assert.equal(movsDe(db, DISTRI).filter((m) => m.remitoNro === otro.nro).length, 1);
    assert.equal(db.cuentas_corrientes[ccId].saldo, cc.saldo + Math.round(totalEsperado(pedido, precios)));
  } finally {
    await h.close();
  }
});

test("remito: si el cliente ya tiene cuenta y este teléfono no se enteró, no se le abre una segunda cuenta", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = pedidoDe(seed, SABOR, (p) => p.estado === "listo");
  pedido.cuentaCorriente = true;
  assert.equal(cuentasDe(seed, SABOR).length, 0, "al empezar el cliente no tiene cuenta");
  const total = Math.round(totalEsperado(pedido, ultimosPrecios(seed, SABOR)));
  const h = await abrir(seed, "comercial");
  try {
    await mirarUnRemito(h, DISTRI);
    const corte = await dejarSinEscucha(h);
    // Desde otro teléfono (sitio anterior) le abren la cuenta y le cargan una venta de $50.000.
    await h.sembrar({
      cuentas_corrientes: { cc_del_otro: { nombre: SABOR, saldo: 50000, creadoEn: "2026-11-10T13:20:00.000Z", ultimoMovimiento: HOY } },
      cc_movimientos: { ccm_venta_otro: { cliente: SABOR, tipo: "pedido", monto: 50000, movimiento: 50000, fecha: HOY, detalle: "Pollo 10kg", obs: "", origen: "venta_rapida", createdAt: "2026-11-10T13:20:01.000Z" } },
    });
    await abrirRemito(h, SABOR);
    await boton(h, "💾 Guardar").click();
    await adelantandoHasta(h, async () => (await hayToast(h, "No se pudo guardar el remito")()) || (await hayToast(h, /Remito N° \d+ (guardado|corregido)/)()), "que termine de guardar o avise");
    let db = await h.dump();
    assert.equal(cuentasDe(db, SABOR).length, 1, "el cliente sigue con UNA cuenta (antes se le abría otra, con el remito cargado ahí)");

    await volverEscucha(h, corte);
    await guardarRemitoHasta(h, /Remito N° 0040 (guardado|corregido)/);
    db = await h.dump();
    assert.equal(remitosDe(db, pedidoId).length, 1);
    assert.equal(cuentasDe(db, SABOR).length, 1);
    assert.equal(db.cuentas_corrientes.cc_del_otro.saldo, 50000 + total, "el remito se cargó en la cuenta que ya existía");
  } finally {
    await h.close();
  }
});

test("cuenta corriente: «+ Nueva» no abre una segunda cuenta si otro teléfono ya se la abrió y este no se enteró", async () => {
  const seed = buildSeed();
  assert.equal(cuentasDe(seed, NATA).length, 0);
  const h = await abrir(seed, "director");
  try {
    await abrirCC(h);
    await dejarSinEscucha(h);
    await h.sembrar({
      cuentas_corrientes: { cc_del_otro: { nombre: NATA, saldo: 50000, creadoEn: "2026-11-10T13:20:00.000Z", ultimoMovimiento: HOY } },
      cc_movimientos: { ccm_venta_otro: { cliente: NATA, tipo: "pedido", monto: 50000, movimiento: 50000, fecha: HOY, detalle: "Queso Cremoso 6kg", obs: "", origen: "venta_rapida", createdAt: "2026-11-10T13:20:01.000Z" } },
    });
    await boton(h, "+ Nueva").click();
    const sel = h.page.locator("select", { has: h.page.locator("option", { hasText: "— Seleccioná un cliente —" }) });
    await adelantandoHasta(h, async () => (await sel.count()) > 0, "la lista de clientes");
    await sel.selectOption({ label: NATA }); // este teléfono todavía lo ofrece: no sabe que ya tiene cuenta
    await boton(h, "Crear cuenta").click();
    await adelantandoHasta(h, async () => (await hayToast(h, "No se pudo crear la cuenta")()) || (await hayToast(h, "Cuenta corriente creada")()) || (await hayToast(h, "ya tiene cuenta corriente")()), "que termine o avise");
    const db = await h.dump();
    assert.equal(cuentasDe(db, NATA).length, 1, "el cliente sigue con UNA cuenta (antes quedaba con dos)");
    assert.equal(db.cuentas_corrientes.cc_del_otro.saldo, 50000);
  } finally {
    await h.close();
  }
});

test("editar pedido: no se pasa a otro cliente si ya tiene remito, aunque este teléfono todavía no lo sepa", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = pedidoDe(seed, DISTRI, (p) => p.estado === "listo");
  const precios = ultimosPrecios(seed, DISTRI);
  const h = await abrir(seed, "comercial");
  try {
    await mirarUnRemito(h, SABOR); // este teléfono ya trabajó con remitos hoy
    await dejarSinEscucha(h);
    await h.sembrar(remitoDelSitioAnterior(seed, pedidoId, precios).escribe); // el depósito ya hizo el remito
    await h.page.locator("span", { hasText: DISTRI }).first().click();
    await boton(h, "✏️").click();
    await h.page.getByText("Editar Pedido").waitFor();
    const selCliente = h.page.locator("select").first();
    await adelantandoHasta(h, async () => (await selCliente.locator("option", { hasText: TREBOL }).count()) > 0, "la lista de clientes");
    await selCliente.selectOption({ label: TREBOL });
    await boton(h, "✓ Guardar Cambios").click();
    await adelantandoHasta(h, async () => (await h.page.locator(".ss-toast").count()) > 0, "que termine o avise");
    assert.equal((await h.doc("pedidos/" + pedidoId)).cliente, DISTRI, "el pedido sigue a nombre del cliente del remito (antes pasaba al otro y el cargo quedaba en la cuenta del primero)");
    assert.equal(pedido.cliente, DISTRI);
  } finally {
    await h.close();
  }
});

// ── 2. La respuesta del servidor se pierde justo al guardar ──────────────────

test("pedidos: cancelar con la señal cortada justo al guardar no dice «cambió desde otro teléfono» y saca el «Pendiente de facturar»", async () => {
  const seed = buildSeed();
  const [id, pedido] = pedidoDe(seed, DAGOSTINO, (p) => p.estado === "pendiente");
  const pendientes = (db) => movsDe(db, DAGOSTINO).filter((m) => m.monto === 0 && m.fecha === pedido.fechaEntrega);
  assert.equal(pendientes(seed).length, 1, "el pedido tiene su «Pendiente de facturar»");
  const h = await abrir(seed, "comercial");
  try {
    await anotarToasts(h);
    await h.page.locator("span", { hasText: DAGOSTINO }).first().click();
    const red = await h.redQueSeCorta();
    red.perder = 1; // el servidor guarda la cancelación, pero la respuesta no vuelve
    await boton(h, "❌").click();
    await botonHoja(h, "Cancelar pedido").click();
    await adelantandoHasta(h, async () => (await h.doc("pedidos/" + id)).estado === "cancelado" && !(await h.page.evaluate((n) => document.body.innerText.includes(n), DAGOSTINO)), "que el pedido salga de los activos");
    assert.equal(red.perdidas, 1, "la prueba tiene que haber perdido una confirmación");
    await pausa(300);
    const avisos = await toastsVistos(h);
    assert.equal(avisos.filter((t) => t.includes("cambió desde otro teléfono")).length, 0, "no culpa a otro teléfono: la cancelación la hizo este. Avisos: " + avisos.join(" | "));
    const ped = await h.doc("pedidos/" + id);
    assert.equal(ped.historial.filter((x) => x.estado === "cancelado").length, 1, "una sola entrada «cancelado» en el historial");
    await adelantandoHasta(h, async () => pendientes(await h.dump()).length === 0, "que el «Pendiente de facturar» salga de la cuenta (antes quedaba para siempre)", 12);
  } finally {
    await h.close();
  }
});

test("remito: con la señal cortada justo al guardar queda UN remito, un cargo y un número; y dice «guardado» y «se abrió la cuenta», no «corregido»", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = pedidoDe(seed, SABOR, (p) => p.estado === "listo");
  pedido.cuentaCorriente = true; // cliente sin cuenta: el remito se la abre
  const total = Math.round(totalEsperado(pedido, ultimosPrecios(seed, SABOR)));
  const preciosAntes = Object.keys(seed.precios_cliente).length;
  const h = await abrir(seed, "comercial");
  try {
    await abrirRemito(h, SABOR);
    await anotarToasts(h);
    const red = await h.redQueSeCorta();
    red.perder = 1; // el servidor guarda todo, la respuesta no vuelve y Firestore repite la operación
    await boton(h, "💾 Guardar").click();
    await toast(h, /Remito N° 0040/).waitFor();
    assert.equal(red.perdidas, 1, "la prueba tiene que haber perdido una confirmación");
    const db = await h.dump();
    assert.equal(remitosDe(db, pedidoId).length, 1, "un solo remito");
    assert.equal(db.config.contador_remitos.ultimo, 40, "un solo número gastado");
    assert.equal(cuentasDe(db, SABOR).length, 1, "una sola cuenta");
    assert.equal(cuentasDe(db, SABOR)[0][1].saldo, total, "el cargo entró una sola vez");
    assert.equal(movsDe(db, SABOR).length, 1, "un solo movimiento");
    assert.equal(Object.keys(db.precios_cliente).length - preciosAntes, pedido.items.length, "cada precio guardado una vez");
    const avisos = await toastsVistos(h);
    assert.ok(avisos.some((t) => t.includes("Remito N° 0040 guardado")), "es un remito nuevo: dice «guardado» (antes decía «corregido»). Avisos: " + avisos.join(" | "));
    await h.page.locator('[data-aviso="remito-cc"]', { hasText: "Se abrió la cuenta corriente" }).waitFor();
  } finally {
    await h.close();
  }
});

test("pago: si dice «No se pudo registrar» pero el servidor lo había guardado, volver a cargarlo no lo duplica", async () => {
  const seed = buildSeed();
  const [ccId, cc] = cuentasDe(seed, TREBOL)[0];
  const pagos = (db) => movsDe(db, TREBOL).filter((m) => m.tipo === "pago" && m.monto === 10000 && m.fecha === HOY);
  const h = await abrir(seed, "director");
  try {
    await abrirCC(h);
    await tarjetaCC(h, TREBOL).locator("button", { hasText: "Registrar pago" }).click();
    await h.page.getByText("Registrar pago", { exact: true }).first().waitFor();
    await h.page.locator('input[placeholder="0"]').fill("10000");
    const red = await h.redQueSeCorta();
    red.perder = 1;
    red.luegoSinSenal = true; // el servidor guarda, la respuesta se pierde y después no hay señal
    await boton(h, "✓ Confirmar pago").click();
    await adelantandoHasta(h, hayToast(h, "No se pudo registrar el pago"), "el aviso de error");
    assert.equal(pagos(await h.dump()).length, 1, "el servidor ya tenía el pago guardado");

    // La persona cierra la hoja, vuelve la señal y lo carga de nuevo, como dice el cartel.
    await h.page.locator("button", { hasText: "×" }).last().click();
    red.caida = false;
    await h.page.clock.runFor(4000);
    await tarjetaCC(h, TREBOL).locator("button", { hasText: "Registrar pago" }).click();
    await h.page.getByText("Registrar pago", { exact: true }).first().waitFor();
    await h.page.locator('input[placeholder="0"]').fill("10000");
    await boton(h, "✓ Confirmar pago").click();
    await adelantandoHasta(h, async () => (await hayToast(h, "Pago de $10.000 registrado")()) || (await hayToast(h, "ya había quedado registrado")()), "que el segundo intento termine");
    const db = await h.dump();
    assert.equal(pagos(db).length, 1, "un solo pago de $10.000 (antes quedaban dos)");
    assert.equal(db.cuentas_corrientes[ccId].saldo, cc.saldo - 10000, "el saldo baja una sola vez");
  } finally {
    await h.close();
  }
});

// ── 3. Datos del sistema anterior ───────────────────────────────────────────

test("cuenta corriente: dos cuentas del mismo cliente escritas distinto (sin fusionar) no se mezclan los movimientos ni se ofrecen «corregir» el saldo con la suma de las dos", async () => {
  const seed = buildSeed();
  const [ccId, cc] = cuentasDe(seed, TREBOL)[0];
  // Segunda cuenta del mismo cliente, abierta con el sistema anterior desde una ficha repetida.
  seed.cuentas_corrientes.cc_repetida = { nombre: "CARNICERIA EL TREBOL", saldo: 120000, creadoEn: "2026-09-01T12:00:00.000Z", ultimoMovimiento: "2026-11-06" };
  seed.cc_movimientos.ccm_repetida = {
    cliente: "CARNICERIA EL TREBOL", tipo: "pedido", monto: 120000, movimiento: 120000, fecha: "2026-11-06",
    detalle: "Cargo de la cuenta repetida", obs: "Remito N° 0900", origen: "remito", remitoNro: 900, createdAt: "2026-11-06T14:00:00.000Z",
  };
  const fmt = (n) => "$" + n.toLocaleString("es-AR");
  const h = await abrir(seed, "director");
  try {
    await abrirCC(h);
    assert.equal((await tarjetaCC(h, TREBOL).locator("[data-saldo]").innerText()).trim(), fmt(cc.saldo));
    assert.equal((await tarjetaCC(h, "CARNICERIA EL TREBOL").locator("[data-saldo]").innerText()).trim(), "$120.000");

    await tarjetaCC(h, TREBOL).locator("button", { hasText: "Ver movimientos" }).click();
    await h.page.locator("[data-estado-saldo]").waitFor(); // terminó de cargar
    assert.equal((await h.page.locator("[data-saldo-detalle]").innerText()).trim(), fmt(cc.saldo), "el detalle de una cuenta suma solo SUS movimientos (antes sumaba también los $120.000 de la otra)");
    assert.equal(await h.page.getByText("Cargo de la cuenta repetida").count(), 0, "el cargo de la otra cuenta no aparece acá");
    assert.equal(await h.page.locator('[data-aviso="saldo-distinto"]').count(), 0, "no ofrece «corregir» un saldo que está bien (aceptarlo dejaba la deuda contada dos veces)");

    await h.page.locator(".chapa", { hasText: "Cuenta corriente" }).locator("button", { hasText: "←" }).click();
    await h.page.getByText("Deuda total").waitFor();
    await tarjetaCC(h, "CARNICERIA EL TREBOL").locator("button", { hasText: "Ver movimientos" }).click();
    await h.page.getByText("Cargo de la cuenta repetida").waitFor();
    assert.equal((await h.page.locator("[data-saldo-detalle]").innerText()).trim(), "$120.000");
    assert.equal(await h.page.locator('[data-aviso="saldo-distinto"]').count(), 0);
    assert.equal((await h.doc("cuentas_corrientes/" + ccId)).saldo, cc.saldo);
  } finally {
    await h.close();
  }
});

test("remito: un pedido a nombre de una cuenta fusionada por la migración se carga en la cuenta principal, no en una cuenta nueva", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = pedidoDe(seed, DISTRI, (p) => p.estado === "listo");
  const [ccId, cc] = cuentasDe(seed, DISTRI)[0];
  const [cliId] = entradas(seed.clientes).find(([, c]) => c.nombre === DISTRI);
  const precios = ultimosPrecios(seed, DISTRI);
  // La migración juntó "… S.R.L" (sin el punto final) con "… S.R.L.": la segunda cuenta quedó
  // fusionada en la principal, y las dos con el clienteId del cliente.
  const SIN_PUNTO = DISTRI.replace(/\.$/, "");
  cc.clienteId = cliId;
  seed.cuentas_corrientes.cc_sin_punto = { nombre: SIN_PUNTO, saldo: 0, mergedInto: ccId, clienteId: cliId, creadoEn: "2026-09-01T12:00:00.000Z", ultimoMovimiento: "2026-09-01" };
  // El pedido quedó cargado con el nombre de la ficha fusionada. Sus precios están con ese nombre.
  pedido.cliente = SIN_PUNTO;
  for (const m of valores(seed.cc_movimientos)) if (m.cliente === DISTRI && m.monto === 0 && m.fecha === pedido.fechaEntrega) m.cliente = SIN_PUNTO;
  let n = 0;
  for (const [producto, precio] of entradas(precios)) seed.precios_cliente["pre_sin_punto_" + n++] = { cliente: SIN_PUNTO, producto, precio, fecha: "2026-11-09T12:00:00.000Z" };
  const total = Math.round(totalEsperado(pedido, precios));
  assert.ok(total > 0);
  const h = await abrir(seed, "comercial");
  try {
    await abrirRemito(h, SIN_PUNTO);
    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 guardado").waitFor();
    const db = await h.dump();
    assert.equal(remitosDe(db, pedidoId).length, 1);
    assert.deepEqual(Object.keys(db.cuentas_corrientes).sort(), Object.keys(seed.cuentas_corrientes).sort(), "no se abrió ninguna cuenta nueva (antes se abría una tercera, aparte de la principal)");
    assert.equal(db.cuentas_corrientes[ccId].saldo, cc.saldo + total, "el remito quedó cargado en la cuenta principal");
    assert.equal(db.cuentas_corrientes.cc_sin_punto.saldo, 0, "la cuenta fusionada no se toca");
    assert.equal(valores(db.cc_movimientos).filter((m) => m.remitoNro === 40 && m.monto === total).length, 1, "un solo cargo");
  } finally {
    await h.close();
  }
});

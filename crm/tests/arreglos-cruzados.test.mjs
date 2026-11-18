// Arreglos "cruzados" de Pedidos: lo que cada auditoría anotó en "Pendiente en otros
// archivos" (docs/auditoria/cruzados.md). Cada prueba maneja la pantalla real como una
// persona con el iPhone y después mira qué quedó guardado en Firestore y qué se ve.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const HOY = "2026-11-10";

const ANGEL = "Fiambrería Don Ángel";
const TREBOL = "Carnicería El Trébol";
const DISTRI = "Distribuidora Mayorista del Sur S.R.L.";
const DAGOSTINO = "Almacén D'Agostino";
const ROSA = "Almacén Doña Rosa";
const NATA = "Fiambrería La Ñata";
const GAMAS_CABALLITO = "Panificadora Gamas - Sucursal Caballito";
const DEMOS = ["Supermercado Don Juan", "Carnicería El Gaucho", "Rotisería La Porteña", "Distribuidora Río de la Plata", "Restaurant El Fogón",
  "Carnicería San Martín", "Almacén Central", "Distribuidora Norte", "Hotel Castelar"];

const VISTAS = {
  comercial: "Cargar y gestionar pedidos",
  director: "Panel general y cuentas corrientes",
  deposito: "Ver pedidos a preparar y despachar",
  clientes: "Agregar, editar y eliminar clientes",
};

// ── Ayudas ──────────────────────────────────────────────────────────────────
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const r2 = (n) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
const pesos = (n) => (n < 0 ? "-$" : "$") + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const valores = (o) => Object.values(o || {});
const entradas = (o) => Object.entries(o || {});
const nuevos = (db, seed, col) => entradas(db[col]).filter(([id]) => !(id in (seed[col] || {}))).map(([id, d]) => ({ id, ...d }));
const cuentaDe = (db, nombre) => entradas(db.cuentas_corrientes).filter(([, c]) => norm(c.nombre) === norm(nombre)).map(([id, c]) => ({ id, ...c }));
const pedidoDe = (seed, cliente, filtro = () => true) => entradas(seed.pedidos).find(([, p]) => p.cliente === cliente && filtro(p));
const esPendiente = (m) => m.tipo === "pedido" && m.origen === "pedido_app" && m.monto === 0 && m.remitoNro == null;
const pendientesDe = (db, nombre) => entradas(db.cc_movimientos).filter(([, m]) => norm(m.cliente) === norm(nombre) && esPendiente(m)).map(([id, m]) => ({ id, ...m }));
/** El «Pendiente de facturar» que dejó el alta de un pedido (el de su fecha de entrega). */
const pendienteDe = (db, pedido, nombre = pedido.cliente) => pendientesDe(db, nombre).find((m) => m.fecha === pedido.fechaEntrega);
// Un 409 de Firestore es una transacción que chocó con otra y que el SDK reintenta solo.
// La pestaña en blanco que se abre para simular el segundo teléfono no tiene sessionStorage: es ruido del arnés.
const erroresDePantalla = (errores) => erroresReales(errores).filter((e) => !/status of 409/.test(e.texto) && e.url !== "about:blank");

async function abrir(seed, vista, opts = {}) {
  const h = await launch({ rol: "director", etiqueta: "cz", seed, ...opts });
  try {
    await h.ir("pedidos.html");
    await h.sincronizar();
    await entrar(h, vista);
  } catch (e) {
    await h.close(); // si la página no llegó a abrir, que no quede el navegador colgado
    throw e;
  }
  return h;
}
async function entrar(h, vista, p = h.page) {
  await p.getByText("¿Quién sos?").waitFor();
  if (!vista) return;
  await p.locator("button", { hasText: VISTAS[vista] }).click();
  if (vista === "comercial") await p.getByText(/Activos \(\d+\)/).waitFor();
  if (vista === "director") await p.getByText("Activos", { exact: true }).first().waitFor();
  if (vista === "clientes") await p.getByText(/Clientes registrados \(\d+\)/).waitFor();
}
const boton = (h, t, p = h.page) => p.locator("button", { hasText: t });
const toast = (h, t, p = h.page) => p.locator(".ss-toast", { hasText: t });
const hoja = (h, p = h.page) => p.locator(".ss-hoja");
const botonHoja = (h, t, p = h.page) => p.locator(".ss-hoja .ss-btn", { hasText: t });
const precioInputs = (h) => h.page.locator('input[placeholder="$ / kg"]');

async function hastaQue(h, cond, que, ms = 20000) {
  const fin = Date.now() + ms;
  let db = null;
  while (Date.now() < fin) {
    db = await h.dump();
    if (cond(db)) return db;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("La base no llegó al estado esperado: " + que);
}

/** Comercial → tocar la tarjeta del cliente → ✏️ y esperar a que el formulario tenga elegido al cliente. */
async function abrirEdicion(h, nombreEnTarjeta, clienteElegido = nombreEnTarjeta) {
  await h.page.locator("span", { hasText: nombreEnTarjeta }).first().click();
  await boton(h, "✏️").click();
  await h.page.getByText("Editar Pedido").waitFor();
  await h.page.waitForFunction((nombre) => document.querySelector("select").value === nombre, clienteElegido);
}
const guardarEdicion = (h) => boton(h, "✓ Guardar Cambios").click();
/** Comercial → tarjeta → «🧾 Remito», con número y precios cargados. */
async function abrirRemito(h, cliente) {
  await h.page.locator("span", { hasText: cliente }).first().click();
  await boton(h, "🧾 Remito").click();
  await h.page.getByText("Remito — " + cliente).waitFor();
  await h.page.waitForFunction(() => {
    const i = document.querySelector('input[aria-label="Número de remito"]');
    return i && i.value !== "";
  });
  await h.page.waitForFunction(() => [...document.querySelectorAll('input[placeholder="$ / kg"]')].some((i) => i.value !== ""));
}
async function cancelarPedido(h, cliente) {
  await h.page.locator("span", { hasText: cliente }).first().click();
  await boton(h, "❌").click();
  await botonHoja(h, "Cancelar pedido").click();
}
const kgDe = (it) => (it.kgReal != null && it.kgReal !== "" ? Number(it.kgReal) : parseFloat(it.cantidad) || 0);

// Venta rápida (Director)
async function ventaRapida(h, cliente, { producto, cantidad, precio }, p = h.page) {
  await p.locator("#btn-venta-rapida").click();
  await p.getByText("Registrar en cuenta corriente").waitFor();
  await p.locator('select[aria-label="Cliente de la venta"]').selectOption({ label: cliente });
  await p.locator('input[placeholder="Producto"]').first().fill(producto);
  await p.locator('input[placeholder="Cant."]').first().fill(String(cantidad));
  await p.locator('input[placeholder="Precio"]').first().fill(String(precio));
  await boton(h, "Registrar venta", p).click();
}

// ── Clientes de demostración ────────────────────────────────────────────────

test("nuevo pedido y editar pedido: se ofrecen solo los clientes cargados, no los nombres de demostración del código", async () => {
  const seed = buildSeed();
  const reales = valores(seed.clientes).map((c) => c.nombre);
  for (const d of DEMOS) assert.ok(!reales.includes(d), "la base de ejemplo no tiene a " + d);
  const h = await abrir(seed, "comercial");
  try {
    // Nuevo pedido: la lista son los clientes de la base y «Otro».
    await boton(h, "+ Nuevo").click();
    await h.page.getByText("Nuevo Pedido").waitFor();
    await h.page.locator("button", { hasText: "Seleccioná un cliente" }).click();
    await h.page.locator("button", { hasText: NATA }).waitFor();
    const ofrecidos = await h.page.evaluate(() => {
      const lista = document.querySelector('input[placeholder="Buscar cliente..."]').parentElement.nextElementSibling;
      return [...lista.querySelectorAll("button")].map((b) => b.innerText.trim());
    });
    assert.deepEqual([...ofrecidos].sort(), [...reales, "➕ Otro (cliente nuevo)"].sort(), "exactamente los clientes de la base y «Otro»");
    await h.page.getByPlaceholder("Buscar cliente...").fill("Hotel");
    await h.page.waitForFunction(() => {
      const lista = document.querySelector('input[placeholder="Buscar cliente..."]').parentElement.nextElementSibling;
      return lista.querySelectorAll("button").length === 1;
    });
    assert.equal(await h.page.getByText("Hotel Castelar").count(), 0);
    await h.page.locator("button", { hasText: "Otro (cliente nuevo)" }).click();
    await h.page.locator('button[aria-label="Volver"]').click();
    await h.page.getByText(/Activos \(\d+\)/).waitFor();

    // Editar pedido: lo mismo.
    await abrirEdicion(h, ROSA);
    const opciones = await h.page.locator("select").first().evaluate((s) => [...s.options].map((o) => o.value).filter(Boolean));
    assert.deepEqual([...opciones].sort(), [...reales, "Otro"].sort());
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Editar pedido ───────────────────────────────────────────────────────────

test("editar pedido: una fila a medio cargar frena el guardado en vez de perderse sin aviso", async () => {
  const seed = buildSeed();
  const [id, pedido] = pedidoDe(seed, ROSA, (p) => p.estado === "pendiente");
  const h = await abrir(seed, "comercial");
  try {
    await abrirEdicion(h, ROSA);
    // Se agrega un producto desde el buscador y no se le pone cantidad.
    await h.page.getByPlaceholder("Buscar producto y agregarlo...").fill("tybo");
    await boton(h, "Queso Tybo").first().click();
    const n = pedido.items.length;
    await h.page.getByPlaceholder("Cantidad").nth(n).waitFor();
    await guardarEdicion(h);
    await toast(h, `Al ítem ${n + 1} (Queso Tybo) le falta la cantidad`).waitFor();
    let guardado = await h.doc("pedidos/" + id);
    assert.equal(guardado.items.length, n, "no se guardó el pedido sin el producto nuevo");
    assert.equal(guardado.editadoEn, undefined);
    assert.equal(await h.page.getByText("Editar Pedido").count(), 1, "el formulario sigue abierto con lo escrito");

    await h.page.getByPlaceholder("Cantidad").nth(n).fill("0");
    await guardarEdicion(h);
    await toast(h, `La cantidad del ítem ${n + 1} (Queso Tybo) tiene que ser mayor a 0`).waitFor();
    assert.equal((await h.doc("pedidos/" + id)).items.length, n);

    await h.page.getByPlaceholder("Cantidad").nth(n).fill("2.5");
    await guardarEdicion(h);
    await toast(h, "Pedido actualizado").waitFor();
    guardado = await h.doc("pedidos/" + id);
    assert.equal(guardado.items.length, n + 1);
    assert.deepEqual(guardado.items.slice(0, n), pedido.items, "los ítems anteriores quedan igual");
    const nuevo = guardado.items[n];
    assert.equal(nuevo.producto, "Queso Tybo");
    assert.equal(nuevo.cantidad, "2.5", "la cantidad se sigue guardando como texto");
    assert.equal(nuevo.unidad, "kg");
    assert.equal(nuevo.categoria, "Quesos");
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("editar pedido: reconoce al cliente aunque el pedido lo tenga con otras mayúsculas y sin acentos, y lo guarda con el nombre de la ficha", async () => {
  const seed = buildSeed();
  const [id, pedido] = pedidoDe(seed, ANGEL, (p) => p.estado === "pendiente");
  pedido.cliente = "FIAMBRERIA  DON ANGEL"; // como lo pudo haber escrito alguien con «Otro»
  const movsAntes = Object.keys(seed.cc_movimientos).length;
  const saldoAntes = cuentaDe(seed, ANGEL)[0].saldo;
  assert.equal(pendientesDe(seed, ANGEL).length, 1, "el pedido tiene su «Pendiente de facturar» en la cuenta");
  const h = await abrir(seed, "comercial");
  try {
    // El cliente queda elegido en la lista (antes aparecía como «Otro», con el nombre para corregir a mano).
    await abrirEdicion(h, "FIAMBRERIA", ANGEL);
    assert.equal(await h.page.getByPlaceholder("Nombre del cliente").count(), 0);
    await h.page.getByPlaceholder("Notas sobre el pedido, horario de entrega, etc.").fill("Tocar timbre");
    await guardarEdicion(h);
    await toast(h, "Pedido actualizado").waitFor();
    const db = await h.dump();
    assert.equal(db.pedidos[id].cliente, ANGEL);
    assert.equal(db.pedidos[id].obs, "Tocar timbre");
    // Es el mismo cliente: la cuenta corriente no se toca.
    assert.equal(Object.keys(db.cc_movimientos).length, movsAntes);
    assert.equal(pendientesDe(db, ANGEL).length, 1);
    assert.equal(cuentaDe(db, ANGEL)[0].saldo, saldoAntes);
    await h.page.locator("span", { hasText: ANGEL }).first().waitFor(); // la tarjeta ya muestra el nombre de la ficha
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("editar pedido: al pasarlo a otro cliente, el «Pendiente de facturar» sale de una cuenta y entra en la otra sin mover saldos", async () => {
  const seed = buildSeed();
  const [id, pedido] = pedidoDe(seed, ANGEL, (p) => p.estado === "pendiente");
  const pendViejo = pendienteDe(seed, pedido);
  assert.ok(pendViejo && !pendViejo.pedidoId, "pendiente cargado antes de que se guardara pedidoId");
  const ctaAngel = cuentaDe(seed, ANGEL)[0], ctaTrebol = cuentaDe(seed, TREBOL)[0];
  const pendTrebolAntes = pendientesDe(seed, TREBOL).length;
  const movsAntes = Object.keys(seed.cc_movimientos).length;
  const h = await abrir(seed, "comercial");
  try {
    await abrirEdicion(h, ANGEL);
    await h.page.locator("select").first().selectOption(TREBOL);
    await boton(h, "✓ Guardar Cambios").dblclick(); // doble toque: una sola vez
    await toast(h, "Pedido actualizado").waitFor();
    const db = await hastaQue(h, (d) => pendientesDe(d, TREBOL).length === pendTrebolAntes + 1, "pendiente en la cuenta nueva");
    assert.equal(db.pedidos[id].cliente, TREBOL);
    assert.equal(db.cc_movimientos[pendViejo.id], undefined, "el pendiente salió de la cuenta de " + ANGEL);
    assert.equal(pendientesDe(db, ANGEL).length, 0);
    const pend = pendientesDe(db, TREBOL).find((m) => m.pedidoId === id);
    assert.ok(pend, "el pendiente nuevo queda atado al pedido");
    assert.equal(pend.cliente, TREBOL);
    assert.equal(pend.fecha, pedido.fechaEntrega);
    assert.equal(pend.detalle, pedido.items.map((it) => it.producto).join(", "));
    assert.equal(pend.obs, "Pendiente de facturar");
    assert.equal(pend.movimiento, 0);
    assert.equal(Object.keys(db.cc_movimientos).length, movsAntes, "uno menos y uno más");
    // Ningún saldo cambió, ni la fecha de último movimiento.
    assert.equal(db.cuentas_corrientes[ctaAngel.id].saldo, ctaAngel.saldo);
    assert.equal(db.cuentas_corrientes[ctaTrebol.id].saldo, ctaTrebol.saldo);
    assert.equal(db.cuentas_corrientes[ctaTrebol.id].ultimoMovimiento, ctaTrebol.ultimoMovimiento);
    assert.equal(Object.keys(db.cuentas_corrientes).length, Object.keys(seed.cuentas_corrientes).length);
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("pedido con remito: no se puede pasar a otro cliente (el cargo quedaría en otra cuenta), y cancelarlo no toca el cargo", async () => {
  const seed = buildSeed();
  const [id] = pedidoDe(seed, DISTRI, (p) => p.estado === "listo");
  const ctaDistri = cuentaDe(seed, DISTRI)[0], ctaTrebol = cuentaDe(seed, TREBOL)[0];
  const h = await abrir(seed, "comercial");
  try {
    await abrirRemito(h, DISTRI);
    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 guardado").waitFor();
    let db = await h.dump();
    const cargo = entradas(db.cc_movimientos).find(([, m]) => m.pedidoId === id || m.remitoNro === 40);
    assert.ok(cargo && cargo[1].monto > 0, "el remito cargó la cuenta");
    const saldoConRemito = db.cuentas_corrientes[ctaDistri.id].saldo;
    assert.equal(saldoConRemito, ctaDistri.saldo + cargo[1].monto);
    await h.page.locator("button", { hasText: "←" }).click();
    await h.page.getByText(/Activos \(\d+\)/).waitFor();

    // Editar y cambiar el cliente: se frena con un aviso claro y no se guarda nada.
    await abrirEdicion(h, DISTRI);
    await h.page.locator("select").first().selectOption(TREBOL);
    await guardarEdicion(h);
    await toast(h, "Este pedido ya tiene el Remito N° 0040 a nombre de " + DISTRI).waitFor();
    db = await h.dump();
    assert.equal(db.pedidos[id].cliente, DISTRI);
    assert.equal(db.pedidos[id].editadoEn, undefined);
    assert.equal(db.remitos["ped_" + id].cliente, DISTRI);
    assert.deepEqual(db.cc_movimientos[cargo[0]], cargo[1]);
    assert.equal(db.cuentas_corrientes[ctaTrebol.id].saldo, ctaTrebol.saldo);
    // Con el mismo cliente sí se puede seguir editando.
    await h.page.locator("select").first().selectOption(DISTRI);
    await h.page.getByPlaceholder("Notas sobre el pedido, horario de entrega, etc.").fill("Entra por Luzuriaga");
    await guardarEdicion(h);
    await toast(h, "Pedido actualizado").waitFor();
    assert.equal((await h.doc("pedidos/" + id)).obs, "Entra por Luzuriaga");

    // Cancelar un pedido que ya tiene remito: el cargo y el saldo quedan como están.
    await h.page.getByText(/Activos \(\d+\)/).waitFor();
    await cancelarPedido(h, DISTRI);
    db = await hastaQue(h, (d) => d.pedidos[id].estado === "cancelado", "pedido cancelado");
    await h.page.getByText(/Historial \(\d+\)/).waitFor();
    db = await h.dump();
    assert.equal(db.cc_movimientos[cargo[0]].monto, cargo[1].monto);
    assert.equal(db.cuentas_corrientes[ctaDistri.id].saldo, saldoConRemito);
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Cancelar ────────────────────────────────────────────────────────────────

test("cancelar un pedido sin remito saca su «Pendiente de facturar» de la cuenta corriente (y solo el suyo)", async () => {
  const seed = buildSeed();
  const [idAngel, pedAngel] = pedidoDe(seed, ANGEL, (p) => p.estado === "pendiente");
  const [idDago, pedDago] = pedidoDe(seed, DAGOSTINO, (p) => p.estado === "pendiente");
  const pendAngel = pendienteDe(seed, pedAngel);
  const pendDago = pendienteDe(seed, pedDago);
  assert.ok(pendAngel && pendDago, "los dos pedidos tienen su pendiente");
  // El de D'Agostino es de los nuevos: atado al pedido con pedidoId (y con un detalle que ya no coincide con los productos).
  seed.cc_movimientos[pendDago.id].pedidoId = idDago;
  seed.cc_movimientos[pendDago.id].detalle = pedDago.items[0].producto;
  const otros = entradas(seed.cc_movimientos).filter(([mid, m]) => esPendiente(m) && mid !== pendAngel.id && mid !== pendDago.id).map(([mid]) => mid);
  assert.ok(otros.length >= 3, "hay pendientes de otros pedidos que no se tienen que tocar");
  const saldos = Object.fromEntries(entradas(seed.cuentas_corrientes).map(([cid, c]) => [cid, c.saldo]));
  const movsAntes = Object.keys(seed.cc_movimientos).length;
  const h = await abrir(seed, "comercial");
  try {
    await cancelarPedido(h, ANGEL);
    let db = await hastaQue(h, (d) => d.pedidos[idAngel].estado === "cancelado" && !d.cc_movimientos[pendAngel.id], "pendiente de Ángel quitado");
    await hoja(h).waitFor({ state: "detached" });
    await cancelarPedido(h, DAGOSTINO);
    db = await hastaQue(h, (d) => d.pedidos[idDago].estado === "cancelado" && !d.cc_movimientos[pendDago.id], "pendiente de D'Agostino quitado");
    assert.equal(Object.keys(db.cc_movimientos).length, movsAntes - 2, "se fueron solo esos dos renglones");
    for (const mid of otros) assert.ok(db.cc_movimientos[mid], "sigue el pendiente " + mid);
    assert.deepEqual(Object.fromEntries(entradas(db.cuentas_corrientes).map(([cid, c]) => [cid, c.saldo])), saldos, "ningún saldo cambió");

    // En la cuenta de Ángel ya no figura el renglón de $0.
    await h.page.locator("button", { hasText: "←" }).click();
    await entrar(h, "director");
    await boton(h, "💳 CC").click();
    await h.page.getByText("Deuda total").waitFor();
    await h.page.locator("div", { has: h.page.getByText(ANGEL, { exact: true }) }).filter({ has: boton(h, "Ver movimientos") }).last().locator("button", { hasText: "Ver movimientos" }).click();
    await h.page.getByText(/Movimientos \(\d+\)/).waitFor();
    await h.page.locator("[data-estado-saldo]").waitFor();
    assert.equal(await h.page.getByText("Pendiente de facturar").count(), 0);
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("cancelar desde el Depósito (director) también saca el «Pendiente de facturar»", async () => {
  const seed = buildSeed();
  const [id, pedido] = pedidoDe(seed, GAMAS_CABALLITO, (p) => p.estado === "pendiente");
  const pend = pendienteDe(seed, pedido);
  assert.ok(pend);
  const pendientesAntes = pendientesDe(seed, GAMAS_CABALLITO).length;
  const saldo = cuentaDe(seed, GAMAS_CABALLITO)[0].saldo;
  const h = await abrir(seed, "deposito");
  try {
    await h.page.locator("span", { hasText: GAMAS_CABALLITO }).first().waitFor();
    await cancelarPedido(h, GAMAS_CABALLITO);
    const db = await hastaQue(h, (d) => d.pedidos[id].estado === "cancelado" && !d.cc_movimientos[pend.id], "pendiente quitado");
    assert.equal(cuentaDe(db, GAMAS_CABALLITO)[0].saldo, saldo);
    assert.equal(pendientesDe(db, GAMAS_CABALLITO).length, pendientesAntes - 1, "el pendiente de otro pedido del mismo cliente sigue");
    assert.equal(Object.keys(db.cc_movimientos).length, Object.keys(seed.cc_movimientos).length - 1);
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Remito ──────────────────────────────────────────────────────────────────

test("remito: si al pedido le cambiaron la fecha de entrega, el cargo queda con la fecha nueva (y sigue siendo un solo movimiento)", async () => {
  const seed = buildSeed();
  const [id, pedido] = pedidoDe(seed, DISTRI, (p) => p.estado === "listo");
  const pend = pendienteDe(seed, pedido);
  assert.equal(pend.fecha, HOY);
  seed.cc_movimientos[pend.id].pedidoId = id; // como lo deja hoy el alta del pedido
  const cta = cuentaDe(seed, DISTRI)[0];
  const movsAntes = Object.keys(seed.cc_movimientos).length;
  const NUEVA = "2026-11-12";
  const h = await abrir(seed, "comercial");
  try {
    await abrirEdicion(h, DISTRI);
    await h.page.locator('input[type="date"]').fill(NUEVA);
    await guardarEdicion(h);
    await toast(h, "Pedido actualizado").waitFor();
    assert.equal((await h.doc("pedidos/" + id)).fechaEntrega, NUEVA);
    await h.page.getByText(/Activos \(\d+\)/).waitFor();

    await abrirRemito(h, DISTRI);
    await h.page.getByText("Entrega: 12/11/2026").waitFor();
    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 guardado").waitFor();
    const db = await h.dump();
    const remito = db.remitos["ped_" + id];
    assert.equal(remito.fecha, HOY, "fecha de emisión: hoy");
    assert.equal(remito.fechaEntrega, NUEVA);
    const esperado = r2(pedido.items.reduce((s, it, i) => s + r2(kgDe(it) * remito.items[i].precio), 0));
    assert.equal(remito.total, esperado);
    const cargo = db.cc_movimientos[pend.id];
    assert.equal(cargo.monto, Math.round(esperado), "el pendiente pasó a ser el cargo");
    assert.equal(cargo.remitoNro, 40);
    assert.equal(cargo.fecha, NUEVA, "con la fecha de entrega que el pedido tiene ahora, no la del alta");
    assert.equal(Object.keys(db.cc_movimientos).length, movsAntes, "no se creó otro movimiento");
    assert.equal(db.cuentas_corrientes[cta.id].saldo, cta.saldo + Math.round(esperado));
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("remito e historial de precios: vale el último precio del cliente aunque esté guardado con otra forma del nombre o con la fecha como Timestamp", async () => {
  const seed = buildSeed();
  const [id, pedido] = pedidoDe(seed, DISTRI, (p) => p.estado === "listo");
  const [p0, p1] = pedido.items.map((it) => it.producto);
  const viejos = {};
  valores(seed.precios_cliente).filter((p) => p.cliente === DISTRI).sort((a, b) => b.fecha.localeCompare(a.fecha)).forEach((p) => { if (!(p.producto in viejos)) viejos[p.producto] = p.precio; });
  assert.ok(viejos[p0] > 0 && viejos[p1] > 0 && viejos[p0] !== 12345 && viejos[p1] !== 6789, "los dos productos ya tenían precio");
  // Un remito de un pedido cargado como "DISTRIBUIDORA MAYORISTA DEL SUR S.R.L." dejó el último precio con ese nombre…
  seed.precios_cliente.cz_variante = { cliente: "DISTRIBUIDORA MAYORISTA DEL SUR S.R.L.", producto: p0, precio: 12345, fecha: "2026-11-10T12:00:00.000Z" };
  // …y otro precio quedó con la fecha guardada como Timestamp (carga vieja o importada).
  seed.precios_cliente.cz_timestamp = { cliente: DISTRI, producto: p1, precio: 6789, fecha: { __ts: "2026-11-10T12:30:00.000Z" } };
  const cta = cuentaDe(seed, DISTRI)[0];
  const h = await abrir(seed, "comercial");
  try {
    await abrirRemito(h, DISTRI);
    // (Con la máquina muy cargada, la lista completa de precios puede tardar en llegar al teléfono.)
    await h.page.waitForFunction(() => document.querySelectorAll('input[placeholder="$ / kg"]')[0].value === "12.345", null, { timeout: 90000 });
    assert.equal(await precioInputs(h).nth(1).inputValue(), "6.789");
    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 guardado").waitFor();
    const db = await h.dump();
    const remito = db.remitos["ped_" + id];
    assert.equal(remito.items[0].precio, 12345);
    assert.equal(remito.items[1].precio, 6789);
    const esperado = r2(pedido.items.reduce((s, it, i) => s + r2(kgDe(it) * remito.items[i].precio), 0));
    assert.equal(remito.total, esperado);
    assert.equal(remito.items[0].total, r2(kgDe(pedido.items[0]) * 12345));
    const cargo = valores(db.cc_movimientos).find((m) => m.remitoNro === 40);
    assert.equal(cargo.monto, Math.round(esperado));
    assert.equal(db.cuentas_corrientes[cta.id].saldo, cta.saldo + Math.round(esperado), "la cuenta se cargó con los precios vigentes");

    // Clientes → 📈: el historial del cliente muestra el mismo precio vigente que usó el remito.
    await h.page.locator("button", { hasText: "←" }).click();
    await h.page.getByText(/Activos \(\d+\)/).waitFor();
    await boton(h, "👥").click();
    await h.page.getByText(/Clientes registrados \(\d+\)/).waitFor();
    await h.page.locator("div", { has: h.page.getByText(DISTRI, { exact: true }) }).filter({ has: boton(h, "📈") }).last().locator("button", { hasText: "📈" }).click();
    const tarjeta = h.page.locator("div", { has: h.page.getByText(p0, { exact: true }) }).filter({ hasText: "Tocá para editar" }).filter({ hasText: "/kg" }).last();
    await tarjeta.waitFor();
    await tarjeta.getByText("$12.345/kg").first().waitFor();
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Cuenta corriente nueva ──────────────────────────────────────────────────

test("cuenta nueva: dos teléfonos que le venden a la vez a un cliente sin cuenta abren UNA sola cuenta, con las dos ventas", async () => {
  const seed = buildSeed();
  assert.equal(cuentaDe(seed, NATA).length, 0, "la base de ejemplo no trae cuenta para este cliente");
  const h = await abrir(seed, "director");
  try {
    const p2 = await h.context.newPage();
    await h.ir("pedidos.html", p2);
    await h.sincronizar(p2);
    await entrar(h, "director", p2);

    // Los dos cargan la venta y los dos ven que el cliente no tiene cuenta.
    await ventaRapida(h, NATA, { producto: "Queso Cremoso", cantidad: 2, precio: 8000 });
    await ventaRapida(h, NATA, { producto: "Mortadela Bologna", cantidad: 3, precio: 5000 }, p2);
    await hoja(h).getByText(NATA + " no tiene cuenta corriente").waitFor();
    await hoja(h, p2).getByText(NATA + " no tiene cuenta corriente").waitFor();
    // Y los dos confirman al mismo tiempo.
    await Promise.all([botonHoja(h, "Abrir cuenta y registrar").click(), botonHoja(h, "Abrir cuenta y registrar", p2).click()]);
    await Promise.all([toast(h, "Venta de " + pesos(16000) + " registrada").waitFor(), toast(h, "Venta de " + pesos(15000) + " registrada", p2).waitFor()]);

    const db = await hastaQue(h, (d) => nuevos(d, seed, "cc_movimientos").length === 2, "las dos ventas asentadas");
    const cuentas = cuentaDe(db, NATA);
    assert.equal(cuentas.length, 1, "una sola cuenta (antes quedaban dos, cada una con una parte de la deuda)");
    assert.equal(cuentas[0].id, "cta_fiambreria_la_nata", "con el mismo id fijo que usa «+ Nueva»");
    assert.equal(cuentas[0].nombre, NATA);
    assert.equal(cuentas[0].saldo, 31000, "el saldo es la suma de las dos ventas");
    assert.equal(cuentas[0].ultimoMovimiento, HOY);
    assert.deepEqual(nuevos(db, seed, "cc_movimientos").map((m) => m.monto).sort(), [15000, 16000]);
    assert.equal(nuevos(db, seed, "pedidos").length, 2);
    assert.equal(Object.keys(db.cuentas_corrientes).length, Object.keys(seed.cuentas_corrientes).length + 1);

    // En Cuentas se ve una sola vez, con el total.
    await boton(h, "💳 CC").click();
    await h.page.getByText("Deuda total").waitFor();
    await h.page.locator(`[data-saldo="${NATA}"]`, { hasText: pesos(31000) }).waitFor();
    assert.equal(await h.page.locator(`[data-saldo="${NATA}"]`).count(), 1);
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("cuenta nueva: si el id fijo está ocupado por una cuenta fusionada, se abre otra y la fusionada no se toca", async () => {
  const seed = buildSeed();
  const fusionada = { nombre: NATA, saldo: 5000, mergedInto: cuentaDe(seed, ANGEL)[0].id, creadoEn: "2026-09-01T12:00:00.000Z", ultimoMovimiento: "2026-09-20" };
  seed.cuentas_corrientes.cta_fiambreria_la_nata = { ...fusionada };
  const h = await abrir(seed, "director");
  try {
    await ventaRapida(h, NATA, { producto: "Queso Cremoso", cantidad: 2, precio: 5000 });
    await hoja(h).getByText(NATA + " no tiene cuenta corriente").waitFor();
    await botonHoja(h, "Abrir cuenta y registrar").click();
    await toast(h, "Venta de " + pesos(10000) + " registrada (cuenta nueva)").waitFor();
    const db = await h.dump();
    assert.deepEqual(db.cuentas_corrientes.cta_fiambreria_la_nata, fusionada, "la cuenta fusionada queda igual");
    const abiertas = cuentaDe(db, NATA).filter((c) => !c.mergedInto);
    assert.equal(abiertas.length, 1);
    assert.equal(abiertas[0].saldo, 10000);
    assert.notEqual(abiertas[0].id, "cta_fiambreria_la_nata");
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Clientes y estadísticas ─────────────────────────────────────────────────

test("clientes: la marca «Cta Cte» aparece si el cliente tiene cuenta abierta, aunque la ficha no esté tildada", async () => {
  const seed = buildSeed();
  const [idTrebol, fichaTrebol] = entradas(seed.clientes).find(([, c]) => c.nombre === TREBOL);
  fichaTrebol.cuentaCorriente = false; // cuenta abierta desde Cuentas Corrientes, un remito o una venta rápida
  assert.equal(cuentaDe(seed, TREBOL).length, 1);
  assert.equal(cuentaDe(seed, NATA).length, 0);
  const h = await abrir(seed, "clientes");
  try {
    const fila = (nombre) => h.page.locator("div", { has: h.page.getByText(nombre, { exact: true }) }).filter({ has: boton(h, "📈") }).last();
    await fila(TREBOL).getByText("💳 Cta Cte").waitFor();
    assert.equal(await fila(NATA).getByText("💳 Cta Cte").count(), 0, "sin cuenta y sin tilde, no se marca");
    // Al editar la ficha, el tilde ya viene puesto.
    await h.page.locator(`button[aria-label="Editar ${TREBOL}"]`).click();
    await h.page.getByText("✏️ Editar cliente").waitFor();
    assert.equal(await h.page.locator('input[type="checkbox"]').isChecked(), true);
    assert.equal((await h.doc("clientes/" + idTrebol)).cuentaCorriente, false, "mirar la lista no escribe nada");
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("estadísticas: un cliente escrito con otras mayúsculas o sin acentos cuenta una sola vez", async () => {
  const seed = buildSeed();
  const delMes = entradas(seed.pedidos).filter(([, p]) => p.estado !== "cancelado" && (p.fechaEntrega || "").startsWith("2026-11"));
  const porCliente = {};
  delMes.forEach(([, p]) => { porCliente[p.cliente] = (porCliente[p.cliente] || 0) + 1; });
  const repetido = Object.keys(porCliente).find((c) => porCliente[c] >= 2 && norm(c) !== c.toLowerCase());
  assert.ok(repetido, "hay un cliente con acentos y dos pedidos en el mes");
  const [idVariante] = delMes.find(([, p]) => p.cliente === repetido);
  seed.pedidos[idVariante].cliente = norm(repetido).toUpperCase();
  const distintos = new Set(delMes.map(([, p]) => norm(p.cliente))).size;
  assert.equal(new Set(delMes.map(([, p]) => p.cliente)).size, distintos + 1, "con el nombre idéntico se contaría dos veces");
  const h = await abrir(seed, "director");
  try {
    await boton(h, "📊 Stats").click();
    const cifra = h.page.getByText("Clientes activos").locator("xpath=preceding-sibling::div[1]");
    await cifra.waitFor();
    assert.equal(Number(await cifra.innerText()), distintos);
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

// Arreglos de venta rápida y precios por cliente (src/pedidos/05-venta-rapida-precios.jsx).
// Cada prueba maneja la pantalla real como una persona con el iPhone y después
// mira qué quedó guardado en Firestore y qué se ve.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const NOCHE = "2026-11-10T22:30:00-03:00"; // en UTC ya es 11/11
const HOY = "2026-11-10";

const ANGEL = "Fiambrería Don Ángel";
const TREBOL = "Carnicería El Trébol";
const PEREZ = "Carnicería Los Hermanos Pérez & Hijos";
const DAGOSTINO = "Almacén D'Agostino";
const SABOR = "Rotisería El Buen Sabor";
const CAYETANO = "Fiambres y Quesos San Cayetano";

// ── Ayudas ──────────────────────────────────────────────────────────────────
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const pesos = (n) => (n < 0 ? "-$" : "$") + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const copia = (o) => JSON.parse(JSON.stringify(o));
const entradas = (o) => Object.entries(o || {});
const nuevos = (db, seed, col) => entradas(db[col]).filter(([id]) => !(id in (seed[col] || {}))).map(([id, d]) => ({ id, ...d }));
const cuentaDe = (db, nombre) => entradas(db.cuentas_corrientes).filter(([, c]) => norm(c.nombre) === norm(nombre)).map(([id, c]) => ({ id, ...c }));
// Errores de la página. Un 409 de Firestore es una transacción que chocó y que el SDK
// reintenta solo: el navegador lo anota en la consola, pero no es una falla (lo guardado se revisa aparte).
const erroresDePantalla = (errores) => erroresReales(errores).filter((e) => !/status of 409/.test(e.texto));
const sinRuidoDeRed = (errores) => erroresDePantalla(errores).filter((e) => !/offline|unavailable|Could not reach|ERR_INTERNET|Failed to fetch|WebChannel|Failed to get document/i.test(e.texto));

/** Último precio guardado de cada producto de un cliente (nombre idéntico), como lo dejó la base de ejemplo. */
function ultimosPrecios(seed, cliente) {
  const ult = {};
  for (const [id, p] of entradas(seed.precios_cliente)) {
    if (p.cliente !== cliente || typeof p.fecha !== "string") continue;
    if (!ult[p.producto] || p.fecha > ult[p.producto].fecha) ult[p.producto] = { id, ...p };
  }
  return ult;
}

/** Director → Panel. Deja la sesión en la vista del director con los datos al día. */
async function abrirDirector(seed, opts = {}) {
  const h = await launch({ rol: "director", etiqueta: "p5", seed, ...opts });
  h.seed = seed;
  await h.ir("pedidos.html");
  await h.sincronizar();
  await h.page.getByText("¿Quién sos?").waitFor();
  await h.page.locator("button", { hasText: "Panel general y cuentas corrientes" }).click();
  await h.page.getByText("Activos", { exact: true }).first().waitFor();
  return h;
}
const boton = (h, t) => h.page.locator("button", { hasText: t });
const toast = (h, t, tipo) => h.page.locator(".ss-toast" + (tipo ? ".ss-toast-" + tipo : ""), { hasText: t });
const hoja = (h) => h.page.locator(".ss-hoja");
const botonHoja = (h, t) => h.page.locator(".ss-hoja .ss-btn", { hasText: t });

async function esperarDoc(h, ruta, cond, ms = 20000) {
  const fin = Date.now() + ms;
  let ultimo = null;
  while (Date.now() < fin) {
    ultimo = await h.doc(ruta);
    if (cond(ultimo)) return ultimo;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("El documento " + ruta + " no llegó al estado esperado: " + JSON.stringify(ultimo).slice(0, 400));
}
async function esperarBase(h, cond, ms = 20000) {
  const fin = Date.now() + ms;
  let db = null;
  while (Date.now() < fin) {
    db = await h.dump();
    if (cond(db)) return db;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("La base no llegó al estado esperado");
}

// Venta rápida
const btnRegistrar = (h) => boton(h, "Registrar venta");
async function abrirVentaRapida(h, cliente) {
  await h.page.locator("#btn-venta-rapida").click();
  await h.page.getByText("Registrar en cuenta corriente").waitFor();
  if (cliente) await h.page.locator('select[aria-label="Cliente de la venta"]').selectOption({ label: cliente });
}
async function fila(h, i, { producto, cantidad, precio }) {
  if (producto != null) await h.page.locator('input[placeholder="Producto"]').nth(i).fill(producto);
  if (cantidad != null) await h.page.locator('input[placeholder="Cant."]').nth(i).fill(String(cantidad));
  if (precio != null) await h.page.locator('input[placeholder="Precio"]').nth(i).fill(String(precio));
}
const agregarFila = (h) => boton(h, "+ Agregar producto").click();
const totalVisible = (h, monto) => btnRegistrar(h).locator("xpath=..").getByText(pesos(monto), { exact: true });
const saldoEnCuentas = (h, nombre, saldo) => h.page.locator(`[data-saldo="${nombre}"]`, { hasText: pesos(saldo) });

// Precios
async function abrirPrecios(h, cliente) {
  await boton(h, "💲 Precios").click();
  await boton(h, "Exportar PDF de precios por cliente").waitFor();
  if (cliente) {
    await h.page.locator('select[aria-label="Cliente"]').selectOption({ label: cliente });
    await h.page.getByText("productos con precio acordado").waitFor();
  }
}
/** Fila de un producto en la lista de precios (el renglón que se toca para editar). */
const filaProducto = (h, producto) =>
  h.page.locator("div", { has: h.page.getByText(producto, { exact: true }) }).filter({ hasText: "›" }).last();
async function editarPrecio(h, producto, precio, { otroProducto = null, botonGuardar = /Guardar cambios|Agregar precio/ } = {}) {
  await filaProducto(h, producto).click();
  await h.page.locator('select[aria-label="Producto"]').waitFor();
  if (otroProducto) await h.page.locator('select[aria-label="Producto"]').selectOption(otroProducto);
  await h.page.locator('input[aria-label="Precio"]').fill(String(precio));
  await boton(h, botonGuardar).click();
}

/** Guarda en window.__pdfTextos todo lo que se escribe en los PDF que se generen. */
async function espiarPdf(h) {
  await h.page.evaluate(() => {
    const J = window.jspdf.jsPDF;
    window.__pdfTextos = [];
    window.jspdf.jsPDF = function (...a) {
      const d = new J(...a);
      const t = d.text;
      d.text = function (s, ...r) {
        window.__pdfTextos.push(Array.isArray(s) ? s.join(" ") : String(s));
        return t.call(d, s, ...r);
      };
      return d;
    };
  });
}

// ── Venta rápida ────────────────────────────────────────────────────────────

test("venta rápida: fecha de hoy aunque sean las 22:30, pedido + cargo + saldo juntos, y el saldo no se recalcula por nombre", async () => {
  const seed = buildSeed();
  const [idCuenta, cuenta] = entradas(seed.cuentas_corrientes).find(([, c]) => c.nombre === ANGEL);
  // Un cargo viejo escrito con otra forma del nombre: está en el saldo guardado.
  seed.cc_movimientos.p5_variante = {
    cliente: "FIAMBRERIA DON ANGEL", tipo: "pedido", monto: 50000, movimiento: 50000, fecha: "2026-11-03",
    detalle: "Carga anterior", obs: "", origen: "importado", createdAt: "2026-11-03T15:00:00.000Z",
  };
  cuenta.saldo = (cuenta.saldo || 0) + 50000;
  const saldoAntes = cuenta.saldo;
  const h = await abrirDirector(seed, { now: NOCHE });
  try {
    await abrirVentaRapida(h, ANGEL);
    await fila(h, 0, { producto: "Queso Tybo", cantidad: "2.35", precio: "8990" }); // 21.126,50
    await agregarFila(h);
    await fila(h, 1, { producto: "Mortadela Bocha", cantidad: "3", precio: "5000" });
    const monto = 36127; // 21.126,50 + 15.000 = 36.126,50 → pesos enteros
    await totalVisible(h, monto).waitFor();
    await btnRegistrar(h).click();
    await toast(h, "Venta de " + pesos(monto) + " registrada", "ok").waitFor();
    await toast(h, "Saldo de " + ANGEL + ": " + pesos(saldoAntes + monto)).waitFor();
    await btnRegistrar(h).waitFor({ state: "detached" });

    const db = await h.dump();
    const pedidos = nuevos(db, seed, "pedidos");
    const movs = nuevos(db, seed, "cc_movimientos");
    assert.equal(pedidos.length, 1, "un solo pedido nuevo");
    assert.equal(movs.length, 1, "un solo movimiento nuevo");
    const [p] = pedidos, [m] = movs;
    assert.equal(p.fechaEntrega, HOY, "la venta de las 22:30 es de hoy, no de mañana");
    assert.equal(p.cliente, ANGEL);
    assert.equal(p.origen, "venta_rapida");
    assert.equal(p.estado, "despachado");
    assert.equal(p.tipo, "retiro");
    assert.equal(p.cuentaCorriente, true);
    assert.equal(p.obs, "Venta rapida");
    assert.ok(p.fechaPedido && p.fechaPedido.__ts, "fechaPedido sigue siendo Timestamp");
    assert.equal(typeof p.fechaPedidoISO, "string");
    assert.deepEqual(p.items, [
      { producto: "Queso Tybo", cantidad: 2.35, unidad: "kg", precio: 8990, kgReal: 2.35 },
      { producto: "Mortadela Bocha", cantidad: 3, unidad: "kg", precio: 5000, kgReal: 3 },
    ]);
    assert.deepEqual(p.historial.map((x) => [x.estado, x.nota]), [["despachado", "Venta rapida"]]);

    assert.equal(m.fecha, HOY);
    assert.equal(m.tipo, "pedido");
    assert.equal(m.monto, monto);
    assert.equal(m.movimiento, monto);
    assert.equal(m.cliente, ANGEL);
    assert.equal(m.origen, "venta_rapida");
    assert.equal(m.detalle, "Queso Tybo 2.35kg, Mortadela Bocha 3kg");
    assert.equal(m.pedidoId, p.id);
    assert.equal(typeof m.createdAt, "string");
    assert.deepEqual(m.items, [
      { producto: "Queso Tybo", cantidad: 2.35, unidad: "kg", precio: 8990 },
      { producto: "Mortadela Bocha", cantidad: 3, unidad: "kg", precio: 5000 },
    ]);

    const cta = db.cuentas_corrientes[idCuenta];
    assert.equal(cta.saldo, saldoAntes + monto, "saldo guardado + venta (no una suma por nombre idéntico)");
    assert.equal(cta.ultimoMovimiento, HOY);
    assert.equal(entradas(db.cuentas_corrientes).length, entradas(seed.cuentas_corrientes).length, "no se abrió otra cuenta");

    // En Cuentas se ve el saldo nuevo.
    await boton(h, "💳 CC").click();
    await h.page.getByText("Deuda total").waitFor();
    await saldoEnCuentas(h, ANGEL, saldoAntes + monto).waitFor();
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("venta rápida sin señal: avisa, no deja nada a medias y al reintentar se carga una sola vez", async () => {
  const seed = buildSeed();
  const [idCuenta, cuenta] = entradas(seed.cuentas_corrientes).find(([, c]) => c.nombre === TREBOL);
  const saldoAntes = cuenta.saldo || 0;
  // La cuenta quedó escrita sin acentos y en mayúsculas: es el mismo cliente.
  cuenta.nombre = "CARNICERIA EL TREBOL";
  const h = await abrirDirector(seed);
  try {
    await abrirVentaRapida(h, TREBOL);
    await fila(h, 0, { producto: "Chorizo Puro Cerdo", cantidad: "10", precio: "6200" });
    await totalVisible(h, 62000).waitFor();

    await h.sinRed(true);
    await btnRegistrar(h).click();
    await toast(h, /Sin conexión|No se pudo registrar/, "error").waitFor();
    // La ventana sigue abierta con lo escrito y el botón vuelve a estar disponible.
    await h.page.locator("button:not([disabled])", { hasText: "Registrar venta" }).waitFor();
    assert.equal(await h.page.locator('input[placeholder="Producto"]').first().inputValue(), "Chorizo Puro Cerdo");
    assert.equal(await h.page.locator('input[placeholder="Cant."]').first().inputValue(), "10");

    await h.sinRed(false);
    await btnRegistrar(h).click();
    await toast(h, "Venta de " + pesos(62000) + " registrada", "ok").waitFor();
    await btnRegistrar(h).waitFor({ state: "detached" });

    const db = await esperarBase(h, (d) => nuevos(d, seed, "pedidos").length > 0);
    const pedidos = nuevos(db, seed, "pedidos");
    const movs = nuevos(db, seed, "cc_movimientos");
    assert.equal(pedidos.length, 1, "el intento sin señal no dejó un pedido suelto");
    assert.equal(movs.length, 1);
    assert.equal(movs[0].monto, 62000);
    assert.equal(movs[0].pedidoId, pedidos[0].id);
    assert.equal(pedidos[0].cliente, TREBOL);
    assert.equal(movs[0].cliente, TREBOL, "el cargo lleva el mismo nombre que el pedido");
    assert.equal(db.cuentas_corrientes[idCuenta].saldo, saldoAntes + 62000, "el saldo sube una sola vez, en la cuenta del cliente aunque su nombre esté escrito distinto");
    assert.equal(entradas(db.cuentas_corrientes).length, entradas(seed.cuentas_corrientes).length, "no se abrió otra cuenta");
    assert.deepEqual(sinRuidoDeRed(h.errores), []);
  } finally {
    await h.close();
  }
});

test("venta rápida a un cliente sin cuenta: pregunta, abre la cuenta y la deuda queda a la vista", async () => {
  const seed = buildSeed();
  assert.equal(cuentaDe(seed, SABOR).length, 0, "la base de ejemplo no trae cuenta para este cliente");
  // Una venta rápida anterior (código viejo): movimiento sin cuenta.
  seed.cc_movimientos.p5_huerfano = {
    cliente: SABOR, tipo: "pedido", monto: 12000, movimiento: 12000, fecha: "2026-11-02",
    detalle: "Pollo 4kg", obs: "", origen: "venta_rapida", createdAt: "2026-11-02T14:00:00.000Z",
  };
  const sueltos = entradas(seed.cc_movimientos).filter(([, m]) => norm(m.cliente) === norm(SABOR))
    .reduce((s, [, m]) => s + (m.tipo === "pedido" ? m.monto : -m.monto), 0);
  const h = await abrirDirector(seed);
  try {
    await abrirVentaRapida(h, SABOR);
    await fila(h, 0, { producto: "Pollo", cantidad: "5", precio: "3100" });
    await btnRegistrar(h).click();
    await hoja(h).getByText(SABOR + " no tiene cuenta corriente").waitFor();
    await botonHoja(h, "Cancelar").click();
    await hoja(h).waitFor({ state: "detached" });
    // Cancelar no guarda nada y deja la venta escrita.
    let db = await h.dump();
    assert.equal(nuevos(db, seed, "pedidos").length, 0);
    assert.equal(nuevos(db, seed, "cc_movimientos").length, 0);
    assert.equal(cuentaDe(db, SABOR).length, 0);
    assert.equal(await h.page.locator('input[placeholder="Producto"]').first().inputValue(), "Pollo");

    await btnRegistrar(h).click();
    await botonHoja(h, "Abrir cuenta y registrar").click();
    await toast(h, "Venta de " + pesos(15500) + " registrada (cuenta nueva)", "ok").waitFor();
    await btnRegistrar(h).waitFor({ state: "detached" });

    db = await h.dump();
    const cuentas = cuentaDe(db, SABOR);
    assert.equal(cuentas.length, 1, "se abrió una cuenta");
    assert.equal(cuentas[0].nombre, SABOR);
    assert.equal(cuentas[0].saldo, sueltos + 15500, "arranca con lo que ya tenía suelto más esta venta");
    assert.equal(cuentas[0].ultimoMovimiento, HOY);
    const movs = nuevos(db, seed, "cc_movimientos");
    assert.equal(movs.length, 1);
    assert.equal(movs[0].monto, 15500);
    assert.equal(movs[0].cliente, SABOR);
    assert.equal(nuevos(db, seed, "pedidos").length, 1);

    // La cuenta nueva aparece en Cuentas con su saldo.
    await boton(h, "💳 CC").click();
    await h.page.getByText("Deuda total").waitFor();
    await saldoEnCuentas(h, SABOR, sueltos + 15500).waitFor();
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("venta rápida: una fila a medias no se cobra a escondidas y un producto sin precio pide confirmación", async () => {
  const seed = buildSeed();
  const [idCuenta, cuenta] = entradas(seed.cuentas_corrientes).find(([, c]) => c.nombre === DAGOSTINO);
  const saldoAntes = cuenta.saldo || 0;
  const h = await abrirDirector(seed);
  try {
    await abrirVentaRapida(h, DAGOSTINO);
    await fila(h, 0, { producto: "Salame Tipo Milán", cantidad: "2", precio: "9000" });
    await agregarFila(h);
    await fila(h, 1, { cantidad: "3", precio: "5000" }); // sin producto
    // El total que se ve es el de lo que se va a guardar.
    await totalVisible(h, 18000).waitFor();
    await btnRegistrar(h).click();
    await toast(h, "fila 2", "error").waitFor();
    let db = await h.dump();
    assert.equal(nuevos(db, seed, "pedidos").length, 0, "con una fila a medias no se guarda");
    assert.equal(nuevos(db, seed, "cc_movimientos").length, 0);
    assert.equal(db.cuentas_corrientes[idCuenta].saldo, saldoAntes);

    await fila(h, 1, { producto: "Queso Cremoso" });
    await totalVisible(h, 33000).waitFor();
    await agregarFila(h);
    await fila(h, 2, { producto: "Queso Sardo", cantidad: "1" }); // sin precio
    await btnRegistrar(h).click();
    await hoja(h).getByText("Hay un producto sin precio").waitFor();
    await hoja(h).getByText("Queso Sardo").waitFor();
    await botonHoja(h, "Volver").click();
    await hoja(h).waitFor({ state: "detached" });
    db = await h.dump();
    assert.equal(nuevos(db, seed, "pedidos").length, 0, "«Volver» no guarda");

    await btnRegistrar(h).click();
    await botonHoja(h, "Registrar igual").click();
    await toast(h, "Venta de " + pesos(33000) + " registrada", "ok").waitFor();
    await btnRegistrar(h).waitFor({ state: "detached" });

    db = await h.dump();
    const [p] = nuevos(db, seed, "pedidos");
    const movs = nuevos(db, seed, "cc_movimientos");
    assert.equal(movs.length, 1);
    const [m] = movs;
    assert.deepEqual(m.items, [
      { producto: "Salame Tipo Milán", cantidad: 2, unidad: "kg", precio: 9000 },
      { producto: "Queso Cremoso", cantidad: 3, unidad: "kg", precio: 5000 },
      { producto: "Queso Sardo", cantidad: 1, unidad: "kg", precio: 0 },
    ]);
    assert.equal(m.monto, 33000);
    assert.equal(m.monto, Math.round(m.items.reduce((s, it) => s + it.cantidad * it.precio, 0)), "el cargo es la suma de sus renglones");
    assert.equal(Math.round(p.items.reduce((s, it) => s + it.kgReal * it.precio, 0)), m.monto, "el pedido factura lo mismo que el cargo");
    assert.equal(db.cuentas_corrientes[idCuenta].saldo, saldoAntes + 33000);
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Precios por cliente ─────────────────────────────────────────────────────

test("precios: el WhatsApp lleva la lista entera aunque el cliente tenga «&» en el nombre", async () => {
  const seed = buildSeed();
  const ult = ultimosPrecios(seed, PEREZ);
  const productos = Object.keys(ult).sort((a, b) => a.localeCompare(b, "es"));
  assert.ok(productos.length >= 3, "la base de ejemplo trae precios de este cliente");
  const h = await abrirDirector(seed);
  try {
    await abrirPrecios(h, PEREZ);
    await filaProducto(h, productos[0]).getByText(pesos(ult[productos[0]].precio), { exact: true }).waitFor();
    await boton(h, "Compartir por WA").click();
    const abiertos = await h.abiertos();
    assert.equal(abiertos.length, 1);
    const url = new URL(abiertos[0]);
    assert.equal(url.origin + url.pathname, "https://wa.me/");
    assert.deepEqual([...url.searchParams.keys()], ["text"], "el nombre con & no parte el link en dos parámetros");
    const texto = url.searchParams.get("text");
    const esperado =
      "*Lista de Precios — " + PEREZ + "*\nFrigorífico Sersale\n\n" +
      productos.map((p) => "• " + p + ": *" + pesos(ult[p].precio) + "*\n").join("") +
      "\n_Precios sujetos a cambio sin previo aviso_\n_Frigorífico Sersale · (011) 6763-7860_";
    assert.equal(texto, esperado);
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("precios: catálogo real, fecha de actualización en hora argentina, y cambiar de producto en la ventana no pisa otro precio", async () => {
  const seed = buildSeed();
  const catalogo = Object.values(seed.config.productos.categorias).flat().filter(Boolean);
  assert.ok(catalogo.includes("Bondiola Ahumada"), "producto agregado desde Productos");
  seed.precios_cliente.p5_bondiola = { cliente: CAYETANO, producto: "Bondiola Ahumada", precio: 15990, fecha: "2026-11-09T18:00:00.000Z" };
  // Un precio de un producto que ya no está en el catálogo: sale en el WhatsApp, tiene que verse.
  seed.precios_cliente.p5_viejo = { cliente: CAYETANO, producto: "Leberwurst Casero", precio: 7400, fecha: "2026-10-20T15:00:00.000Z" };
  const ult = ultimosPrecios(seed, CAYETANO);
  assert.ok(ult["Queso Sardo"], "San Cayetano tiene precio de Queso Sardo");
  assert.ok(!ult["Queso Tybo"], "y no tiene de Queso Tybo");
  const sardoAntes = entradas(seed.precios_cliente).filter(([, p]) => p.cliente === CAYETANO && p.producto === "Queso Sardo");
  const h = await abrirDirector(seed, { now: NOCHE });
  try {
    await abrirPrecios(h, CAYETANO);
    // El producto agregado al catálogo figura con su precio (antes no aparecía).
    await filaProducto(h, "Bondiola Ahumada").getByText(pesos(15990), { exact: true }).waitFor();
    const enCatalogo = Object.keys(ult).filter((p) => catalogo.includes(p)).length;
    await h.page.getByText(enCatalogo + " de " + catalogo.length + " productos con precio acordado · 1 fuera del catálogo").waitFor();
    await h.page.getByText("Fuera del catálogo", { exact: true }).waitFor();
    await filaProducto(h, "Leberwurst Casero").getByText(pesos(7400), { exact: true }).waitFor();

    // Cambiar un precio a las 22:30: queda con fecha de hoy en pantalla.
    await editarPrecio(h, "Bondiola Ahumada", "16500", { botonGuardar: "Guardar cambios" });
    await toast(h, "Precio guardado", "ok").waitFor();
    await filaProducto(h, "Bondiola Ahumada").getByText(pesos(16500), { exact: true }).waitFor();
    await filaProducto(h, "Bondiola Ahumada").getByText("Act: 10/11/2026").waitFor();
    const bondiola = await esperarDoc(h, "precios_cliente/p5_bondiola", (d) => d && d.precio === 16500);
    assert.equal(typeof bondiola.fecha, "string", "la fecha se sigue guardando como texto ISO");
    assert.match(bondiola.fecha, /^2026-11-11T01:3\d:\d\d\.\d{3}Z$/);
    assert.equal(bondiola.producto, "Bondiola Ahumada");
    assert.equal(bondiola.cliente, CAYETANO);

    // Abrir Queso Sardo, elegir Queso Tybo en la ventana y guardar: Queso Sardo no se toca.
    await editarPrecio(h, "Queso Sardo", "7777", { otroProducto: "Queso Tybo", botonGuardar: "Agregar precio" });
    await toast(h, "Precio guardado: Queso Tybo", "ok").waitFor();
    await filaProducto(h, "Queso Tybo").getByText(pesos(7777), { exact: true }).waitFor();
    await filaProducto(h, "Queso Sardo").getByText(pesos(ult["Queso Sardo"].precio), { exact: true }).waitFor();
    const db = await esperarBase(h, (d) => nuevos(d, seed, "precios_cliente").length > 0);
    for (const [id, antes] of sardoAntes) assert.deepEqual(db.precios_cliente[id], copia(antes), "el precio de Queso Sardo queda como estaba");
    const creados = nuevos(db, seed, "precios_cliente");
    assert.equal(creados.length, 1);
    assert.equal(creados[0].cliente, CAYETANO);
    assert.equal(creados[0].producto, "Queso Tybo");
    assert.equal(creados[0].precio, 7777);
    assert.equal(typeof creados[0].fecha, "string");
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("precios sin señal: no queda el botón trabado, avisa que se envía después y el precio llega a la base", async () => {
  const seed = buildSeed();
  // Documentos con formato viejo: fecha como Timestamp y precio como texto. La pantalla no se rompe.
  seed.precios_cliente.p5_ts = { cliente: TREBOL, producto: "Pollo", precio: "5500", fecha: { __ts: "2026-11-08T15:00:00.000Z" } };
  const ult = ultimosPrecios(seed, TREBOL);
  const conPrecio = Object.keys(ult)[0];
  assert.ok(conPrecio && !ult["Queso Tybo"]);
  const h = await abrirDirector(seed);
  try {
    await abrirPrecios(h, TREBOL);
    await filaProducto(h, "Pollo").getByText(pesos(5500), { exact: true }).waitFor();
    await filaProducto(h, "Pollo").getByText("Act: 08/11/2026").waitFor();

    await h.sinRed(true);
    await editarPrecio(h, conPrecio, "12340", { botonGuardar: "Guardar cambios" });
    await toast(h, "Sin señal: el precio quedó guardado en este teléfono", "info").waitFor();
    await h.page.locator('select[aria-label="Producto"]').waitFor({ state: "detached" });
    await filaProducto(h, conPrecio).getByText(pesos(12340), { exact: true }).waitFor();
    // Se puede seguir cargando: el botón no quedó en «Guardando...».
    await editarPrecio(h, "Queso Tybo", "8100", { botonGuardar: "Agregar precio" });
    await h.page.locator('select[aria-label="Producto"]').waitFor({ state: "detached" });
    await filaProducto(h, "Queso Tybo").getByText(pesos(8100), { exact: true }).waitFor();
    assert.equal((await h.doc("precios_cliente/" + ult[conPrecio].id)).precio, ult[conPrecio].precio, "sin señal todavía no llegó a la base");

    await h.sinRed(false);
    const editado = await esperarDoc(h, "precios_cliente/" + ult[conPrecio].id, (d) => d && d.precio === 12340);
    assert.equal(editado.producto, conPrecio);
    assert.equal(editado.cliente, TREBOL);
    const db = await esperarBase(h, (d) => nuevos(d, seed, "precios_cliente").length > 0);
    const creados = nuevos(db, seed, "precios_cliente");
    assert.equal(creados.length, 1);
    assert.deepEqual({ cliente: creados[0].cliente, producto: creados[0].producto, precio: creados[0].precio }, { cliente: TREBOL, producto: "Queso Tybo", precio: 8100 });
    assert.deepEqual(sinRuidoDeRed(h.errores), []);
  } finally {
    await h.close();
  }
});

test("reporte PDF: busca sin acentos, «seleccionar visibles» suma a lo elegido y junta los precios guardados con otra forma del nombre", async () => {
  const seed = buildSeed();
  // Precio guardado con el nombre escrito distinto (sin acentos, mayúsculas, doble espacio).
  seed.precios_cliente.p5_variante = { cliente: "FIAMBRERIA  DON ANGEL", producto: "Queso Sardo", precio: 11110, fecha: "2026-11-09T12:00:00.000Z" };
  const ult = ultimosPrecios(seed, ANGEL);
  assert.ok(!ult["Queso Sardo"]);
  const gamas = Object.values(seed.clientes).filter((c) => /gamas/i.test(c.nombre)).length;
  assert.equal(gamas, 3);
  const h = await abrirDirector(seed, { now: NOCHE });
  try {
    await abrirPrecios(h, ANGEL);
    // En la pestaña también se ve el precio guardado con la otra forma del nombre.
    await filaProducto(h, "Queso Sardo").getByText(pesos(11110), { exact: true }).waitFor();

    await boton(h, "Exportar PDF de precios por cliente").click();
    await h.page.getByText("Exportar Reporte").waitFor();
    const buscar = h.page.locator('input[placeholder="Buscar cliente..."]');
    await buscar.fill("don angel");
    await boton(h, ANGEL).click();
    await h.page.getByText("1 seleccionado", { exact: true }).waitFor();
    await buscar.fill("gamas");
    await boton(h, "Seleccionar todos").click();
    await h.page.getByText("4 seleccionados", { exact: true }).waitFor();

    await espiarPdf(h);
    await boton(h, "Generar PDF").click();
    await h.page.waitForFunction(() => window.__compartidos.length > 0);
    const [compartido] = await h.compartidos();
    assert.deepEqual(compartido.archivos.map((a) => [a.nombre, a.tipo]), [["Reporte de Precios - 10-11-2026.pdf", "application/pdf"]]);
    const textos = await h.page.evaluate(() => window.__pdfTextos.slice());
    assert.ok(textos.includes("Generado: 10/11/2026"));
    assert.ok(textos.includes(ANGEL));
    const i = textos.indexOf("Queso Sardo");
    assert.ok(i > 0, "el PDF trae el precio guardado con la otra forma del nombre");
    assert.equal(textos[i + 1], pesos(11110));
    for (const [producto, p] of entradas(ult)) {
      const j = textos.indexOf(producto);
      assert.ok(j > 0, "falta " + producto);
      assert.equal(textos[j + 1], pesos(p.precio), "precio vigente de " + producto);
    }
    assert.ok(!textos.some((t) => /NaN|undefined/.test(t)));
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

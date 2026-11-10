// Arreglos del panel del director, devoluciones y arranque de Pedidos
// (src/pedidos/08-director-devoluciones-app.jsx).
// Cada prueba maneja la pantalla real como una persona con el iPhone y después
// mira qué quedó guardado en Firestore y qué se ve.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const NOCHE = "2026-11-10T22:30:00-03:00"; // en UTC ya es 11/11
const HOY = "2026-11-10";

const ANGEL = "Fiambrería Don Ángel";
const PEREZ = "Carnicería Los Hermanos Pérez & Hijos";
const SABOR = "Rotisería El Buen Sabor";
const TREBOL = "Carnicería El Trébol";
const GUEMES = "Almacén y Despensa Güemes";

// ── Ayudas ──────────────────────────────────────────────────────────────────
const pesos = (n) => (n < 0 ? "-$" : "$") + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const entradas = (o) => Object.entries(o || {});
const nuevos = (db, seed, col) => entradas(db[col]).filter(([id]) => !(id in (seed[col] || {}))).map(([id, d]) => ({ id, ...d }));
// Un 409 de Firestore es una transacción que chocó y que el SDK reintenta solo: no es una falla.
const erroresDePantalla = (errores) => erroresReales(errores).filter((e) => !/status of 409/.test(e.texto));
const sinRuidoDeRed = (errores) => erroresDePantalla(errores).filter((e) => !/offline|unavailable|Could not reach|ERR_INTERNET|Failed to fetch|WebChannel|Failed to get document/i.test(e.texto));

const boton = (h, t) => h.page.locator("button", { hasText: t });
const toast = (h, t, tipo) => h.page.locator(".ss-toast" + (tipo ? ".ss-toast-" + tipo : ""), { hasText: t });
const hoja = (h) => h.page.locator(".ss-hoja");
const botonHoja = (h, t) => h.page.locator(".ss-hoja .ss-btn", { hasText: t });

/** Abre Pedidos en el inicio ("¿Quién sos?"). `antes(h)` corre antes de cargar la página. */
async function abrirInicio(seed, opts = {}) {
  const { antes, ...resto } = opts;
  const h = await launch({ rol: "director", etiqueta: "p8", seed, ...resto });
  h.seed = seed;
  if (antes) await antes(h);
  await h.ir("pedidos.html");
  await h.sincronizar();
  await h.page.getByText("¿Quién sos?").waitFor();
  return h;
}
const entrarDirector = async (h) => {
  await boton(h, "Panel general y cuentas corrientes").click();
  await h.page.getByText("Activos", { exact: true }).first().waitFor();
};
const entrarComercial = async (h) => {
  await boton(h, "Cargar y gestionar pedidos").click();
  await h.page.getByText(/^Activos \(\d+\)$/).waitFor();
};
async function abrirDirector(seed, opts = {}) {
  const h = await abrirInicio(seed, opts);
  await entrarDirector(h);
  return h;
}
const pestana = (h, nombre) => boton(h, nombre).click();
/** Espera a que lo que la página dejó en cola ya esté en el servidor. */
const escriturasAlDia = (h) =>
  h.page.evaluate(async () => {
    const m = await import("/js/fb.js");
    await m.waitForPendingWrites(m.db);
  });
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

// Devoluciones
const btnRegistrar = (h) => boton(h, "Registrar devolución");
const campoCredito = (h) => h.page.locator('input[aria-label="Crédito a favor"]');
const campoProducto = (h) => h.page.locator('input[placeholder="Ej: Jamón cocido"]');
async function abrirDevoluciones(h) {
  await pestana(h, "Devol.");
  await boton(h, "+ Nueva").waitFor();
  await h.page.getByText("Resueltas", { exact: true }).first().waitFor(); // ya cargó la lista
}
async function llenarDevolucion(h, { cliente, producto, cantidad, motivo = "Producto en mal estado", descripcion, monto }) {
  await boton(h, "+ Nueva").click();
  await h.page.getByText("Nueva Devolución").waitFor();
  await h.page.locator('select[aria-label="Cliente de la devolución"]').selectOption({ label: cliente });
  await campoProducto(h).fill(producto);
  if (cantidad != null) await h.page.locator('input[aria-label="Cantidad devuelta"]').fill(String(cantidad));
  await h.page.locator('select[aria-label="Motivo de la devolución"]').selectOption(motivo);
  if (descripcion) await h.page.locator('textarea[placeholder="Detallá el problema..."]').fill(descripcion);
  if (monto != null) await campoCredito(h).fill(String(monto));
}
/** Tarjeta de una devolución en la lista (la que muestra ese producto). */
const tarjetaDevolucion = (h, producto) => h.page.locator("strong", { hasText: producto }).locator("xpath=ancestor::div[3]");

// Alertas
/** Tarjeta de un cliente en la pestaña Alertas. */
const tarjetaAlerta = (h, cliente) => h.page.getByText(cliente, { exact: true }).locator("xpath=ancestor::div[.//input[@type='number']][1]");

// ── Devoluciones y cuenta corriente ─────────────────────────────────────────

test("devolución con crédito, de noche: queda con la fecha de hoy y el crédito se asienta junto con el saldo", async () => {
  const seed = buildSeed();
  const saldoAntes = seed.cuentas_corrientes.cc_01.saldo;
  const h = await abrirDirector(seed, { now: NOCHE });
  try {
    await abrirDevoluciones(h);
    // El selector de cliente ya no estira la página (el nombre más largo la llevaba a ~700 px)
    const ancho = await h.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(ancho[0] <= ancho[1], "la página no se pasa del ancho del teléfono: " + ancho.join(" > "));

    await llenarDevolucion(h, { cliente: ANGEL, producto: "Jamón Cocido Natural Sublime", cantidad: "2.5", monto: "15000" });
    await h.page.getByText("Se generará un crédito de " + pesos(15000) + " en la cuenta corriente de " + ANGEL).waitFor();
    await btnRegistrar(h).click();
    await toast(h, "Devolución registrada", "ok").waitFor();
    await toast(h, "saldo " + pesos(saldoAntes - 15000), "ok").waitFor();

    const db = await h.dump();
    const devs = nuevos(db, seed, "devoluciones");
    assert.equal(devs.length, 1);
    const dev = devs[0];
    assert.equal(dev.fecha, HOY, "fecha de Buenos Aires, no la de UTC");
    assert.equal(dev.cliente, ANGEL);
    assert.equal(dev.producto, "Jamón Cocido Natural Sublime");
    assert.equal(dev.cantidad, 2.5);
    assert.equal(dev.unidad, "kg");
    assert.equal(dev.monto, 15000);
    assert.equal(dev.estado, "pendiente");
    assert.equal(dev.creditoAsentado, true);

    const movs = nuevos(db, seed, "cc_movimientos");
    assert.equal(movs.length, 1);
    const mov = movs[0];
    assert.equal(mov.cliente, ANGEL);
    assert.equal(mov.tipo, "pago");
    assert.equal(mov.monto, 15000);
    assert.equal(mov.movimiento, -15000);
    assert.equal(mov.saldo, saldoAntes - 15000);
    assert.equal(mov.fecha, HOY);
    assert.equal(mov.origen, "devolucion");
    assert.equal(mov.detalle, "Crédito por devolución: Jamón Cocido Natural Sublime");
    assert.equal(mov.devolucionId, dev.id);

    assert.equal(db.cuentas_corrientes.cc_01.saldo, saldoAntes - 15000);
    assert.equal(db.cuentas_corrientes.cc_01.ultimoMovimiento, HOY);
    assert.equal(nuevos(db, seed, "cuentas_corrientes").length, 0);

    // En pantalla: la tarjeta nueva con la fecha de hoy y el crédito; el saldo en Cuentas Corrientes
    const tarjeta = tarjetaDevolucion(h, "Jamón Cocido Natural Sublime");
    await tarjeta.waitFor();
    const texto = await tarjeta.innerText();
    assert.match(texto, /10\/11\/2026/);
    assert.match(texto, /2,5 kg/);
    assert.ok(texto.includes("Crédito: " + pesos(15000)));
    await pestana(h, "💳 CC");
    await h.page.locator(`[data-saldo="${ANGEL}"]`, { hasText: pesos(saldoAntes - 15000) }).waitFor();
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("devolución: dos toques seguidos en «Registrar» guardan una sola devolución y un solo crédito", async () => {
  const seed = buildSeed();
  const saldoAntes = seed.cuentas_corrientes.cc_01.saldo;
  const h = await abrirDirector(seed);
  try {
    await abrirDevoluciones(h);
    await llenarDevolucion(h, { cliente: ANGEL, producto: "Queso Tybo", cantidad: "1", monto: "9000" });
    await btnRegistrar(h).evaluate((b) => { b.click(); b.click(); });
    await toast(h, "Devolución registrada", "ok").waitFor();
    await tarjetaDevolucion(h, "Queso Tybo").waitFor();
    await escriturasAlDia(h);
    const db = await h.dump();
    assert.equal(nuevos(db, seed, "devoluciones").length, 1);
    assert.equal(nuevos(db, seed, "cc_movimientos").length, 1);
    assert.equal(db.cuentas_corrientes.cc_01.saldo, saldoAntes - 9000);
    assert.equal(await h.page.locator("strong", { hasText: "Queso Tybo" }).count(), 1);
  } finally {
    await h.close();
  }
});

test("devolución: el crédito llega a la cuenta aunque el nombre esté escrito distinto, y el cliente no aparece duplicado", async () => {
  const seed = buildSeed();
  const FICHA = "Almacén Güemes Sur";
  // Un mismo cliente escrito de tres maneras: ficha, pedido y cuenta corriente.
  seed.clientes.cli_p8 = { nombre: FICHA, telefono: "", direccion: "", cuentaCorriente: true, creadoEn: { __ts: "2026-11-01T12:00:00.000Z" }, ultimoContacto: "2026-11-09T15:00:00.000Z", ultimoPedidoRegistrado: "2026-11-09" };
  seed.cuentas_corrientes.cc_p8 = { nombre: "Almacen Guemes Sur", saldo: 50000, creadoEn: "2026-11-01T12:00:00.000Z", ultimoMovimiento: "2026-11-10" };
  seed.pedidos.ped_p8 = {
    cliente: "ALMACEN GUEMES SUR", cuentaCorriente: true, tipo: "retiro",
    fechaPedido: { __ts: "2026-11-09T15:00:00.000Z" }, fechaPedidoISO: "2026-11-09T15:00:00.000Z", fechaEntrega: "2026-11-12",
    items: [{ categoria: "Quesos", producto: "Queso Sardo", cantidad: "5", unidad: "kg", obs: "" }], obs: "", estado: "listo",
    historial: [{ estado: "pendiente", fecha: "2026-11-09T15:00:00.000Z", nota: "Pedido creado" }],
  };
  // El cargo del remito, hecho dos días antes de la entrega: lleva el id del pedido.
  seed.cc_movimientos.ccm_p8 = {
    cliente: "Almacen Guemes Sur", tipo: "pedido", monto: 50000, movimiento: 50000, fecha: "2026-11-10",
    detalle: "Remito N° 0900", obs: "", origen: "remito", pedidoId: "ped_p8", remitoNro: 900, createdAt: "2026-11-10T12:00:00.000Z",
  };
  const h = await abrirDirector(seed);
  try {
    // Lista de clientes: uno solo, con el nombre de la ficha, y un solo pedido (el cargo no cuenta como otro)
    await pestana(h, "Clientes");
    await h.page.locator('input[placeholder="Buscar cliente por nombre..."]').fill("guemes sur");
    await h.page.getByText("1 resultado", { exact: true }).waitFor();
    const fila = h.page.locator("button", { hasText: "Ver historial" });
    assert.equal(await fila.count(), 1);
    const textoFila = await fila.innerText();
    assert.ok(textoFila.includes(FICHA), textoFila);
    assert.match(textoFila, /Total:\s*1\b/);
    assert.match(textoFila, /Cta Cte/);

    await abrirDevoluciones(h);
    await llenarDevolucion(h, { cliente: FICHA, producto: "Queso Sardo", cantidad: "1", monto: "10000" });
    await btnRegistrar(h).click();
    await toast(h, "saldo " + pesos(40000), "ok").waitFor();
    const db = await h.dump();
    assert.equal(db.cuentas_corrientes.cc_p8.saldo, 40000, "el crédito se descontó de la cuenta del cliente");
    const movs = nuevos(db, seed, "cc_movimientos");
    assert.equal(movs.length, 1);
    assert.equal(movs[0].cliente, "Almacen Guemes Sur", "el movimiento lleva el nombre de la cuenta");
    assert.equal(movs[0].saldo, 40000);
    assert.equal(nuevos(db, seed, "cuentas_corrientes").length, 0);
    assert.equal(nuevos(db, seed, "devoluciones")[0].creditoAsentado, true);
  } finally {
    await h.close();
  }
});

test("devolución con crédito a un cliente sin cuenta corriente: avisa antes y no promete un crédito que no existe", async () => {
  const seed = buildSeed();
  const h = await abrirDirector(seed);
  try {
    await abrirDevoluciones(h);
    await llenarDevolucion(h, { cliente: SABOR, producto: "Matambrito de Cerdo", cantidad: "3", monto: "8000" });
    await h.page.getByText(SABOR + " no tiene cuenta corriente: el crédito de " + pesos(8000) + " no se va a asentar en ninguna cuenta").waitFor();
    await btnRegistrar(h).click();
    await hoja(h).waitFor();
    assert.match(await hoja(h).innerText(), /no tiene cuenta corriente/i);
    await botonHoja(h, "Volver").click();
    await hoja(h).waitFor({ state: "detached" });
    assert.equal(await campoProducto(h).inputValue(), "Matambrito de Cerdo", "el formulario queda como estaba");
    assert.equal(nuevos(await h.dump(), seed, "devoluciones").length, 0);

    await btnRegistrar(h).click();
    await botonHoja(h, "Registrar sin crédito").click();
    await toast(h, "Devolución registrada sin crédito en cuenta", "ok").waitFor();
    const db = await h.dump();
    const devs = nuevos(db, seed, "devoluciones");
    assert.equal(devs.length, 1);
    assert.equal(devs[0].monto, 8000);
    assert.equal(devs[0].creditoAsentado, false);
    assert.equal(nuevos(db, seed, "cc_movimientos").length, 0);
    assert.equal(nuevos(db, seed, "cuentas_corrientes").length, 0);
    const tarjeta = tarjetaDevolucion(h, "Matambrito de Cerdo");
    await tarjeta.waitFor();
    assert.match(await tarjeta.innerText(), /sin asentar/);
  } finally {
    await h.close();
  }
});

test("devolución sin señal: avisa, no guarda nada y el formulario queda cargado para reintentar", async () => {
  const seed = buildSeed();
  const saldoAntes = seed.cuentas_corrientes.cc_01.saldo;
  const h = await abrirDirector(seed);
  try {
    await abrirDevoluciones(h);
    await llenarDevolucion(h, { cliente: ANGEL, producto: "Panceta Ahumada", cantidad: "2", monto: "7000" });
    await h.sinRed(true);
    await btnRegistrar(h).click();
    await toast(h, "Sin conexión", "error").waitFor();
    assert.equal(await campoProducto(h).inputValue(), "Panceta Ahumada");
    assert.equal(await campoCredito(h).inputValue(), "7.000");
    await h.sinRed(false);
    assert.equal(nuevos(await h.dump(), seed, "devoluciones").length, 0);

    await btnRegistrar(h).click();
    await toast(h, "Devolución registrada", "ok").waitFor();
    const db = await h.dump();
    assert.equal(nuevos(db, seed, "devoluciones").length, 1);
    assert.equal(nuevos(db, seed, "cc_movimientos").length, 1);
    assert.equal(db.cuentas_corrientes.cc_01.saldo, saldoAntes - 7000);
    assert.deepEqual(sinRuidoDeRed(h.errores), []);
  } finally {
    await h.close();
  }
});

test("devolución guardada: «Marcar resuelta» cambia el estado en la base y en la tarjeta", async () => {
  const seed = buildSeed();
  assert.equal(seed.devoluciones.dev_05.estado, "pendiente");
  const pendientes = Object.values(seed.devoluciones).filter((d) => d.estado === "pendiente").length;
  const h = await abrirDirector(seed);
  try {
    await abrirDevoluciones(h);
    const tarjeta = tarjetaDevolucion(h, seed.devoluciones.dev_05.producto);
    await tarjeta.locator("strong").click();
    await boton(h, "✓ Marcar resuelta").click();
    await boton(h, "Marcar pendiente").waitFor();
    assert.match(await tarjeta.innerText(), /Resuelta/);
    await esperarBase(h, (db) => db.devoluciones.dev_05.estado === "resuelta");
    // El contador de pendientes baja en uno
    const kpi = h.page.getByText("Pendientes", { exact: true }).first().locator("xpath=..");
    assert.match(await kpi.innerText(), new RegExp("^" + (pendientes - 1) + "\\s"));
    assert.deepEqual(erroresDePantalla(h.errores), []);
  } finally {
    await h.close();
  }
});

test("devolución por WhatsApp: el mensaje llega entero aunque el cliente tenga «&» y el detalle «%» o «#»", async () => {
  const seed = buildSeed();
  seed.devoluciones.dev_p8 = {
    cliente: PEREZ, producto: "Queso Tybo #2", cantidad: 1.5, unidad: "kg", motivo: "Calidad no conforme",
    descripcion: "50% del envase roto & golpeado", fechaPedidoOrig: "2026-11-06", monto: 12500, estado: "pendiente",
    createdAt: "2026-11-10T12:00:00.000Z", fecha: HOY,
  };
  const h = await abrirDirector(seed);
  try {
    await abrirDevoluciones(h);
    await h.page.locator("strong", { hasText: "Queso Tybo #2" }).click();
    await boton(h, "WA").click();
    const abiertos = await h.abiertos();
    assert.equal(abiertos.length, 1);
    const url = new URL(abiertos[0]);
    assert.equal(url.origin + url.pathname, "https://wa.me/");
    assert.equal(
      url.searchParams.get("text"),
      [
        "Devolución registrada", "",
        "Cliente: " + PEREZ,
        "Producto: Queso Tybo #2 (1,5 kg)",
        "Motivo: Calidad no conforme",
        "Detalle: 50% del envase roto & golpeado",
        "Crédito a favor: $12.500",
        "Estado: Pendiente", "",
        "Frigorífico Sersale",
      ].join("\n")
    );
    assert.equal(url.hash, "");
  } finally {
    await h.close();
  }
});

// ── Panel del director ──────────────────────────────────────────────────────

test("resumen, de noche: «Preparar hoy» muestra lo de hoy (no lo de mañana) y lo pesado va en kilos", async () => {
  const seed = buildSeed();
  const activos = Object.values(seed.pedidos).filter((p) => !["despachado", "cancelado"].includes(p.estado));
  const deHoy = activos.filter((p) => p.fechaEntrega === HOY).length;
  const deManana = activos.filter((p) => p.fechaEntrega === "2026-11-11").length;
  assert.ok(deHoy > 0 && deHoy !== deManana);
  const h = await abrirDirector(seed, { now: NOCHE });
  try {
    const titulo = h.page.getByText(/Preparar hoy/);
    await titulo.waitFor();
    assert.match(await titulo.innerText(), new RegExp("Preparar hoy \\(" + deHoy + " pedidos?\\)", "i"));
    const lineas = (await titulo.locator("xpath=..").innerText()).split("\n").map((l) => l.trim());
    const caja = lineas.join(" | ");
    // Solo en pedidos de mañana:
    assert.ok(!caja.includes("Carré c/ Hueso"), caja);
    // 4 piezas pesadas en 31,6 kg: antes salía "31.6 piezas"
    assert.ok(/Jamón Crudo c\/ Hueso 12 Meses.*\| 31,6 kg/.test(caja), caja);
    assert.ok(!/31[.,]6 piezas/.test(caja), caja);
    // 40,35 kg pesados + 12 kg pedidos todavía sin pesar
    assert.ok(caja.includes("52,35 kg"), caja);
    // Lo que no se pesó sigue en su unidad
    assert.ok(/Salamín Picado Fino.*\| 3 ganchos/.test(caja), caja);
  } finally {
    await h.close();
  }
});

test("alertas: los días sin pedir se cuentan con el día argentino del último contacto, y el límite a mano se valida", async () => {
  const seed = buildSeed();
  // Contactado el 27/10 a las 22:10 (en UTC ya era 28/10): hoy 10/11 son 14 días → alerta.
  seed.clientes.cli_p8 = {
    nombre: "Despensa La Esquina", telefono: "", direccion: "", cuentaCorriente: false, creadoEn: { __ts: "2026-10-01T12:00:00.000Z" },
    diasAlerta: 14, ultimoContacto: "2026-10-28T01:10:00.000Z", ultimoPedidoRegistrado: "2026-10-27",
  };
  const h = await abrirDirector(seed);
  try {
    await pestana(h, "🔔 Alertas");
    const esquina = tarjetaAlerta(h, "Despensa La Esquina");
    await esquina.waitFor();
    assert.match(await esquina.innerText(), /14d sin pedir \(límite: 14d\)/);
    assert.match(await esquina.innerText(), /\+0d/, "está entre los que requieren recontacto");

    // Recargar no vuelve a escribir la frecuencia de cada cliente si no cambió
    await escriturasAlDia(h);
    const antes = await h.dump();
    // (otro teléfono carga un cliente: cuando aparece su alerta, la recarga terminó)
    await h.sembrar({ clientes: { cli_p8b: { nombre: "Despensa Segunda", telefono: "", direccion: "", cuentaCorriente: false, diasAlerta: 14, ultimoContacto: "2026-10-20T15:00:00.000Z", ultimoPedidoRegistrado: "2026-10-20" } } });
    await h.page.waitForFunction(async () => {
      const m = await import("/js/fb.js");
      return (await m.getDocs(m.collection(m.db, "clientes"))).docs.some((d) => d.id === "cli_p8b");
    });
    await boton(h, "↻").click();
    await tarjetaAlerta(h, "Despensa Segunda").waitFor();
    await escriturasAlDia(h);
    const despues = await h.dump();
    for (const [id, c] of entradas(antes.clientes)) assert.equal(despues.clientes[id].freqActualizado, c.freqActualizado, "no se reescribió " + c.nombre);

    // Campo de días vacío: antes guardaba NaN
    const guemes = tarjetaAlerta(h, GUEMES);
    await guemes.locator('input[type="number"]').fill("");
    await guemes.locator('input[type="number"]').blur();
    await toast(h, "entre 1 y 365", "error").waitFor();
    assert.equal((await h.dump()).clientes.cli_06.diasAlerta, 21);

    // Cliente con historial: el límite se calcula solo, se avisa en vez de aparentar que se guardó
    const trebol = tarjetaAlerta(h, TREBOL);
    const limite = despues.clientes.cli_03.diasAlerta;
    // (Desde que se integró el arreglo de Alertas, ese campo dice "Auto:" y no se puede editar:
    // al tocarlo explica por qué. Antes esta prueba escribía 45 en el campo y ya no podía.)
    assert.equal(await trebol.locator('input[type="number"]').getAttribute("readonly"), "", "el campo de un límite automático no se edita");
    await trebol.locator('input[type="number"]').click();
    await toast(h, "se calcula solo", "info").waitFor();
    assert.equal((await h.dump()).clientes.cli_03.diasAlerta, limite);

    // Cliente sin historial: el límite a mano se guarda y la alerta se recalcula
    await guemes.locator('input[type="number"]').fill("60");
    await guemes.locator('input[type="number"]').blur();
    await esperarBase(h, (db) => db.clientes.cli_06.diasAlerta === 60);
    await h.page.getByText(GUEMES, { exact: true }).waitFor({ state: "detached" });
    await esquina.waitFor();
  } finally {
    await h.close();
  }
});

test("director → Todos: lo último cargado va arriba y la búsqueda no mira acentos", async () => {
  const seed = buildSeed();
  // El pedido más nuevo, con un id que por orden alfabético quedaba entre los primeros
  seed.pedidos.aaa_p8 = {
    cliente: "Bar El Federal", cuentaCorriente: false, tipo: "retiro",
    fechaPedido: { __ts: "2026-11-10T13:29:00.000Z" }, fechaPedidoISO: "2026-11-10T13:29:00.000Z", fechaEntrega: "2026-11-13",
    items: [{ categoria: "Quesos", producto: "Queso Reggianito", cantidad: "2", unidad: "kg", obs: "" }], obs: "", estado: "pendiente",
    historial: [{ estado: "pendiente", fecha: "2026-11-10T13:29:00.000Z", nota: "Pedido creado" }],
  };
  seed.pedidos.zzz_p8 = { ...seed.pedidos.aaa_p8, cliente: "Bar El Viejo Almacén", fechaPedido: { __ts: "2026-08-01T13:00:00.000Z" }, fechaPedidoISO: "2026-08-01T13:00:00.000Z", fechaEntrega: "2026-08-03", estado: "despachado" };
  const h = await abrirDirector(seed);
  try {
    await pestana(h, "Todos");
    const buscador = h.page.locator('input[placeholder="Buscar por cliente, producto, estado..."]');
    await buscador.waitFor();
    const lista = buscador.locator("xpath=../..");
    const texto = await lista.innerText();
    const primero = texto.indexOf("Bar El Federal");
    const ultimo = texto.indexOf("Bar El Viejo Almacén");
    assert.ok(primero >= 0 && ultimo > primero);
    for (const c of Object.values(seed.clientes)) {
      const i = texto.indexOf(c.nombre);
      if (i >= 0) assert.ok(i > primero && i < ultimo, c.nombre + " tendría que estar entre el más nuevo y el más viejo");
    }
    // "angel" encuentra "Ángel"; antes no daba resultados
    await buscador.fill("angel");
    const resultados = h.page.getByText(/resultados? para "angel"/);
    await resultados.waitFor();
    assert.match(await resultados.innerText(), /^[1-9]\d* resultado/);
    assert.ok((await lista.innerText()).includes(ANGEL));
    // La fecha de entrega se puede buscar como se lee: 13/11
    await buscador.fill("13/11/2026");
    await h.page.getByText('1 resultado para "13/11/2026"').waitFor();
    assert.ok((await lista.innerText()).includes("Bar El Federal"));
  } finally {
    await h.close();
  }
});

// ── Arranque: pedidos nuevos y cinta NUEVO ──────────────────────────────────

test("acceso rápido «Registrar una venta rápida» (pedidos.html?vr=1): abre la venta rápida aunque Pedidos estuviera en el inicio, una sola vez", async () => {
  const seed = buildSeed();
  const h = await launch({ rol: "director", etiqueta: "p8", seed });
  try {
    await h.ir("pedidos.html?vr=1");
    await h.page.getByText("Registrar en cuenta corriente").waitFor();
    assert.equal(new URL(h.page.url()).search, "", "el pedido de abrirla no queda en la dirección");
    await h.page.locator('button[aria-label="Cerrar"]').click();
    await h.page.getByText("Registrar en cuenta corriente").waitFor({ state: "detached" });
    // Volver al inicio y entrar de nuevo al panel: no se abre sola otra vez
    await h.page.getByText("Activos", { exact: true }).first().waitFor();
    await boton(h, "←").click();
    await h.page.getByText("¿Quién sos?").waitFor();
    await entrarDirector(h);
    assert.equal(await h.page.getByText("Registrar en cuenta corriente").count(), 0);
  } finally {
    await h.close();
  }
});

test("pedidos nuevos: la cinta NUEVO aparece al entrar a Comercial y al Director, y se apaga al volver al inicio", async () => {
  const seed = buildSeed();
  const desde = "2026-11-10T10:00:00.000Z"; // el teléfono miró los pedidos por última vez hoy a las 7
  const activos = Object.values(seed.pedidos).filter((p) => !["despachado", "cancelado"].includes(p.estado));
  const nuevosActivos = activos.filter((p) => p.fechaPedidoISO > desde).length;
  const nuevosPendientes = activos.filter((p) => p.estado === "pendiente" && p.fechaPedidoISO > desde).length;
  assert.ok(nuevosActivos > 0 && nuevosPendientes > 0 && nuevosActivos < activos.length);
  const antes = (h) => h.context.addInitScript((desde) => { if (!localStorage.getItem("sersale_last_seen")) localStorage.setItem("sersale_last_seen", desde); }, desde);
  const cintas = (h) => h.page.getByText("NUEVO", { exact: true });
  const cartel = (h) => h.page.getByText(/pedidos? nuevos? desde tu última visita/);

  const h = await abrirInicio(seed, { antes });
  try {
    await cartel(h).waitFor();
    assert.match(await cartel(h).innerText(), new RegExp("^\\D*" + nuevosPendientes + " pedido"));
    await entrarComercial(h);
    await cintas(h).first().waitFor();
    assert.equal(await cintas(h).count(), nuevosActivos);
    // Volver al inicio: ya se vieron
    await boton(h, "←").click();
    await h.page.getByText("¿Quién sos?").waitFor();
    assert.equal(await cartel(h).count(), 0);
    assert.ok((await h.page.evaluate(() => localStorage.getItem("sersale_last_seen"))) > desde);
    await entrarComercial(h);
    await h.page.getByText("Almacén Doña Rosa", { exact: true }).first().waitFor();
    assert.equal(await cintas(h).count(), 0);
  } finally {
    await h.close();
  }

  const h2 = await abrirInicio(seed, { antes });
  try {
    await entrarDirector(h2);
    await cintas(h2).first().waitFor();
    assert.equal(await cintas(h2).count(), nuevosActivos);
  } finally {
    await h2.close();
  }
});

test("un pedido con datos rotos no deja la página en blanco: se avisa y se puede volver al inicio", async () => {
  const seed = buildSeed();
  seed.pedidos.ped_roto = {
    cliente: ANGEL, cuentaCorriente: true, tipo: "retiro",
    fechaPedido: { __ts: "2026-11-10T12:00:00.000Z" }, fechaPedidoISO: "2026-11-10T12:00:00.000Z", fechaEntrega: HOY,
    items: 5, obs: "", estado: "pendiente", historial: [],
  };
  const h = await abrirInicio(seed);
  try {
    await boton(h, "Panel general y cuentas corrientes").click();
    await h.page.getByText("Esta pantalla no se pudo mostrar").waitFor();
    await boton(h, "Volver al inicio").click();
    await h.page.getByText("¿Quién sos?").waitFor();
  } finally {
    await h.close();
  }
});

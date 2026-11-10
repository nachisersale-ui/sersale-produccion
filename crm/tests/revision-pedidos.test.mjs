// Revisión independiente de clientes, nuevo pedido, venta rápida y precios
// (src/pedidos/01, 02 y 05). Cada prueba reproduce, con la pantalla real y una
// red que falla a propósito, un defecto que quedaba después de los arreglos.
// Detalle en docs/auditoria/revision-pedidos.md.
import test from "node:test";
import assert from "node:assert/strict";
import { launch } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const ANGEL = "Fiambrería Don Ángel"; // cli_01, cuenta cc_01
const TREBOL = "Carnicería El Trébol"; // cli_03, cuenta cc_02, debe $660.925
const SABOR = "Rotisería El Buen Sabor"; // sin cuenta corriente

// ── Ayudas ──────────────────────────────────────────────────────────────────
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const entradas = (o) => Object.entries(o || {});
const boton = (h, t) => h.page.locator("button", { hasText: t });
const toast = (h, t) => h.page.locator(".ss-toast", { hasText: t });
const hoja = (h) => h.page.locator(".ss-hoja");
const botonHoja = (h, t) => h.page.locator(".ss-hoja .ss-btn", { hasText: t });
const de = (db, col, campo, nombre) => entradas(db[col]).filter(([, d]) => d[campo] === nombre);
const nuevos = (db, seed, col) => entradas(db[col]).filter(([id]) => !(id in (seed[col] || {}))).map(([id, d]) => ({ id, ...d }));
const hay = (loc) => async () => (await loc.count()) > 0;

/** Cuántos documentos nombran al cliente, por colección. */
function porCliente(db, nombre) {
  return {
    pedidos: de(db, "pedidos", "cliente", nombre).length,
    remitos: de(db, "remitos", "cliente", nombre).length,
    precios: de(db, "precios_cliente", "cliente", nombre).length,
    movimientos: de(db, "cc_movimientos", "cliente", nombre).length,
    cuentas: de(db, "cuentas_corrientes", "nombre", nombre).length,
    fichas: de(db, "clientes", "nombre", nombre).length,
  };
}

/** Espera a que `fn` sea verdadero adelantando el reloj de la página (las esperas y reintentos internos duran varios segundos). */
async function adelantandoHasta(p, fn, que, pasos = 80) {
  for (let i = 0; i < pasos; i++) {
    if (await fn()) return;
    await p.clock.runFor(1500);
    await pausa(150);
  }
  throw new Error("No se cumplió: " + que);
}
const alDia = (p) => p.evaluate(() => {
  const e = window.__sersaleDatos.estado();
  return Object.keys(e).length > 0 && Object.values(e).every((x) => x.sincronizado);
});

async function abrir(seed) {
  const h = await launch({ rol: "director", etiqueta: "rvped", seed });
  await h.ir("pedidos.html");
  await h.sincronizar();
  await h.page.getByText("¿Quién sos?").waitFor();
  return h;
}
async function irAClientes(h) {
  await boton(h, "Agregar, editar y eliminar clientes").click();
  await h.page.getByText(/Clientes registrados \(\d+\)/).waitFor();
}
async function irAlPanel(h) {
  await boton(h, "Panel general y cuentas corrientes").click();
  await h.page.getByText("Activos", { exact: true }).first().waitFor();
}
/**
 * El teléfono queda con la copia de ayer: se cae el canal por el que escucha los
 * cambios (los pedidos sueltos al servidor sí pasan), otro teléfono guarda
 * `deOtroTelefono` y la app se vuelve a abrir en la misma pantalla.
 */
async function quedarConCopiaVieja(h, deOtroTelefono) {
  const corte = await h.cortarEscucha();
  await h.sembrar(deOtroTelefono);
  await h.ir("pedidos.html");
  return corte;
}
/** Vuelve la señal: espera a que el teléfono se ponga al día. */
async function volverLaSenal(h, corte) {
  corte.activo = false;
  await adelantandoHasta(h.page, () => alDia(h.page), "que el teléfono se ponga al día con el servidor", 120);
}

// Venta rápida
const btnRegistrar = (h) => boton(h, "Registrar venta");
async function cargarVentaRapida(h, cliente, { producto, cantidad, precio }) {
  await h.page.locator("#btn-venta-rapida").click();
  await h.page.getByText("Registrar en cuenta corriente").waitFor();
  await adelantandoHasta(h.page, hay(h.page.locator('select[aria-label="Cliente de la venta"] option', { hasText: cliente })), "clientes en la venta rápida");
  await h.page.locator('select[aria-label="Cliente de la venta"]').selectOption({ label: cliente });
  await h.page.locator('input[placeholder="Producto"]').first().fill(producto);
  await h.page.locator('input[placeholder="Cant."]').first().fill(String(cantidad));
  await h.page.locator('input[placeholder="Precio"]').first().fill(String(precio));
}

// ── 1. Decidir con la copia atrasada del teléfono ───────────────────────────

test("clientes: con la copia del teléfono atrasada no se cambia el nombre dejando afuera el pedido que cargó otro teléfono", async () => {
  const seed = buildSeed();
  const NUEVO = "Fiambrería Don Ángel e Hijos";
  const antes = porCliente(seed, ANGEL);
  const h = await abrir(seed);
  const p = h.page;
  try {
    // Este teléfono ya abrió alguna vez Remitos y Devoluciones (tiene su copia guardada).
    await p.evaluate(() => window.__sersaleDatos.precalentar(["remitos", "devoluciones"]));
    await h.sincronizar();
    await irAClientes(h);
    // Señal entrecortada: el teléfono queda con la copia vieja y otro teléfono le carga un pedido al cliente.
    const corte = await quedarConCopiaVieja(h, {
      pedidos: { ped_otro_tel: { cliente: ANGEL, tipo: "envio", fechaEntrega: "2026-11-11", fechaPedidoISO: "2026-11-10T13:00:00.000Z", fechaPedido: { __ts: "2026-11-10T13:00:00.000Z" }, items: [{ producto: "Queso Tybo", cantidad: "4", unidad: "kg" }], obs: "", estado: "pendiente", cuentaCorriente: true, historial: [] } },
    });
    await adelantandoHasta(p, hay(p.locator(`button[aria-label="Editar ${ANGEL}"]`)), "la lista de clientes (con la copia guardada)");
    await p.locator(`button[aria-label="Editar ${ANGEL}"]`).click();
    await p.getByPlaceholder("Nombre del cliente *").fill(NUEVO);
    await boton(h, "Actualizar").click();
    await adelantandoHasta(p, async () => (await hay(hoja(h))()) || (await hay(p.locator(".ss-toast-error"))()), "que pregunte o avise");
    if (await hoja(h).count()) {
      // Si llegó a preguntar, tiene que haber contado también el pedido del otro teléfono.
      await botonHoja(h, "Cambiar nombre").click();
      await adelantandoHasta(p, hay(p.locator(".ss-toast")), "el aviso final");
    }
    let db = await h.dump();
    const ficha = db.clientes.cli_01.nombre;
    assert.ok(
      ficha === ANGEL ? db.pedidos.ped_otro_tel.cliente === ANGEL : de(db, "pedidos", "cliente", ANGEL).length === 0,
      "o no se cambia nada, o se cambia todo. Quedó la ficha como «" + ficha + "» y el pedido del otro teléfono a nombre de «" + db.pedidos.ped_otro_tel.cliente + "» (antes: ficha con el nombre nuevo y ese pedido suelto con el viejo)"
    );
    assert.equal(ficha, ANGEL, "sin poder consultar el servidor, el nombre no se cambia");
    assert.deepEqual(porCliente(db, ANGEL), { ...antes, pedidos: antes.pedidos + 1 }, "nada cambió de nombre");
    assert.ok(await toast(h, "No se pudo consultar el servidor").count(), "y se avisa por qué");
    assert.equal(await p.getByPlaceholder("Nombre del cliente *").inputValue(), NUEVO, "lo escrito queda para reintentar");

    // Vuelve la señal: ahora cambia todo, también el pedido que había cargado el otro teléfono.
    await volverLaSenal(h, corte);
    await boton(h, "Actualizar").click();
    await hoja(h).getByText("¿Cambiar el nombre del cliente?").waitFor();
    await botonHoja(h, "Cambiar nombre").click();
    await toast(h, "Nombre cambiado").waitFor();
    db = await h.dump();
    assert.deepEqual(porCliente(db, ANGEL), { pedidos: 0, remitos: 0, precios: 0, movimientos: 0, cuentas: 0, fichas: 0 }, "no queda nada con el nombre viejo");
    assert.equal(db.pedidos.ped_otro_tel.cliente, NUEVO);
    assert.deepEqual(porCliente(db, NUEVO), { ...antes, pedidos: antes.pedidos + 1 });
  } finally {
    await h.close();
  }
});

test("clientes: con la copia del teléfono atrasada no se elimina un cliente avisando una deuda vieja y dejando movimientos sueltos", async () => {
  const seed = buildSeed();
  const cuenta = seed.cuentas_corrientes.cc_02;
  assert.equal(cuenta.nombre, TREBOL);
  const antes = porCliente(seed, TREBOL);
  const h = await abrir(seed);
  const p = h.page;
  try {
    await irAClientes(h);
    // Otro teléfono le cobra un remito de $90.000 que este teléfono no llegó a bajar.
    const corte = await quedarConCopiaVieja(h, {
      cuentas_corrientes: { cc_02: { ...cuenta, saldo: cuenta.saldo + 90000 } },
      cc_movimientos: { mov_otro_tel: { cliente: TREBOL, tipo: "pedido", monto: 90000, movimiento: 90000, fecha: "2026-11-10", detalle: "Chorizo Puro Cerdo", obs: "Remito N° 0098", origen: "remito", remitoNro: 98, createdAt: "2026-11-10T13:00:00.000Z" } },
    });
    await adelantandoHasta(p, hay(p.locator(`button[aria-label="Eliminar ${TREBOL}"]`)), "la lista de clientes (con la copia guardada)");
    await p.locator(`button[aria-label="Eliminar ${TREBOL}"]`).click();
    await adelantandoHasta(p, async () => (await hay(hoja(h))()) || (await hay(p.locator(".ss-toast-error"))()), "que pregunte o avise");
    if (await hoja(h).count()) {
      assert.match(await hoja(h).innerText(), /\$750\.925/, "si pregunta, la deuda que avisa es la real ($660.925 + $90.000), no la de la copia vieja: " + (await hoja(h).innerText()));
      await botonHoja(h, "Eliminar").click();
      await adelantandoHasta(p, hay(p.locator(".ss-toast")), "el aviso final");
    }
    let db = await h.dump();
    assert.ok(db.clientes.cli_03, "sin poder consultar el servidor, el cliente no se elimina");
    assert.deepEqual(porCliente(db, TREBOL), { ...antes, movimientos: antes.movimientos + 1 }, "no se borró nada");
    assert.ok(await toast(h, "No se pudo consultar el servidor").count(), "y se avisa por qué");

    // Vuelve la señal: avisa la deuda real y se lleva también el movimiento del otro teléfono.
    await volverLaSenal(h, corte);
    await p.locator(`button[aria-label="Eliminar ${TREBOL}"]`).click();
    await hoja(h).getByText("Hoy debe $750.925").waitFor();
    await botonHoja(h, "Eliminar").click();
    await toast(h, "Cliente eliminado").waitFor();
    db = await h.dump();
    assert.deepEqual(porCliente(db, TREBOL), { ...antes, fichas: 0, cuentas: 0, movimientos: 0, precios: 0 }, "ficha, cuenta, movimientos (también el del otro teléfono) y precios; quedan pedidos y remitos");
  } finally {
    await h.close();
  }
});

test("venta rápida: con la copia del teléfono atrasada no le abre una segunda cuenta al cliente que ya tiene una", async () => {
  const seed = buildSeed();
  assert.equal(de(seed, "cuentas_corrientes", "nombre", SABOR).length, 0, "la base de ejemplo no trae cuenta para este cliente");
  const h = await abrir(seed);
  const p = h.page;
  try {
    await irAlPanel(h);
    // Desde otro teléfono (versión anterior del sistema) le abrieron la cuenta y le cargaron un remito de $80.000.
    const corte = await quedarConCopiaVieja(h, {
      cuentas_corrientes: { cuenta_de_otro_tel: { nombre: SABOR, saldo: 80000, creadoEn: "2026-11-10T12:00:00.000Z", ultimoMovimiento: "2026-11-10" } },
      cc_movimientos: { mov_de_otro_tel: { cliente: SABOR, tipo: "pedido", monto: 80000, movimiento: 80000, fecha: "2026-11-10", detalle: "Pollo", obs: "Remito N° 0099", origen: "remito", remitoNro: 99, createdAt: "2026-11-10T12:00:00.000Z" } },
    });
    await adelantandoHasta(p, hay(p.locator("#btn-venta-rapida")), "el panel del director");
    await cargarVentaRapida(h, SABOR, { producto: "Pollo", cantidad: "5", precio: "3100" });
    await btnRegistrar(h).click();
    await adelantandoHasta(p, async () => (await hay(hoja(h))()) || (await hay(p.locator(".ss-toast"))()), "que pregunte o avise");
    if (await hoja(h).count()) {
      // La copia vieja dice que no tiene cuenta: la persona acepta abrirle una.
      await botonHoja(h, "Abrir cuenta y registrar").click();
      await adelantandoHasta(p, hay(p.locator(".ss-toast")), "el aviso final");
    }
    let db = await h.dump();
    let cuentas = de(db, "cuentas_corrientes", "nombre", SABOR);
    assert.equal(cuentas.length, 1, "el cliente sigue con UNA cuenta (antes se le abría otra y la deuda quedaba repartida): " + JSON.stringify(cuentas));
    if (nuevos(db, seed, "pedidos").length) assert.equal(db.cuentas_corrientes.cuenta_de_otro_tel.saldo, 95500, "si la venta se registró, fue en la cuenta que ya tenía");
    else assert.ok(await toast(h, "No se pudo consultar la cuenta corriente").count(), "si no se registró, se avisa por qué");

    // Vuelve la señal: la venta entra en la cuenta que ya tenía.
    await volverLaSenal(h, corte);
    if (!nuevos(db, seed, "pedidos").length) {
      await btnRegistrar(h).click();
      await toast(h, "Venta de $15.500 registrada").waitFor();
    }
    db = await h.dump();
    cuentas = de(db, "cuentas_corrientes", "nombre", SABOR);
    assert.equal(cuentas.length, 1);
    assert.equal(db.cuentas_corrientes.cuenta_de_otro_tel.saldo, 95500, "$80.000 del remito + $15.500 de la venta");
    assert.equal(nuevos(db, seed, "pedidos").length, 1);
    assert.equal(nuevos(db, seed, "cc_movimientos").filter((m) => m.origen === "venta_rapida").length, 1);
  } finally {
    await h.close();
  }
});

// ── 2. La señal se corta justo al confirmar una venta rápida ────────────────

test("venta rápida: si se corta la señal al confirmar y se la carga de nuevo desde otra ventana, se cobra una sola vez", async () => {
  const seed = buildSeed();
  const saldoAntes = seed.cuentas_corrientes.cc_02.saldo;
  const h = await abrir(seed);
  const p = h.page;
  const estado = async () => {
    const db = await h.dump();
    return { pedidos: nuevos(db, seed, "pedidos").length, cargos: nuevos(db, seed, "cc_movimientos").length, saldo: db.cuentas_corrientes.cc_02.saldo - saldoAntes };
  };
  try {
    await irAlPanel(h);
    const red = await h.redQueSeCorta();
    await cargarVentaRapida(h, TREBOL, { producto: "Chorizo Puro Cerdo", cantidad: "10", precio: "6200" });
    // El servidor guarda la venta, la respuesta no vuelve y después no hay señal.
    red.perder = 1;
    red.luegoSinSenal = true;
    await btnRegistrar(h).click();
    await adelantandoHasta(p, hay(toast(h, "No se pudo registrar la venta")), "el aviso de que no se pudo registrar");
    assert.equal(red.perdidas, 1, "la prueba tiene que haber perdido una confirmación");
    assert.deepEqual(await estado(), { pedidos: 1, cargos: 1, saldo: 62000 }, "el servidor sí la había guardado");

    // La persona cierra la ventana y, cuando vuelve la señal, carga la misma venta otra vez.
    await p.locator('button[aria-label="Cerrar"]').click();
    await btnRegistrar(h).waitFor({ state: "detached" });
    await cargarVentaRapida(h, TREBOL, { producto: "Chorizo Puro Cerdo", cantidad: "10", precio: "6200" });
    red.caida = false;
    // (Si el aviso de abajo aparece justo antes del toque, el toque no llega: es lo mismo que le pasaría a la persona.)
    await btnRegistrar(h).click({ timeout: 4000 }).catch(() => {});
    await adelantandoHasta(p, async () => (await hay(hoja(h))()) || (await hay(toast(h, /Venta de .* registrada/))()), "que avise o registre");
    assert.deepEqual(await estado(), { pedidos: 1, cargos: 1, saldo: 62000 }, "una sola venta y el saldo sube una sola vez (antes: dos pedidos, dos cargos y $124.000)");
    const aviso = await hoja(h).innerText();
    assert.match(aviso, /quedó registrada/i, "avisa que la venta anterior sí había quedado: " + aviso);
    assert.ok(aviso.includes("$62.000") && aviso.includes(TREBOL), "dice cuál: " + aviso);
    await botonHoja(h, "Entendido").click();
    await hoja(h).waitFor({ state: "detached" });
    assert.deepEqual(await estado(), { pedidos: 1, cargos: 1, saldo: 62000 });
  } finally {
    await h.close();
  }
});

test("venta rápida: si la app se cierra mientras guardaba y el servidor la había guardado, al volver a abrir avisa que quedó registrada", async () => {
  const seed = buildSeed();
  const saldoAntes = seed.cuentas_corrientes.cc_02.saldo;
  const h = await abrir(seed);
  const p = h.page;
  try {
    await irAlPanel(h);
    const red = await h.redQueSeCorta();
    await cargarVentaRapida(h, TREBOL, { producto: "Chorizo Puro Cerdo", cantidad: "10", precio: "6200" });
    red.perder = 1;
    red.luegoSinSenal = true;
    await btnRegistrar(h).click();
    for (let i = 0; i < 100 && red.perdidas < 1; i++) await pausa(100);
    assert.equal(red.perdidas, 1, "la venta llegó al servidor y la respuesta se perdió");
    // Queda en "Guardando..." y la persona cierra la app. Más tarde, ya con señal, la vuelve a abrir.
    red.caida = false;
    await h.ir("pedidos.html");
    await adelantandoHasta(p, hay(hoja(h)), "el aviso de la venta que había quedado registrada");
    const aviso = await hoja(h).innerText();
    assert.match(aviso, /quedó registrada/i, aviso);
    assert.ok(aviso.includes("$62.000") && aviso.includes(TREBOL), "dice cuál: " + aviso);
    await botonHoja(h, "Entendido").click();
    await hoja(h).waitFor({ state: "detached" });
    const db = await h.dump();
    assert.equal(nuevos(db, seed, "pedidos").length, 1);
    assert.equal(db.cuentas_corrientes.cc_02.saldo, saldoAntes + 62000);
    // Ya avisada, no vuelve a aparecer.
    await p.clock.runFor(12000);
    await pausa(300);
    assert.equal(await hoja(h).count(), 0);
  } finally {
    await h.close();
  }
});

// ── 3. Eliminar o cambiar el nombre y que se corte a la mitad ───────────────

/** Cliente con tantos precios guardados que el borrado o el cambio de nombre no entra en una sola tanda (400). */
function conMuchosPrecios(seed, cliente) {
  for (let i = 0; i < 430; i++) seed.precios_cliente["pre_viejo_" + i] = { cliente, producto: "Chorizo Puro Cerdo", precio: 5000 + i, fecha: "2026-09-01T12:00:00.000Z" };
  return seed;
}

test("clientes: si eliminar se corta a la mitad, la cuenta no queda con la deuda y sin movimientos; al repetir se completa", async () => {
  const seed = conMuchosPrecios(buildSeed(), TREBOL);
  const antes = porCliente(seed, TREBOL);
  const h = await abrir(seed);
  const p = h.page;
  try {
    await irAClientes(h);
    const red = await h.redQueSeCorta();
    await p.locator(`button[aria-label="Eliminar ${TREBOL}"]`).click();
    await hoja(h).getByText("Hoy debe $660.925").waitFor();
    // La primera tanda llega al servidor; después se corta la señal.
    red.perder = 1;
    red.luegoSinSenal = true;
    await botonHoja(h, "Eliminar").click();
    await adelantandoHasta(p, hay(toast(h, "No se pudo eliminar el cliente")), "el aviso de que no se pudo eliminar");
    assert.equal(red.perdidas, 1);
    let db = await h.dump();
    const medio = porCliente(db, TREBOL);
    assert.equal(medio.fichas, 1, "el cliente sigue en la lista para volver a eliminarlo");
    assert.equal(medio.cuentas, 1);
    assert.equal(db.cuentas_corrientes.cc_02.saldo, 660925);
    assert.equal(medio.movimientos, antes.movimientos, "la cuenta conserva sus movimientos (antes se borraban primero y quedaba la deuda de $660.925 sin un solo movimiento)");
    assert.ok(medio.precios < antes.precios, "la prueba tiene que haber borrado una parte");

    // Vuelve la señal y se repite: ahora se completa.
    red.caida = false;
    await p.clock.runFor(10000);
    await p.locator(`button[aria-label="Eliminar ${TREBOL}"]`).click();
    await adelantandoHasta(p, hay(hoja(h)), "la pregunta");
    await botonHoja(h, "Eliminar").click();
    await adelantandoHasta(p, hay(toast(h, "Cliente eliminado")), "que termine de eliminar");
    db = await h.dump();
    assert.deepEqual(porCliente(db, TREBOL), { ...antes, fichas: 0, cuentas: 0, movimientos: 0, precios: 0 });
  } finally {
    await h.close();
  }
});

test("clientes: si el cambio de nombre se corta a la mitad, el cliente no queda separado de su cuenta; al repetir se completa", async () => {
  const seed = conMuchosPrecios(buildSeed(), TREBOL);
  const NUEVO = "Carnicería El Trébol de Pompeya";
  const antes = porCliente(seed, TREBOL);
  const h = await abrir(seed);
  const p = h.page;
  try {
    await irAClientes(h);
    const red = await h.redQueSeCorta();
    await p.locator(`button[aria-label="Editar ${TREBOL}"]`).click();
    await p.getByPlaceholder("Nombre del cliente *").fill(NUEVO);
    await boton(h, "Actualizar").click();
    await hoja(h).getByText("¿Cambiar el nombre del cliente?").waitFor();
    red.perder = 1;
    red.luegoSinSenal = true;
    await botonHoja(h, "Cambiar nombre").click();
    await adelantandoHasta(p, hay(toast(h, "No se pudo terminar el cambio de nombre")), "el aviso de que quedó a medias");
    assert.equal(red.perdidas, 1);
    let db = await h.dump();
    const medio = porCliente(db, TREBOL);
    assert.equal(medio.fichas, 1, "la ficha sigue con el nombre anterior");
    assert.ok(porCliente(db, NUEVO).precios > 0, "la prueba tiene que haber cambiado una parte");
    assert.equal(medio.cuentas, 1, "y su cuenta corriente también (antes la cuenta ya tenía el nombre nuevo: el cliente quedaba sin cuenta y un remito le abría otra)");
    assert.equal(medio.movimientos, antes.movimientos);
    assert.equal(medio.pedidos, antes.pedidos);

    // Vuelve la señal y se toca Actualizar otra vez, como dice el aviso.
    red.caida = false;
    await p.clock.runFor(10000);
    await boton(h, "Actualizar").click();
    await adelantandoHasta(p, hay(hoja(h)), "la pregunta");
    await botonHoja(h, "Cambiar nombre").click();
    await adelantandoHasta(p, hay(toast(h, "Nombre cambiado")), "que termine el cambio");
    db = await h.dump();
    assert.deepEqual(porCliente(db, TREBOL), { pedidos: 0, remitos: 0, precios: 0, movimientos: 0, cuentas: 0, fichas: 0 });
    assert.deepEqual(porCliente(db, NUEVO), antes);
    assert.equal(db.cuentas_corrientes.cc_02.saldo, 660925, "el saldo no cambia");
  } finally {
    await h.close();
  }
});

// ── 4. Catálogo: la respuesta del servidor se pierde ─────────────────────────

test("productos: si se corta la señal al confirmar, no dice «Ya existe ese producto» por el que acaba de agregar", async () => {
  const seed = buildSeed();
  const h = await abrir(seed);
  const p = h.page;
  try {
    const red = await h.redQueSeCorta();
    await boton(h, "Agregar productos a cada categoría").click();
    await p.getByText("Gestión de Productos").waitFor();
    await p.getByText("Quesos", { exact: true }).click();
    await boton(h, "+ Agregar producto").click();
    await p.getByPlaceholder("Ej: Jamón Serrano").fill("Queso Fontina");
    red.perder = 1; // el servidor guarda, la respuesta no vuelve y Firestore repite la transacción
    await boton(h, /^Agregar$/).click();
    await adelantandoHasta(p, hay(p.locator(".ss-toast")), "el aviso");
    assert.equal(red.perdidas, 1);
    const avisos = await p.locator(".ss-toast").allInnerTexts();
    assert.deepEqual(avisos, ["Producto agregado"], "avisa que se agregó (antes: «Ya existe ese producto en esta categoría», con la ventana abierta)");
    await p.getByPlaceholder("Ej: Jamón Serrano").waitFor({ state: "detached" });
    const db = await h.dump();
    assert.equal(db.config.productos.categorias["Quesos"].filter((x) => x === "Queso Fontina").length, 1, "una sola vez en el catálogo");
    assert.equal(Object.keys(db.config.productos.categorias).length, Object.keys(seed.config.productos.categorias).length, "el resto del catálogo no se tocó");
  } finally {
    await h.close();
  }
});

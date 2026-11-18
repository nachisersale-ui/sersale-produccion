// Arreglos de clientes y nuevo pedido (src/pedidos/02-clientes-nuevo-pedido.jsx).
// Cada prueba maneja la pantalla real como una persona con el iPhone y después
// mira qué quedó guardado en Firestore y qué se ve.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed, PRODUCTO_AGREGADO } from "./lib/seed.mjs";

const NOCHE = "2026-11-10T22:30:00-03:00"; // en UTC ya es 11/11
const HOY = "2026-11-10";
const MANANA = "2026-11-11";

const ANGEL = "Fiambrería Don Ángel"; // cli_01, cuenta cc_01, debe $367.993
const TREBOL = "Carnicería El Trébol"; // cli_03, cuenta cc_02, debe $660.925
const DAGOSTINO = "Almacén D'Agostino"; // cuenta cc_04, $25.258 a favor
const NATA = "Fiambrería La Ñata"; // sin cuenta corriente

// ── Ayudas ──────────────────────────────────────────────────────────────────
const valores = (o) => Object.values(o || {});
const entradas = (o) => Object.entries(o || {});
const boton = (h, t) => h.page.locator("button", { hasText: t });
const toast = (h, t) => h.page.locator(".ss-toast", { hasText: t });
const hoja = (h) => h.page.locator(".ss-hoja");
const botonHoja = (h, t) => h.page.locator(".ss-hoja .ss-btn", { hasText: t });
const de = (db, col, campo, nombre) => entradas(db[col]).filter(([, d]) => d[campo] === nombre);

/** Cuántos documentos nombran a cada cliente, por colección (para comparar antes y después). */
function porCliente(db, nombre) {
  return {
    pedidos: de(db, "pedidos", "cliente", nombre).length,
    remitos: de(db, "remitos", "cliente", nombre).length,
    precios: de(db, "precios_cliente", "cliente", nombre).length,
    movimientos: de(db, "cc_movimientos", "cliente", nombre).length,
    devoluciones: de(db, "devoluciones", "cliente", nombre).length,
    cuentas: de(db, "cuentas_corrientes", "nombre", nombre).length,
    fichas: de(db, "clientes", "nombre", nombre).length,
  };
}

/** Espera (sin pausas fijas) a que la base cumpla una condición y la devuelve. */
async function hastaQue(h, cond, que, ms = 15000) {
  const fin = Date.now() + ms;
  let db = null;
  while (Date.now() < fin) {
    db = await h.dump();
    if (cond(db)) return db;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error("La base no llegó al estado esperado: " + que);
}

async function abrir(seed, opts = {}) {
  const h = await launch({ rol: "director", etiqueta: "p2", seed, ...opts });
  await h.ir("pedidos.html");
  await h.sincronizar();
  await h.page.getByText("¿Quién sos?").waitFor();
  return h;
}
async function irAClientes(h) {
  await boton(h, "Agregar, editar y eliminar clientes").click();
  await h.page.getByText(/Clientes registrados \(\d+\)/).waitFor();
}
async function irANuevoPedido(h) {
  await boton(h, "Cargar y gestionar pedidos").click();
  await h.page.getByText(/Activos \(\d+\)/).waitFor();
  await boton(h, "+ Nuevo").click();
  await h.page.getByText("Nuevo Pedido").waitFor();
}
/** Abre el selector, busca y toca el cliente. */
async function elegirCliente(h, buscar, nombre) {
  await h.page.locator("button", { hasText: /Seleccioná un cliente|▼/ }).first().click();
  await h.page.getByPlaceholder("Buscar cliente...").fill(buscar);
  await h.page.locator("button", { hasText: nombre }).first().click();
}
async function agregarProducto(h, buscar, producto, cantidad) {
  const antes = await h.page.getByPlaceholder("Cantidad").count();
  const vacia = antes === 1 && (await h.page.locator("select").first().inputValue()) === "";
  await h.page.getByPlaceholder("Buscar producto y agregarlo...").fill(buscar);
  await boton(h, producto).first().click();
  const fila = vacia ? 0 : antes;
  await h.page.getByPlaceholder("Cantidad").nth(fila).waitFor();
  if (cantidad != null) await h.page.getByPlaceholder("Cantidad").nth(fila).fill(String(cantidad));
  return fila;
}
const guardarPedido = (h) => boton(h, "Guardar Pedido").click();
const formCliente = (h) => ({
  nombre: h.page.getByPlaceholder("Nombre del cliente *"),
  telefono: h.page.getByPlaceholder("Teléfono (opcional)"),
  direccion: h.page.getByPlaceholder("Dirección de entrega"),
});

// ── Clientes ────────────────────────────────────────────────────────────────

test("clientes: cambiar el nombre lleva el nombre nuevo a pedidos, remitos, precios y cuenta corriente", async () => {
  const seed = buildSeed();
  // Cliente con años de historia: más registros de los que entran en una sola tanda de guardado (400).
  for (let i = 0; i < 430; i++) seed.precios_cliente["pre_viejo_" + i] = { cliente: ANGEL, producto: "Queso Tybo", precio: 9000 + i, fecha: "2026-09-01T12:00:00.000Z" };
  const antes = porCliente(seed, ANGEL);
  const antesTrebol = porCliente(seed, TREBOL);
  assert.ok(antes.pedidos > 0 && antes.remitos > 0 && antes.precios > 430 && antes.movimientos > 0 && antes.cuentas === 1, "el cliente de la prueba tiene de todo");
  const NUEVO = "Fiambrería Don Ángel e Hijos";
  const h = await abrir(seed);
  try {
    await irAClientes(h);
    await h.page.locator(`button[aria-label="Editar ${ANGEL}"]`).click();
    const f = formCliente(h);
    await assert.doesNotReject(f.nombre.waitFor());
    assert.equal(await f.nombre.inputValue(), ANGEL);
    await f.nombre.fill(NUEVO);
    await boton(h, "Actualizar").click();
    await hoja(h).getByText("¿Cambiar el nombre del cliente?").waitFor();
    const total = antes.pedidos + antes.remitos + antes.precios + antes.movimientos + antes.devoluciones + antes.cuentas;
    assert.match(await hoja(h).innerText(), new RegExp(`\\(${total} registros\\)`), "la hoja dice cuántos registros se tocan");
    await botonHoja(h, "Cambiar nombre").click();
    await toast(h, "Nombre cambiado").waitFor();

    const db = await hastaQue(h, (d) => d.clientes.cli_01.nombre === NUEVO, "ficha con el nombre nuevo");
    assert.deepEqual(porCliente(db, ANGEL), { pedidos: 0, remitos: 0, precios: 0, movimientos: 0, devoluciones: 0, cuentas: 0, fichas: 0 }, "no queda nada con el nombre viejo");
    assert.deepEqual(porCliente(db, NUEVO), { ...antes, fichas: 1 }, "todo pasó al nombre nuevo");
    assert.deepEqual(porCliente(db, TREBOL), antesTrebol, "los otros clientes no se tocan");
    assert.equal(db.cuentas_corrientes.cc_01.saldo, seed.cuentas_corrientes.cc_01.saldo, "el saldo no cambia");
    assert.equal(db.clientes.cli_01.direccion, seed.clientes.cli_01.direccion);
    for (const col of ["pedidos", "remitos", "precios_cliente", "cc_movimientos", "cuentas_corrientes"]) {
      assert.equal(valores(db[col]).length, valores(seed[col]).length, "misma cantidad de documentos en " + col);
    }

    // Lo que se ve: en la lista figura el nombre nuevo y al cargarle un pedido aparece su deuda.
    await h.page.getByText(NUEVO, { exact: true }).first().waitFor();
    await h.page.locator("button", { hasText: "←" }).first().click();
    await h.page.getByText("¿Quién sos?").waitFor();
    await irANuevoPedido(h);
    await elegirCliente(h, "angel e hijos", NUEVO);
    await h.page.locator("[data-saldo-cc]").getByText("Saldo pendiente: $367.993").waitFor();
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("clientes: eliminar una ficha repetida no borra la cuenta, los movimientos ni los precios del cliente", async () => {
  const seed = buildSeed();
  seed.clientes.cli_rep = { nombre: "fiambreria don angel", telefono: "", direccion: "", cuentaCorriente: false, creadoEn: { __ts: "2026-11-09T15:00:00.000Z" } };
  const antes = porCliente(seed, ANGEL);
  const h = await abrir(seed);
  try {
    await irAClientes(h);
    await h.page.locator('button[aria-label="Eliminar fiambreria don angel"]').click();
    await hoja(h).getByText("se borra solo esta ficha").waitFor();
    await botonHoja(h, "Eliminar").click();
    await toast(h, "Cliente eliminado").waitFor();
    const db = await hastaQue(h, (d) => !d.clientes.cli_rep, "ficha repetida borrada");
    assert.deepEqual(porCliente(db, ANGEL), antes, "el cliente verdadero conserva todo");
    assert.equal(db.cuentas_corrientes.cc_01.saldo, seed.cuentas_corrientes.cc_01.saldo);
    assert.equal(valores(db.cc_movimientos).length, valores(seed.cc_movimientos).length);
    assert.equal(valores(db.precios_cliente).length, valores(seed.precios_cliente).length);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("clientes: eliminar avisa la deuda, borra ficha, precios, cuenta y movimientos juntos, y deja pedidos y remitos", async () => {
  const seed = buildSeed();
  const antes = porCliente(seed, TREBOL);
  const antesAngel = porCliente(seed, ANGEL);
  const h = await abrir(seed);
  try {
    await irAClientes(h);
    // Estaba en edición ese mismo cliente: después de borrarlo el formulario tiene que quedar limpio.
    await h.page.locator(`button[aria-label="Editar ${TREBOL}"]`).click();
    await boton(h, "Actualizar").waitFor();
    await h.page.locator(`button[aria-label="Eliminar ${TREBOL}"]`).click();
    await hoja(h).getByText("Hoy debe $660.925").waitFor();
    assert.equal(h.llamadas.dialogos.length, 0, "no se usa el confirm() del navegador");

    // Cancelar no borra nada.
    await botonHoja(h, "Cancelar").click();
    await hoja(h).waitFor({ state: "detached" });
    assert.deepEqual(porCliente(await h.dump(), TREBOL), antes);

    await h.page.locator(`button[aria-label="Eliminar ${TREBOL}"]`).click();
    await botonHoja(h, "Eliminar").click();
    await toast(h, "Cliente eliminado").waitFor();
    const db = await hastaQue(h, (d) => !d.clientes.cli_03, "ficha borrada");
    assert.deepEqual(porCliente(db, TREBOL), { ...antes, fichas: 0, cuentas: 0, movimientos: 0, precios: 0 }, "se borra la ficha, la cuenta, los movimientos y los precios; quedan pedidos y remitos");
    assert.deepEqual(porCliente(db, ANGEL), antesAngel, "los demás no se tocan");
    assert.equal(valores(db.cc_movimientos).length, valores(seed.cc_movimientos).length - antes.movimientos);
    assert.equal(valores(db.precios_cliente).length, valores(seed.precios_cliente).length - antes.precios);

    await h.page.getByText(/Clientes registrados \(21\)/).waitFor();
    await boton(h, "Guardar").waitFor(); // salió del modo edición
    assert.equal(await formCliente(h).nombre.inputValue(), "");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("clientes: el cliente siguiente no hereda la dirección del anterior y no se puede cargar un nombre repetido", async () => {
  const seed = buildSeed();
  const h = await abrir(seed);
  try {
    await irAClientes(h);
    const f = formCliente(h);
    await f.nombre.fill("Despensa La Esquina");
    await f.telefono.fill("11 4000-1111");
    await f.direccion.fill("Av. Rivadavia 1234");
    await boton(h, "Guardar").click();
    await toast(h, "Cliente guardado").waitFor();
    await h.page.getByText(/Clientes registrados \(23\)/).waitFor();
    assert.equal(await f.direccion.inputValue(), "", "el formulario queda vacío");

    await f.nombre.fill("Kiosco Los Pibes");
    await boton(h, "Guardar").click();
    await h.page.getByText(/Clientes registrados \(24\)/).waitFor();
    let db = await hastaQue(h, (d) => de(d, "clientes", "nombre", "Kiosco Los Pibes").length === 1, "segundo cliente guardado");
    assert.equal(de(db, "clientes", "nombre", "Kiosco Los Pibes")[0][1].direccion, "", "sin dirección heredada");
    assert.equal(de(db, "clientes", "nombre", "Despensa La Esquina")[0][1].direccion, "Av. Rivadavia 1234");

    // Mismo nombre con otra mayúscula y sin acentos: no se crea otra ficha y lo escrito queda.
    await f.nombre.fill("  fiambreria DON angel ");
    await f.direccion.fill("Otra 123");
    await boton(h, "Guardar").click();
    await toast(h, `Ya hay un cliente cargado como "${ANGEL}"`).waitFor();
    assert.equal(await f.direccion.inputValue(), "Otra 123");
    db = await h.dump();
    assert.equal(valores(db.clientes).length, 24);
    assert.equal(h.llamadas.dialogos.length, 0, "sin alert() del navegador");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Nuevo pedido ────────────────────────────────────────────────────────────

test("nuevo pedido: una fila sin cantidad frena el guardado en vez de perderse, y dos toques guardan un solo pedido", async () => {
  const seed = buildSeed();
  const nPedidos = valores(seed.pedidos).length;
  const h = await abrir(seed);
  try {
    await irANuevoPedido(h);
    await elegirCliente(h, "ñata", NATA);
    await boton(h, "Envío / Reparto").click();
    await h.page.locator('input[type="date"]').fill(MANANA);
    await agregarProducto(h, "sublime", "Jamón Cocido Natural Sublime", 12);
    const fila2 = await agregarProducto(h, "queso tybo", "Queso Tybo", null); // se olvida la cantidad
    assert.equal(await h.page.getByPlaceholder("Cantidad").first().getAttribute("inputmode"), "decimal", "teclado numérico");

    await guardarPedido(h);
    await toast(h, "Al ítem 2 (Queso Tybo) le falta la cantidad").waitFor();
    assert.equal(valores((await h.dump()).pedidos).length, nPedidos, "no se guardó un pedido incompleto");
    await h.page.getByText("Nuevo Pedido").waitFor(); // sigue en el formulario, con lo cargado
    assert.equal(await h.page.getByPlaceholder("Cantidad").first().inputValue(), "12");

    await h.page.getByPlaceholder("Cantidad").nth(fila2).fill("0");
    await guardarPedido(h);
    await toast(h, "tiene que ser mayor a 0").waitFor();
    assert.equal(valores((await h.dump()).pedidos).length, nPedidos);

    await h.page.getByPlaceholder("Cantidad").nth(fila2).fill("8.5");
    // Dos toques seguidos en Guardar.
    await h.page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Guardar Pedido"));
      b.click();
      b.click();
    });
    await toast(h, "Pedido guardado").waitFor();
    await h.page.getByText(/Activos \(\d+\)/).waitFor();
    const db = await hastaQue(h, (d) => valores(d.pedidos).length > nPedidos, "pedido guardado");
    const nuevos = entradas(db.pedidos).filter(([id]) => !seed.pedidos[id]);
    assert.equal(nuevos.length, 1, "un solo pedido aunque se toque dos veces");
    const p = nuevos[0][1];
    assert.equal(p.cliente, NATA);
    assert.equal(p.fechaEntrega, MANANA);
    assert.equal(p.tipo, "envio");
    assert.equal(p.estado, "pendiente");
    assert.deepEqual(p.items.map((it) => [it.producto, it.cantidad, it.unidad]), [["Jamón Cocido Natural Sublime", "12", "kg"], ["Queso Tybo", "8.5", "kg"]], "los dos productos, con la cantidad como texto (igual que siempre)");
    assert.equal(valores(db.cc_movimientos).length, valores(seed.cc_movimientos).length, "cliente sin cuenta corriente: no se anota nada");
    assert.equal(h.llamadas.dialogos.length, 0, "sin alert() del navegador");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("nuevo pedido con cuenta corriente: el «Pendiente de facturar» queda atado al pedido y no toca el saldo", async () => {
  const seed = buildSeed();
  // Cuenta abierta desde «Cuentas Corrientes»: la ficha del cliente no tiene la marca.
  seed.clientes.cli_01.cuentaCorriente = false;
  const h = await abrir(seed);
  try {
    await irANuevoPedido(h);
    await elegirCliente(h, "don angel", ANGEL); // sin acento
    await h.page.locator("[data-saldo-cc]").getByText("Saldo pendiente: $367.993").waitFor();
    assert.equal(await h.page.locator('input[type="checkbox"]').isChecked(), true, "queda marcado como cuenta corriente");
    await boton(h, "Retira por local").click();
    await h.page.locator('input[type="date"]').fill("2026-11-12");
    await agregarProducto(h, "bondiola fresca", "Bondiola Fresca", 20);
    await agregarProducto(h, "tybo", "Queso Tybo", 6);
    await guardarPedido(h);
    await toast(h, "Pedido guardado").waitFor();

    const db = await hastaQue(h, (d) => valores(d.cc_movimientos).length > valores(seed.cc_movimientos).length, "movimiento pendiente");
    const [pedidoId, pedido] = entradas(db.pedidos).find(([id]) => !seed.pedidos[id]);
    assert.equal(pedido.cuentaCorriente, true);
    const movs = entradas(db.cc_movimientos).filter(([id]) => !seed.cc_movimientos[id]);
    assert.equal(movs.length, 1);
    const m = movs[0][1];
    assert.equal(m.pedidoId, pedidoId, "el pendiente guarda el id del pedido");
    assert.deepEqual(
      { cliente: m.cliente, tipo: m.tipo, monto: m.monto, movimiento: m.movimiento, fecha: m.fecha, detalle: m.detalle, obs: m.obs, origen: m.origen },
      { cliente: ANGEL, tipo: "pedido", monto: 0, movimiento: 0, fecha: "2026-11-12", detalle: "Bondiola Fresca, Queso Tybo", obs: "Pendiente de facturar", origen: "pedido_app" }
    );
    assert.equal(typeof m.createdAt, "string");
    assert.equal(db.cuentas_corrientes.cc_01.saldo, seed.cuentas_corrientes.cc_01.saldo, "el saldo queda igual");
    assert.equal(db.cuentas_corrientes.cc_01.ultimoMovimiento, seed.cuentas_corrientes.cc_01.ultimoMovimiento, "un pendiente de $0 no cambia el último movimiento");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("nuevo pedido: saldo a favor se muestra como tal, y «Otro» con un nombre que ya existe usa al cliente que ya está", async () => {
  const seed = buildSeed();
  const nClientes = valores(seed.clientes).length;
  const h = await abrir(seed);
  try {
    await irANuevoPedido(h);
    await elegirCliente(h, "agostino", DAGOSTINO);
    await h.page.locator("[data-saldo-cc]").getByText("Saldo a favor: $25.258").waitFor();

    // No lo encuentra por como lo escribe, toca «Otro»: el nombre buscado ya queda cargado.
    await elegirCliente(h, "fiambreria la nata.", "Otro (cliente nuevo)");
    const custom = h.page.getByPlaceholder("Nombre del cliente");
    assert.equal(await custom.inputValue(), "fiambreria la nata.");
    await h.page.locator("[data-saldo-cc]").waitFor({ state: "detached" });
    await custom.fill("FIAMBRERIA  LA ÑATA");
    await boton(h, "Envío / Reparto").click();
    await h.page.locator('input[type="date"]').fill(MANANA);
    await agregarProducto(h, "salamin picado fino", "Salamín Picado Fino", 5);
    await guardarPedido(h);
    await toast(h, "Pedido guardado").waitFor();
    // El contacto se marca después de guardar el pedido: se espera el de ahora (la prueba corre a las 10:30 = 13:30 UTC).
    const db = await hastaQue(h, (d) => valores(d.pedidos).length > valores(seed.pedidos).length && (d.clientes.cli_02.ultimoContacto || "") >= "2026-11-10T13:30", "pedido y contacto guardados");
    const pedido = entradas(db.pedidos).find(([id]) => !seed.pedidos[id])[1];
    assert.equal(pedido.cliente, NATA, "el pedido va a nombre del cliente que ya existía");
    assert.equal(valores(db.clientes).length, nClientes, "no se crea una ficha repetida");
    assert.equal(db.clientes.cli_02.ultimoPedidoRegistrado, HOY);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("nuevo pedido de un cliente nuevo marcado «cuenta corriente»: no deja movimientos sueltos y la ficha queda con la marca", async () => {
  const seed = buildSeed();
  const h = await abrir(seed);
  try {
    await irANuevoPedido(h);
    await elegirCliente(h, "Granja Tres Arroyos", "Otro (cliente nuevo)");
    assert.equal(await h.page.getByPlaceholder("Nombre del cliente").inputValue(), "Granja Tres Arroyos");
    await h.page.locator('input[type="checkbox"]').check();
    await boton(h, "Envío / Reparto").click();
    await h.page.locator('input[type="date"]').fill(MANANA);
    await agregarProducto(h, "pollo", "Pollo", 30);
    await guardarPedido(h);
    await toast(h, "Pedido guardado").waitFor();
    const db = await hastaQue(h, (d) => de(d, "clientes", "nombre", "Granja Tres Arroyos").length === 1, "ficha del cliente nuevo");
    const pedido = entradas(db.pedidos).find(([id]) => !seed.pedidos[id])[1];
    assert.equal(pedido.cliente, "Granja Tres Arroyos");
    assert.equal(pedido.cuentaCorriente, true);
    assert.equal(de(db, "clientes", "nombre", "Granja Tres Arroyos")[0][1].cuentaCorriente, true, "la ficha nueva guarda la marca");
    assert.equal(de(db, "cc_movimientos", "cliente", "Granja Tres Arroyos").length, 0, "sin cuenta abierta no se anota un movimiento que nadie ve");
    assert.equal(de(db, "cuentas_corrientes", "nombre", "Granja Tres Arroyos").length, 0, "la cuenta la abre el remito");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("de noche (22:30): se puede elegir hoy como entrega y el contacto queda con la fecha de hoy, no la de mañana", async () => {
  const seed = buildSeed();
  const h = await abrir(seed, { now: NOCHE });
  try {
    await irANuevoPedido(h);
    assert.equal(await h.page.locator('input[type="date"]').getAttribute("min"), HOY, "la fecha mínima es hoy en Buenos Aires");
    await elegirCliente(h, "ñata", NATA);
    await boton(h, "Retira por local").click();
    await h.page.locator('input[type="date"]').fill(HOY);
    await agregarProducto(h, "sublime", "Jamón Cocido Natural Sublime", 3);
    await guardarPedido(h);
    await toast(h, "Pedido guardado").waitFor();
    const db = await hastaQue(h, (d) => (d.clientes.cli_02.ultimoContacto || "") > "2026-11-11T01:00", "contacto marcado");
    assert.equal(db.clientes.cli_02.ultimoPedidoRegistrado, HOY, "día de Buenos Aires");
    const pedido = entradas(db.pedidos).find(([id]) => !seed.pedidos[id])[1];
    assert.equal(pedido.fechaEntrega, HOY);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("de noche (22:30): el mail de alertas se anota con el día de hoy y no dice «Invalid Date»", async () => {
  const seed = buildSeed();
  seed.config.ultima_alerta_email = { ...seed.config.ultima_alerta_email, fecha: "2026-11-09" };
  const h = await abrir(seed, { now: NOCHE });
  try {
    await boton(h, "Panel general y cuentas corrientes").click();
    const db = await hastaQue(h, (d) => d.config.ultima_alerta_email.fecha !== "2026-11-09", "mail de alertas enviado");
    assert.equal(db.config.ultima_alerta_email.fecha, HOY, "se anota el día de Buenos Aires: mañana a la mañana vuelve a salir");
    const envios = h.llamadas.terceros.filter((t) => /emailjs/.test(t.url));
    assert.equal(envios.length, 1);
    const cuerpo = String(envios[0].cuerpo || "");
    assert.match(cuerpo, /Ultimo pedido: \d{2}\/\d{2}\/\d{4}/, "fecha del último pedido legible");
    assert.doesNotMatch(cuerpo, /Invalid Date/);
  } finally {
    await h.close();
  }
});

test("precios: un producto agregado desde «Productos» aparece en la lista de precios del cliente", async () => {
  const seed = buildSeed();
  assert.ok(seed.config.productos.categorias[PRODUCTO_AGREGADO.categoria].includes(PRODUCTO_AGREGADO.producto));
  const h = await abrir(seed);
  try {
    await boton(h, "Panel general y cuentas corrientes").click();
    await boton(h, "💲 Precios").click();
    await h.page.locator("select").first().waitFor();
    const total = valores(seed.config.productos.categorias).flat().filter(Boolean).length;
    const sel = h.page.locator("select", { has: h.page.locator("option", { hasText: ANGEL }) }).first();
    await sel.selectOption({ label: ANGEL });
    await h.page.getByText(new RegExp(`de ${total} productos con precio acordado`)).waitFor();
    await h.page.getByText(PRODUCTO_AGREGADO.producto, { exact: true }).first().waitFor();
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// Arreglos de cuentas corrientes y remitos (src/pedidos/00, 03 y 06).
// Cada prueba maneja la pantalla real como una persona con el iPhone y después
// mira qué quedó guardado en Firestore y qué se ve.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const NOCHE = "2026-11-10T22:30:00-03:00"; // en UTC ya es 11/11
const HOY = "2026-11-10";

const DISTRI = "Distribuidora Mayorista del Sur S.R.L.";
const TREBOL = "Carnicería El Trébol";
const ANGEL = "Fiambrería Don Ángel";
const DAGOSTINO = "Almacén D'Agostino";
const SABOR = "Rotisería El Buen Sabor";
const GAMAS_BOEDO = "Panificadora Gamas - Sucursal Boedo";
const ROSA = "Almacén Doña Rosa";
const PIZZA = "Pizzería El Cuartito de Barracas";
const NATA = "Fiambrería La Ñata";
const GAMAS_CABALLITO = "Panificadora Gamas - Sucursal Caballito";

const VISTAS = { comercial: "Cargar y gestionar pedidos", director: "Panel general y cuentas corrientes" };

// ── Ayudas ──────────────────────────────────────────────────────────────────
const r2 = (n) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
const copia = (o) => JSON.parse(JSON.stringify(o));
const valores = (o) => Object.values(o || {});
const entradas = (o) => Object.entries(o || {});

async function abrir(seed, vista, opts = {}) {
  const h = await launch({ rol: "director", etiqueta: "cc", seed, ...opts });
  await h.ir("pedidos.html");
  await h.sincronizar();
  await h.page.getByText("¿Quién sos?").waitFor();
  await h.page.locator("button", { hasText: VISTAS[vista] }).click();
  if (vista === "comercial") await h.page.getByText(/Activos \(\d+\)/).waitFor();
  return h;
}
const boton = (h, t) => h.page.locator("button", { hasText: t });
const toast = (h, t) => h.page.locator(".ss-toast", { hasText: t });
const hoja = (h) => h.page.locator(".ss-hoja");
const botonHoja = (h, t) => h.page.locator(".ss-hoja .ss-btn", { hasText: t });
const precioInputs = (h) => h.page.locator('input[placeholder="$ / kg"]');
const nroRemito = (h) => h.page.locator('input[aria-label="Número de remito"]');

/** Comercial → tocar la tarjeta del cliente → «🧾 Remito», y esperar número y precios guardados. */
async function abrirRemito(h, cliente, { esperarPrecios = true } = {}) {
  await h.page.locator("span", { hasText: cliente }).first().click();
  await boton(h, "🧾 Remito").click();
  await h.page.getByText("Remito — " + cliente).waitFor();
  await h.page.waitForFunction(() => {
    const i = document.querySelector('input[aria-label="Número de remito"]');
    return i && i.value !== "";
  });
  if (esperarPrecios) {
    await h.page.waitForFunction(() => [...document.querySelectorAll('input[placeholder="$ / kg"]')].some((i) => i.value !== ""));
  }
}
/** Director → pestaña CC. */
async function abrirCC(h) {
  await h.page.getByText("Activos", { exact: true }).first().waitFor();
  await boton(h, "💳 CC").click();
  await h.page.getByText("Deuda total").waitFor();
}
const tarjetaCC = (h, nombre) =>
  h.page.locator("div", { has: h.page.getByText(nombre, { exact: true }) }).filter({ has: boton(h, "Ver movimientos") }).last();

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
const pdfTextos = (h) => h.page.evaluate(() => window.__pdfTextos.slice());

/** La otra persona (otro teléfono) cambia un documento; se espera a que este teléfono lo tenga en su copia. */
async function desdeOtroTelefono(h, coleccion, id, datos) {
  await h.sembrar({ [coleccion]: { [id]: datos } });
}
async function esperarCopia(h, coleccion, id, prueba, arg) {
  await h.page.waitForFunction(
    async ({ coleccion, id, prueba, arg }) => {
      const m = await import("/js/fb.js");
      const s = await m.getDoc(m.doc(m.db, coleccion, id));
      // eslint-disable-next-line no-new-func
      return s.exists() && new Function("d", "arg", "return (" + prueba + ")(d, arg)")(s.data(), arg);
    },
    { coleccion, id, prueba: prueba.toString(), arg }
  );
}

/** Último precio guardado de cada producto para un cliente (lo que precarga la pantalla de remito). */
function ultimosPrecios(seed, cliente) {
  const out = {};
  valores(seed.precios_cliente)
    .filter((p) => p.cliente === cliente)
    .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""))
    .forEach((p) => { if (!out[p.producto]) out[p.producto] = p.precio; });
  return out;
}
const kgDe = (it) => (it.kgReal != null && it.kgReal !== "" ? Number(it.kgReal) : parseFloat(it.cantidad) || 0);
function totalEsperado(pedido, precios) {
  return r2(pedido.items.reduce((s, it) => s + r2(kgDe(it) * (precios[it.producto] || 0)), 0));
}
const cuentaDe = (db, nombre) => entradas(db.cuentas_corrientes).filter(([, c]) => c.nombre === nombre);
const movsDe = (db, nombre) => valores(db.cc_movimientos).filter((m) => m.cliente === nombre);
const remitosDe = (db, pedidoId) => entradas(db.remitos).filter(([, r]) => r.pedidoId === pedidoId);
const pedidoDe = (seed, cliente, filtro = () => true) => entradas(seed.pedidos).find(([, p]) => p.cliente === cliente && filtro(p));

// ── REMITO ──────────────────────────────────────────────────────────────────

test("remito: un ítem pesado en 0 kg no se cobra, y el remito, la cuenta y el PDF dicen lo mismo (de noche, con fecha de hoy)", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = pedidoDe(seed, DISTRI, (p) => p.estado === "listo");
  pedido.items[0].kgReal = 0; // no había: el depósito cargó 0
  const precios = ultimosPrecios(seed, DISTRI);
  assert.ok(precios[pedido.items[0].producto] > 0, "el producto sin stock tiene precio guardado (antes se cobraba)");
  const total = totalEsperado(pedido, precios);
  const saldoAntes = cuentaDe(seed, DISTRI)[0][1].saldo;
  const movsAntes = Object.keys(seed.cc_movimientos).length;

  const h = await abrir(seed, "comercial", { now: NOCHE });
  try {
    await espiarPdf(h);
    await abrirRemito(h, DISTRI);
    assert.equal(await nroRemito(h).inputValue(), "0040");
    await h.page.getByText("0 kg", { exact: true }).waitFor(); // la pantalla muestra 0 kg para ese ítem
    await boton(h, "💾 Guardar").dblclick(); // doble toque: se guarda una sola vez
    await toast(h, "Remito N° 0040 guardado").waitFor();
    await h.page.locator('[data-aviso="remito-cc"]').waitFor();

    const db = await h.dump();
    const rems = remitosDe(db, pedidoId);
    assert.equal(rems.length, 1, "un solo remito para el pedido");
    const rem = rems[0][1];
    assert.equal(rem.nro, 40);
    assert.equal(rem.items[0].kg, 0, "kg guardado = 0, no la cantidad pedida");
    assert.equal(rem.items[0].total, 0);
    assert.equal(rem.items[0].precio, precios[pedido.items[0].producto]);
    assert.equal(rem.total, total, "total del remito = suma de kg reales por precio");
    assert.equal(rem.fecha, HOY, "fecha del remito: hoy en Buenos Aires, no mañana");
    assert.equal(rem.fechaEntrega, pedido.fechaEntrega, "el remito guarda la fecha de entrega");
    assert.equal(rem.tipo, pedido.tipo, "el remito guarda si es envío o retiro");
    assert.equal(db.config.contador_remitos.ultimo, 40);

    // Cuenta corriente: el "Pendiente de facturar" pasó a tener el importe; no se creó otro movimiento.
    assert.equal(Object.keys(db.cc_movimientos).length, movsAntes, "no se agregaron movimientos");
    const cargos = movsDe(db, DISTRI).filter((m) => m.remitoNro === 40);
    assert.equal(cargos.length, 1);
    assert.equal(cargos[0].monto, Math.round(total));
    assert.equal(cargos[0].movimiento, Math.round(total));
    assert.equal(cargos[0].origen, "pedido_app");
    assert.equal(cargos[0].obs, "Remito N° 0040");
    const cuenta = cuentaDe(db, DISTRI)[0][1];
    assert.equal(cuenta.saldo, saldoAntes + Math.round(total), "saldo = saldo anterior + total del remito");
    assert.equal(cuenta.ultimoMovimiento, HOY);

    // El PDF que se comparte DESPUÉS de guardar lleva el número guardado (no el siguiente).
    await boton(h, "📤 Compartir PDF").click();
    await h.page.waitForFunction(() => window.__compartidos.length === 1);
    const textos = await pdfTextos(h);
    assert.ok(textos.includes("N° 0040"), "el PDF dice N° 0040: " + textos.filter((t) => t.startsWith("N°")));
    assert.ok(!textos.includes("N° 0041"));
    assert.ok(textos.includes("10/11/2026"), "fecha del PDF = fecha del remito");
    const compartido = (await h.compartidos())[0];
    assert.match(compartido.archivos[0].nombre, /^Remito 0040 - /);
    assert.equal(await nroRemito(h).inputValue(), "0040");
  } finally {
    await h.close();
  }
});

test("remito: volver a guardarlo corrige el mismo remito y su cargo, no cobra dos veces", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = pedidoDe(seed, DISTRI, (p) => p.estado === "listo");
  const precios = ultimosPrecios(seed, DISTRI);
  const saldoAntes = cuentaDe(seed, DISTRI)[0][1].saldo;
  const movsAntes = Object.keys(seed.cc_movimientos).length;
  const h = await abrir(seed, "comercial");
  try {
    await abrirRemito(h, DISTRI);
    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 guardado").waitFor();
    const saldo1 = cuentaDe(await h.dump(), DISTRI)[0][1].saldo;
    assert.equal(saldo1, saldoAntes + Math.round(totalEsperado(pedido, precios)));

    // Se da cuenta de un precio mal: vuelve, abre otra vez el remito, corrige y guarda.
    await boton(h, "←").first().click();
    await h.page.getByText(/Activos \(\d+\)/).waitFor();
    await abrirRemito(h, DISTRI);
    await h.page.locator('[data-aviso="remito-emitido"]').waitFor();
    assert.equal(await nroRemito(h).inputValue(), "0040", "muestra el número ya emitido");
    await precioInputs(h).nth(1).fill("9000");
    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 corregido").waitFor();

    const db = await h.dump();
    const rems = remitosDe(db, pedidoId);
    assert.equal(rems.length, 1, "sigue habiendo un solo remito");
    assert.equal(rems[0][1].nro, 40);
    assert.equal(rems[0][1].items[1].precio, 9000);
    assert.equal(db.config.contador_remitos.ultimo, 40, "no se gastó otro número");
    const total2 = totalEsperado(pedido, { ...precios, [pedido.items[1].producto]: 9000 });
    assert.equal(rems[0][1].total, total2);
    assert.equal(Object.keys(db.cc_movimientos).length, movsAntes, "ningún movimiento de más");
    const cargos = movsDe(db, DISTRI).filter((m) => m.remitoNro === 40);
    assert.equal(cargos.length, 1, "un solo cargo por el pedido");
    assert.equal(cargos[0].monto, Math.round(total2));
    assert.equal(cuentaDe(db, DISTRI)[0][1].saldo, saldoAntes + Math.round(total2), "el saldo refleja un solo cargo, ya corregido");
    const nuevos = valores(db.precios_cliente).filter((p) => p.cliente === DISTRI && p.producto === pedido.items[1].producto && p.precio === 9000);
    assert.equal(nuevos.length, 1, "el precio corregido quedó guardado una vez");
  } finally {
    await h.close();
  }
});

test("remito: si falla al guardar no queda nada a medias, se avisa y se puede reintentar", async () => {
  const seed = buildSeed();
  const [pedidoId] = pedidoDe(seed, DISTRI, (p) => p.estado === "listo");
  const saldoAntes = cuentaDe(seed, DISTRI)[0][1].saldo;
  const h = await abrir(seed, "comercial");
  try {
    await abrirRemito(h, DISTRI);
    // El servidor rechaza la escritura (como un corte o un permiso caído).
    const falla = (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: 403, message: "rechazado por la prueba", status: "PERMISSION_DENIED" } }) });
    await h.page.route(/documents:commit/, falla);
    await boton(h, "💾 Guardar").click();
    await h.page.locator(".ss-toast-error", { hasText: "No se pudo guardar el remito" }).waitFor();
    let db = await h.dump();
    assert.equal(remitosDe(db, pedidoId).length, 0, "no quedó un remito a medias");
    assert.equal(db.config.contador_remitos.ultimo, 39, "no se gastó el número");
    assert.equal(cuentaDe(db, DISTRI)[0][1].saldo, saldoAntes, "el saldo no se tocó");
    assert.equal(movsDe(db, DISTRI).filter((m) => m.remitoNro === 40).length, 0);
    assert.equal(await boton(h, "💾 Guardar").isEnabled(), true, "el botón queda listo para reintentar (no dice Guardado)");

    await h.page.unroute(/documents:commit/, falla);
    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 guardado").waitFor();
    db = await h.dump();
    assert.equal(remitosDe(db, pedidoId).length, 1);
    assert.equal(movsDe(db, DISTRI).filter((m) => m.remitoNro === 40).length, 1);
    assert.ok(cuentaDe(db, DISTRI)[0][1].saldo > saldoAntes);
  } finally {
    await h.close();
  }
});

test("remito: un pedido ya despachado sin remito se puede facturar desde el Historial y su «Pendiente de facturar» toma el importe", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = pedidoDe(seed, GAMAS_CABALLITO, (p) => p.fechaEntrega === "2026-11-05");
  assert.equal(pedido.estado, "despachado");
  assert.equal(remitosDe(seed, pedidoId).length, 0, "el pedido de ejemplo no tiene remito");
  const pendiente = entradas(seed.cc_movimientos).find(([, m]) => m.cliente === GAMAS_CABALLITO && m.fecha === "2026-11-05" && m.origen === "pedido_app");
  assert.equal(pendiente[1].monto, 0);
  const saldoAntes = cuentaDe(seed, GAMAS_CABALLITO)[0][1].saldo;

  const h = await abrir(seed, "comercial");
  try {
    await boton(h, /Historial \(\d+\)/).click();
    await h.page.getByText("Filtrar historial").waitFor();
    await h.page.locator("select").first().selectOption({ label: GAMAS_CABALLITO });
    await h.page.locator('input[type="date"]').nth(0).fill("2026-11-05");
    await h.page.locator('input[type="date"]').nth(1).fill("2026-11-05");
    await h.page.getByText("1 pedido encontrados").waitFor();
    await abrirRemito(h, GAMAS_CABALLITO, { esperarPrecios: false });
    // Completar los precios que falten
    const n = await precioInputs(h).count();
    for (let i = 0; i < n; i++) if ((await precioInputs(h).nth(i).inputValue()) === "") await precioInputs(h).nth(i).fill("10000");
    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 guardado").waitFor();

    const db = await h.dump();
    const rems = remitosDe(db, pedidoId);
    assert.equal(rems.length, 1);
    assert.ok(rems[0][1].total > 0);
    const mov = db.cc_movimientos[pendiente[0]];
    assert.equal(mov.monto, Math.round(rems[0][1].total), "el pendiente de facturar tomó el importe");
    assert.equal(mov.remitoNro, 40);
    assert.equal(mov.fecha, "2026-11-05", "conserva la fecha de entrega");
    assert.equal(Object.keys(db.cc_movimientos).length, Object.keys(seed.cc_movimientos).length);
    assert.equal(cuentaDe(db, GAMAS_CABALLITO)[0][1].saldo, saldoAntes + Math.round(rems[0][1].total));
    assert.equal(db.pedidos[pedidoId].estado, "despachado", "el pedido sigue despachado");
  } finally {
    await h.close();
  }
});

test("remito: pedido marcado «cuenta corriente» de un cliente sin cuenta: se abre la cuenta y la deuda queda a la vista", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = pedidoDe(seed, SABOR, (p) => p.estado === "listo");
  pedido.cuentaCorriente = true; // lo tildaron a mano al editar
  assert.equal(cuentaDe(seed, SABOR).length, 0);
  const total = totalEsperado(pedido, ultimosPrecios(seed, SABOR));
  assert.ok(total > 0);
  const h = await abrir(seed, "comercial");
  try {
    await abrirRemito(h, SABOR);
    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 guardado").waitFor();
    await h.page.locator('[data-aviso="remito-cc"]', { hasText: "Se abrió la cuenta corriente" }).waitFor();
    const db = await h.dump();
    const cuentas = cuentaDe(db, SABOR);
    assert.equal(cuentas.length, 1, "se abrió la cuenta");
    assert.equal(cuentas[0][1].saldo, Math.round(total));
    const movs = movsDe(db, SABOR);
    assert.equal(movs.length, 1);
    assert.equal(movs[0].tipo, "pedido");
    assert.equal(movs[0].monto, Math.round(total));
    assert.equal(movs[0].origen, "remito");
    assert.equal(movs[0].pedidoId, pedidoId);
    assert.equal(movs[0].fecha, pedido.fechaEntrega);
  } finally {
    await h.close();
  }
});

test("remito: cliente sin cuenta corriente y pedido sin marcar: se guarda el remito y no se toca ninguna cuenta", async () => {
  const seed = buildSeed();
  const [pedidoId] = pedidoDe(seed, SABOR, (p) => p.estado === "listo");
  const h = await abrir(seed, "comercial");
  try {
    await abrirRemito(h, SABOR);
    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 guardado").waitFor();
    const db = await h.dump();
    assert.equal(remitosDe(db, pedidoId).length, 1);
    assert.equal(cuentaDe(db, SABOR).length, 0);
    assert.equal(movsDe(db, SABOR).length, 0);
    assert.deepEqual(db.cuentas_corrientes, copia(seed.cuentas_corrientes), "ninguna cuenta cambió");
  } finally {
    await h.close();
  }
});

test("remito: factura los kg que hay ahora en el pedido, no los de la lista vieja; si cambian mientras tanto, avisa y no guarda", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = pedidoDe(seed, DISTRI, (p) => p.estado === "listo");
  const precios = ultimosPrecios(seed, DISTRI);
  const h = await abrir(seed, "comercial"); // la lista de Comercial queda cargada con los kg viejos
  try {
    // El depósito corrige un peso desde su teléfono.
    const v2 = copia(pedido);
    v2.items[1].kgReal = 30;
    await desdeOtroTelefono(h, "pedidos", pedidoId, { ...pedido, items: v2.items });
    await esperarCopia(h, "pedidos", pedidoId, (d) => d.items[1].kgReal === 30);
    await abrirRemito(h, DISTRI);
    await h.page.getByText("30 kg", { exact: true }).waitFor(); // la pantalla muestra el peso corregido

    // Con el remito abierto, lo vuelven a corregir.
    const v3 = copia(v2);
    v3.items[1].kgReal = 31.5;
    await desdeOtroTelefono(h, "pedidos", pedidoId, { ...pedido, items: v3.items });
    await boton(h, "💾 Guardar").click();
    await toast(h, "El pedido cambió desde otro teléfono").waitFor();
    assert.equal(remitosDe(await h.dump(), pedidoId).length, 0, "no se guardó con los kg viejos");
    await h.page.getByText("31.5 kg", { exact: true }).waitFor(); // se actualizó sola

    await boton(h, "💾 Guardar").click();
    await toast(h, "Remito N° 0040 guardado").waitFor();
    const db = await h.dump();
    const rem = remitosDe(db, pedidoId)[0][1];
    assert.equal(rem.items[1].kg, 31.5);
    assert.equal(rem.total, totalEsperado(v3, precios));
  } finally {
    await h.close();
  }
});

// ── PEDIDOS: CAMBIOS DESDE DOS TELÉFONOS ────────────────────────────────────

test("pedidos: una tarjeta vieja no revive un pedido cancelado ni pisa productos agregados desde otro teléfono", async () => {
  const seed = buildSeed();
  const [idPizza, pizza] = pedidoDe(seed, PIZZA, (p) => p.estado === "pendiente");
  const [idRosa, rosa] = pedidoDe(seed, ROSA, (p) => p.estado === "pendiente");
  const h = await abrir(seed, "comercial");
  try {
    // Otro teléfono cancela el pedido de la pizzería y le agrega un producto al de Doña Rosa.
    const cancelado = { ...pizza, estado: "cancelado", historial: [...pizza.historial, { estado: "cancelado", fecha: "2026-11-10T13:00:00.000Z" }] };
    await desdeOtroTelefono(h, "pedidos", idPizza, cancelado);
    const conExtra = { ...rosa, items: [...rosa.items, { categoria: "Quesos", producto: "Queso Tybo", cantidad: "2", unidad: "kg", obs: "" }] };
    await desdeOtroTelefono(h, "pedidos", idRosa, conExtra);

    // En este teléfono la tarjeta todavía dice PENDIENTE.
    await h.page.locator("span", { hasText: PIZZA }).first().click();
    await boton(h, "⚙️ En preparación").click();
    await boton(h, "Confirmar — En preparación").click();
    await toast(h, "ahora está CANCELADO").waitFor();
    let db = await h.dump();
    assert.equal(db.pedidos[idPizza].estado, "cancelado", "sigue cancelado");
    assert.equal(db.pedidos[idPizza].historial.length, cancelado.historial.length);

    // La lista se recargó sola. Doña Rosa: ahora la tarjeta ya muestra 4 productos y se puede preparar.
    await h.page.locator("div", { has: h.page.locator("span", { hasText: ROSA }) }).filter({ hasText: "4 productos" }).last().waitFor();
    await h.page.locator("span", { hasText: ROSA }).first().click();
    await boton(h, "⚙️ En preparación").click();
    await h.page.locator('input[placeholder="kg"]').first().fill("2.1");
    await boton(h, "Confirmar — En preparación").click();
    await h.page.getByText("Anotar kg por ítem").waitFor({ state: "detached" });
    db = await h.dump();
    assert.equal(db.pedidos[idRosa].estado, "preparando");
    assert.equal(db.pedidos[idRosa].items.length, 4, "no se perdió el producto agregado");
    assert.equal(db.pedidos[idRosa].items[0].kgReal, 2.1);
    assert.equal(db.pedidos[idRosa].items[3].producto, "Queso Tybo");
  } finally {
    await h.close();
  }
});

test("pedidos: con la lista vieja, «En preparación» no borra un producto agregado después (avisa y recarga)", async () => {
  const seed = buildSeed();
  const [idRosa, rosa] = pedidoDe(seed, ROSA, (p) => p.estado === "pendiente");
  const h = await abrir(seed, "comercial");
  try {
    await h.page.locator("span", { hasText: ROSA }).first().click();
    await boton(h, "⚙️ En preparación").click(); // hoja de kg abierta con los 3 productos viejos
    const conExtra = { ...rosa, items: [...rosa.items, { categoria: "Quesos", producto: "Queso Tybo", cantidad: "2", unidad: "kg", obs: "" }] };
    await desdeOtroTelefono(h, "pedidos", idRosa, conExtra);
    await h.page.locator('input[placeholder="kg"]').first().fill("2.1");
    await boton(h, "Confirmar — En preparación").click();
    await toast(h, "Los productos del pedido").waitFor();
    const db = await h.dump();
    assert.equal(db.pedidos[idRosa].items.length, 4, "el producto agregado sigue en el pedido");
    assert.equal(db.pedidos[idRosa].estado, "pendiente", "no se cambió nada");
  } finally {
    await h.close();
  }
});

test("pedidos: corregir un kg desde una tarjeta vieja no pisa el kg que corrigió el depósito en otro ítem", async () => {
  const seed = buildSeed();
  const [id, pedido] = pedidoDe(seed, SABOR, (p) => p.estado === "listo");
  assert.deepEqual(pedido.items.map((i) => i.kgReal), [20.26, 9.76, 5]);
  const h = await abrir(seed, "comercial");
  try {
    const v2 = copia(pedido);
    v2.items[1].kgReal = 9.9;
    await desdeOtroTelefono(h, "pedidos", id, { ...pedido, items: v2.items });
    await h.page.locator("span", { hasText: SABOR }).first().click();
    await boton(h, "⚖️ kg").click();
    await h.page.getByText("Editar kg — " + SABOR).waitFor();
    assert.equal(await h.page.locator('input[placeholder="kg"]').nth(0).getAttribute("inputmode"), "decimal");
    await h.page.locator('input[placeholder="kg"]').nth(0).fill("21");
    await boton(h, "✓ Guardar kg").click();
    await h.page.getByText("Editar kg — " + SABOR).waitFor({ state: "detached" });
    const db = await h.dump();
    assert.deepEqual(db.pedidos[id].items.map((i) => i.kgReal), [21, 9.9, 5]);
    assert.equal(db.pedidos[id].estado, "listo");
  } finally {
    await h.close();
  }
});

test("editar pedido: guardar no borra los kg que cargó el depósito mientras tanto; cambiar el producto de una fila limpia su kg", async () => {
  const seed = buildSeed();
  const [id, pedido] = pedidoDe(seed, GAMAS_BOEDO, (p) => p.estado === "preparando");
  assert.deepEqual(pedido.items.map((i) => i.kgReal), [15.2, null, null]);
  const h = await abrir(seed, "comercial");
  try {
    await h.page.locator("span", { hasText: GAMAS_BOEDO }).first().click();
    await boton(h, "✏️").click();
    await h.page.getByText("Editar Pedido").waitFor();
    // El cliente del pedido queda elegido en la lista (no como «Otro» con el nombre editable).
    await h.page.waitForFunction((nombre) => document.querySelector("select").value === nombre, GAMAS_BOEDO);

    // Mientras el formulario está abierto, el depósito pesa los otros dos ítems.
    const v2 = copia(pedido);
    v2.items[1].kgReal = 19.8;
    v2.items[2].kgReal = 10.1;
    await desdeOtroTelefono(h, "pedidos", id, { ...pedido, items: v2.items });

    // Fila 1: se cambia el producto (lo pesado era del anterior).
    const fila1 = h.page.getByText("Ítem 1", { exact: true }).locator("xpath=../..");
    const otro = await fila1.locator("select").nth(1).evaluate((sel) => [...sel.options].map((o) => o.value).find((v) => v && v !== sel.value));
    await fila1.locator("select").nth(1).selectOption(otro);
    await h.page.getByPlaceholder("Notas sobre el pedido, horario de entrega, etc.").fill("Entregar por el fondo");
    await boton(h, "✓ Guardar Cambios").dblclick();
    await toast(h, "Pedido actualizado").waitFor();

    const p = (await h.dump()).pedidos[id];
    assert.equal(p.obs, "Entregar por el fondo");
    assert.equal(p.cliente, GAMAS_BOEDO);
    assert.equal(p.items[0].producto, otro);
    assert.equal(p.items[0].kgReal, null, "el kg del producto anterior no se arrastra");
    assert.equal(p.items[1].kgReal, 19.8, "se conserva lo que pesó el depósito");
    assert.equal(p.items[2].kgReal, 10.1);
    assert.equal(p.estado, "preparando");
  } finally {
    await h.close();
  }
});

test("pedidos: cancelar pide confirmación", async () => {
  const seed = buildSeed();
  const [id] = pedidoDe(seed, ROSA, (p) => p.estado === "pendiente");
  const h = await abrir(seed, "comercial");
  try {
    await h.page.locator("span", { hasText: ROSA }).first().click();
    await boton(h, "❌").click();
    await hoja(h).waitFor();
    await botonHoja(h, "Volver").click();
    await hoja(h).waitFor({ state: "detached" });
    assert.equal((await h.doc("pedidos/" + id)).estado, "pendiente", "tocar ❌ y arrepentirse no cancela");
    await boton(h, "❌").click();
    await botonHoja(h, "Cancelar pedido").click();
    await h.page.waitForFunction(() => !document.body.innerText.includes("Almacén Doña Rosa"));
    assert.equal((await h.doc("pedidos/" + id)).estado, "cancelado");
    assert.equal(h.llamadas.dialogos.length, 0, "sin confirm() del navegador");
  } finally {
    await h.close();
  }
});

// ── CUENTAS CORRIENTES ──────────────────────────────────────────────────────

/** El Trébol con una cuenta fusionada por la migración y un cargo escrito con otras mayúsculas. */
function seedTrebolConVariantes() {
  const seed = buildSeed();
  const [ccId, cc] = cuentaDe(seed, TREBOL)[0];
  const cli = entradas(seed.clientes).find(([, c]) => c.nombre === TREBOL)[0];
  seed.cc_movimientos.ccm_variante = {
    cliente: "CARNICERÍA EL TRÉBOL ", tipo: "pedido", monto: 120000, movimiento: 120000, fecha: "2026-11-06",
    detalle: "Costillitas de Cerdo (cargado con otro nombre)", obs: "Remito N° 0900", origen: "remito", remitoNro: 900, createdAt: "2026-11-06T14:00:00.000Z",
  };
  cc.saldo += 120000; // así lo dejó el remito, que sí reconocía el nombre
  cc.clienteId = cli;
  seed.cuentas_corrientes.cc_fusionada = { nombre: "carniceria el trebol", saldo: 0, mergedInto: ccId, clienteId: cli, creadoEn: "2026-09-01T12:00:00.000Z", ultimoMovimiento: "2026-09-01" };
  return { seed, ccId, saldo: cc.saldo };
}

test("cuenta corriente: registrar un pago resta solo el pago (no borra cargos escritos con otro nombre), de noche queda con fecha de hoy", async () => {
  const { seed, ccId, saldo } = seedTrebolConVariantes();
  const h = await abrir(seed, "director", { now: NOCHE });
  try {
    await abrirCC(h);
    assert.equal(await h.page.getByText(/^carniceria el trebol$/).count(), 0, "la cuenta fusionada no aparece en la lista");
    const tarjeta = tarjetaCC(h, TREBOL);
    assert.equal((await tarjeta.locator("[data-saldo]").innerText()).trim(), "$780.925");
    await tarjeta.locator("button", { hasText: "Registrar pago" }).click();
    await h.page.getByText("Registrar pago", { exact: true }).first().waitFor();
    await h.page.locator('input[placeholder="0"]').fill("10000");
    await boton(h, "✓ Confirmar pago").dblclick(); // doble toque: un solo pago
    await toast(h, "Pago de $10.000 registrado").waitFor();
    await h.page.waitForFunction(() => [...document.querySelectorAll("[data-saldo]")].some((e) => e.textContent.trim() === "$770.925"));

    const db = await h.dump();
    assert.equal(db.cuentas_corrientes[ccId].saldo, saldo - 10000, "saldo = saldo guardado − pago");
    assert.equal(db.cuentas_corrientes[ccId].ultimoMovimiento, HOY);
    assert.equal(db.cuentas_corrientes.cc_fusionada.saldo, 0, "la cuenta fusionada no se toca");
    const pagos = valores(db.cc_movimientos).filter((m) => m.tipo === "pago" && m.monto === 10000 && m.cliente === TREBOL && m.fecha === HOY);
    assert.equal(pagos.length, 1, "un solo pago guardado");
    assert.equal(pagos[0].movimiento, -10000);
    assert.equal(pagos[0].formaPago, "transferencia");
    assert.equal(pagos[0].detalle, "Pago — transferencia");
    assert.equal(Object.keys(db.cc_movimientos).length, Object.keys(seed.cc_movimientos).length + 1);

    // En el detalle se ve también el cargo escrito con otro nombre, y el saldo coincide con el guardado.
    await tarjetaCC(h, TREBOL).locator("button", { hasText: "Ver movimientos" }).click();
    await h.page.getByText("Costillitas de Cerdo (cargado con otro nombre)").waitFor();
    assert.equal((await h.page.locator("[data-saldo-detalle]").innerText()).trim(), "$770.925");
    assert.equal(await h.page.locator('[data-aviso="saldo-distinto"]').count(), 0);
  } finally {
    await h.close();
  }
});

test("cuenta corriente: el botón «Pago» dentro del detalle abre la hoja de pago y el detalle se actualiza", async () => {
  const seed = buildSeed();
  const [ccId, cc] = cuentaDe(seed, ANGEL)[0];
  // Un movimiento importado con la fecha guardada como Timestamp (no texto)
  seed.cc_movimientos.ccm_importado = { cliente: ANGEL, tipo: "pago", monto: 1000, movimiento: -1000, fecha: { __ts: "2026-10-01T15:00:00.000Z" }, detalle: "Pago histórico", origen: "importado", createdAt: { __ts: "2026-10-01T15:00:00.000Z" } };
  cc.saldo -= 1000;
  const h = await abrir(seed, "director");
  try {
    await abrirCC(h);
    await tarjetaCC(h, ANGEL).locator("button", { hasText: "Ver movimientos" }).click();
    await h.page.getByText("Pago histórico").waitFor();
    await h.page.getByText("01/10/2026").first().waitFor(); // la fecha Timestamp se muestra bien
    const antes = await h.page.getByText(/^Movimientos \(\d+\)$/).innerText();
    assert.equal((await h.page.locator("[data-saldo-detalle]").innerText()).trim(), "$" + cc.saldo.toLocaleString("es-AR"));

    await boton(h, "💰 Pago").click();
    await h.page.getByText("Registrar pago", { exact: true }).waitFor(); // la hoja aparece SOBRE el detalle
    await h.page.locator('input[placeholder="0"]').fill("5000");
    await h.page.locator("select").last().selectOption("efectivo");
    await boton(h, "✓ Confirmar pago").click();
    await toast(h, "Pago de $5.000 registrado").waitFor();
    await h.page.getByText("Registrar pago", { exact: true }).waitFor({ state: "detached" });
    // Sigue en el detalle, con el pago nuevo y el saldo actualizado
    const n = Number(antes.match(/\d+/)[0]);
    await h.page.getByText(`Movimientos (${n + 1})`).waitFor();
    await h.page.waitForFunction((t) => document.querySelector("[data-saldo-detalle]").textContent.trim() === t, "$" + (cc.saldo - 5000).toLocaleString("es-AR"));
    await h.page.getByText("Pago — efectivo").first().waitFor();

    const db = await h.dump();
    assert.equal(db.cuentas_corrientes[ccId].saldo, cc.saldo - 5000);
    assert.equal(valores(db.cc_movimientos).filter((m) => m.cliente === ANGEL && m.tipo === "pago" && m.monto === 5000 && m.formaPago === "efectivo").length, 1);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("cuenta corriente: un saldo a favor del cliente se muestra como tal en la lista, el detalle y el PDF (que cierra con sus filas)", async () => {
  const seed = buildSeed();
  const cc = cuentaDe(seed, DAGOSTINO)[0][1];
  assert.equal(cc.saldo, -25258);
  const movs = valores(seed.cc_movimientos).filter((m) => m.cliente === DAGOSTINO);
  const desde = "2026-10-20";
  const previos = movs.filter((m) => m.fecha < desde);
  const anterior = previos.reduce((s, m) => s + (m.tipo === "pedido" ? m.monto : -m.monto), 0);
  assert.ok(previos.length > 0, "hay movimientos anteriores al período");
  const fmt = (n) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("es-AR");

  const h = await abrir(seed, "director", { now: NOCHE });
  try {
    await espiarPdf(h);
    await abrirCC(h);
    const tarjeta = tarjetaCC(h, DAGOSTINO);
    assert.equal((await tarjeta.locator("[data-saldo]").innerText()).trim(), "-$25.258");
    await tarjeta.getByText("Saldo a favor del cliente").waitFor();
    await tarjeta.locator("button", { hasText: "Ver movimientos" }).click();
    await h.page.locator('[data-estado-saldo="a_favor"]', { hasText: "Saldo a favor del cliente: $25.258" }).waitFor();
    assert.equal(await h.page.getByText("Al día").count(), 0, "no dice «Al día» con plata a favor");

    await boton(h, "📄 PDF").click();
    await h.page.getByText("Exportar PDF").waitFor();
    assert.equal(await h.page.locator('input[type="date"]').nth(0).inputValue(), "2026-10-11", "«Desde» = 30 días antes de hoy (hora de Buenos Aires)");
    assert.equal(await h.page.locator('input[type="date"]').nth(1).inputValue(), HOY, "«Hasta» = hoy, no mañana");
    await h.page.locator('input[type="date"]').nth(0).fill(desde);
    // La hoja queda por encima de la barra de navegación
    const z = await h.page.getByText("Exportar PDF").evaluate((el) => { let n = el; while (n && getComputedStyle(n).position !== "fixed") n = n.parentElement; return Number(getComputedStyle(n).zIndex); });
    assert.ok(z > 9998, "z-index de la hoja: " + z);
    await boton(h, "📥 Descargar PDF").click();
    await h.page.waitForFunction(() => window.__compartidos.length === 1);
    const textos = await pdfTextos(h);
    assert.ok(textos.includes("Generado: 10/11/2026"), "fecha de generación = hoy");
    assert.ok(textos.includes("Saldo anterior al 20/10/2026"), "imprime el saldo anterior al período");
    assert.ok(textos.includes(fmt(anterior)), "saldo anterior " + fmt(anterior));
    assert.ok(textos.includes("Saldo al 10/11/2026: -$25.258 (a favor del cliente)"), "saldo final con signo: " + textos.filter((t) => t.startsWith("Saldo al")));
    assert.ok(!textos.includes("Saldo: $25.258"), "ya no imprime el saldo sin signo");
    const archivo = (await h.compartidos())[0].archivos[0].nombre;
    assert.equal(archivo, "CC_Sersale_almacen_d_agostino_2026-10-20_a_2026-11-10.pdf");
  } finally {
    await h.close();
  }
});

test("cuenta corriente: si el saldo guardado no coincide con los movimientos se avisa y se puede corregir", async () => {
  const seed = buildSeed();
  const [ccId, cc] = cuentaDe(seed, GAMAS_BOEDO)[0];
  const real = cc.saldo;
  cc.saldo = 100000; // quedó mal guardado
  const h = await abrir(seed, "director");
  try {
    await abrirCC(h);
    await tarjetaCC(h, GAMAS_BOEDO).locator("button", { hasText: "Ver movimientos" }).click();
    const aviso = h.page.locator('[data-aviso="saldo-distinto"]');
    await aviso.waitFor();
    assert.match(await aviso.innerText(), /\$100\.000/);
    await aviso.locator("button").click();
    await hoja(h).waitFor();
    await botonHoja(h, "Dejar como está").click();
    assert.equal((await h.doc("cuentas_corrientes/" + ccId)).saldo, 100000, "sin confirmar no se toca");
    await aviso.locator("button").click();
    await botonHoja(h, "Usar $" + real.toLocaleString("es-AR")).click();
    await toast(h, "Saldo corregido").waitFor();
    await aviso.waitFor({ state: "detached" });
    assert.equal((await h.doc("cuentas_corrientes/" + ccId)).saldo, real);
  } finally {
    await h.close();
  }
});

test("cuenta corriente: «Crear cuenta» con doble toque abre una sola cuenta, con fecha de hoy", async () => {
  const seed = buildSeed();
  const h = await abrir(seed, "director", { now: NOCHE });
  try {
    await abrirCC(h);
    await boton(h, "+ Nueva").click();
    const sel = h.page.locator("select", { has: h.page.locator("option", { hasText: "— Seleccioná un cliente —" }) });
    await sel.waitFor();
    assert.equal(await sel.locator("option", { hasText: ANGEL }).count(), 0, "no ofrece clientes que ya tienen cuenta");
    await sel.selectOption({ label: NATA });
    await boton(h, "Crear cuenta").dblclick();
    await toast(h, "Cuenta corriente creada").waitFor();
    await tarjetaCC(h, NATA).waitFor();
    const db = await h.dump();
    const cuentas = cuentaDe(db, NATA);
    assert.equal(cuentas.length, 1, "una sola cuenta");
    assert.equal(cuentas[0][1].saldo, 0);
    assert.equal(cuentas[0][1].ultimoMovimiento, HOY);
    assert.equal(Object.keys(db.cuentas_corrientes).length, Object.keys(seed.cuentas_corrientes).length + 1);
  } finally {
    await h.close();
  }
});

test("estadísticas: «Clientes activos» cuenta todos los clientes del mes, no solo los 8 del ranking", async () => {
  const seed = buildSeed();
  const delMes = valores(seed.pedidos).filter((p) => p.estado !== "cancelado" && (p.fechaEntrega || "").startsWith("2026-11"));
  const clientes = new Set(delMes.map((p) => p.cliente));
  assert.ok(clientes.size > 8, "el mes de ejemplo tiene más de 8 clientes: " + clientes.size);
  const h = await abrir(seed, "director");
  try {
    await h.page.getByText("Activos", { exact: true }).first().waitFor();
    await boton(h, "📊 Stats").click();
    const cifra = h.page.getByText("Clientes activos").locator("xpath=preceding-sibling::div[1]");
    await cifra.waitFor();
    assert.equal(Number(await cifra.innerText()), clientes.size);
  } finally {
    await h.close();
  }
});

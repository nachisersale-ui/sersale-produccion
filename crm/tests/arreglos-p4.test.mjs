// Arreglos del área "depósito, remitos guardados e historial"
// (src/pedidos/04-deposito-remitos-historial.jsx). Cada prueba maneja la
// pantalla real como una persona con el iPhone y después mira qué quedó
// guardado en Firestore y qué se ve.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const NOCHE = "2026-11-10T22:30:00-03:00"; // en UTC ya es el día siguiente
const copia = (o) => structuredClone(o);

/**
 * Abre pedidos.html. `window.__pausarEscuchas = true` (ver congelarPantalla)
 * hace que la pantalla deje de recibir las novedades en vivo: así se simula un
 * teléfono con mala señal que todavía muestra el pedido como estaba antes.
 */
async function abrir({ rol = "operario", seed = buildSeed(), now, antes } = {}) {
  const h = await launch({ rol, etiqueta: "p4", seed, ...(now ? { now } : {}) });
  await h.context.addInitScript(() => {
    let real;
    Object.defineProperty(window, "__fb", {
      configurable: true,
      get() { return real; },
      set(v) {
        real = {
          ...v,
          onSnapshot: (q, ...resto) =>
            v.onSnapshot(q, ...resto.map((f) => (typeof f === "function" ? (...a) => { if (!window.__pausarEscuchas) f(...a); } : f))),
        };
      },
    });
  });
  if (antes) await antes(h);
  await h.ir("pedidos.html");
  h.seed = seed;
  return h;
}
const congelarPantalla = (h) => h.page.evaluate(() => { window.__pausarEscuchas = true; });
const boton = (h, t) => h.page.locator("button", { hasText: t });
const texto = (h, t, o) => h.page.getByText(t, o);
const toast = (h, re) => h.page.locator(".ss-toast", { hasText: re });

/** Espera a que un documento cumpla una condición y lo devuelve. */
async function esperarDoc(h, ruta, cond, ms = 15000) {
  const fin = Date.now() + ms;
  let ultimo = null;
  while (Date.now() < fin) {
    ultimo = await h.doc(ruta);
    if (cond(ultimo)) return ultimo;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("El documento " + ruta + " no llegó al estado esperado: " + JSON.stringify(ultimo).slice(0, 400));
}

async function directorClientes(h) {
  await texto(h, "¿Quién sos?").waitFor();
  await boton(h, "Panel general y cuentas corrientes").click();
  await texto(h, "Activos", { exact: true }).waitFor();
  await boton(h, "Clientes").first().click();
}
async function abrirCliente(h, nombre) {
  await h.page.locator("button", { hasText: nombre }).filter({ hasText: "Ver historial" }).first().click();
}

// ── Depósito ────────────────────────────────────────────────────────────────

test("depósito: anotar kg no borra el producto que Comercial agregó desde otro teléfono", async () => {
  const h = await abrir({ now: NOCHE });
  try {
    const id = "ped_060"; // Fiambrería Don Ángel, pendiente, entrega hoy
    const antes = copia(h.seed.pedidos[id]);
    assert.equal(antes.estado, "pendiente");
    await texto(h, "Depósito · Vista Operario").waitFor();
    // A las 22:30 "hoy" sigue siendo el 10/11 (no el día de UTC).
    await texto(h, /martes 10.11 — HOY/i).first().waitFor();
    await texto(h, /miércoles 11.11 — MAÑANA/i).first().waitFor();

    await texto(h, "Fiambrería Don Ángel", { exact: true }).first().click();
    await boton(h, "⚙️ En preparación").click();
    await texto(h, "Anotar kg por ítem").waitFor();
    const campos = h.page.locator('input[placeholder="kg"]');
    await campos.nth(0).fill("12.3");
    await campos.nth(1).fill("8.1");

    // Mientras tanto, desde Comercial le agregan un salame al pedido.
    await congelarPantalla(h);
    const editado = copia(antes);
    editado.items.push({ categoria: "Salames y Secos", producto: "Salame Milán", cantidad: "3", unidad: "kg", obs: "" });
    editado.editadoEn = "2026-11-11T01:31:00.000Z";
    await h.sembrar({ pedidos: { [id]: editado } });

    await boton(h, "Confirmar — En preparación").click();
    const doc = await esperarDoc(h, "pedidos/" + id, (d) => d.estado === "preparando");

    assert.equal(doc.items.length, 5, "el salame agregado sigue en el pedido");
    assert.equal(doc.items[4].producto, "Salame Milán");
    assert.equal(doc.items[4].cantidad, "3");
    assert.equal(doc.items[0].kgReal, 12.3);
    assert.equal(doc.items[1].kgReal, 8.1);
    assert.equal(doc.items[2].kgReal, null);
    assert.deepEqual(doc.items.map((i) => i.producto).slice(0, 4), antes.items.map((i) => i.producto));
    assert.equal(doc.editadoEn, editado.editadoEn, "no se pisa lo que guardó Comercial");
    assert.equal(doc.historial.length, antes.historial.length + 1);
    assert.equal(doc.historial.at(-1).estado, "preparando");
    assert.equal(doc.cliente, antes.cliente);
    assert.equal(doc.fechaEntrega, antes.fechaEntrega);

    // En pantalla: avisa que el pedido cambió y lo muestra completo en "En preparación".
    await toast(h, /cambi/i).first().waitFor();
    const tarjeta = texto(h, "Fiambrería Don Ángel", { exact: true }).first();
    await tarjeta.waitFor();
    await texto(h, /5 productos/).first().waitFor();
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("depósito: un pedido cancelado desde Comercial no revive al tocarlo en una pantalla vieja", async () => {
  const h = await abrir();
  try {
    const id = "ped_064"; // Almacén Doña Rosa, pendiente
    const antes = copia(h.seed.pedidos[id]);
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, "Almacén Doña Rosa", { exact: true }).first().click();
    await boton(h, "⚙️ En preparación").click();
    await texto(h, "Anotar kg por ítem").waitFor();
    await h.page.locator('input[placeholder="kg"]').nth(0).fill("2.1");

    await congelarPantalla(h);
    const cancelado = copia(antes);
    cancelado.estado = "cancelado";
    cancelado.historial.push({ estado: "cancelado", fecha: "2026-11-10T13:31:00.000Z" });
    await h.sembrar({ pedidos: { [id]: cancelado } });

    await boton(h, "Confirmar — En preparación").click();
    await toast(h, /cancelado/i).first().waitFor();

    const doc = await h.doc("pedidos/" + id);
    assert.equal(doc.estado, "cancelado", "sigue cancelado");
    assert.deepEqual(doc.historial, cancelado.historial, "no se agregó ningún cambio de estado");
    assert.deepEqual(doc.items, antes.items, "no se tocaron los ítems");
    // La lista se actualiza sola y el pedido deja de estar.
    await texto(h, "Almacén Doña Rosa", { exact: true }).first().waitFor({ state: "detached" });
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("depósito: no se marca «Listo» un pedido al que le agregaron un producto que nadie preparó", async () => {
  const h = await abrir();
  try {
    const id = "ped_057"; // Panificadora Gamas - Sucursal Boedo, preparando, 3 ítems
    const antes = copia(h.seed.pedidos[id]);
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, "Panificadora Gamas - Sucursal Boedo", { exact: true }).first().click();
    await boton(h, "📋 Ítems").click();
    for (const it of antes.items) await h.page.locator("button", { hasText: it.producto }).first().click();
    await texto(h, "3 de 3 ítems listos").waitFor();

    await congelarPantalla(h);
    const editado = copia(antes);
    editado.items.push({ categoria: "Salames y Secos", producto: "Salame Milán", cantidad: "3", unidad: "kg", obs: "" });
    await h.sembrar({ pedidos: { [id]: editado } });

    await boton(h, "Marcar como Listo").click();
    await toast(h, /Cambiaron los productos/).first().waitFor();
    const doc = await h.doc("pedidos/" + id);
    assert.equal(doc.estado, "preparando", "no pasó a listo");
    assert.equal(doc.historial.length, antes.historial.length);
    assert.equal(doc.items.length, 4);
    // Sigue en la lista de ítems, ahora con el producto nuevo y todo sin tildar.
    await texto(h, "0 de 4 ítems listos").waitFor();
    await h.page.locator("button", { hasText: "Salame Milán" }).first().waitFor();
    assert.equal(await boton(h, "Marcar como Listo").count(), 0);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("depósito: lo que carga o cancela otro teléfono aparece solo, sin tocar ↻", async () => {
  const h = await abrir();
  try {
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, "Fiambrería La Ñata", { exact: true }).first().waitFor();
    const nuevo = {
      cliente: "Kiosco y Almacén 24hs Chiclana", cuentaCorriente: false, tipo: "retiro",
      fechaPedido: { __ts: "2026-11-10T13:40:00.000Z" }, fechaPedidoISO: "2026-11-10T13:40:00.000Z", fechaEntrega: "2026-11-10",
      items: [{ categoria: "Quesos", producto: "Queso Cremoso", cantidad: "4", unidad: "kg", obs: "" }], obs: "", estado: "pendiente",
      historial: [{ estado: "pendiente", fecha: "2026-11-10T13:40:00.000Z", nota: "Pedido creado" }],
    };
    const cancelado = copia(h.seed.pedidos.ped_061); // Fiambrería La Ñata
    cancelado.estado = "cancelado";
    cancelado.historial.push({ estado: "cancelado", fecha: "2026-11-10T13:41:00.000Z" });
    await h.sembrar({ pedidos: { ped_nuevo: nuevo, ped_061: cancelado } });

    await texto(h, "Kiosco y Almacén 24hs Chiclana", { exact: true }).first().waitFor();
    await texto(h, "Fiambrería La Ñata", { exact: true }).first().waitFor({ state: "detached" });
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("depósito: sin señal, «Marcar como Listo» avisa y no pierde lo tildado; con señal guarda una sola vez", async () => {
  const h = await abrir();
  try {
    const id = "ped_057"; // Panificadora Gamas - Sucursal Boedo, preparando, 3 ítems
    const antes = copia(h.seed.pedidos[id]);
    assert.equal(antes.estado, "preparando");
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, "Panificadora Gamas - Sucursal Boedo", { exact: true }).first().click();
    await boton(h, "📋 Ítems").click();
    await texto(h, "Preparando — Panificadora Gamas - Sucursal Boedo").waitFor();
    for (const it of antes.items) await h.page.locator("button", { hasText: it.producto }).first().click();
    await texto(h, "3 de 3 ítems listos").waitFor();

    await h.sinRed(true);
    await boton(h, "Marcar como Listo").click();
    await h.page.locator(".ss-toast.ss-toast-error").first().waitFor();
    // Sigue en la lista de ítems, con todo tildado, y en la base no cambió nada.
    await texto(h, "3 de 3 ítems listos").waitFor();
    assert.equal(await boton(h, "Marcar como Listo").count(), 1);
    const sinCambios = await h.doc("pedidos/" + id);
    assert.equal(sinCambios.estado, "preparando");
    assert.equal(sinCambios.historial.length, antes.historial.length);

    await h.sinRed(false);
    await boton(h, "Marcar como Listo").click();
    const doc = await esperarDoc(h, "pedidos/" + id, (d) => d.estado === "listo");
    assert.equal(doc.historial.length, antes.historial.length + 1, "un solo cambio de estado");
    assert.equal(doc.historial.at(-1).estado, "listo");
    assert.deepEqual(doc.items, antes.items, "los ítems y sus kg quedan como estaban");
    // Vuelve a la lista y el pedido figura como listo.
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, "Preparando — Panificadora Gamas - Sucursal Boedo").waitFor({ state: "detached" });
    const sinRedOk = erroresReales(h.errores).filter((e) => !/offline|unavailable|Could not reach|ERR_INTERNET|Failed to fetch|WebChannel/i.test(e.texto));
    assert.deepEqual(sinRedOk, []);
  } finally {
    await h.close();
  }
});

test("depósito: la cinta NUEVO marca solo lo que entró desde la última vez que se miró", async () => {
  const seed = buildSeed();
  const desde = "2026-11-10T11:00:00.000Z";
  const activos = Object.values(seed.pedidos).filter((p) => !["despachado", "cancelado"].includes(p.estado));
  const esperados = activos.filter((p) => p.fechaPedidoISO > desde).length;
  assert.ok(esperados > 0 && esperados < activos.length);
  const h = await abrir({
    seed,
    antes: (h) => h.context.addInitScript((desde) => { if (!localStorage.getItem("sersale_deposito_visto")) localStorage.setItem("sersale_deposito_visto", desde); }, desde),
  });
  try {
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, "Almacén Doña Rosa", { exact: true }).first().waitFor();
    assert.equal(await texto(h, "NUEVO", { exact: true }).count(), esperados);
  } finally {
    await h.close();
  }
  // En un teléfono que abre el depósito por primera vez no está todo marcado como nuevo:
  // solo lo que entra a partir de ese momento.
  const h2 = await abrir();
  try {
    await texto(h2, "Depósito · Vista Operario").waitFor();
    await texto(h2, "Almacén Doña Rosa", { exact: true }).first().waitFor();
    assert.equal(await texto(h2, "NUEVO", { exact: true }).count(), 0);
    await h2.sembrar({ pedidos: { ped_nuevo: {
      cliente: "Autoservicio Avenida La Plata", cuentaCorriente: false, tipo: "retiro",
      fechaPedido: { __ts: "2026-11-10T13:50:00.000Z" }, fechaPedidoISO: "2026-11-10T13:50:00.000Z", fechaEntrega: "2026-11-10",
      items: [{ categoria: "Quesos", producto: "Queso Tybo", cantidad: "5", unidad: "kg", obs: "" }], obs: "", estado: "pendiente",
      historial: [{ estado: "pendiente", fecha: "2026-11-10T13:50:00.000Z", nota: "Pedido creado" }],
    } } });
    await texto(h2, "Autoservicio Avenida La Plata", { exact: true }).first().waitFor();
    assert.equal(await texto(h2, "NUEVO", { exact: true }).count(), 1);
  } finally {
    await h2.close();
  }
});

// ── Remitos guardados e historial del cliente ───────────────────────────────

/** Registra lo que se escribe en cada PDF y si se descargó. */
const espiarPdf = (h) =>
  h.page.evaluate(() => {
    window.__pdfTextos = [];
    window.__pdfGuardados = [];
    const Real = window.jspdf.jsPDF;
    window.jspdf.jsPDF = function (...a) {
      const d = new Real(...a);
      const escribir = d.text;
      d.text = function (s, ...r) { window.__pdfTextos.push(String(s)); return escribir.call(d, s, ...r); };
      d.save = function (nombre) { window.__pdfGuardados.push(nombre); return d; };
      return d;
    };
  });

test("remito guardado: la copia dice el tipo y la fecha de entrega del pedido (y no inventa «Retiro»)", async () => {
  const seed = buildSeed();
  const [, rem] = Object.entries(seed.remitos).reverse().find(([, r]) => seed.pedidos[r.pedidoId] && seed.pedidos[r.pedidoId].tipo === "envio");
  const ped = seed.pedidos[rem.pedidoId];
  // Otro remito del mismo cliente cuyo pedido ya no existe: no se sabe si fue envío o retiro.
  seed.remitos.rem_suelto = { nro: 900, pedidoId: "ped_que_no_existe", cliente: rem.cliente, fecha: "2026-11-09", items: [{ producto: "Queso Tybo", kg: 2, unidad: "kg", precio: 9990, total: 19980 }], total: 19980, createdAt: "2026-11-09T15:00:00.000Z" };
  const h = await abrir({ rol: "director", seed, now: NOCHE });
  try {
    await directorClientes(h);
    await abrirCliente(h, rem.cliente);
    await boton(h, "🧾 Remitos").click();
    const nro = String(rem.nro).padStart(4, "0");
    await texto(h, "N° " + nro, { exact: true }).click();
    await texto(h, "Remito N° " + nro, { exact: true }).waitFor();
    // Una sola pantalla: no queda el encabezado del cliente con sus pestañas arriba del remito.
    assert.equal(await boton(h, "🧾 Remitos").count(), 0);

    await espiarPdf(h);
    await boton(h, "Ver / Descargar PDF").click();
    await h.page.waitForFunction(() => window.__pdfGuardados.length === 1);
    let textos = await h.page.evaluate(() => window.__pdfTextos);
    const fechaEntrega = ped.fechaEntrega.split("-").reverse().join("/");
    const fechaRemito = rem.fecha.split("-").reverse().join("/");
    assert.ok(textos.includes("Envio / Reparto"), "tipo del pedido: " + JSON.stringify(textos.slice(0, 16)));
    assert.ok(!textos.includes("Retiro por local"));
    assert.ok(textos.includes(fechaEntrega), "fecha de entrega " + fechaEntrega + ": " + JSON.stringify(textos.slice(0, 16)));
    assert.ok(textos.includes(fechaRemito), "fecha del remito " + fechaRemito);
    assert.ok(textos.includes("N° " + nro));
    const archivo = (await h.page.evaluate(() => window.__pdfGuardados))[0];
    assert.ok(archivo.startsWith("Remito " + nro + " - " + rem.cliente + " - " + fechaRemito.replace(/\//g, "-")), archivo);

    // Cerrar la hoja de compartir del iPhone no baja un archivo que nadie pidió.
    await h.page.evaluate(() => {
      window.__pdfGuardados.length = 0;
      window.__compartirPedido = 0;
      navigator.share = () => { window.__compartirPedido++; return Promise.reject(new DOMException("La persona cerró la hoja", "AbortError")); };
    });
    await boton(h, "Compartir por WhatsApp").click();
    await h.page.waitForFunction(() => window.__compartirPedido === 1);
    await h.page.evaluate(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
    assert.deepEqual(await h.page.evaluate(() => window.__pdfGuardados), []);

    // El remito sin pedido conocido: guion, no «Retiro por local».
    await boton(h, "←").first().click();
    await texto(h, "N° 0900", { exact: true }).click();
    await texto(h, "Remito N° 0900", { exact: true }).waitFor();
    await h.page.evaluate(() => { window.__pdfTextos.length = 0; window.__pdfGuardados.length = 0; });
    await boton(h, "Ver / Descargar PDF").click();
    await h.page.waitForFunction(() => window.__pdfGuardados.length === 1);
    textos = await h.page.evaluate(() => window.__pdfTextos);
    assert.ok(!textos.includes("Retiro por local") && !textos.includes("Envio / Reparto"), JSON.stringify(textos.slice(0, 16)));
    assert.ok(textos.includes("09/11/2026"));
    assert.deepEqual(erroresReales(h.errores), []);
    // Nada de esto escribe en la base.
    assert.deepEqual((await h.dump()).remitos, JSON.parse(JSON.stringify(seed.remitos)));
  } finally {
    await h.close();
  }
});

test("remitos del cliente: aparecen aunque el nombre se haya guardado con otras mayúsculas o espacios", async () => {
  const seed = buildSeed();
  const cliente = "Fiambrería Don Ángel";
  const suyos = Object.entries(seed.remitos).filter(([, r]) => r.cliente === cliente);
  assert.ok(suyos.length >= 3);
  seed.remitos[suyos[0][0]].cliente = "FIAMBRERÍA DON ÁNGEL ";
  seed.remitos[suyos[1][0]].cliente = "fiambreria don angel";
  const h = await abrir({ rol: "director", seed });
  try {
    await directorClientes(h);
    await abrirCliente(h, cliente);
    await boton(h, "🧾 Remitos").click();
    for (const [, r] of suyos) await texto(h, "N° " + String(r.nro).padStart(4, "0"), { exact: true }).waitFor();
    assert.equal(await texto(h, /^N° \d{4}$/).count(), suyos.length);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("remitos del cliente: sin señal no dice «Sin remitos emitidos»; al volver se pueden cargar", async () => {
  const seed = buildSeed();
  const cliente = "Fiambrería Don Ángel";
  const suyos = Object.values(seed.remitos).filter((r) => r.cliente === cliente);
  const h = await abrir({ rol: "director", seed });
  try {
    await directorClientes(h);
    await abrirCliente(h, cliente);
    await texto(h, /pedidos? en total/).first().waitFor();
    await h.sinRed(true);
    await boton(h, "🧾 Remitos").click();
    await texto(h, /No se pudieron cargar los remitos/).first().waitFor();
    assert.equal(await texto(h, "Sin remitos emitidos").count(), 0);
    await h.sinRed(false);
    await boton(h, "Reintentar").click();
    await texto(h, "N° " + String(suyos[0].nro).padStart(4, "0"), { exact: true }).waitFor();
    assert.equal(await texto(h, /^N° \d{4}$/).count(), suyos.length);
  } finally {
    await h.close();
  }
});

test("historial del cliente: un pedido viejo sin fecha de carga no deja la pantalla en blanco", async () => {
  const seed = buildSeed();
  const cliente = "Fiambrería Don Ángel";
  const propios = Object.values(seed.pedidos).filter((p) => p.cliente === cliente);
  const cancelados = propios.filter((p) => p.estado === "cancelado").length;
  // Pedido importado del sistema anterior: sin fechaPedidoISO.
  seed.pedidos.ped_viejo = {
    cliente, cuentaCorriente: true, tipo: "retiro", fechaEntrega: "2026-08-03",
    items: [{ categoria: "Quesos", producto: "Queso Tybo", cantidad: "6", unidad: "kg", obs: "" }], obs: "", estado: "despachado",
  };
  // Y un movimiento de cuenta corriente con la fecha guardada como Timestamp.
  seed.cc_movimientos.ccm_viejo = { cliente, tipo: "pedido", monto: 45000, movimiento: 45000, fecha: "2026-07-20", detalle: "Queso Tybo", origen: "manual", createdAt: { __ts: "2026-07-20T15:00:00.000Z" } };
  const h = await abrir({ rol: "director", seed });
  try {
    await directorClientes(h);
    await abrirCliente(h, cliente);
    await texto(h, /pedidos? en total/).first().waitFor();
    const cabecera = await texto(h, /pedidos? en total/).first().innerText();
    const total = propios.length - cancelados + 2;
    assert.ok(cabecera.startsWith(total + " pedidos en total"), cabecera);
    await boton(h, "🧾 Remitos").waitFor();
    assert.deepEqual(erroresReales(h.errores).filter((e) => e.tipo === "pageerror"), []);
  } finally {
    await h.close();
  }
});

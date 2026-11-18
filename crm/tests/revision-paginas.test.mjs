// Revisión independiente de Ventas diarias, Panel y Presupuestos, después de los
// arreglos. Una prueba por cada defecto encontrado: usa la página real como en el
// iPhone y compara lo que se ve (o lo que queda guardado) con una cuenta hecha
// aparte, sin usar el código de la página.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const NOV = "2026-11", OCT = "2026-10";
const HOY = "2026-11-10";
const DISTRI = "Distribuidora Mayorista del Sur S.R.L.";
const ROSA = "Almacén Doña Rosa";
const VASQUITO = "Fiambrería El Vasquito";
const COOPE = "Cooperativa de Trabajo Gastronómica La Nueva Esperanza de Villa Soldati Limitada";

const copia = (o) => JSON.parse(JSON.stringify(o));
const cerca = (real, esperado, msg) => assert.ok(Math.abs(real - esperado) < 0.02, `${msg}: ${real} en vez de ${esperado}`);
const hora = (dia, hhmm = "14:00") => `${dia}T${hhmm}:00.000Z`;

// ── Panel ───────────────────────────────────────────────────────────────────

const panelCargado = (p, mes) =>
  p.waitForFunction((mes) => !!window._repData && window._repData.listo === true && (!mes || window._repData.mes === mes), mes || null);
const datosPanel = (p) => p.evaluate(() => ({ kpis: window._repData.kpis, clientes: window._repData.clientes, rentabilidad: window._repData.rentabilidad }));
/** Importe abreviado como lo muestra el Panel: "$840K", "$1,3M". */
const abreviado = (n) => (n >= 999500 ? "$" + (n / 1e6).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "M" : "$" + Math.round(n / 1000) + "K");

/** Pedido común: se guarda SIN precio (el precio lo pone el remito). */
function pedidoComun(seed, id, cliente, fechaEntrega, items) {
  seed.pedidos[id] = {
    cliente, cuentaCorriente: false, tipo: "envio", fechaPedido: { __ts: hora(fechaEntrega) }, fechaPedidoISO: hora(fechaEntrega), fechaEntrega,
    items: items.map((it) => ({ categoria: "", unidad: "kg", obs: "", ...it, cantidad: String(it.cantidad) })),
    obs: "", estado: "despachado", historial: [{ estado: "despachado", fecha: hora(fechaEntrega), nota: "Pedido creado" }],
  };
}

/**
 * Lo facturado en un mes según los documentos, sin usar ninguna cuenta del Panel:
 * la venta rápida vale sus ítems; un pedido común, el total de su remito.
 */
function facturadoSegunRemitos(db, mes) {
  const remitoDe = {};
  for (const r of Object.values(db.remitos || {})) if (r.pedidoId) remitoDe[r.pedidoId] = r;
  const porCliente = {};
  let total = 0;
  for (const [id, p] of Object.entries(db.pedidos)) {
    if (p.estado === "cancelado" || !String(p.fechaEntrega).startsWith(mes)) continue;
    const f = p.origen === "venta_rapida" ? p.items.reduce((s, it) => s + it.precio * it.cantidad, 0) : remitoDe[id] ? remitoDe[id].total : 0;
    total += f;
    porCliente[p.cliente] = (porCliente[p.cliente] || 0) + f;
  }
  return { total, porCliente };
}

/** Textos de un PDF de jsPDF en el orden en que se dibujaron. */
function textosPdf(bytes) {
  const t = bytes.toString("latin1");
  const out = [];
  const re = /\(((?:\\.|[^\\()])*)\) Tj/g;
  let m;
  while ((m = re.exec(t))) out.push(m[1].replace(/\\([\\()])/g, "$1"));
  return out;
}

/**
 * Todos los números de un mes calculados a mano desde los documentos, ítem por ítem:
 * precio del remito del pedido (o el de la venta rápida) × kilos pesados (o la cantidad
 * pedida si no se pesó). No usa nada del Panel.
 */
function mesAMano(seed, mes, costos = {}) {
  const remitoDe = {};
  for (const r of Object.values(seed.remitos)) if (r.pedidoId) remitoDe[r.pedidoId] = r;
  const pedidos = Object.entries(seed.pedidos).filter(([, p]) => p.estado !== "cancelado" && p.fechaEntrega.startsWith(mes));
  const out = { fact: 0, pedidos: pedidos.length, porCliente: {}, semanas: [0, 0, 0, 0, 0], porDia: [0, 0, 0, 0, 0, 0, 0], productos: {} };
  for (const [id, p] of pedidos) {
    const c = (out.porCliente[p.cliente] ||= { fact: 0, pedidos: 0, ganancia: 0, factConCosto: 0, conCosto: 0, sinCosto: 0 });
    let f = 0;
    for (const it of p.items) {
      const enRemito = remitoDe[id] && remitoDe[id].items.find((x) => x.producto === it.producto);
      const precio = Number(it.precio) || (enRemito ? enRemito.precio : 0);
      const pedido = parseFloat(it.cantidad) || 0;
      const pesado = it.kgReal != null && it.kgReal !== "" ? Number(it.kgReal) : pedido;
      f += precio * pesado;
      const prod = (out.productos[it.producto] ||= { unidades: 0, kgTotal: 0, pedidos: 0 });
      prod.unidades += pedido;
      prod.kgTotal += it.unidad === "kg" ? pedido : pesado;
      prod.pedidos++;
      // Rentabilidad: solo lo facturado; con costo de planilla suma ganancia, sin costo baja la cobertura.
      if (!(precio * pesado > 0)) continue;
      if (costos[it.producto] == null) c.sinCosto++;
      else {
        c.conCosto++;
        c.factConCosto += precio * pesado;
        c.ganancia += (precio - costos[it.producto]) * pesado;
      }
    }
    out.fact += f;
    c.fact += f;
    c.pedidos++;
    out.semanas[Math.min(5, Math.ceil(Number(p.fechaEntrega.slice(8)) / 7)) - 1] += f;
    out.porDia[new Date(p.fechaEntrega + "T12:00:00Z").getUTCDay()]++;
  }
  const cierres = Object.values(seed.ventas_diarias).filter((v) => v.fecha.startsWith(mes));
  out.ventasDiarias = cierres.reduce((s, v) => s + v.totalVentas, 0);
  out.diasConVenta = new Set(cierres.map((v) => v.fecha)).size;
  out.semanasVD = [0, 0, 0, 0, 0];
  for (const v of cierres) out.semanasVD[Math.min(5, Math.ceil(Number(v.fecha.slice(8)) / 7)) - 1] += v.totalVentas;
  return out;
}

test("panel: indicadores, gráficos, top de clientes, cuentas y productos coinciden con la cuenta hecha a mano (noviembre y octubre)", async () => {
  const seed = buildSeed();
  const h = await launch({ rol: "director", etiqueta: "rvpanel", seed });
  const p = h.page;
  const lista = (real, esperado, msg) => {
    assert.equal(real.length, esperado.length, msg + ": cantidad");
    real.forEach((x, i) => cerca(x, esperado[i], `${msg} [${i}]`));
  };
  const variacion = (ahora, antes) => ((ahora - antes) / antes) * 100;
  // La planilla de costos está escrita dentro de la página: se toma la tabla (el dato), no la cuenta.
  const costos = JSON.parse(/const COSTO_PROD = (\{.*?\});/.exec(fs.readFileSync(DIST + "dashboard.html", "utf8"))[1]);
  assert.ok(costos["Jamón Cocido Natural Sublime"] > 0);
  try {
    await h.ir("dashboard.html");
    for (const [mes, anterior] of [[NOV, OCT], [OCT, "2026-09"]]) {
      await p.selectOption("#sel-mes", mes);
      await panelCargado(p, mes);
      const m = mesAMano(seed, mes, costos), ant = mesAMano(seed, anterior);
      const D = await p.evaluate(() => {
        const R = window._repData, cf = Chart.getChart("chart-fact"), cd = Chart.getChart("chart-dias");
        return { kpis: R.kpis, clientes: R.clientes, cc: R.cc, productos: R.productos, rentabilidad: R.rentabilidad, semanas: cf.data.datasets[0].data, semanasVD: cf.data.datasets[1].data, porDia: cd.data.datasets[0].data };
      });
      // Indicadores
      cerca(D.kpis.fact, m.fact, mes + " facturación");
      cerca(D.kpis.factAnt, ant.fact, mes + " facturación del mes anterior");
      cerca(D.kpis.varFact, variacion(m.fact, ant.fact), mes + " variación");
      assert.equal(D.kpis.pedidos, m.pedidos);
      assert.equal(D.kpis.pedidosAnt, ant.pedidos);
      assert.equal(D.kpis.clientesMes, Object.keys(m.porCliente).length);
      cerca(D.kpis.totalVD, m.ventasDiarias, mes + " ventas diarias");
      assert.equal(D.kpis.diasConVenta, m.diasConVenta);
      cerca(D.kpis.totalCombinado, m.fact + m.ventasDiarias, mes + " total combinado");
      cerca(D.kpis.varTotal, variacion(m.fact + m.ventasDiarias, ant.fact + ant.ventasDiarias), mes + " variación del total");
      const flecha = (v) => `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`;
      assert.equal((await p.innerText("#k-fact-sub")).trim(), flecha(variacion(m.fact, ant.fact)) + " vs mes ant.");
      // Gráficos: facturación por semana del mes (se muestran hasta la última semana con movimiento) y pedidos por día
      const ultima = Math.max(m.semanas.findLastIndex((x) => x > 0), m.semanasVD.findLastIndex((x) => x > 0));
      lista(D.semanas, m.semanas.slice(0, ultima + 1), mes + " semanas (pedidos)");
      lista(D.semanasVD, m.semanasVD.slice(0, ultima + 1), mes + " semanas (ventas diarias)");
      assert.deepEqual(D.porDia, m.porDia, mes + " pedidos por día de la semana");
      // Top 10 de clientes (los importes en orden, y cada cliente con lo suyo)
      const top = Object.values(m.porCliente).map((c) => c.fact).sort((a, b) => b - a).slice(0, 10);
      lista(D.clientes.map((c) => c.fact), top, mes + " top de clientes");
      for (const c of D.clientes) {
        cerca(c.fact, m.porCliente[c.nombre].fact, mes + " top " + c.nombre);
        assert.equal(c.pedidos, m.porCliente[c.nombre].pedidos, mes + " pedidos de " + c.nombre);
      }
      // Cuentas corrientes: las que deben, de mayor a menor
      const deben = Object.values(seed.cuentas_corrientes).filter((c) => c.saldo > 0).sort((a, b) => b.saldo - a.saldo);
      assert.deepEqual(D.cc, deben.map((c) => ({ nombre: c.nombre, saldo: c.saldo })));
      assert.equal(D.kpis.saldoCC, deben.reduce((s, c) => s + c.saldo, 0));
      // Productos más pedidos (12 primeros por kilos)
      const kilos = Object.values(m.productos).map((x) => x.kgTotal).sort((a, b) => b - a).slice(0, 12);
      lista(D.productos.map((x) => x.kgTotal), kilos, mes + " ranking de productos");
      for (const x of D.productos) {
        const mio = m.productos[x.nombre];
        cerca(x.kgTotal, mio.kgTotal, mes + " kg de " + x.nombre);
        cerca(x.unidades, mio.unidades, mes + " unidades de " + x.nombre);
        assert.equal(x.pedidos, mio.pedidos, mes + " pedidos con " + x.nombre);
      }
      // Ranking de rentabilidad: todos los clientes con facturación, de mayor a menor ganancia
      const conVenta = Object.entries(m.porCliente).filter(([, c]) => c.fact > 0);
      assert.equal(D.rentabilidad.length, conVenta.length, mes + " clientes en el ranking de rentabilidad");
      lista(D.rentabilidad.map((r) => r.ganancia), conVenta.map(([, c]) => c.ganancia).sort((a, b) => b - a), mes + " ganancias en orden");
      for (const r of D.rentabilidad) {
        const mio = m.porCliente[r.nombre];
        cerca(r.fact, mio.fact, mes + " rentabilidad, facturación de " + r.nombre);
        cerca(r.ganancia, mio.ganancia, mes + " ganancia de " + r.nombre);
        cerca(r.margenEfectivo, mio.factConCosto > 0 ? (mio.ganancia / mio.factConCosto) * 100 : 0, mes + " margen de " + r.nombre);
        assert.equal(r.cobertura, mio.conCosto + mio.sinCosto ? Math.round((mio.conCosto / (mio.conCosto + mio.sinCosto)) * 100) : 0, mes + " cobertura de " + r.nombre);
      }
    }
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("panel: un ítem pesado en 0 kg (no había) no se factura; el Panel dice lo mismo que el remito y la cuenta corriente", async () => {
  const seed = buildSeed();
  const [pedidoId, pedido] = Object.entries(seed.pedidos).find(([, p]) => p.cliente === DISTRI && p.estado === "listo");
  assert.ok(pedido.fechaEntrega.startsWith(NOV), "el pedido listo de la Distribuidora es de noviembre");
  assert.equal(Object.values(seed.pedidos).filter((p) => p.cliente === DISTRI && p.fechaEntrega.startsWith(NOV) && p.estado !== "cancelado").length, 1);
  const sinStock = pedido.items[0];
  sinStock.kgReal = 0; // no había: el depósito cargó 0 kg

  // Un remito hecho con la versión anterior en el mismo caso: cobraba la cantidad pedida
  // (5 kg) y así quedó cargado. Lo ya cobrado no tiene que cambiar.
  pedidoComun(seed, "ped_rv_viejo", ROSA, "2026-11-04", [
    { producto: "Queso Tybo", cantidad: 5, kgReal: 0 },
    { producto: "Mortadela Familiar", cantidad: 2, kgReal: 2.1 },
  ]);
  const remitoViejo = {
    nro: 9101, pedidoId: "ped_rv_viejo", cliente: ROSA, fecha: "2026-11-04",
    items: [
      { producto: "Queso Tybo", kg: "5", unidad: "kg", precio: 9990, total: 5 * 9990 },
      { producto: "Mortadela Familiar", kg: 2.1, unidad: "kg", precio: 5890, total: 2.1 * 5890 },
    ],
    total: 5 * 9990 + 2.1 * 5890, createdAt: hora("2026-11-04", "15:00"),
  };
  seed.remitos.rem_rv_viejo = remitoViejo;

  const h = await launch({ rol: "director", etiqueta: "rvpanel", seed });
  const p = h.page;
  try {
    // 1) Comercial hace el remito del pedido, como todos los días.
    await h.ir("pedidos.html");
    await h.sincronizar();
    await p.getByText("¿Quién sos?").waitFor();
    await p.locator("button", { hasText: "Cargar y gestionar pedidos" }).click();
    await p.getByText(/Activos \(\d+\)/).waitFor();
    await p.locator("span", { hasText: DISTRI }).first().click();
    await p.locator("button", { hasText: "🧾 Remito" }).click();
    await p.getByText("Remito — " + DISTRI).waitFor();
    await p.waitForFunction(() => {
      const i = document.querySelector('input[aria-label="Número de remito"]');
      return i && i.value !== "";
    });
    await p.waitForFunction(() => [...document.querySelectorAll('input[placeholder="$ / kg"]')].some((i) => i.value !== ""));
    await p.locator("button", { hasText: "💾 Guardar" }).click();
    await p.locator(".ss-toast", { hasText: /Remito N° \d+ guardado/ }).waitFor();

    const db = await h.dump();
    const rem = Object.values(db.remitos).find((r) => r.pedidoId === pedidoId);
    assert.ok(rem, "el remito quedó guardado");
    const itemRem = rem.items.find((it) => it.producto === sinStock.producto);
    assert.ok(itemRem.precio > 0, "el producto que no había tiene precio");
    assert.equal(itemRem.total, 0, "el remito no cobra el ítem pesado en 0 kg");
    assert.ok(rem.total > 0);
    const cargo = Object.values(db.cc_movimientos).find((m) => m.remitoNro === rem.nro);
    assert.equal(cargo.monto, Math.round(rem.total), "a la cuenta corriente se le cargó el total del remito");
    const noEntregado = itemRem.precio * parseFloat(sinStock.cantidad);

    // 2) El director abre el Panel: tiene que ver lo mismo que se cobró.
    await h.ir("dashboard.html");
    await panelCargado(p, NOV);
    const esperado = facturadoSegunRemitos(db, NOV);
    cerca(esperado.porCliente[DISTRI], rem.total, "cuenta aparte");
    const D = await datosPanel(p);
    const detalle = ` (lo pedido y no entregado vale ${Math.round(noEntregado)})`;
    cerca(D.clientes.find((c) => c.nombre === DISTRI).fact, rem.total, "Top clientes, " + DISTRI + detalle);
    cerca(D.rentabilidad.find((c) => c.nombre === DISTRI).fact, rem.total, "Ranking de rentabilidad, " + DISTRI + detalle);
    cerca(D.rentabilidad.find((c) => c.nombre === ROSA).fact, remitoViejo.total, "un remito de la versión anterior se sigue contando por lo que cobró");
    cerca(D.kpis.fact, esperado.total, "Facturación del mes" + detalle);

    // Lo que se ve en pantalla.
    assert.equal((await p.innerText("#k-fact")).trim(), abreviado(esperado.total));
    const primera = p.locator("#tabla-clientes tbody tr").first();
    assert.ok((await primera.innerText()).includes(DISTRI), "la Distribuidora encabeza los clientes del mes");
    assert.equal((await primera.locator("td").last().innerText()).trim(), abreviado(rem.total));
    assert.notEqual(abreviado(rem.total), abreviado(rem.total + noEntregado), "el caso distingue el importe correcto del inflado");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("panel: si un pedido tiene remitos repetidos de la versión anterior y uno se corrigió, vale el corregido", async () => {
  const seed = buildSeed();
  assert.equal(Object.values(seed.pedidos).filter((x) => x.cliente === VASQUITO && x.fechaEntrega.startsWith(NOV)).length, 0);
  const sinEstePedido = facturadoSegunRemitos(seed, NOV).total;
  // Con la versión anterior, guardar dos veces el remito dejaba dos remitos del mismo pedido (a $10.000).
  // El 9/11, ya con la versión nueva, se corrigió el precio a $12.000: el sistema corrige el primero
  // (el de número más bajo) y su cargo en la cuenta, y le anota la fecha de la corrección.
  pedidoComun(seed, "ped_rv_dup", VASQUITO, "2026-11-05", [{ producto: "Jamón Cocido Natural Sublime", cantidad: 10, kgReal: 10 }]);
  const item = (precio) => [{ producto: "Jamón Cocido Natural Sublime", kg: 10, unidad: "kg", precio, total: 10 * precio }];
  seed.remitos.rem_rv_a = {
    nro: 9201, pedidoId: "ped_rv_dup", cliente: VASQUITO, fecha: "2026-11-05", fechaEntrega: "2026-11-05", tipo: "envio",
    items: item(12000), total: 120000, createdAt: hora("2026-11-05", "15:00"), updatedAt: hora("2026-11-09", "12:00"),
  };
  seed.remitos.rem_rv_b = {
    nro: 9202, pedidoId: "ped_rv_dup", cliente: VASQUITO, fecha: "2026-11-05",
    items: item(10000), total: 100000, createdAt: hora("2026-11-05", "15:10"),
  };

  const h = await launch({ rol: "director", etiqueta: "rvpanel", seed });
  try {
    await h.ir("dashboard.html");
    await panelCargado(h.page, NOV);
    const D = await datosPanel(h.page);
    cerca(D.rentabilidad.find((c) => c.nombre === VASQUITO).fact, 120000, "facturación del pedido (remito corregido el 9/11)");
    cerca(D.clientes.find((c) => c.nombre === VASQUITO).fact, 120000, "Top clientes");
    cerca(D.kpis.fact, sinEstePedido + 120000, "Facturación del mes");
  } finally {
    await h.close();
  }
});

test("panel: en el PDF un nombre de cliente largo no tapa los importes de su fila", async () => {
  const seed = buildSeed();
  const h = await launch({ rol: "director", etiqueta: "rvpanel", seed });
  const p = h.page;
  try {
    await h.ir("dashboard.html");
    await panelCargado(p);
    await p.selectOption("#sel-mes", OCT);
    await panelCargado(p, OCT);
    const fila = (await datosPanel(p)).rentabilidad.find((c) => c.nombre === COOPE);
    assert.ok(fila && fila.fact > 0, "la cooperativa compró en octubre");

    await p.tap('.mes-sel button:has-text("Reporte")');
    await p.waitForSelector("#reportModal", { state: "visible" });
    const [descarga] = await Promise.all([p.waitForEvent("download"), p.tap("#btnRepPDF")]);
    const textos = textosPdf(fs.readFileSync(await descarga.path()));
    const i = textos.findIndex((t) => t.startsWith("Cooperativa de Trabajo"));
    assert.ok(i > 0, "la cooperativa está en el ranking de rentabilidad del PDF");
    // La columna "Cliente" del ranking mide 180 pt; a su derecha va la facturación.
    const ancho = await p.evaluate((t) => new window.jspdf.jsPDF({ unit: "pt" }).setFontSize(9).getTextWidth(t), textos[i]);
    assert.ok(ancho <= 180, `el nombre ocupa ${Math.round(ancho)} pt y la columna mide 180: "${textos[i]}"`);
    assert.ok(textos[i].endsWith("..."), "se recorta con puntos suspensivos");
    assert.equal(textos[i + 1], "$" + Math.round(fila.fact).toLocaleString("es-AR"), "al lado sigue su facturación");
    // Los demás nombres salen enteros.
    assert.ok(textos.includes("Distribuidora Mayorista del Sur S.R.L."));
    assert.ok(textos.includes("Carnicer\xeda Los Hermanos P\xe9rez & Hijos"));
  } finally {
    await h.close();
  }
});

// ── Ventas diarias ──────────────────────────────────────────────────────────

const VENTAS = buildSeed().ventas_diarias;
const escribir = (p, selector, texto) => p.locator(selector).pressSequentially(texto);
const aviso = (p, texto) => p.locator(".ss-toast", { hasText: texto }).first();

test("ventas: con mala señal, si el servidor guardó pero la confirmación no llegó, avisa que quedó guardado (no pregunta por 'reemplazar' lo recién cargado)", async () => {
  const h = await launch({ rol: "director", etiqueta: "rvventas", seed: { ventas_diarias: copia(VENTAS) } });
  const p = h.page;
  try {
    await h.ir("ventas.html");
    await p.waitForFunction(() => document.getElementById("fUsdOf").value !== "" && document.getElementById("fUsdBl").value !== "");
    await escribir(p, "#fZ", "1250000");
    await escribir(p, "#fEfec", "700000");
    await escribir(p, "#fTarj", "550000,50");
    await p.locator("#gastosList input").nth(0).fill("Flete");
    await escribir(p, "#gastosList input >> nth=1", "15000");
    await p.fill("#fObs", "Cierre con poca señal");

    // El primer intento llega al servidor y se guarda, pero la respuesta se pierde en el camino.
    let intentos = 0;
    const esGuardado = (url) => /:commit(\?|$)/.test(url.href);
    const perderRespuesta = async (ruta) => {
      if (intentos++ > 0) return ruta.continue();
      await ruta.fetch();
      return ruta.abort();
    };
    await h.context.route(esGuardado, perderRespuesta);
    await p.tap("#btnSave");
    await p.waitForFunction(
      () => !!document.querySelector(".ss-hoja") || [...document.querySelectorAll(".ss-toast")].some((t) => /Registro guardado|No se pudo guardar/.test(t.textContent)),
      null,
      { timeout: 90000 }
    );
    assert.ok(intentos >= 2, "el guardado se reintentó solo");
    const pregunta = (await p.locator(".ss-hoja").count()) ? (await p.locator(".ss-hoja").innerText()).replace(/\s+/g, " ") : "";
    assert.equal(pregunta, "", "no hay nada que preguntar: lo que está guardado es lo que se acaba de cargar");
    assert.match(await aviso(p, "Registro guardado").innerText(), /10\/11\/2026 · Parque Patricios/);
    await p.waitForFunction(() => !document.getElementById("btnSave").disabled);
    assert.equal(await p.inputValue("#fZ"), "", "el formulario se limpió, como en cualquier guardado");

    const { ts, ...d } = (await h.dump()).ventas_diarias[HOY + "_PP"];
    assert.ok(ts);
    assert.deepEqual(d, {
      fecha: HOY, sucursal: "PP", totalZ: 1250000, cobEfec: 700000, cobTarj: 550000.5, cobMP: 0, cobOtro: 0, usdOficial: 1420, usdBlue: 1490,
      extraZ: 0, extraDesc: "", extras: [], gastos: [{ desc: "Flete", monto: 15000 }], totalGasto: 15000, totalCobros: 1250000.5,
      totalVentas: 1250000, totalNeto: 1235000, obs: "Cierre con poca señal",
    });
    await h.context.unroute(esGuardado, perderRespuesta);

    // Si lo que hay guardado es OTRA cosa, sigue preguntando antes de pisarlo.
    await escribir(p, "#fZ", "999000");
    await p.tap("#btnSave");
    const hoja = p.locator(".ss-hoja");
    await hoja.waitFor();
    assert.match(await hoja.innerText(), /ya hay un registro de ese día/i);
    await hoja.locator(".ss-btn", { hasText: "Cancelar" }).tap();
    await hoja.waitFor({ state: "detached" });
    assert.equal((await h.dump()).ventas_diarias[HOY + "_PP"].totalZ, 1250000, "al cancelar no se tocó");
  } finally {
    await h.close();
  }
});

// ── Entre archivos ──────────────────────────────────────────────────────────
// El defecto estaba en src/js/shell.js (la recarga automática solo miraba si había un
// campo con el cursor). Ya está corregido: una página abierta no se recarga sola. La
// prueba quedó sin la marca "todo" en la revisión de la capa compartida.

const DIST = new URL("../dist/", import.meta.url).pathname;
const visibilidad = (p, estado) =>
  p.evaluate((estado) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => estado });
    document.dispatchEvent(new Event("visibilitychange"));
  }, estado);

test(
  "ventas: si se publica una versión nueva con un cierre a medio cargar, salir un momento de la app no borra lo escrito",
  async () => {
    const publicado = fs.mkdtempSync(path.join(os.tmpdir(), "sersale-dist-"));
    fs.cpSync(DIST, publicado, { recursive: true });
    const h = await launch({ rol: "director", sw: true, etiqueta: "rvsw", root: publicado });
    const p = h.page;
    try {
      await h.ir("ventas.html");
      await p.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
      });
      await p.waitForTimeout(4500); // la página lleva un rato abierta
      await escribir(p, "#fZ", "1250000");
      await escribir(p, "#fEfec", "700000");
      await p.fill("#fObs", "Faltó cerrar el posnet");

      // Se publica una versión nueva del sistema.
      const v1 = JSON.parse(fs.readFileSync(path.join(publicado, "version.json"), "utf8")).version;
      const sw = fs.readFileSync(path.join(publicado, "sw.js"), "utf8");
      fs.writeFileSync(path.join(publicado, "sw.js"), sw.replace(JSON.stringify(v1), JSON.stringify("version-nueva")));
      // El director cierra el teclado, mira otra app y vuelve: ahí la app descubre la versión nueva.
      await p.evaluate(() => document.activeElement && document.activeElement.blur());
      await visibilidad(p, "hidden");
      await visibilidad(p, "visible");
      await p.locator(".ss-toast", { hasText: "versión nueva" }).waitFor({ timeout: 20000 });
      assert.equal(await p.inputValue("#fZ"), "1.250.000");

      // Sale otra vez un momento (a mirar el ticket, la calculadora, un WhatsApp) y vuelve.
      await visibilidad(p, "hidden");
      await p.waitForTimeout(2500);
      assert.equal(await p.inputValue("#fZ"), "1.250.000", "el Total Z que estaba escrito sigue en el formulario");
      assert.equal(await p.inputValue("#fObs"), "Faltó cerrar el posnet");
    } finally {
      await h.close();
      fs.rmSync(publicado, { recursive: true, force: true });
    }
  }
);

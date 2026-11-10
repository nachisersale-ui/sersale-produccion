// Arreglos del Panel (dashboard.html): cada prueba usa la página real como la
// usa el director en el iPhone y revisa lo que queda en pantalla y lo que sale
// en el reporte. El panel solo lee: también se revisa que no escriba nada.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const NOV = "2026-11", OCT = "2026-10";

// ── Datos extra sobre la base de ejemplo ────────────────────────────────────
const hora = (dia, hhmm = "14:00") => `${dia}T${hhmm}:00.000Z`;

/** Pedido común: se guarda SIN precio (el precio lo pone el remito). */
function pedidoComun(seed, id, cliente, fechaEntrega, items, estado = "despachado") {
  seed.pedidos[id] = {
    cliente, cuentaCorriente: false, tipo: "envio", fechaPedido: { __ts: hora(fechaEntrega) }, fechaPedidoISO: hora(fechaEntrega), fechaEntrega,
    items: items.map((it) => ({ categoria: "", unidad: "kg", obs: "", ...it, cantidad: String(it.cantidad) })),
    obs: "", estado, historial: [{ estado, fecha: hora(fechaEntrega), nota: "Pedido creado" }],
  };
}
/** Venta rápida: el pedido ya trae precio y kilos. */
function ventaRapida(seed, id, cliente, fechaEntrega, items) {
  seed.pedidos[id] = {
    cliente, tipo: "retiro", fechaPedido: { __ts: hora(fechaEntrega) }, fechaPedidoISO: hora(fechaEntrega), fechaEntrega,
    items: items.map((it) => ({ unidad: "kg", kgReal: it.cantidad, ...it })),
    obs: "Venta rapida", estado: "despachado", origen: "venta_rapida", cuentaCorriente: true,
    historial: [{ estado: "despachado", fecha: hora(fechaEntrega), nota: "Venta rapida" }],
  };
}
let nroRemito = 9000;
function remito(seed, id, { pedidoId, cliente, fecha, createdAt, items }) {
  const its = items.map((it) => ({ producto: it.producto, kg: it.kg, unidad: "kg", precio: it.precio, total: it.kg * it.precio }));
  seed.remitos[id] = {
    nro: ++nroRemito, ...(pedidoId ? { pedidoId } : {}), cliente, fecha,
    items: its, total: its.reduce((s, i) => s + i.total, 0), createdAt: createdAt || hora(fecha, "15:00"),
  };
}

// Lo que se facturó en un mes según los datos, calculado sin usar el panel:
// venta rápida = sus ítems; pedido común = el total de su remito (de la fecha que sea).
function facturado(seed, mes) {
  const remitoDe = {};
  for (const r of Object.values(seed.remitos)) if (r.pedidoId) remitoDe[r.pedidoId] = r;
  let total = 0, pedidos = 0;
  for (const [id, p] of Object.entries(seed.pedidos)) {
    if (p.estado === "cancelado" || !String(p.fechaEntrega).startsWith(mes)) continue;
    pedidos++;
    if (p.items.some((it) => it.precio > 0)) total += p.items.reduce((s, it) => s + it.precio * (it.kgReal || parseFloat(it.cantidad) || 0), 0);
    else if (remitoDe[id]) total += remitoDe[id].total;
  }
  return { total, pedidos };
}
const ventasDe = (seed, mes) => Object.values(seed.ventas_diarias).filter((v) => v.fecha.startsWith(mes));
const suma = (lista, campo) => lista.reduce((s, x) => s + x[campo], 0);

// ── Manejo de la página ─────────────────────────────────────────────────────
const cargado = (h, mes) =>
  h.page.waitForFunction((mes) => !!window._repData && window._repData.listo === true && (!mes || window._repData.mes === mes), mes || null);

async function abrir(opts = {}) {
  const h = await launch({ rol: "director", etiqueta: "panel", ...opts });
  await h.ir("dashboard.html");
  await cargado(h);
  return h;
}
async function elegirMes(h, mes) {
  await h.page.selectOption("#sel-mes", mes);
  await cargado(h, mes);
}
const BOTON_REPORTE = '.mes-sel button:has-text("Reporte")';
/** Toca Reporte y el botón pedido (PDF o Excel); devuelve el archivo descargado. */
async function reporte(h, boton) {
  await h.page.tap(BOTON_REPORTE);
  await h.page.waitForSelector("#reportModal", { state: "visible" });
  const titulo = (await h.page.innerText("#repMes")).trim();
  const [descarga] = await Promise.all([h.page.waitForEvent("download"), h.page.tap(boton)]);
  const bytes = fs.readFileSync(await descarga.path());
  await h.page.waitForSelector("#reportModal", { state: "hidden" });
  await h.page.waitForSelector('.ss-toast:has-text("Reporte generado")');
  return { nombre: descarga.suggestedFilename(), titulo, bytes, texto: bytes.toString("utf8").replace(/^﻿/, "") };
}
/** Valor numérico de una fila "Etiqueta;valor" del CSV. */
function valorCSV(csv, etiqueta) {
  const fila = csv.split("\n").find((l) => l.startsWith(etiqueta + ";"));
  assert.ok(fila, "falta en el CSV: " + etiqueta);
  return Number(fila.slice(etiqueta.length + 1).replace(",", "."));
}
const cerca = (real, esperado, msg) => assert.ok(Math.abs(real - esperado) < 0.02, `${msg}: ${real} en vez de ${esperado}`);
const filasTop = (h) =>
  h.page.$$eval("#tabla-clientes tbody tr", (trs) =>
    trs.map((tr) => {
      const td = tr.querySelectorAll("td");
      return { nombre: td[1].innerText.trim(), pedidos: td[2].innerText.trim(), fact: td[3].innerText.trim() };
    })
  );
const texto = (h, sel) => h.page.innerText(sel).then((t) => t.trim());
const variacion = (ahora, antes) => ((ahora - antes) / antes) * 100;
const flecha = (v) => `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`;

// ── Reporte ─────────────────────────────────────────────────────────────────

test("el PDF del reporte se genera y trae los gastos y el neto de cada día", async () => {
  const seed = buildSeed();
  const h = await abrir({ seed });
  try {
    const pdf = await reporte(h, "#btnRepPDF");
    assert.equal(pdf.nombre, "Sersale_Informe_Noviembre_2026.pdf");
    assert.equal(pdf.bytes.subarray(0, 5).toString("latin1"), "%PDF-");
    const t = pdf.bytes.toString("latin1");
    const tiene = (s) => assert.ok(t.includes(`(${s}) Tj`), "falta en el PDF: " + s);
    tiene("VENTAS DIARIAS DEL MES");
    tiene("TOP CLIENTES POR FACTURACI\xd3N");

    const nov = ventasDe(seed, NOV);
    const ventas = suma(nov, "totalVentas"), gastos = suma(nov, "totalGasto");
    assert.ok(gastos > 0, "la base de ejemplo tiene gastos en noviembre");
    const $ = (n) => "$" + Math.round(n).toLocaleString("es-AR");
    tiene($(ventas));
    tiene($(gastos)); // antes: $0
    tiene($(ventas - gastos)); // antes: igual a las ventas
    const pp = seed.ventas_diarias["2026-11-02_PP"];
    tiene($(pp.totalGasto));
    tiene($(pp.totalVentas - pp.totalGasto));
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("el Excel (CSV) trae gastos y neto reales, y un nombre con ; o = no rompe las columnas", async () => {
  const seed = buildSeed();
  ventaRapida(seed, "ped_csv1", "Carnes; Fiambres SRL", "2026-11-04", [{ producto: "Jamón Cocido Natural Sublime", cantidad: 200, precio: 15000 }]);
  ventaRapida(seed, "ped_csv2", "=SUMA(1;2)", "2026-11-04", [{ producto: "Jamón Cocido Natural Sublime", cantidad: 140, precio: 20000 }]);
  const h = await abrir({ seed });
  try {
    const csv = await reporte(h, "#btnRepXLS");
    assert.equal(csv.nombre, "Sersale_Informe_Noviembre_2026.csv");
    const lineas = csv.texto.split("\n");
    const n = (x) => String(Math.round(x * 100) / 100).replace(".", ",");

    const nov = ventasDe(seed, NOV);
    assert.ok(nov.length > 10);
    for (const v of nov) {
      const fila = `${v.fecha};${v.sucursal};${n(v.totalVentas)};${n(v.totalGasto)};${n(v.totalVentas - v.totalGasto)}`;
      assert.ok(lineas.includes(fila), "falta la fila de ventas: " + fila);
    }
    assert.ok(nov.some((v) => v.totalGasto > 0));

    assert.ok(lineas.includes('1;"Carnes; Fiambres SRL";1;3000000'), "el nombre con ; va entre comillas");
    assert.ok(lineas.includes(`2;"'=SUMA(1;2)";1;2800000`), "lo que empieza con = no queda como fórmula");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Facturación y remitos ───────────────────────────────────────────────────

test("la variación contra el mes anterior cuenta los remitos de ese mes, y los días de venta son días", async () => {
  const seed = buildSeed();
  const h = await abrir({ seed });
  try {
    const nov = facturado(seed, NOV), oct = facturado(seed, OCT);
    assert.ok(oct.total > nov.total, "octubre (mes entero) facturó más que noviembre hasta el 10");
    const vdNov = suma(ventasDe(seed, NOV), "totalVentas"), vdOct = suma(ventasDe(seed, OCT), "totalVentas");
    const dias = new Set(ventasDe(seed, NOV).map((v) => v.fecha)).size;
    assert.ok(ventasDe(seed, NOV).length > dias, "hay dos sucursales por día");

    // En pantalla (antes: "▲ 2130.7% vs mes ant." y "18 días registrados")
    assert.equal(await texto(h, "#k-fact-sub"), `${flecha(variacion(nov.total, oct.total))} vs mes ant.`);
    assert.equal(await texto(h, "#k-total-sub"), `${flecha(variacion(nov.total + vdNov, oct.total + vdOct))} vs mes ant.`);
    assert.equal(await texto(h, "#k-pedidos"), String(nov.pedidos));
    assert.equal(await texto(h, "#k-ped-sub"), `▼ vs ${oct.pedidos} mes ant.`);
    assert.match(await texto(h, "#k-vd-sub"), new RegExp(`· ${dias} días registrados$`));

    // En el reporte
    const csv = (await reporte(h, "#btnRepXLS")).texto;
    cerca(valorCSV(csv, "Facturación pedidos mayoristas"), nov.total, "facturación de noviembre");
    cerca(valorCSV(csv, "Variación vs mes anterior (%)"), variacion(nov.total + vdNov, oct.total + vdOct), "variación");
    assert.equal(valorCSV(csv, "Días con venta registrada"), dias);

    // Octubre contra septiembre
    await elegirMes(h, OCT);
    const sep = facturado(seed, "2026-09");
    assert.equal(await texto(h, "#k-fact-sub"), `${flecha(variacion(oct.total, sep.total))} vs mes ant.`);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("remito fechado en otro mes: el pedido se factura en el mes de su entrega, una sola vez", async () => {
  const seed = buildSeed();
  const SUBLIME = "Jamón Cocido Natural Sublime";
  // A) Se prepara el viernes 30/10 para entregar el lunes 2/11: remito de octubre, pedido de noviembre.
  pedidoComun(seed, "ped_a", "Almacén Ñandú", "2026-11-02", [{ producto: SUBLIME, cantidad: 200, kgReal: 200 }]);
  remito(seed, "rem_a", { pedidoId: "ped_a", cliente: "Almacén Ñandú", fecha: "2026-10-30", items: [{ producto: SUBLIME, kg: 200, precio: 15000 }] });
  // B) Entrega del 31/10 con el remito guardado a las 22:30: queda con fecha 1/11 (día en UTC).
  pedidoComun(seed, "ped_b", "Despensa La Medianoche", "2026-10-31", [{ producto: SUBLIME, cantidad: 100, kgReal: 100 }]);
  remito(seed, "rem_b", { pedidoId: "ped_b", cliente: "Despensa La Medianoche", fecha: "2026-11-01", createdAt: "2026-11-01T01:30:00.000Z", items: [{ producto: SUBLIME, kg: 100, precio: 20000 }] });
  // C) Remito hecho mucho después de la entrega (junio, facturado en septiembre).
  pedidoComun(seed, "ped_c", "Rotisería El Atraso", "2026-06-20", [{ producto: SUBLIME, cantidad: 10, kgReal: 10 }]);
  remito(seed, "rem_c", { pedidoId: "ped_c", cliente: "Rotisería El Atraso", fecha: "2026-09-05", items: [{ producto: SUBLIME, kg: 10, precio: 10000 }] });

  const base = buildSeed();
  const nov = facturado(base, NOV).total + 3000000;
  const oct = facturado(base, OCT).total + 2000000;

  const h = await abrir({ seed, now: "2026-11-10T22:30:00-03:00" });
  try {
    const antes = await h.dump();
    assert.equal(await h.page.inputValue("#sel-mes"), NOV);

    // Noviembre: entra A (antes $0); B no es una venta de noviembre.
    let top = await filasTop(h);
    assert.deepEqual(top[0], { nombre: "Almacén Ñandú", pedidos: "1", fact: "$3,0M" });
    assert.ok(!top.some((f) => f.nombre === "Despensa La Medianoche"), "el remito de un pedido de octubre no se cuenta de nuevo en noviembre");
    assert.equal(await texto(h, "#k-fact-sub"), `${flecha(variacion(nov, oct))} vs mes ant.`);
    let csv = (await reporte(h, "#btnRepXLS")).texto;
    cerca(valorCSV(csv, "Facturación pedidos mayoristas"), nov, "noviembre");
    assert.ok(csv.split("\n").includes("1;Almacén Ñandú;1;3000000"));

    // Octubre: entra B (antes $0); A no se cuenta acá.
    await elegirMes(h, OCT);
    top = await filasTop(h);
    assert.ok(top.some((f) => f.nombre === "Despensa La Medianoche" && f.pedidos === "1" && f.fact === "$2,0M"), JSON.stringify(top));
    assert.ok(!top.some((f) => f.nombre === "Almacén Ñandú"), "el remito de un pedido de noviembre no es venta de octubre");
    csv = (await reporte(h, "#btnRepXLS")).texto;
    assert.match(csv, /INDICADORES CLAVE - Octubre 2026/);
    cerca(valorCSV(csv, "Facturación pedidos mayoristas"), oct, "octubre");

    // Junio: el remito llegó 77 días después y el pedido igual tiene su importe.
    await elegirMes(h, "2026-06");
    assert.deepEqual(await filasTop(h), [{ nombre: "Rotisería El Atraso", pedidos: "1", fact: "$100K" }]);
    assert.equal(await texto(h, "#k-fact"), "$100K");

    assert.deepEqual(await h.dump(), antes, "el panel no escribe en la base");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("el remito de un pedido cancelado no es una venta; el remito sin pedido sí", async () => {
  const seed = buildSeed();
  const SUBLIME = "Jamón Cocido Natural Sublime";
  pedidoComun(seed, "ped_cancelado", "Cliente Que Canceló", "2026-11-05", [{ producto: SUBLIME, cantidad: 200, kgReal: 200 }], "cancelado");
  remito(seed, "rem_cancelado", { pedidoId: "ped_cancelado", cliente: "Cliente Que Canceló", fecha: "2026-11-04", items: [{ producto: SUBLIME, kg: 200, precio: 15000 }] });
  remito(seed, "rem_huerfano", { pedidoId: "ped_que_no_existe", cliente: "Rotisería Sin Pedido", fecha: "2026-11-06", items: [{ producto: SUBLIME, kg: 160, precio: 15000 }] });
  remito(seed, "rem_suelto", { cliente: "Mostrador Mayorista", fecha: "2026-11-07", items: [{ producto: SUBLIME, kg: 120, precio: 15000 }] });

  const h = await abrir({ seed });
  try {
    const top = await filasTop(h);
    assert.ok(!top.some((f) => f.nombre === "Cliente Que Canceló"), "antes figuraba con $3,0M");
    assert.deepEqual(top[0], { nombre: "Rotisería Sin Pedido", pedidos: "1", fact: "$2,4M" });
    assert.deepEqual(top[1], { nombre: "Mostrador Mayorista", pedidos: "1", fact: "$1,8M" });
    const csv = (await reporte(h, "#btnRepXLS")).texto;
    assert.ok(!csv.includes("Cliente Que Canceló"));
    cerca(valorCSV(csv, "Facturación pedidos mayoristas"), facturado(buildSeed(), NOV).total, "el KPI no cambia");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("rentabilidad: el margen se calcula sobre los ítems con costo y lo pendiente no baja la cobertura", async () => {
  const seed = buildSeed();
  const CLIENTE = "Autoservicio Margen Mixto";
  ventaRapida(seed, "ped_m1", CLIENTE, "2026-11-04", [
    { producto: "Jamón Cocido Natural Sublime", cantidad: 10, precio: 12000 }, // costo de planilla 6.057,07
    { producto: "Carré c/ Hueso", cantidad: 10, precio: 6000 }, // sin costo cargado
  ]);
  pedidoComun(seed, "ped_m2", CLIENTE, "2026-11-12", [{ producto: "Queso Tybo", cantidad: 5 }], "pendiente"); // todavía sin precio
  const h = await abrir({ seed });
  try {
    const fila = await h.page.$$eval("#tabla-rentabilidad tbody tr", (trs, cliente) => {
      const tr = trs.find((x) => x.querySelectorAll("td")[1].innerText.trim() === cliente);
      return tr ? [...tr.querySelectorAll("td")].slice(2).map((td) => td.innerText.trim()) : null;
    }, CLIENTE);
    // ganancia (12.000 − 6.057,07) × 10 = 59.429,30 sobre $120.000 con costo = 49,5 % (antes: 33,0 % y cobertura 33 %)
    assert.deepEqual(fila, ["$180K", "$59K", "49.5%", "50%"]);
    const csv = (await reporte(h, "#btnRepXLS")).texto;
    const ranking = csv.slice(csv.indexOf("RANKING DE RENTABILIDAD"));
    const linea = ranking.split("\n").find((l) => l.includes(";" + CLIENTE + ";"));
    assert.equal(linea.split(";").slice(2).join(";"), "180000;59429,3;49,52;50");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Pantalla ────────────────────────────────────────────────────────────────

test("nombres con < > & se muestran completos y no se ejecutan", async () => {
  const seed = buildSeed();
  const ESQUINA = "Fiambrería <La Esquina> & Cía";
  const MALO = '<img src=x onerror="window.__xss=1">';
  ventaRapida(seed, "ped_x1", ESQUINA, "2026-11-04", [{ producto: "Chorizo <i>casero</i>", cantidad: 500, precio: 6000 }]);
  ventaRapida(seed, "ped_x2", MALO, "2026-11-04", [{ producto: "Jamón Cocido Natural Sublime", cantidad: 100, precio: 29000 }]);
  seed.cuentas_corrientes.cc_x = { nombre: "Kiosco <b>Negrita</b>", saldo: 900000, creadoEn: hora("2026-10-01"), ultimoMovimiento: "2026-11-04" };
  const h = await abrir({ seed });
  try {
    const top = await filasTop(h);
    assert.deepEqual(top.slice(0, 2), [
      { nombre: ESQUINA, pedidos: "1", fact: "$3,0M" },
      { nombre: MALO, pedidos: "1", fact: "$2,9M" },
    ]);
    assert.equal(await h.page.evaluate(() => window.__xss), undefined);
    assert.equal(await h.page.locator("#tabla-clientes img, #tabla-rentabilidad img, #tabla-productos i, #lista-cc b").count(), 0);
    assert.equal(await texto(h, "#lista-cc .cc-row:first-child .cc-nombre"), "🔴 Kiosco <b>Negrita</b>");
    assert.equal(await texto(h, "#tabla-productos tbody tr:first-child td:first-child"), "Chorizo <i>casero</i>");
    const rent = await h.page.$$eval("#tabla-rentabilidad tbody tr", (trs) => trs.map((tr) => tr.querySelectorAll("td")[1].innerText.trim()));
    assert.ok(rent.includes(ESQUINA) && rent.includes(MALO));
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("en el iPhone la página no se ensancha y Reporte queda a la vista", async () => {
  const h = await abrir({ seed: buildSeed() });
  try {
    const m = await h.page.evaluate(() => {
      const caja = (el) => { const r = el.getBoundingClientRect(); return { izq: r.left, der: r.right, alto: r.height }; };
      return {
        ancho: window.innerWidth,
        pagina: document.documentElement.scrollWidth,
        controles: [...document.querySelectorAll(".mes-sel > *")].map(caja),
        letraMes: parseFloat(getComputedStyle(document.getElementById("sel-mes")).fontSize),
      };
    });
    assert.equal(m.ancho, 390);
    assert.ok(m.pagina <= 390, "la página mide " + m.pagina + "px de ancho");
    assert.equal(m.controles.length, 3);
    for (const c of m.controles) {
      assert.ok(c.izq >= 0 && c.der <= 390, "control fuera de la pantalla: " + JSON.stringify(c));
      assert.ok(c.alto >= 44, "control de menos de 44px: " + JSON.stringify(c));
    }
    assert.ok(m.letraMes >= 16, "el selector de mes hace zoom en iOS con letra de " + m.letraMes + "px");

    await h.page.tap(BOTON_REPORTE);
    await h.page.waitForSelector("#reportModal", { state: "visible" });
    const botones = await h.page.$$eval("#btnRepPDF, #btnRepXLS, #reportModal button[aria-label=Cerrar]", (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { izq: r.left, der: r.right, alto: r.height }; }));
    for (const c of botones) assert.ok(c.izq >= 0 && c.der <= 390 && c.alto >= 44, JSON.stringify(c));
    await h.page.tap("#reportModal button[aria-label=Cerrar]");
    await h.page.waitForSelector("#reportModal", { state: "hidden" });
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("al cambiar de mes rápido no queda en pantalla (ni en el reporte) el mes anterior", async () => {
  const seed = buildSeed();
  const h = await abrir({ seed });
  try {
    const nov = facturado(seed, NOV), oct = facturado(seed, OCT);
    assert.notEqual(nov.pedidos, oct.pedidos);

    // La próxima carga (octubre) queda demorada hasta que la prueba la suelte.
    await h.page.evaluate(() => {
      const original = Promise.all;
      Promise.all = function (xs) {
        const p = original.call(Promise, xs);
        if (!Array.isArray(xs) || xs.length !== 7) return p; // la carga del panel son 7 consultas juntas
        Promise.all = original;
        return p.then((v) => new Promise((seguir) => {
          window.__soltar = () => { seguir(v); setTimeout(() => { window.__lentaTermino = true; }, 0); };
        }));
      };
    });
    await h.page.selectOption("#sel-mes", OCT);
    await h.page.waitForFunction(() => typeof window.__soltar === "function");

    // Mientras carga no hay reporte: antes salía el de noviembre con título "Octubre 2026".
    await h.page.tap(BOTON_REPORTE);
    await h.page.waitForSelector('.ss-toast:has-text("todavía no están cargados")');
    assert.equal(await h.page.isVisible("#reportModal"), false);

    // El director vuelve a noviembre antes de que termine la carga de octubre...
    await elegirMes(h, NOV);
    // ...y recién después llega la respuesta de octubre.
    await h.page.evaluate(() => window.__soltar());
    await h.page.waitForFunction(() => window.__lentaTermino === true);

    assert.equal(await h.page.inputValue("#sel-mes"), NOV);
    assert.equal(await texto(h, "#k-pedidos"), String(nov.pedidos), "quedaron en pantalla los pedidos de octubre");
    const csv = await reporte(h, "#btnRepXLS");
    assert.equal(csv.titulo, "Noviembre 2026");
    assert.equal(valorCSV(csv.texto, "Pedidos del mes"), nov.pedidos);
    cerca(valorCSV(csv.texto, "Facturación pedidos mayoristas"), nov.total, "facturación de noviembre");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("si una tarjeta falla, las demás se muestran, se avisa y no se puede sacar un reporte incompleto", async () => {
  const h = await abrir({ seed: buildSeed() });
  try {
    await h.page.evaluate(() => { window.Chart = function () { throw new Error("gráfico roto (prueba)"); }; });
    await h.page.tap("#btn-actualizar");
    await h.page.waitForSelector('.ss-toast:has-text("Una parte del panel no se pudo mostrar")');
    assert.ok((await filasTop(h)).length > 0, "la tabla de clientes se muestra igual");
    assert.ok((await h.page.locator("#tabla-rentabilidad tbody tr").count()) > 0);
    assert.match(await texto(h, "#k-fact"), /^\$/);
    assert.equal(await h.page.isEnabled("#btn-actualizar"), true);
    await h.page.tap(BOTON_REPORTE);
    await h.page.waitForSelector('.ss-toast:has-text("todavía no están cargados")');
    assert.equal(await h.page.isVisible("#reportModal"), false);
  } finally {
    await h.close();
  }
});

test("si la carga falla se avisa y no queda en pantalla nada del mes anterior", async () => {
  const h = await abrir({ seed: buildSeed() });
  try {
    assert.match(await texto(h, "#k-fact"), /^\$/);
    await h.page.evaluate(() => { window.SersaleBase.sumarDias = () => { throw new Error("falla de prueba"); }; });
    await h.page.selectOption("#sel-mes", OCT);
    await h.page.waitForSelector('.ss-toast-error:has-text("No se pudieron cargar los datos")');
    assert.equal(await texto(h, "#k-fact"), "—");
    assert.equal(await texto(h, "#k-fact-sub"), "No se pudo cargar");
    assert.equal(await texto(h, "#tabla-clientes"), "No se pudo cargar");
    assert.equal(await texto(h, "#lista-cc"), "No se pudo cargar");
    assert.equal(await h.page.isEnabled("#btn-actualizar"), true, "se puede reintentar");
    await h.page.tap(BOTON_REPORTE);
    await h.page.waitForSelector('.ss-toast:has-text("todavía no están cargados")');
    assert.equal(await h.page.isVisible("#reportModal"), false, "no se exporta octubre con datos de noviembre");
  } finally {
    await h.close();
  }
});

test("la lista de cuentas corrientes avisa cuántas quedan fuera de las 12 que muestra", async () => {
  const seed = buildSeed();
  for (let i = 1; i <= 7; i++) seed.cuentas_corrientes["cc_extra" + i] = { nombre: "Cliente Extra " + i, saldo: 10000 * i, creadoEn: hora("2026-10-01"), ultimoMovimiento: "2026-11-04" };
  const saldos = Object.values(seed.cuentas_corrientes).map((c) => c.saldo).filter((s) => s > 0).sort((a, b) => b - a);
  assert.equal(saldos.length, 15);
  const h = await abrir({ seed });
  try {
    assert.equal(await h.page.locator("#lista-cc .cc-row").count(), 13);
    const resto = saldos.slice(12).reduce((s, x) => s + x, 0);
    assert.equal((await texto(h, "#cc-resto")).replace(/\s+/g, " "), `y 3 cuentas más $${resto.toLocaleString("es-AR")}`);
    assert.match(await texto(h, "#k-cc-sub"), /^15 clientes con saldo$/);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("el último día del mes a las 22:30 el panel sigue en ese mes (hora de Buenos Aires)", async () => {
  const h = await abrir({ now: "2026-11-30T22:30:00-03:00" });
  try {
    assert.equal(await h.page.inputValue("#sel-mes"), NOV);
    assert.equal(await texto(h, "#sel-mes option:first-child"), "Noviembre 2026");
    const pdf = await reporte(h, "#btnRepPDF");
    assert.equal(pdf.titulo, "Noviembre 2026");
    assert.ok(pdf.bytes.toString("latin1").includes("(Generado: 30/11/2026) Tj"));
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

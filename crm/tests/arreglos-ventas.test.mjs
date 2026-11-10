// Arreglos de Ventas Diarias (ventas.html): cada prueba usa la página real como
// la usa el director en el iPhone y revisa lo que queda guardado en Firestore
// y lo que se ve en pantalla.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const NOCHE = "2026-11-10T22:30:00-03:00"; // martes a la noche: en UTC ya es miércoles 11
const HOY = "2026-11-10";

// La página solo usa la colección de cierres de caja de la base de ejemplo.
const VENTAS = buildSeed().ventas_diarias;
const copia = (o) => JSON.parse(JSON.stringify(o));
const entre = (desde, hasta, suc) => Object.values(VENTAS).filter((v) => v.fecha >= desde && v.fecha <= hasta && (!suc || v.sucursal === suc));
const suma = (lista, campo) => lista.reduce((s, x) => s + x[campo], 0);
const pesos = (n) => "$" + Math.round(n).toLocaleString("es-AR");
const numero = (texto) => Number(String(texto).replace(/[^\d]/g, ""));

async function abrir(opts = {}) {
  const { ventas, ...resto } = opts;
  const h = await launch({ rol: "director", etiqueta: "ventas", seed: { ventas_diarias: ventas || copia(VENTAS) }, ...resto });
  await h.ir("ventas.html");
  return h;
}
const registro = async (h, id) => (await h.dump()).ventas_diarias?.[id];
const escribir = (p, selector, texto) => p.locator(selector).pressSequentially(texto);
const aviso = (p, texto) => p.locator(".ss-toast", { hasText: texto }).first();
const cotizacionCargada = (p) => p.waitForFunction(() => document.getElementById("fUsdOf").value !== "" && document.getElementById("fUsdBl").value !== "");
const botonLibre = (p) => p.waitForFunction(() => !document.getElementById("btnSave").disabled);
/** El elemento se ve entero: nada (encabezado, barra inferior) lo tapa en su centro. */
const seVe = (p, selector) =>
  p.evaluate((selector) => {
    const e = document.querySelector(selector);
    if (!e) return false;
    const r = e.getBoundingClientRect();
    const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!arriba && (arriba === e || e.contains(arriba));
  }, selector);
/** Texto de un bloque sin las mayúsculas que pone el estilo. */
const texto = (p, selector) => p.evaluate((s) => (document.querySelector(s)?.textContent || "").replace(/\s+/g, " ").trim(), selector);
async function hoja(p, boton) {
  const caja = p.locator(".ss-hoja");
  await caja.waitFor();
  const dicho = await caja.innerText();
  await caja.locator(".ss-btn", { hasText: boton }).tap();
  await caja.waitFor({ state: "detached" });
  return dicho;
}

test("a las 22:30 propone la fecha de hoy, guarda en ese día con totales redondeados y el aviso se ve", async () => {
  const h = await abrir({ now: NOCHE });
  const p = h.page;
  try {
    assert.equal(await p.inputValue("#fFecha"), HOY, "fecha propuesta");
    assert.equal(await p.inputValue("#hMes"), "2026-11");
    await cotizacionCargada(p); // la cotización se trae sola al abrir
    assert.equal(await p.inputValue("#fUsdOf"), "1.420");
    assert.equal(await p.inputValue("#fUsdBl"), "1.490");

    await escribir(p, "#fZ", "1250000");
    await escribir(p, "#fEfec", "500000");
    await escribir(p, "#fTarj", "750000,50");
    await p.locator("#extrasList input").nth(0).fill("Picada para evento");
    await escribir(p, "#extrasList input >> nth=1", "1000,10");
    await p.getByText("+ Agregar ingreso extra").tap();
    await p.locator("#extrasList input").nth(2).fill("Venta a vecino");
    await escribir(p, "#extrasList input >> nth=3", "2000,20");
    await p.locator("#gastosList input").nth(0).fill("Flete");
    await escribir(p, "#gastosList input >> nth=1", "15000");
    assert.equal((await p.innerText("#rNeto")).trim(), "$1.238.000");

    await p.tap("#btnSave");
    await aviso(p, "Registro guardado").waitFor();
    assert.ok(await seVe(p, ".ss-toast"), "el aviso de guardado no queda tapado por la barra inferior");
    assert.match(await aviso(p, "Registro guardado").innerText(), /10\/11\/2026 · Parque Patricios/);

    const todo = (await h.dump()).ventas_diarias;
    assert.equal(todo["2026-11-11_PP"], undefined, "no se guardó con la fecha de mañana");
    const d = todo[HOY + "_PP"];
    assert.ok(d, "registro del 10/11");
    const { ts, ...campos } = d;
    assert.ok(ts, "lleva la hora del servidor");
    assert.deepEqual(campos, {
      fecha: HOY, sucursal: "PP", totalZ: 1250000, cobEfec: 500000, cobTarj: 750000.5, cobMP: 0, cobOtro: 0, usdOficial: 1420, usdBlue: 1490,
      extraZ: 3000.3, extraDesc: "Picada para evento, Venta a vecino",
      extras: [{ desc: "Picada para evento", monto: 1000.1 }, { desc: "Venta a vecino", monto: 2000.2 }],
      gastos: [{ desc: "Flete", monto: 15000 }], totalGasto: 15000, totalCobros: 1250000.5, totalVentas: 1253000.3, totalNeto: 1238000.3, obs: "",
    });

    // El cierre de la otra sucursal, cargado a continuación, conserva la cotización.
    await botonLibre(p);
    assert.equal(await p.inputValue("#fZ"), "", "el formulario se limpió");
    assert.equal(await p.inputValue("#fUsdOf"), "1.420");
    await p.tap("#sbCAB");
    await escribir(p, "#fZ", "800000");
    await p.tap("#btnSave");
    await aviso(p, "Caballito").waitFor();
    const cab = await registro(h, HOY + "_CAB");
    assert.equal(cab.totalZ, 800000);
    assert.equal(cab.usdOficial, 1420);
    assert.equal(cab.usdBlue, 1490);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("la app quedó abierta desde ayer: al volver propone la fecha de hoy y no toca el cierre de ayer", async () => {
  const h = await abrir({ now: "2026-11-09T21:40:00-03:00" }); // lunes a la noche, con el cierre del lunes ya cargado
  const p = h.page;
  const volverALaApp = () => p.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
  try {
    assert.equal(await p.inputValue("#fFecha"), "2026-11-09");
    const lunes = await registro(h, "2026-11-09_PP");
    assert.ok(lunes.totalZ > 0);

    await p.clock.fastForward("22:35:00"); // martes 20:15: el teléfono estuvo guardado todo el día
    await volverALaApp();
    assert.equal(await p.inputValue("#fFecha"), HOY, "al volver, la fecha propuesta es la de hoy");
    await escribir(p, "#fZ", "990000");
    await p.tap("#btnSave");
    await aviso(p, "Registro guardado").waitFor();
    assert.equal(await p.locator(".ss-hoja").count(), 0);
    assert.equal((await registro(h, HOY + "_PP")).totalZ, 990000);
    assert.deepEqual(await registro(h, "2026-11-09_PP"), lunes, "el cierre del lunes quedó como estaba");
    await botonLibre(p);

    // Una fecha elegida a mano no se cambia por salir y volver a la app en el mismo día.
    await p.fill("#fFecha", "2026-11-05");
    await volverALaApp();
    assert.equal(await p.inputValue("#fFecha"), "2026-11-05");
    // Con una carga a medio hacer tampoco se cambia, aunque haya pasado la medianoche.
    await escribir(p, "#fZ", "5000");
    await p.clock.fastForward("24:00:00");
    await volverALaApp();
    assert.equal(await p.inputValue("#fFecha"), "2026-11-05");
    assert.equal(await p.inputValue("#fZ"), "5.000");
  } finally {
    await h.close();
  }
});

test("un segundo toque en Guardar, con el formulario ya limpio, no pisa el registro con ceros", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    await escribir(p, "#fZ", "1250000");
    await escribir(p, "#fEfec", "1250000");
    await p.tap("#btnSave");
    await aviso(p, "Registro guardado").waitFor();
    await botonLibre(p);
    const antes = await registro(h, HOY + "_PP");
    assert.equal(antes.totalZ, 1250000);

    await p.tap("#btnSave");
    await aviso(p, "No hay nada cargado").waitFor();
    assert.equal(await p.locator(".ss-hoja").count(), 0, "ni siquiera pregunta por reemplazar");
    await botonLibre(p);
    assert.deepEqual(await registro(h, HOY + "_PP"), antes, "el registro quedó como estaba");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("si ya hay un registro de ese día y sucursal, pregunta antes de reemplazarlo", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    const ID = "2026-11-09_PP";
    const original = await registro(h, ID);
    assert.ok(original.totalZ > 0);
    await p.fill("#fFecha", "2026-11-09"); // la sucursal quedó en Parque Patricios, como al abrir
    await escribir(p, "#fZ", "111000");
    await p.locator("#gastosList input").nth(0).fill("Limpieza");
    await escribir(p, "#gastosList input >> nth=1", "1000");

    await p.tap("#btnSave");
    const dicho = await hoja(p, "Cancelar");
    assert.match(dicho, /ya hay un registro de ese día/i);
    assert.ok(dicho.includes("09/11/2026 · Parque Patricios"), dicho);
    assert.ok(dicho.includes(pesos(original.totalZ)), "muestra el Total Z que ya estaba: " + dicho);
    await botonLibre(p);
    assert.deepEqual(await registro(h, ID), original, "al cancelar no se toca el registro");
    assert.equal(await p.inputValue("#fZ"), "111.000", "lo escrito sigue en el formulario");
    assert.equal(await p.locator("#gastosList input").nth(0).inputValue(), "Limpieza");
    assert.equal(await p.locator(".ss-toast", { hasText: "guardado" }).count(), 0);

    await p.tap("#btnSave");
    await hoja(p, "Reemplazar");
    await aviso(p, "Registro guardado").waitFor();
    const nuevo = await registro(h, ID);
    assert.equal(nuevo.totalZ, 111000);
    assert.equal(nuevo.totalGasto, 1000);
    assert.equal(nuevo.totalNeto, 110000);
    assert.deepEqual(nuevo.gastos, [{ desc: "Limpieza", monto: 1000 }]);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("dos teléfonos cargan el mismo cierre a la vez: uno guarda y al otro le pregunta", async () => {
  const h = await abrir();
  const p1 = h.page;
  try {
    const p2 = await h.context.newPage();
    await h.ir("ventas.html", p2);
    await escribir(p1, "#fZ", "1000000");
    await escribir(p2, "#fZ", "2000000");
    await Promise.all([p1.tap("#btnSave"), p2.tap("#btnSave")]);
    const resuelto = (p) => p.waitForFunction(() => !!document.querySelector(".ss-hoja") || [...document.querySelectorAll(".ss-toast")].some((t) => t.textContent.includes("Registro guardado")));
    await Promise.all([resuelto(p1), resuelto(p2)]);
    const pregunta = [await p1.locator(".ss-hoja").count(), await p2.locator(".ss-hoja").count()];
    assert.deepEqual([...pregunta].sort(), [0, 1], "a uno solo de los dos le pregunta");
    const [gano, perdio, zGano] = pregunta[0] ? [p2, p1, 2000000] : [p1, p2, 1000000];
    await aviso(gano, "Registro guardado").waitFor();
    assert.equal((await registro(h, HOY + "_PP")).totalZ, zGano);
    const dicho = await hoja(perdio, "Cancelar");
    assert.ok(dicho.includes(pesos(zGano)), dicho);
    await botonLibre(perdio);
    assert.equal((await registro(h, HOY + "_PP")).totalZ, zGano, "el que canceló no pisó nada");
  } finally {
    await h.close();
  }
});

test("sin conexión: avisa que no se guardó, no muestra 'sin registros', y al volver la señal guarda lo escrito", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    await escribir(p, "#fZ", "640000");
    await p.fill("#fObs", "Se cortó internet");
    await h.sinRed(true);

    await p.tap("#btnSave");
    await aviso(p, "Sin conexión. No se guardó").waitFor();
    await botonLibre(p);
    assert.equal(await p.innerText("#btnSave"), "Guardar Registro del Día");
    assert.equal(await p.inputValue("#fZ"), "640.000", "lo escrito sigue en el formulario");
    assert.equal(await registro(h, HOY + "_PP"), undefined);

    await p.tap("#nb-hist");
    await p.locator("#histContent", { hasText: "Sin conexión. No se pudieron cargar los datos." }).waitFor();
    assert.equal(await p.locator("#histContent", { hasText: "Sin registros" }).count(), 0);
    await p.tap("#nb-rep");
    await p.locator("#repContent", { hasText: "Sin conexión. No se pudieron cargar los datos." }).waitFor();
    await p.tap("#nb-comp");
    await p.locator("#compContent", { hasText: "Sin conexión. No se pudieron cargar los datos." }).waitFor();

    await h.sinRed(false);
    await p.tap("#nb-hist");
    // Con la señal de vuelta, "Reintentar" trae los registros (el primer intento puede llegar antes de reconectar).
    await p.waitForFunction(() => {
      if (document.querySelector("#histContent table.tbl")) return true;
      const b = document.querySelector("#histContent .empty button");
      if (b) b.click();
      return false;
    }, null, { polling: 500, timeout: 30000 });
    assert.equal(await texto(p, "#histContent .kpi-sub"), "9 días");

    await p.tap("#nb-carga");
    assert.equal(await p.inputValue("#fZ"), "640.000");
    await p.tap("#btnSave");
    await aviso(p, "Registro guardado").waitFor({ timeout: 30000 });
    const d = await registro(h, HOY + "_PP");
    assert.equal(d.totalZ, 640000);
    assert.equal(d.obs, "Se cortó internet");
  } finally {
    await h.close();
  }
});

test("si el servidor no responde al guardar: avisa, deja el formulario como estaba y se puede reintentar", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    await escribir(p, "#fZ", "730000");
    // El teléfono cree tener señal, pero el servidor de datos no contesta.
    const cortar = (ruta) => ruta.abort();
    const puerto = new URL("http://" + process.env.FIRESTORE_EMULATOR_HOST).port; // tests/run.mjs lo define siempre
    const servidor = (url) => url.port === puerto;
    await h.context.route(servidor, cortar);
    await p.tap("#btnSave");
    await aviso(p, "No se pudo guardar").waitFor({ timeout: 60000 });
    await botonLibre(p);
    assert.equal(await p.inputValue("#fZ"), "730.000");
    assert.equal(await p.locator(".ss-toast", { hasText: "Registro guardado" }).count(), 0);
    assert.equal(await registro(h, HOY + "_PP"), undefined);

    await h.context.unroute(servidor, cortar);
    await p.tap("#btnSave");
    await aviso(p, "Registro guardado").waitFor({ timeout: 60000 });
    assert.equal((await registro(h, HOY + "_PP")).totalZ, 730000);
  } finally {
    await h.close();
  }
});

test("a las 22:30 del martes, 'Esta semana' arranca el lunes y 'Semana anterior' va de lunes a domingo", async () => {
  const h = await abrir({ now: NOCHE });
  const p = h.page;
  try {
    await p.tap("#nb-rep");
    const titulo = (t) => p.locator("#repContent > div", { hasText: t }).first().waitFor();
    await titulo("01/11/2026 — 10/11/2026");
    const mes = entre("2026-11-01", "2026-11-10");
    assert.match(await texto(p, "#repContent > div"), /· 9 días$/);
    assert.ok((await texto(p, "#repContent .kpi-grid")).includes("TOTAL VENTAS" + pesos(suma(mes, "totalVentas"))));

    await p.selectOption("#rTipo", "semana");
    await titulo("09/11/2026 — 10/11/2026");
    const lunes = entre("2026-11-09", "2026-11-09");
    assert.equal(lunes.length, 2);
    assert.match(await texto(p, "#repContent > div"), /· 1 día$/);
    assert.ok((await texto(p, "#repContent .kpi-grid")).includes("TOTAL VENTAS" + pesos(suma(lunes, "totalVentas"))), "las ventas del lunes están en la semana");

    await p.selectOption("#rTipo", "semana-ant");
    await titulo("02/11/2026 — 08/11/2026");
    const anterior = entre("2026-11-02", "2026-11-08");
    assert.equal(anterior.length, 14);
    const kpis = await texto(p, "#repContent .kpi-grid");
    assert.ok(kpis.includes("TOTAL VENTAS" + pesos(suma(anterior, "totalVentas"))), kpis);
    assert.ok(kpis.includes("NETO TOTAL" + pesos(suma(anterior, "totalNeto"))), kpis);

    await p.selectOption("#rTipo", "mes-ant");
    await titulo("01/10/2026 — 31/10/2026");
    assert.match(await texto(p, "#repContent > div"), /· 31 días$/);
    assert.ok((await texto(p, "#repContent .kpi-grid")).includes("TOTAL VENTAS" + pesos(suma(entre("2026-10-01", "2026-10-31"), "totalVentas"))));

    // La comparativa termina en el mes en curso de Buenos Aires.
    await p.tap("#nb-comp");
    await p.locator("#compContent table").waitFor();
    assert.match(await p.locator("#compContent tbody tr").last().innerText(), /^NOV/);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("los días se cuentan una vez aunque haya dos sucursales, y el reporte impreso cierra con sus filas", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    const nov = entre("2026-11-01", "2026-11-10");
    assert.equal(nov.length, 18, "18 registros: 9 días por 2 sucursales");

    await p.tap("#nb-hist");
    await p.locator("#histContent table.tbl").waitFor();
    assert.equal(await texto(p, "#histContent .kpi-sub"), "9 días");
    await p.selectOption("#hSuc", "PP");
    await p.waitForFunction(() => document.querySelectorAll("#histContent .stag.pp").length === 9 && !document.querySelector("#histContent .stag.cab"));
    assert.equal(await texto(p, "#histContent .kpi-sub"), "9 días");

    await p.tap("#nb-rep");
    await p.locator("#repContent .kpi").first().waitFor();
    assert.match(await texto(p, "#repContent > div"), /01\/11\/2026 — 10\/11\/2026 · 9 días$/);
    const total = suma(nov, "totalVentas");
    assert.ok((await texto(p, "#repContent .kpi-grid")).includes("prom " + pesos(total / 9) + "/día"), await texto(p, "#repContent .kpi-grid"));

    // Reporte para imprimir: se abre en otra ventana.
    const [ventana] = await Promise.all([h.context.waitForEvent("page"), p.getByText("Exportar / Imprimir PDF").tap()]);
    await ventana.waitForFunction(() => document.body && document.body.innerText.includes("Documento interno"));
    const impreso = (await ventana.evaluate(() => document.body.innerText)).replace(/ /g, " ");
    assert.match(impreso, /9 días · Todas las sucursales/);
    const fila = (nombre) => {
      const m = new RegExp("^" + nombre + "\\s*\\n?\\s*(-?\\$ ?[\\d.]+)", "m").exec(impreso);
      assert.ok(m, "falta la fila " + nombre + " en:\n" + impreso.slice(0, 900));
      return numero(m[1]);
    };
    const filas = ["Efectivo", "Tarjeta / Posnet", "Transferencia", "Cheque / Otro"].map(fila);
    assert.deepEqual(filas, [suma(nov, "cobEfec"), suma(nov, "cobTarj"), suma(nov, "cobMP"), suma(nov, "cobOtro")]);
    assert.ok(suma(nov, "cobOtro") > 0, "la base de ejemplo tiene cobros con cheque");
    assert.equal(fila("Total"), filas.reduce((a, b) => a + b, 0), "el total de cobros es la suma de sus filas");
    assert.equal(fila("PROMEDIO/DÍA"), Math.round(total / 9));
    await ventana.close();

    // Si el teléfono no deja abrir la ventana, se avisa en vez de no hacer nada.
    await p.evaluate(() => { window.open = () => null; });
    await p.getByText("Exportar / Imprimir PDF").tap();
    await aviso(p, "No se pudo abrir la ventana del reporte").waitFor();

    await p.tap("#nb-comp");
    await p.locator("#compContent table").waitFor();
    const meses = await p.locator("#compContent tbody tr").allInnerTexts();
    const diasDe = (mes) => meses.find((f) => f.toUpperCase().startsWith(mes)).trim().split(/\s+/).pop();
    assert.equal(diasDe("OCT"), "31d");
    assert.equal(diasDe("NOV"), "9d");
    assert.equal(diasDe("SEPT"), new Set(entre("2026-09-01", "2026-09-30").map((v) => v.fecha)).size + "d");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("al cambiar de filtro rápido no queda en pantalla la respuesta del filtro anterior", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    await p.tap("#nb-hist");
    await p.locator("#histContent table.tbl").waitFor();
    // La próxima consulta tarda más que la siguiente (como pasa con mala señal).
    const demorarProxima = () =>
      p.evaluate(() => {
        const Q = firebase.firestore.Query.prototype;
        const original = Q.get;
        window.__lentaLista = false;
        Q.get = function (...a) {
          Q.get = original;
          return original.apply(this, a).then((r) => new Promise((ok) => setTimeout(() => { ok(r); setTimeout(() => { window.__lentaLista = true; }, 50); }, 1200)));
        };
      });
    await demorarProxima();
    await p.fill("#hMes", "2026-10"); // octubre: respuesta lenta
    await p.fill("#hMes", "2026-09"); // enseguida septiembre
    await p.waitForFunction(() => window.__lentaLista === true);
    const sep = entre("2026-09-01", "2026-09-30");
    const kpis = await texto(p, "#histContent .kpi-grid");
    assert.ok(kpis.includes("TOTAL VENTAS" + pesos(suma(sep, "totalVentas"))), "se ve septiembre, que es lo elegido: " + kpis);
    assert.ok((await p.locator("#histContent tbody tr").first().innerText()).includes("/09/2026"));

    await p.tap("#nb-rep");
    await p.locator("#repContent .kpi").first().waitFor();
    await demorarProxima();
    await p.selectOption("#rTipo", "mes-ant"); // lenta
    await p.selectOption("#rTipo", "semana-ant");
    await p.waitForFunction(() => window.__lentaLista === true);
    assert.match(await texto(p, "#repContent > div"), /^02\/11\/2026 — 08\/11\/2026/);
    assert.equal(await p.evaluate(() => window._repData.label), "02/11/2026 — 08/11/2026", "lo que se imprime es el período elegido");
  } finally {
    await h.close();
  }
});

test("editar un registro: no desarma los extras con centavos, redondea los totales y respeta registros viejos", async () => {
  const ventas = copia(VENTAS);
  // Dos ingresos extra con centavos: su suma en coma flotante es 3000.3000000000002.
  const a = ventas["2026-11-07_CAB"];
  a.extras = [{ desc: "Picada para evento", monto: 1000.1 }, { desc: "Venta a vecino", monto: 2000.2 }];
  a.extraZ = 1000.1 + 2000.2;
  a.extraDesc = "Picada para evento, Venta a vecino";
  a.totalVentas = a.totalZ + a.extraZ;
  a.totalNeto = a.totalVentas - a.totalGasto;
  // Registro de formato viejo: solo el total de gastos y la descripción del extra, sin las listas.
  const b = ventas["2026-11-06_CAB"];
  delete b.gastos;
  delete b.extras;
  Object.assign(b, { totalGasto: 12345, extraZ: 5000, extraDesc: "Venta mostrador", totalVentas: b.totalZ + 5000, totalNeto: b.totalZ + 5000 - 12345 });

  const h = await abrir({ ventas, viewport: { width: 375, height: 667 } }); // iPhone chico
  const p = h.page;
  try {
    await p.tap("#nb-hist");
    await p.selectOption("#hSuc", "CAB");
    const editar = async (fecha) => {
      const filaDia = p.locator("#histContent tbody tr", { hasText: fecha }).first();
      await filaDia.waitFor();
      await filaDia.tap();
      await p.locator("#histContent .det-row button:visible", { hasText: "Editar registro" }).tap();
      await p.locator("#editOverlay.show").waitFor();
    };
    const guardarEdicion = async () => {
      await p.tap("#btnEditSave");
      await aviso(p, "Registro actualizado").waitFor();
      await p.locator("#editOverlay.show").waitFor({ state: "detached" });
      await p.locator(".ss-toast", { hasText: "Registro actualizado" }).first().tap(); // se cierra al tocarlo
      await p.locator(".ss-toast", { hasText: "Registro actualizado" }).waitFor({ state: "detached" });
    };

    await editar("07/11/2026");
    assert.equal(await p.innerText("#editSubtitle"), "07/11/2026 · Caballito");
    assert.ok(await seVe(p, "#editOverlay h3"), "el título de la ventana no queda debajo del encabezado");
    await p.locator("#btnEditSave").scrollIntoViewIfNeeded();
    assert.ok(await seVe(p, "#btnEditSave"), "el botón Guardar no queda debajo de la barra inferior");
    assert.equal(await p.inputValue("#eExtraZ"), "3.000,3");
    await p.fill("#eZ", "900000,55");
    assert.equal(await p.inputValue("#eZ"), "900.000,55");
    await guardarEdicion();
    const d = await registro(h, "2026-11-07_CAB");
    assert.deepEqual(d.extras, a.extras, "los dos ingresos extra siguen separados");
    assert.equal(d.extraDesc, a.extraDesc);
    assert.equal(d.totalZ, 900000.55);
    assert.equal(d.extraZ, 3000.3);
    assert.equal(d.totalVentas, 903000.85);
    assert.equal(d.totalNeto, Math.round((903000.85 - a.totalGasto) * 100) / 100);
    assert.deepEqual(d.gastos, a.gastos);
    assert.equal(d.totalGasto, a.totalGasto);
    assert.equal(d.fecha, "2026-11-07");
    assert.equal(d.sucursal, "CAB");

    await editar("06/11/2026");
    await p.fill("#eObs", "Corregido por Nacho");
    await guardarEdicion();
    const v = await registro(h, "2026-11-06_CAB");
    assert.equal(v.obs, "Corregido por Nacho");
    assert.equal(v.totalGasto, 12345, "el total de gastos de un registro viejo no se pierde");
    assert.equal(v.totalVentas, b.totalZ + 5000);
    assert.equal(v.totalNeto, b.totalZ + 5000 - 12345);
    assert.equal(v.extraZ, 5000);
    assert.equal(v.gastos, undefined, "no se inventa una lista de gastos");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

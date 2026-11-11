// Funciones compartidas de fechas, montos y texto (src/js/base.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function cargar(ahoraISO) {
  const RealDate = Date;
  class FechaFija extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(new RealDate(ahoraISO).getTime());
      else super(...a);
    }
    static now() {
      return new RealDate(ahoraISO).getTime();
    }
  }
  const window = { addEventListener() {} };
  const ctx = vm.createContext({ window, Intl, Math, Number, String, isFinite, isNaN, parseFloat, encodeURIComponent, Date: ahoraISO ? FechaFija : RealDate });
  vm.runInContext(fs.readFileSync(new URL("../src/js/base.js", import.meta.url), "utf8"), ctx);
  return window.SersaleBase;
}

test("hoy() es el día de Buenos Aires, también de noche", () => {
  assert.equal(cargar("2026-11-10T10:30:00-03:00").hoy(), "2026-11-10");
  assert.equal(cargar("2026-11-10T22:30:00-03:00").hoy(), "2026-11-10"); // en UTC ya es el 11
  assert.equal(cargar("2026-11-30T23:59:00-03:00").hoy(), "2026-11-30"); // fin de mes
  assert.equal(cargar("2026-12-31T21:30:00-03:00").hoy(), "2026-12-31"); // fin de año
});

test("las fechas sin hora no se corren un día", () => {
  const B = cargar();
  assert.equal(B.fmtFecha("2026-11-10"), "10/11/2026");
  assert.equal(B.fmtFechaCorta("2026-01-05"), "05/01");
  assert.equal(B.diaDe("2026-11-10"), "2026-11-10");
  assert.equal(B.diaSemana("2026-11-10"), 2); // martes
});

test("fechas con hora, Timestamps y valores inválidos", () => {
  const B = cargar();
  assert.equal(B.fmtFecha("2026-11-11T01:30:00.000Z"), "10/11/2026"); // 22:30 del 10 en Buenos Aires
  assert.equal(B.fmtHora("2026-11-11T01:30:00.000Z"), "22:30");
  assert.equal(B.fmtFecha({ toDate: () => new Date("2026-03-01T15:00:00Z") }), "01/03/2026");
  assert.equal(B.fmtFecha({ seconds: 1772377200, nanoseconds: 0 }), B.fmtFecha(new Date(1772377200000)));
  assert.equal(B.fmtFecha("cualquier cosa"), "");
  assert.equal(B.fmtFecha(null), "");
  assert.equal(B.aFecha(undefined), null);
  assert.equal(B.diaDe(null), "");
  assert.equal(B.fmtFechaCorta(""), "");
});

test("sumarDias y diasEntre cruzan meses y años", () => {
  const B = cargar("2026-11-10T10:30:00-03:00");
  assert.equal(B.sumarDias("2026-11-30", 1), "2026-12-01");
  assert.equal(B.sumarDias("2026-01-01", -1), "2025-12-31");
  assert.equal(B.sumarDias("2024-02-28", 1), "2024-02-29");
  assert.equal(B.diasEntre("2026-11-01", "2026-11-10"), 9);
  assert.equal(B.diasEntre("2026-10-11"), 30);
  assert.equal(B.diasEntre("2026-11-12"), -2);
  assert.equal(B.diasEntre("2026-11-09T23:50:00-03:00", "2026-11-10T00:10:00-03:00"), 1);
});

test("numero() entiende montos escritos a la argentina", () => {
  const B = cargar();
  const casos = [
    ["8.990", 8990], ["$ 12.500", 12500], ["1.234,56", 1234.56], ["1,5", 1.5], ["1500.50", 1500.5],
    ["12.345.678", 12345678], ["2.5", 2.5], ["0,250", 0.25], ["-1.200", -1200], ["", 0], [null, 0],
    ["abc", 0], [1234.5, 1234.5], ["1.500", 1500], ["$8.990,00", 8990], ["10", 10], [NaN, 0],
  ];
  for (const [entrada, esperado] of casos) assert.equal(B.numero(entrada), esperado, JSON.stringify(entrada));
});

test("fmtMonto y redondear", () => {
  const B = cargar();
  assert.equal(B.fmtMonto(8990), "$8.990");
  assert.equal(B.fmtMonto(-1200.4), "-$1.200");
  assert.equal(B.fmtMonto(1234.5, 2), "$1.234,50");
  assert.equal(B.fmtMonto(undefined), "$0");
  assert.equal(B.fmtMonto(-0.2), "$0");
  assert.equal(B.redondear(1.005, 2), 1.01);
  assert.equal(B.redondear(0.1 + 0.2, 2), 0.3);
  assert.equal(B.redondear("x"), 0);
});

test("texto: comparar nombres y armar links", () => {
  const B = cargar();
  assert.equal(B.mismoNombre("  Fiambrería  El Ñandú ", "fiambreria el nandu"), true);
  assert.equal(B.mismoNombre("Don Pepe", "Don Pepe S.A."), false);
  assert.equal(B.mismoNombre("  Fiambrería  El Toro ", "fiambreria el toro"), true);
  assert.equal(B.coincide("Carnicería Don José", "jose carni"), true);
  assert.equal(B.coincide("Carnicería Don José", "pepe"), false);
  assert.equal(B.waLink("Hola & chau #1 +54", "11 6763-7860"), "https://wa.me/1167637860?text=Hola%20%26%20chau%20%231%20%2B54");
  assert.equal(B.esc(`<b onclick="x">O'Brien & Cía</b>`), "&lt;b onclick=&quot;x&quot;&gt;O&#39;Brien &amp; Cía&lt;/b&gt;");
});

test("campo de kilos: acepta coma o punto y entrega el valor con punto", () => {
  const B = cargar();
  // lo que se va escribiendo
  assert.equal(B.decimalLimpiar("30,4", 3), "30,4");
  assert.equal(B.decimalLimpiar("30.4", 3), "30,4"); // el punto es decimal, nunca miles
  assert.equal(B.decimalLimpiar("30,", 3), "30,");
  assert.equal(B.decimalLimpiar("30,4,5", 3), "30,45");
  assert.equal(B.decimalLimpiar("12,34567", 3), "12,345");
  assert.equal(B.decimalLimpiar("3o,4 kg", 3), "3,4");
  assert.equal(B.decimalLimpiar("-5", 3), "5");
  // valor que se guarda
  const casos = [["30,4", "30.4"], ["30,", "30"], [",5", "0.5"], ["", ""], [",", ""], ["0,250", "0.250"], ["12", "12"]];
  for (const [texto, valor] of casos) assert.equal(B.decimalValor(texto), valor, JSON.stringify(texto));
  // valor guardado -> lo que se muestra
  assert.equal(B.decimalVista("30.4"), "30,4");
  assert.equal(B.decimalVista(30.4), "30,4");
  assert.equal(B.decimalVista(null), "");
  assert.equal(B.decimalVista(""), "");
});

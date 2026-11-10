// Señal que se corta justo al confirmar: el servidor guardó pero la respuesta no
// llegó, y Firestore vuelve a ejecutar la transacción. Nada puede aplicarse dos veces.
import test from "node:test";
import assert from "node:assert/strict";
import { launch } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

function cuentaConDeuda(seed) {
  const [id, c] = Object.entries(seed.cuentas_corrientes).find(([, c]) => c.saldo > 100000 && !c.mergedInto);
  return { id, ...c };
}
const movimientosDe = (db, nombre) => Object.values(db.cc_movimientos || {}).filter((m) => m.cliente === nombre);

async function abrir(seed) {
  const h = await launch({ rol: "director", etiqueta: "tx", seed });
  await h.ir("pedidos.html");
  await h.sincronizar();
  return h;
}

test("cuenta corriente: un pago cuya confirmación se pierde se asienta una sola vez", async () => {
  const seed = buildSeed();
  const cuenta = cuentaConDeuda(seed);
  const antes = movimientosDe(seed, cuenta.nombre).length;
  const h = await abrir(seed);
  try {
    const red = await h.redQueSeCorta();
    red.perder = 1;
    const res = await h.page.evaluate(
      (cliente) => ccAsentarMovimiento({ cliente, datos: { tipo: "pago", formaPago: "Efectivo", monto: 10000, fecha: SersaleBase.hoy(), detalle: "Pago de prueba", obs: "" } }),
      cuenta.nombre
    );
    assert.equal(red.perdidas, 1, "la prueba tiene que haber perdido una confirmación");
    assert.equal(res.asentado, true);
    const db = await h.dump();
    assert.equal(db.cuentas_corrientes[cuenta.id].saldo, cuenta.saldo - 10000, "el saldo baja una sola vez");
    assert.equal(movimientosDe(db, cuenta.nombre).length, antes + 1, "un solo movimiento nuevo");
  } finally {
    await h.close();
  }
});

test("cuenta corriente: un cargo cuya confirmación se pierde se cobra una sola vez", async () => {
  const seed = buildSeed();
  const cuenta = cuentaConDeuda(seed);
  const h = await abrir(seed);
  try {
    const red = await h.redQueSeCorta();
    red.perder = 2; // dos cortes seguidos
    await h.page.evaluate(
      (cliente) => ccAsentarMovimiento({ cliente, datos: { tipo: "pedido", monto: 25000, fecha: SersaleBase.hoy(), detalle: "Cargo de prueba", origen: "venta_rapida" } }),
      cuenta.nombre
    );
    assert.equal(red.perdidas, 2);
    const db = await h.dump();
    assert.equal(db.cuentas_corrientes[cuenta.id].saldo, cuenta.saldo + 25000);
    assert.equal(Object.values(db.cc_movimientos).filter((m) => m.detalle === "Cargo de prueba").length, 1);
  } finally {
    await h.close();
  }
});

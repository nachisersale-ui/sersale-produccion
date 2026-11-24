// iPhone, app instalada: al cerrarse el teclado (o al volver de otra app) la barra de
// abajo quedaba flotando en el medio de la pantalla hasta que se desplazaba la página.
// js/shell.js ahora mueve la página un punto y la devuelve, que es lo que hace que iOS
// vuelva a ubicar lo que va fijo abajo.
//
// El defecto en sí es del motor del iPhone y no se reproduce en el navegador de las
// pruebas: acá se comprueba que el reacomodo se dispara cuando corresponde, que deja la
// página exactamente donde estaba y que no molesta mientras se pasa de un campo a otro.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const movimientos = (p) => p.evaluate(() => window.__movs.slice());
async function preparar(p) {
  await p.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", '<div style="height:3000px"></div><input id="campo-a" style="position:fixed;top:80px;left:10px"><input id="campo-b" style="position:fixed;top:140px;left:10px">');
    window.__movs = [];
    const real = window.scrollTo.bind(window);
    window.scrollTo = (x, y) => { window.__movs.push(Math.round(y)); real(x, y); };
    real(0, 400);
  });
}
const quieto = (p) => p.waitForTimeout(700);

test("al cerrarse el teclado la pantalla se reacomoda y queda donde estaba; entre un campo y otro no se mueve", async () => {
  const h = await launch({ rol: "director", etiqueta: "barra", seed: buildSeed() });
  const p = h.page;
  try {
    await h.ir("pedidos.html");
    await quieto(p); // el reacomodo de la carga de la página
    await preparar(p);

    // De un campo a otro (el teclado sigue abierto): no se toca la página.
    await p.focus("#campo-a");
    await p.focus("#campo-b");
    await quieto(p);
    assert.deepEqual(await movimientos(p), []);

    // Se cierra el teclado (el campo pierde el foco): un punto y vuelta.
    await p.evaluate(() => document.activeElement.blur());
    await quieto(p);
    assert.deepEqual(await movimientos(p), [399, 400]);
    assert.equal(await p.evaluate(() => Math.round(window.pageYOffset)), 400, "la página queda donde estaba");

    // Arriba de todo no se puede subir: baja un punto y vuelve.
    await p.evaluate(() => { window.__movs = []; window.scrollTo(0, 0); window.__movs = []; });
    await p.focus("#campo-a");
    await p.evaluate(() => document.activeElement.blur());
    await quieto(p);
    assert.deepEqual(await movimientos(p), [1, 0]);

    // Al volver a la app también se reacomoda.
    await p.evaluate(() => { window.__movs = []; document.dispatchEvent(new Event("visibilitychange")); });
    await quieto(p);
    assert.deepEqual(await movimientos(p), [1, 0]);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

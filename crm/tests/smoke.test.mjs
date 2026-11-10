// Humo: cada página abre sin errores con la base vacía, sin pedir nada a
// servidores externos, y la conexión con Firestore funciona de punta a punta.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";

const PAGINAS = [
  ["index.html", null],
  ["index.html", "director"],
  ["pedidos.html", "director"],
  ["pedidos.html", "operario"],
  ["produccion.html", "director"],
  ["ventas.html", "director"],
  ["dashboard.html", "director"],
  ["presupuestos.html", "director"],
  ["backup.html", "director"],
  ["migracion.html", "director"],
];

for (const [pagina, rol] of PAGINAS) {
  test(`${pagina} abre sin errores (${rol || "sin sesión"})`, async () => {
    const h = await launch({ rol, etiqueta: "humo" });
    try {
      await h.ir(pagina);
      await h.page.waitForTimeout(600);
      assert.deepEqual(erroresReales(h.errores), [], "errores en la página");
      assert.deepEqual(h.inesperados, [], "pedidos a servidores externos");
      assert.ok(new URL(h.page.url()).pathname.endsWith(pagina), "quedó en " + h.page.url());
    } finally {
      await h.close();
    }
  });
}

test("sin sesión, las páginas internas vuelven al ingreso", async () => {
  const h = await launch({ etiqueta: "guard" });
  try {
    for (const p of ["pedidos.html", "dashboard.html", "ventas.html", "produccion.html", "presupuestos.html", "backup.html"]) {
      await h.page.goto(h.origin + "/" + p);
      await h.page.waitForURL(/index\.html$/);
    }
  } finally {
    await h.close();
  }
});

test("lee y escribe en Firestore (emulador) de punta a punta", async () => {
  const h = await launch({
    rol: "director",
    etiqueta: "cable",
    seed: { clientes: { c1: { nombre: "Fiambrería Ñandú", direccion: "Av. Caseros 2500" } } },
  });
  try {
    await h.ir("pedidos.html");
    await h.page.getByText("Clientes", { exact: false }).first().click();
    await h.page.getByText("Fiambrería Ñandú").first().waitFor();
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

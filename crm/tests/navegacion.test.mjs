// Navegación dentro de Pedidos: el gesto "atrás" del teléfono vuelve a la
// pantalla anterior en vez de salir de la página.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";

const enInicio = (page) => page.getByText("¿Quién sos?", { exact: false }).first();

test("atrás desde una vista vuelve al inicio de Pedidos", async () => {
  const h = await launch({ rol: "director", etiqueta: "nav" });
  try {
    await h.ir("index.html");
    await h.ir("pedidos.html");
    await enInicio(h.page).waitFor();

    await h.page.getByText("Comercial", { exact: true }).first().click();
    await h.page.getByText("Activos", { exact: false }).first().waitFor();
    await h.page.goBack();
    await enInicio(h.page).waitFor();
    assert.ok(h.page.url().endsWith("pedidos.html"), "el gesto atrás no debe salir de Pedidos");

    // Volver con la flecha de la pantalla y después con el gesto: no quedan entradas de más.
    await h.page.getByText("Clientes", { exact: true }).first().click();
    await h.page.getByText("←").first().click();
    await enInicio(h.page).waitFor();
    await h.page.waitForTimeout(300);
    await h.page.goBack();
    await h.page.waitForURL(/index\.html$/);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("al recargar dentro de una vista, atrás también vuelve al inicio", async () => {
  const h = await launch({ rol: "director", etiqueta: "nav2" });
  try {
    await h.ir("pedidos.html");
    await h.page.getByText("Depósito", { exact: true }).first().click();
    await h.page.waitForTimeout(200);
    await h.page.reload();
    await h.esperarApp();
    assert.equal(await enInicio(h.page).count(), 0, "debería seguir en Depósito tras recargar");
    await h.page.goBack();
    await enInicio(h.page).waitFor();
  } finally {
    await h.close();
  }
});

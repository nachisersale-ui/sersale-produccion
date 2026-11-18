// Kilos y cantidades con decimales: se pueden escribir con coma (30,4) o con
// punto (30.4) y se guardan igual que siempre (número con punto).
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const boton = (h, t) => h.page.locator("button", { hasText: t });

async function abrirDeposito(seed, rol = "operario") {
  const h = await launch({ rol, etiqueta: "kg", seed });
  await h.ir("pedidos.html");
  if (rol !== "operario") await h.page.getByText("Depósito", { exact: true }).first().click();
  await h.sincronizar();
  return h;
}

test("depósito: los kg se anotan con coma o con punto y se guardan con decimales", async () => {
  const seed = buildSeed();
  const [id, pedido] = Object.entries(seed.pedidos).find(([, p]) => p.estado === "pendiente" && p.items.length >= 3);
  const h = await abrirDeposito(seed);
  try {
    await h.page.getByText(pedido.cliente, { exact: true }).first().click();
    await boton(h, "⚙️ En preparación").first().click();
    await h.page.getByText("Anotar kg por ítem").waitFor();
    const campos = h.page.locator('input[placeholder="kg"]');
    assert.equal(await campos.first().getAttribute("inputmode"), "decimal", "teclado con coma");
    assert.equal(await campos.first().getAttribute("type"), "text");

    // Tecla por tecla, como en el teléfono
    await campos.nth(0).pressSequentially("30,4");
    assert.equal(await campos.nth(0).inputValue(), "30,4");
    await campos.nth(1).pressSequentially("12.75"); // con punto también vale, y se muestra con coma
    assert.equal(await campos.nth(1).inputValue(), "12,75");
    await campos.nth(2).pressSequentially("0,250");
    await campos.nth(2).press("Backspace"); // corregir no rompe el campo
    await campos.nth(2).pressSequentially("5");
    assert.equal(await campos.nth(2).inputValue(), "0,255");

    await boton(h, "Confirmar — En preparación").click();
    await h.page.getByText("Anotar kg por ítem").waitFor({ state: "detached" });
    let doc;
    for (let i = 0; i < 100; i++) {
      doc = await h.doc("pedidos/" + id);
      if (doc.estado === "preparando") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(doc.estado, "preparando");
    assert.deepEqual(doc.items.slice(0, 3).map((it) => it.kgReal), [30.4, 12.75, 0.255]);
    assert.equal(typeof doc.items[0].kgReal, "number", "se guarda como número, igual que antes");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("depósito: al corregir kg ya anotados se ven con coma y se puede cambiar el decimal", async () => {
  const seed = buildSeed();
  const [id, pedido] = Object.entries(seed.pedidos).find(([, p]) => p.estado === "pendiente" && p.items.length >= 2);
  pedido.estado = "listo"; // los kg se corrigen con el pedido listo
  pedido.items[0].kgReal = 30.4;
  const h = await abrirDeposito(seed, "director");
  try {
    await h.page.getByText(pedido.cliente, { exact: true }).first().click();
    await boton(h, "⚖️ kg").first().click();
    const campos = h.page.locator('input[placeholder="kg"]');
    await campos.first().waitFor();
    assert.equal(await campos.nth(0).inputValue(), "30,4");
    await campos.nth(0).fill("");
    await campos.nth(0).pressSequentially("31,65");
    await boton(h, "✓ Guardar kg").click();
    let doc;
    for (let i = 0; i < 100; i++) {
      doc = await h.doc("pedidos/" + id);
      if (doc.items[0].kgReal === 31.65) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(doc.items[0].kgReal, 31.65);
  } finally {
    await h.close();
  }
});

test("nuevo pedido: la cantidad acepta decimales con coma", async () => {
  const seed = buildSeed();
  const h = await launch({ rol: "director", etiqueta: "kg", seed });
  try {
    await h.ir("pedidos.html");
    await h.page.getByText("Comercial", { exact: true }).first().click();
    await boton(h, "+ Nuevo").click();
    const cantidad = h.page.getByPlaceholder("Cantidad").first();
    await cantidad.waitFor();
    await cantidad.pressSequentially("2,5");
    assert.equal(await cantidad.inputValue(), "2,5");
    assert.equal(await cantidad.getAttribute("inputmode"), "decimal");
  } finally {
    await h.close();
  }
});

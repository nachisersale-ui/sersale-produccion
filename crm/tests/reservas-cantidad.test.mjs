// Reservas: cantidad opcional ("2 lechones"). Con más de una unidad, los kilos
// cargados son los de CADA UNA: los totales de kilos y de plata se multiplican.
// Las reservas sin el dato siguen siendo de una.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { launch } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

// "Hoy" en las pruebas es el martes 10/11/2026.
function reserva(extra) {
  return { fechaReserva: "2026-11-02", cliente: "Cliente", contacto: "", item: "LECHÓN", kg: 10, precioKg: 14500, sena: 0, fechaRetiro: "2026-12-24", obs: "", estado: "pendiente", creadoEn: "2026-11-02T10:00:00.000Z", creadoPor: "nacho", ...extra };
}
const RESERVAS = {
  a: reserva({ cliente: "Marta Gómez", cantidad: 2, kg: 10, kgHasta: 12, sena: 50000, creadoEn: "2026-11-02T10:00:00.000Z" }),
  b: reserva({ cliente: "Pedro Ruiz", kg: 9, creadoEn: "2026-11-02T11:00:00.000Z" }), // vieja: sin cantidad
};
async function abrir() {
  const seed = buildSeed();
  seed.reservas = JSON.parse(JSON.stringify(RESERVAS));
  const h = await launch({ rol: "director", etiqueta: "rsv-cant", seed });
  await h.ir("pedidos.html");
  await h.page.getByText("Reservas fin de año").first().click();
  await h.page.getByRole("tab", { name: "Por día" }).waitFor();
  return h;
}
const boton = (p, t) => p.getByRole("button", { name: t, exact: true });
const filas = (p) => p.locator("button[data-reserva-fila]").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s*\n\s*/g, " | ")));
const pdfTexto = async (d) => fs.readFileSync(await d.path()).toString("latin1");
async function esperar(h, cond, ms = 15000) {
  const fin = Date.now() + ms;
  for (;;) {
    const db = await h.dump();
    if (cond(db.reservas || {})) return db.reservas;
    if (Date.now() > fin) throw new Error("no se cumplió a tiempo: " + JSON.stringify(db.reservas));
    await new Promise((r) => setTimeout(r, 120));
  }
}

test("cantidad: 2 lechones de 10 a 12 kg son 20 a 24 kg; los kilos, lo que hay que tener y lo que resta cobrar cuentan las dos unidades", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    const f = await filas(p);
    // 2 × 10 kg × $14.500 = $290.000 (tope 2 × 12 → $348.000), menos la seña de $50.000.
    assert.equal(f.find((x) => x.startsWith("Marta Gómez")), "Marta Gómez | LECHÓN · Parque Patricios | 2 × 10 a 12 kg | Resta $240.000 a $298.000");
    assert.equal(f.find((x) => x.startsWith("Pedro Ruiz")), "Pedro Ruiz | LECHÓN · Parque Patricios | 9 kg | Sin seña");
    // El bloque del día: 2 reservas, 3 lechones, 29 a 33 kg.
    await p.locator('[data-rsv-grupo="Jueves 24/12/2026"]').getByText("2 reservas · 29 a 33 kg").waitFor();
    await p.locator('[data-rsv-grupo="Jueves 24/12/2026"]').getByText("LECHÓN ×3 · 29 a 33 kg").waitFor();

    // La tarjeta completa.
    await p.getByRole("button", { name: "Ver la reserva de Marta Gómez: LECHÓN" }).click();
    const t = p.locator("[data-reserva]", { hasText: "Marta Gómez" });
    await t.getByText("2 × 10 a 12 kg").waitFor();
    await t.getByText("$290.000 a $348.000").waitFor();

    // La planilla del depósito: cuántos hay que tener y el detalle de cada reserva.
    const [d] = await Promise.all([p.waitForEvent("download"), boton(p, "🖨️ Planilla para el depósito").click()]);
    const pdf = await pdfTexto(d);
    assert.ok(pdf.includes("2 reservas  \xb7  29 a 33 kg en total"));
    assert.ok(pdf.includes("(2 \xd7 10 a 12 kg)") && pdf.includes("(9 kg)"));
    assert.ok(/\(LECH\xd3N\)[^]{0,200}\(3\)[^]{0,200}\(29 a 33 kg\)/.test(pdf), "hay que tener 3 lechones");

    // Lista de siempre: el resumen de arriba también cuenta 3.
    await p.getByRole("tab", { name: "Lista" }).click();
    await p.getByText("× 3").first().waitFor();
  } finally {
    await h.close();
  }
});

test("cantidad: es opcional al cargar, cambia la etiqueta de kilos a «de cada uno», y editar una reserva vieja no le agrega nada", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    await boton(p, "+ Nueva").click();
    await p.getByText("Nueva reserva").waitFor();
    await p.locator("#rsv-cliente").fill("Carla Núñez");
    await p.locator("#rsv-item").selectOption("LECHÓN");
    assert.equal(await p.locator('label[for="rsv-kg"]').innerText(), "Kilos");
    await p.getByLabel("Cantidad", { exact: true }).pressSequentially("2x"); // solo números
    assert.equal(await p.getByLabel("Cantidad", { exact: true }).inputValue(), "2");
    assert.equal(await p.locator('label[for="rsv-kg"]').innerText(), "Kilos de cada uno");
    await boton(p, "✓ Guardar reserva").click();
    await p.locator(".ss-toast", { hasText: "Poné cuántos kilos tiene que tener cada uno." }).waitFor();
    await p.locator("#rsv-kg").pressSequentially("10,5");
    await p.locator("#rsv-kg-ayuda").getByText("21 kg en total").waitFor();
    await p.getByLabel("Precio por kg").fill(""); // puede venir sugerido el último precio del lechón
    await p.getByLabel("Precio por kg").pressSequentially("10000");
    await p.getByText("$210.000").first().waitFor();
    await boton(p, "Guardar y cargar otro ítem de este cliente").click();
    let r = await esperar(h, (x) => Object.values(x).some((v) => v.cliente === "Carla Núñez"));
    const carla = Object.values(r).find((v) => v.cliente === "Carla Núñez");
    assert.deepEqual([carla.cantidad, carla.kg, carla.kgHasta], [2, 10.5, null]);
    // El ítem siguiente arranca sin cantidad; si no se pone, se guarda como una unidad.
    assert.equal(await p.getByLabel("Cantidad", { exact: true }).inputValue(), "");
    await p.locator("#rsv-item").selectOption("CORDERO");
    await p.locator("#rsv-kg").pressSequentially("7");
    await boton(p, "✓ Guardar reserva").click();
    r = await esperar(h, (x) => Object.values(x).some((v) => v.item === "CORDERO"));
    assert.equal(Object.values(r).find((v) => v.item === "CORDERO").cantidad, null);

    // Una reserva vieja: abrir y guardar sin tocar nada no escribe nada.
    await p.getByRole("tab", { name: "Lista" }).click();
    const pedro = p.locator("[data-reserva]", { hasText: "Pedro Ruiz" });
    await pedro.getByRole("button", { name: "Editar" }).click();
    await p.getByText("Editar reserva").waitFor();
    assert.equal(await p.getByLabel("Cantidad", { exact: true }).inputValue(), "");
    await boton(p, "✓ Guardar cambios").click();
    await pedro.waitFor();
    await h.sincronizar();
    assert.deepEqual((await h.dump()).reservas.b, RESERVAS.b);

    // Se le pone cantidad 3: cambia solo ese dato, y la tarjeta lo muestra.
    await pedro.getByRole("button", { name: "Editar" }).click();
    await p.getByLabel("Cantidad", { exact: true }).fill("3");
    await boton(p, "✓ Guardar cambios").click();
    r = await esperar(h, (x) => x.b.cantidad === 3);
    const { cantidad, actualizadoEn, ...resto } = r.b;
    assert.deepEqual(resto, RESERVAS.b);
    await pedro.getByText("3 × 9 kg").waitFor();
    await pedro.getByText("$391.500").first().waitFor(); // 27 kg × $14.500

    // Marta deja de llevar dos: al borrar la cantidad vuelve a ser una.
    const marta = p.locator("[data-reserva]", { hasText: "Marta Gómez" });
    await marta.getByRole("button", { name: "Editar" }).click();
    assert.equal(await p.getByLabel("Cantidad", { exact: true }).inputValue(), "2");
    await p.getByLabel("Cantidad", { exact: true }).fill("");
    await boton(p, "✓ Guardar cambios").click();
    r = await esperar(h, (x) => x.a.cantidad === null);
    assert.equal(r.a.kg, 10);
  } finally {
    await h.close();
  }
});

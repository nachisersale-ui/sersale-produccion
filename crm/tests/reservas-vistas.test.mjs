// Reservas, vistas agrupadas: por día de retiro (la que abre), por producto y por
// cliente, con filas compactas, filtros rápidos y la planilla en PDF para el depósito.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

// "Hoy" en las pruebas es el martes 10/11/2026.
function reserva(extra) {
  return { fechaReserva: "2026-11-02", cliente: "Cliente", contacto: "", item: "LECHÓN", kg: 10, precioKg: 14500, sena: 0, fechaRetiro: "2026-12-24", obs: "", estado: "pendiente", creadoEn: "2026-11-02T12:00:00.000Z", creadoPor: "nacho", ...extra };
}
const RESERVAS = {
  r1: reserva({ cliente: "Marta Gómez", kg: 10, sena: 50000, creadoEn: "2026-11-02T10:00:00.000Z" }),
  r2: reserva({ cliente: "Marta Gómez", item: "CORDERO", kg: 8, kgHasta: 10, precioKg: 20000, creadoEn: "2026-11-02T10:05:00.000Z" }),
  r3: reserva({ cliente: "Pedro Ruiz", item: "lechon", kg: 12, precioKg: 10000, sena: 120000, obs: "Abierto al medio", creadoEn: "2026-11-03T10:00:00.000Z" }),
  r4: reserva({ cliente: "Lucía Paz", kg: 9, precioKg: null, fechaRetiro: "2026-12-31", creadoEn: "2026-11-04T10:00:00.000Z" }),
  r5: reserva({ cliente: "Raúl Díaz", item: "COCHINILLO", kg: 5, precioKg: null, sena: 1000, fechaRetiro: "", creadoEn: "2026-11-04T11:00:00.000Z" }),
  r6: reserva({ cliente: "Ana Sosa", kg: 11, fechaRetiro: "2026-11-05", fechaReserva: "2026-10-20", creadoEn: "2026-10-20T10:00:00.000Z" }),
  r7: reserva({ cliente: "Juan Vera", item: "CORDERO", kg: 7, estado: "entregada", entregadaEn: "2026-11-08T10:00:00.000Z", creadoEn: "2026-11-01T10:00:00.000Z" }),
};

async function abrir(opts = {}) {
  const seed = buildSeed();
  seed.reservas = JSON.parse(JSON.stringify(RESERVAS));
  const h = await launch({ rol: "director", etiqueta: "rsv-v", seed, ...opts });
  await h.ir("pedidos.html");
  await h.page.getByText("Reservas fin de año").first().click();
  await h.page.getByRole("tab", { name: "Por día" }).waitFor();
  return h;
}
const grupo = (p, titulo) => p.locator('[data-rsv-grupo="' + titulo + '"]');
const titulos = (p) => p.locator("[data-rsv-grupo]").evaluateAll((els) => els.map((e) => e.getAttribute("data-rsv-grupo")));
const filasDe = (p, titulo) => grupo(p, titulo).locator("button[data-reserva-fila]").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s*\n\s*/g, " | ")));
const pdfTexto = async (d) => fs.readFileSync(await d.path()).toString("latin1");
const hojas = (t) => (t.match(/\/Type\s*\/Page\b/g) || []).length;

test("abre «Por día»: un bloque por fecha de retiro con lo que hay que tener, filas compactas y la tarjeta completa al tocar", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    assert.equal(await p.getByRole("tab", { name: "Por día" }).getAttribute("aria-selected"), "true");
    // Primero lo atrasado, después los días que vienen y al final lo que no tiene fecha. Lo entregado no figura.
    assert.deepEqual(await titulos(p), ["Jueves 05/11/2026", "Jueves 24/12/2026", "Jueves 31/12/2026", "Retiro a confirmar"]);
    const dia = grupo(p, "Jueves 24/12/2026");
    await dia.getByText("3 reservas · 30 a 32 kg").waitFor();
    await dia.getByText("LECHÓN ×2 · 22 kg").waitFor(); // «lechon» escrito a mano se junta con LECHÓN
    await dia.getByText("CORDERO ×1 · 8 a 10 kg").waitFor();
    await grupo(p, "Jueves 05/11/2026").getByText("sin retirar (hace 5 días)").waitFor();
    // Una línea por reserva: quién, qué, cuánto y cómo está de plata. Juntas las del mismo producto.
    assert.deepEqual(await filasDe(p, "Jueves 24/12/2026"), [
      "Marta Gómez | LECHÓN | 10 kg | Resta $95.000",
      "Pedro Ruiz | lechon · Abierto al medio | 12 kg | Pagado",
      "Marta Gómez | CORDERO | 8 a 10 kg | Sin seña",
    ]);
    assert.deepEqual(await filasDe(p, "Retiro a confirmar"), ["Raúl Díaz | COCHINILLO | 5 kg | A convenir"]);
    assert.equal(await p.locator("[data-reserva]").count(), 0, "las tarjetas grandes no se ven hasta tocar una fila");

    // Tocar una fila abre la tarjeta de siempre, con sus botones; de a una por vez.
    await p.getByRole("button", { name: "Ver la reserva de Pedro Ruiz: lechon" }).click();
    const tarjeta = p.locator("[data-reserva]");
    assert.equal(await tarjeta.count(), 1);
    await tarjeta.getByText("PAGADO").waitFor();
    await tarjeta.getByRole("button", { name: "Editar" }).waitFor();
    await p.getByRole("button", { name: "Ver la reserva de Marta Gómez: LECHÓN" }).click();
    assert.equal(await p.locator("[data-reserva]").count(), 1);
    await p.locator("[data-reserva]").getByText("Marta Gómez").waitFor();
    await p.getByRole("button", { name: "Cerrar el detalle de Marta Gómez" }).click();
    assert.equal(await p.locator("[data-reserva]").count(), 0);
    // Tocar la reserva abierta (su nombre) la vuelve a cerrar, igual que en la lista.
    await p.getByRole("button", { name: "Ver la reserva de Marta Gómez: LECHÓN" }).click();
    await p.locator("[data-reserva]").getByText("Marta Gómez").click();
    assert.equal(await p.locator("[data-reserva]").count(), 0);
    await p.getByRole("button", { name: "Ver la reserva de Marta Gómez: LECHÓN" }).waitFor();

    // Marcar entregada desde la fila: sale del día y bajan sus totales.
    await p.getByRole("button", { name: "Ver la reserva de Pedro Ruiz: lechon" }).click();
    await p.locator("[data-reserva]").getByRole("button", { name: "✓ Entregada" }).click();
    await p.locator(".ss-hoja .ss-btn", { hasText: "Entregada" }).tap();
    await dia.getByText("2 reservas · 18 a 20 kg").waitFor();
    assert.equal((await h.dump()).reservas.r3.estado, "entregada");
    assert.equal(await p.getByRole("button", { name: "Ver la reserva de Pedro Ruiz: lechon" }).count(), 0);

    // Un bloque se puede plegar.
    await p.getByRole("button", { name: "Cerrar Jueves 24/12/2026" }).click();
    assert.deepEqual(await filasDe(p, "Jueves 24/12/2026"), []);
    await p.getByRole("button", { name: "Abrir Jueves 24/12/2026" }).click();
    assert.equal((await filasDe(p, "Jueves 24/12/2026")).length, 2);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("editar una reserva desde una fila guarda los cambios y vuelve a la misma vista, ya actualizada", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    await p.getByRole("button", { name: "Ver la reserva de Marta Gómez: LECHÓN" }).click();
    await p.locator("[data-reserva]").getByRole("button", { name: "Editar" }).click();
    await p.getByText("Editar reserva").waitFor();
    assert.equal(await p.locator("#rsv-cliente").inputValue(), "Marta Gómez");
    await p.getByLabel("Kilos").fill("");
    await p.getByLabel("Kilos").pressSequentially("11,5");
    await p.locator("#rsv-obs").fill("Lo quiere abierto");
    await p.locator("#rsv-retiro").fill("2026-12-31");
    await p.getByRole("button", { name: "✓ Guardar cambios" }).click();
    await p.locator(".ss-toast", { hasText: "Reserva actualizada" }).waitFor();
    // Vuelve a «Por día», con la reserva en su día nuevo y con los kilos nuevos.
    await p.getByRole("tab", { name: "Por día" }).waitFor();
    assert.equal(await p.getByRole("tab", { name: "Por día" }).getAttribute("aria-selected"), "true");
    const r = (await h.dump()).reservas.r1;
    assert.deepEqual([r.kg, r.obs, r.fechaRetiro, r.cliente, r.sena], [11.5, "Lo quiere abierto", "2026-12-31", "Marta Gómez", 50000]);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(r.actualizadoEn));
    // La reserva queda abierta, en su día nuevo, mostrando lo recién guardado.
    const abierta = grupo(p, "Jueves 31/12/2026").locator("[data-reserva]");
    await abierta.getByText("Lo quiere abierto").waitFor();
    await abierta.getByText("11,5").first().waitFor();
    assert.equal(await grupo(p, "Jueves 24/12/2026").locator("[data-reserva]").count(), 0);
    await p.getByRole("button", { name: "Cerrar el detalle de Marta Gómez" }).click();
    assert.ok((await filasDe(p, "Jueves 31/12/2026")).includes("Marta Gómez | LECHÓN · Lo quiere abierto | 11,5 kg | Resta $116.750"));
    assert.equal((await filasDe(p, "Jueves 24/12/2026")).filter((f) => f.startsWith("Marta Gómez | LECHÓN")).length, 0);

    // Una segunda edición seguida, de la misma reserva, también se guarda.
    await p.getByRole("button", { name: "Ver la reserva de Marta Gómez: LECHÓN" }).click();
    await p.locator("[data-reserva]").getByRole("button", { name: "Editar" }).click();
    assert.equal(await p.locator("#rsv-obs").inputValue(), "Lo quiere abierto", "el formulario abre con lo último guardado");
    await p.locator("#rsv-obs").fill("Abierto y sin cabeza");
    await p.getByRole("button", { name: "✓ Guardar cambios" }).click();
    await p.locator(".ss-toast", { hasText: "Reserva actualizada" }).first().waitFor();
    await p.getByRole("tab", { name: "Por día" }).waitFor();
    assert.equal((await h.dump()).reservas.r1.obs, "Abierto y sin cabeza");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("filtros rápidos, búsqueda, y las vistas «Por producto» y «Por cliente»", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    for (const t of ["Pendientes (6)", "Sin seña (3)", "Atrasadas (1)", "Entregadas (1)", "Todas (7)"]) await p.getByRole("button", { name: t, exact: true }).waitFor();
    await p.getByRole("button", { name: "Sin seña (3)", exact: true }).click();
    assert.deepEqual(await titulos(p), ["Jueves 05/11/2026", "Jueves 24/12/2026", "Jueves 31/12/2026"]);
    assert.deepEqual(await filasDe(p, "Jueves 24/12/2026"), ["Marta Gómez | CORDERO | 8 a 10 kg | Sin seña"]);
    await p.getByRole("button", { name: "Atrasadas (1)", exact: true }).click();
    assert.deepEqual(await titulos(p), ["Jueves 05/11/2026"]);
    await p.getByRole("button", { name: "Entregadas (1)", exact: true }).click();
    assert.deepEqual(await filasDe(p, "Jueves 24/12/2026"), ["Juan Vera | CORDERO | 7 kg | ✓ Entregada"]);
    await p.getByRole("button", { name: "Pendientes (6)", exact: true }).click();

    // Buscar mira en todas (también las entregadas), sin acentos.
    await p.getByLabel("Buscar reserva").fill("gomez");
    await p.getByText("2 reservas encontradas").waitFor();
    assert.deepEqual(await titulos(p), ["Jueves 24/12/2026"]);
    await p.getByLabel("Buscar reserva").fill("juan");
    await p.getByText("1 reserva encontrada").waitFor();
    await p.getByRole("button", { name: "Borrar la búsqueda" }).click();

    // Por producto: cuánto hay que tener de cada cosa y quiénes lo pidieron.
    await p.getByRole("tab", { name: "Por producto" }).click();
    assert.deepEqual(await titulos(p), ["LECHÓN", "CORDERO", "COCHINILLO"]);
    await grupo(p, "LECHÓN").getByText("4 reservas · 42 kg").waitFor();
    await grupo(p, "CORDERO").getByText("1 reserva · 8 a 10 kg").waitFor();
    assert.deepEqual(await filasDe(p, "LECHÓN"), [
      "Ana Sosa | Retira 05/11 | 11 kg | Sin seña",
      "Marta Gómez | Retira 24/12 | 10 kg | Resta $95.000",
      "Pedro Ruiz | Retira 24/12 · Abierto al medio | 12 kg | Pagado",
      "Lucía Paz | Retira 31/12 | 9 kg | Sin seña",
    ]);
    assert.deepEqual(await filasDe(p, "COCHINILLO"), ["Raúl Díaz | Retira a confirmar | 5 kg | A convenir"]);

    // Por cliente: todo lo de cada persona junto, con su seña y lo que resta.
    await p.getByRole("tab", { name: "Por cliente" }).click();
    assert.deepEqual(await titulos(p), ["Ana Sosa", "Lucía Paz", "Marta Gómez", "Pedro Ruiz", "Raúl Díaz"]);
    await grupo(p, "Marta Gómez").getByText("2 reservas · 18 a 20 kg").waitFor();
    await grupo(p, "Marta Gómez").getByText("seña $50.000 · resta $255.000 a $295.000").waitFor();
    assert.deepEqual(await filasDe(p, "Marta Gómez"), ["LECHÓN | Retira 24/12 | 10 kg | Resta $95.000", "CORDERO | Retira 24/12 | 8 a 10 kg | Sin seña"]);
    await grupo(p, "Pedro Ruiz").getByText("seña $120.000").waitFor();

    // La vista elegida se recuerda al volver a entrar; «Lista» sigue siendo la de siempre.
    await p.reload();
    await p.getByText("Reservas fin de año").first().click();
    await p.getByRole("tab", { name: "Por cliente" }).waitFor();
    assert.equal(await p.getByRole("tab", { name: "Por cliente" }).getAttribute("aria-selected"), "true");
    await p.getByRole("tab", { name: "Lista" }).click();
    await p.getByText("Ordenar por fecha de").waitFor();
    assert.equal(await p.locator("[data-reserva]").count(), 6);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("planilla para el depósito: una hoja por día con el resumen por producto y el detalle para tildar, sin precios", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    let [d] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "🖨️ Planilla para el depósito" }).click()]);
    assert.equal(d.suggestedFilename(), "Reservas para preparar - todas.pdf");
    let t = await pdfTexto(d);
    assert.equal(hojas(t), 4, "una hoja por día de retiro");
    for (const x of ["FRIGORÍFICO SERSALE", "RESERVAS PARA PREPARAR", "JUEVES 05/11/2026", "JUEVES 24/12/2026", "JUEVES 31/12/2026", "RETIRO A CONFIRMAR", "30 a 32 kg en total", "QUÉ HAY QUE TENER", "LECHÓN", "CORDERO", "COCHINILLO", "Marta Gómez", "Pedro Ruiz", "Abierto al medio", "8 a 10 kg", "LISTO"]) {
      assert.ok(t.includes(x), "la planilla dice «" + x + "»");
    }
    assert.ok(!t.includes("Juan Vera"), "lo ya entregado no va");
    assert.ok(!/14\.500|50\.000|\$/.test(t.replace(/\/[A-Za-z]+ \d+/g, "")), "sin precios ni señas");

    // La impresora de un día: solo ese día.
    [d] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Planilla de Jueves 24/12/2026" }).click()]);
    assert.equal(d.suggestedFilename(), "Reservas para preparar - 24-12-2026.pdf");
    t = await pdfTexto(d);
    assert.equal(hojas(t), 1);
    assert.ok(t.includes("JUEVES 24/12/2026") && t.includes("Marta Gómez") && t.includes("3 reservas"));
    assert.ok(!t.includes("Lucía Paz") && !t.includes("Ana Sosa"));
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// Reservas: por cuál sucursal retira cada cliente (Parque Patricios o Caballito).
// Se elige al cargar, se ve en cada reserva, se puede mirar una sucursal sola y
// la planilla del depósito sale por sucursal. Las reservas anteriores al campo
// se leen de su observación; sin observación, Parque Patricios.
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
  a: reserva({ cliente: "Marta Gómez", obs: "Retira por senillosa ", creadoEn: "2026-11-02T10:00:00.000Z" }),
  b: reserva({ cliente: "Pedro Ruiz", obs: "Retira por 24 de noviembre", creadoEn: "2026-11-02T11:00:00.000Z" }),
  c: reserva({ cliente: "Lucía Paz", item: "CORDERO", creadoEn: "2026-11-02T12:00:00.000Z" }),
  d: reserva({ cliente: "Raúl Díaz", obs: "Retira en parque patricios", sucursal: "caballito", creadoEn: "2026-11-02T13:00:00.000Z" }), // lo elegido le gana al texto
  e: reserva({ cliente: "Ana Sosa", obs: "Pasa por Caballito", estado: "entregada", creadoEn: "2026-11-01T10:00:00.000Z" }),
};
async function abrir() {
  const seed = buildSeed();
  seed.reservas = JSON.parse(JSON.stringify(RESERVAS));
  const h = await launch({ rol: "director", etiqueta: "rsv-suc", seed });
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

test("sucursal de retiro: las reservas viejas se leen de su observación, se puede mirar una sucursal sola y la planilla sale por sucursal", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    // Cada fila dice por cuál retira; sin observación es Parque Patricios.
    const todas = await filas(p);
    assert.equal(todas.length, 4);
    assert.ok(todas.find((f) => f.includes("Marta Gómez")).includes("Caballito"));
    assert.ok(todas.find((f) => f.includes("Pedro Ruiz")).includes("Parque Patricios"));
    assert.ok(todas.find((f) => f.includes("Lucía Paz")).includes("Parque Patricios"));
    assert.ok(todas.find((f) => f.includes("Raúl Díaz")).includes("Caballito"), "lo elegido en el formulario le gana al texto");

    // Los botones cuentan las pendientes de cada una.
    await boton(p, "Parque Patricios (2)").waitFor();
    await boton(p, "Caballito (2)").click();
    assert.deepEqual((await filas(p)).map((f) => f.split(" | ")[0]).sort(), ["Marta Gómez", "Raúl Díaz"]);
    await boton(p, "Pendientes (2)").waitFor();
    await boton(p, "Entregadas (1)").waitFor(); // Ana Sosa, por Caballito

    // La planilla del depósito sale solo con esa sucursal y lo dice arriba.
    let [d] = await Promise.all([p.waitForEvent("download"), boton(p, "🖨️ Planilla para el depósito").click()]);
    assert.equal(d.suggestedFilename(), "Reservas para preparar - Caballito - todas.pdf");
    let t = await pdfTexto(d);
    assert.ok(t.includes("RETIRO POR CABALLITO"));
    assert.ok(t.includes("Marta G") && t.includes("Ra\xfal D") && !t.includes("Pedro Ruiz") && !t.includes("Luc\xeda Paz"));

    // En la lista de siempre también filtra, y la elección se mantiene.
    await p.getByRole("tab", { name: "Lista" }).click();
    assert.equal(await p.locator("[data-reserva]").count(), 2);
    await p.locator("[data-reserva]", { hasText: "Marta Gómez" }).locator('[data-sucursal="caballito"]').getByText("Caballito").waitFor();
    await boton(p, "Parque Patricios (2)").click();
    assert.equal(await p.locator("[data-reserva]").count(), 2);
    await p.locator("[data-reserva]", { hasText: "Lucía Paz" }).locator('[data-sucursal="patricios"]').waitFor();

    // Con las dos juntas, la planilla dice la sucursal en cada renglón.
    await p.getByRole("tab", { name: "Por día" }).click();
    await boton(p, "Las dos sucursales").click();
    [d] = await Promise.all([p.waitForEvent("download"), boton(p, "🖨️ Planilla para el depósito").click()]);
    assert.equal(d.suggestedFilename(), "Reservas para preparar - todas.pdf");
    t = await pdfTexto(d);
    assert.ok(!t.includes("RETIRO POR"));
    assert.ok(t.includes("RETIRA POR") && t.includes("Retira por senillosa"));
    assert.equal((t.match(/\(CABALLITO\)/g) || []).length, 2);
    assert.equal((t.match(/\(P\. PATRICIOS\)/g) || []).length, 2);
  } finally {
    await h.close();
  }
});

test("sucursal de retiro: se elige al cargar (Parque Patricios si no se toca) y se cambia al editar sin tocar lo demás", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    await boton(p, "+ Nueva").click();
    await p.getByText("Nueva reserva").waitFor();
    const grupo = p.getByRole("group", { name: "Retira por" });
    assert.equal(await grupo.locator('[data-sucursal="patricios"]').getAttribute("aria-pressed"), "true");
    await p.locator("#rsv-cliente").fill("Carla Núñez");
    await p.locator("#rsv-item").selectOption("LECHÓN");
    await p.getByLabel("Kilos").pressSequentially("9");
    await grupo.locator('[data-sucursal="caballito"]').click();
    await boton(p, "Guardar y cargar otro ítem de este cliente").click();
    let r = await esperar(h, (x) => Object.values(x).some((v) => v.cliente === "Carla Núñez"));
    assert.equal(Object.values(r).find((v) => v.cliente === "Carla Núñez").sucursal, "caballito");
    // Para el segundo ítem del mismo cliente queda la misma sucursal.
    assert.equal(await grupo.locator('[data-sucursal="caballito"]').getAttribute("aria-pressed"), "true");
    await p.locator("#rsv-item").selectOption("CORDERO");
    await p.getByLabel("Kilos").pressSequentially("7");
    await boton(p, "✓ Guardar reserva").click();
    r = await esperar(h, (x) => Object.values(x).filter((v) => v.cliente === "Carla Núñez").length === 2);
    assert.deepEqual(Object.values(r).filter((v) => v.cliente === "Carla Núñez").map((v) => v.sucursal), ["caballito", "caballito"]);

    // Editar una vieja: abre con la sucursal leída de la observación y guarda solo ese campo.
    await p.getByRole("tab", { name: "Lista" }).click();
    await p.locator("[data-reserva]", { hasText: "Pedro Ruiz" }).getByRole("button", { name: "Editar" }).click();
    await p.getByText("Editar reserva").waitFor();
    assert.equal(await grupo.locator('[data-sucursal="patricios"]').getAttribute("aria-pressed"), "true");
    await grupo.locator('[data-sucursal="caballito"]').click();
    await boton(p, "✓ Guardar cambios").click();
    r = await esperar(h, (x) => x.b.sucursal === "caballito");
    const { sucursal, actualizadoEn, ...resto } = r.b;
    assert.ok(actualizadoEn);
    assert.deepEqual(resto, RESERVAS.b, "no se tocó nada más");
    await p.locator("[data-reserva]", { hasText: "Pedro Ruiz" }).locator('[data-sucursal="caballito"]').waitFor();
    await boton(p, "Caballito (5)").waitFor();
  } finally {
    await h.close();
  }
});

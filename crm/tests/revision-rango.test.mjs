// Revisión independiente del rango de kilos en Reservas ("de 10 a 12 kg"): cada
// prueba reproduce un defecto encontrado (y queda como red de seguridad). Las
// últimas dos cubren lo que se revisó y ya andaba bien.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const boton = (h, t) => h.page.getByRole("button", { name: t, exact: true });
const toast = (h, t) => h.page.locator(".ss-toast", { hasText: t });
const tarjeta = (h, cliente) => h.page.locator("[data-reserva]", { hasText: cliente });
const reservasDe = (db) => Object.entries(db.reservas || {}).map(([id, r]) => ({ id, ...r }));
const plano = async (loc) => (await loc.innerText()).replace(/\s+/g, " ");

function reserva(extra) {
  return { fechaReserva: "2026-11-05", cliente: "Cliente", contacto: "", item: "LECHÓN", kg: 10, precioKg: 10000, sena: 0, fechaRetiro: "2026-12-24", obs: "", estado: "pendiente", creadoEn: "2026-11-05T12:00:00.000Z", creadoPor: "nacho", ...extra };
}
async function abrir(reservas = {}, opts = {}) {
  const seed = buildSeed();
  seed.reservas = reservas;
  const h = await launch({ rol: "director", etiqueta: "rsvrevrango", ...opts, seed });
  await h.ir("pedidos.html");
  await h.page.getByText("Reservas fin de año").first().click();
  await h.page.getByText("Ordenar por fecha de").waitFor();
  return h;
}
async function esperar(h, cond, ms = 15000) {
  const fin = Date.now() + ms;
  let db;
  for (;;) {
    db = await h.dump();
    if (cond(reservasDe(db), db)) return db;
    if (Date.now() > fin) throw new Error("no se cumplió a tiempo: " + JSON.stringify(reservasDe(db)));
    await new Promise((r) => setTimeout(r, 120));
  }
}
async function escribir(h, id, texto) {
  await h.page.locator(id).fill("");
  if (texto) await h.page.locator(id).pressSequentially(texto);
}
/** Contesta la hoja de confirmación que esté abierta con el botón `texto`. */
async function contestar(h, texto) {
  const hoja = h.page.locator(".ss-hoja");
  await hoja.waitFor({ timeout: 8000 });
  const cuerpo = await hoja.innerText();
  await h.page.waitForTimeout(450);
  await hoja.locator(".ss-btn", { hasText: texto }).click();
  await hoja.waitFor({ state: "detached" });
  return cuerpo;
}
/** Lo que queda por fuera del interior de su tarjeta (cortado contra el borde o fuera de la pantalla). */
function salidosDeLaTarjeta(h) {
  return h.page.evaluate(() => {
    const salidos = [];
    document.querySelectorAll("[data-reserva]").forEach((c) => {
      const rc = c.getBoundingClientRect(), cs = getComputedStyle(c);
      const tope = rc.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      c.querySelectorAll("strong, span, button").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > tope + 0.5) salidos.push((el.innerText || "").trim() + " (se pasa " + Math.round(r.right - tope) + " px)");
      });
    });
    return salidos;
  });
}

// ── La tarjeta en un iPhone angosto ────────────────────────────────────────

test("iPhone angosto (320 px): «Resta: $130.500 a $166.750» entra en la tarjeta, no queda cortado contra el borde", async () => {
  const h = await abrir({
    a: reserva({ cliente: "Rango Común", kg: 9, kgHasta: 11.5, precioKg: 14500 }), // resta $130.500 a $166.750
    b: reserva({ cliente: "Rango Grande De Nombre Bien Largo Para Probar", item: "MEDIO LECHÓN", kg: 96, kgHasta: 108.5, precioKg: 14500, fechaReserva: "2026-11-06" }), // $1.392.000 a $1.573.250
    c: reserva({ cliente: "Cubre El Mínimo", item: "CORDERO", kg: 12, kgHasta: 14, precioKg: 16900, sena: 210000, fechaReserva: "2026-11-07", fechaRetiro: "" }), // hasta $26.600
    d: reserva({ cliente: "Peso Justo", kg: 10.5, precioKg: 14500, sena: 50000, fechaReserva: "2026-11-08" }), // $102.250
  }, { viewport: { width: 320, height: 740 } });
  try {
    for (const ancho of [320, 375]) {
      await h.page.setViewportSize({ width: ancho, height: 740 });
      await tarjeta(h, "Rango Común").waitFor();
      assert.ok((await plano(tarjeta(h, "Rango Común"))).includes("Resta: $130.500 a $166.750"));
      assert.ok((await plano(tarjeta(h, "Rango Grande"))).includes("Resta: $1.392.000 a $1.573.250"));
      assert.ok((await plano(tarjeta(h, "Cubre El Mínimo"))).includes("Resta: hasta $26.600"));
      assert.deepEqual(await salidosDeLaTarjeta(h), [], "a " + ancho + " px se sale de la tarjeta");
      assert.equal(await h.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "a " + ancho + " px la página se desplaza de costado");
      // Por día de retiro (con los encabezados de cada día) tampoco
      await boton(h, "Retiro").click();
      await h.page.getByText("Retiro a confirmar").waitFor();
      assert.deepEqual(await salidosDeLaTarjeta(h), [], "por retiro, a " + ancho + " px se sale de la tarjeta");
      await boton(h, "Reserva").click();
    }
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── El formulario ──────────────────────────────────────────────────────────

test("formulario: con la seña igual al total del tope no dice que resta un importe negativo", async () => {
  const h = await abrir();
  try {
    await boton(h, "+ Nueva").click();
    await h.page.locator("#rsv-cliente").fill("Paga Todo");
    await h.page.locator("#rsv-item").selectOption("LECHÓN");
    await escribir(h, "#rsv-kg", "10");
    await escribir(h, "#rsv-kg-hasta", "12");
    await escribir(h, "#rsv-precio", "10000");
    // Deja pago el tope: 12 kg × $10.000. Es una seña válida (se guarda) y no queda nada por cobrar.
    await escribir(h, "#rsv-sena", "120000");
    await h.page.getByText("Total estimado: $100.000 a $120.000").waitFor();
    const pagina = await plano(h.page.locator(".crm-page"));
    assert.ok(!/Resta cobrar al retirar: -/.test(pagina), "dice que resta un importe negativo: " + /Resta cobrar al retirar: \S+/.exec(pagina));
    assert.ok(pagina.includes("Resta cobrar al retirar: $0 "), pagina);
    // Entre el mínimo y el tope sigue diciendo hasta cuánto
    await escribir(h, "#rsv-sena", "105000");
    await h.page.getByText("Resta cobrar al retirar: hasta $15.000").waitFor();
    await escribir(h, "#rsv-sena", "120000");
    await boton(h, "✓ Guardar reserva").click();
    await esperar(h, (rs) => rs.length === 1 && rs[0].sena === 120000 && rs[0].kgHasta === 12);
    assert.ok((await plano(tarjeta(h, "Paga Todo"))).includes("PAGADO"), "la tarjeta y el formulario dicen lo mismo");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("formulario: con el «hasta» escrito y los kilos todavía vacíos no dice «se le puede vender de 0 a 12 kg»", async () => {
  const h = await abrir();
  try {
    await boton(h, "+ Nueva").click();
    const ayuda = h.page.locator("#rsv-kg-ayuda");
    // Primero el tope ("hasta 12"), después los kilos
    await escribir(h, "#rsv-kg-hasta", "12");
    assert.match(await plano(ayuda), /poné en Hasta el máximo que se le puede vender/, "sin kilos no hay rango que anunciar");
    await escribir(h, "#rsv-kg", "10");
    assert.equal(await plano(ayuda), "Se le puede vender de 10 a 12 kg.");
    // Se borran los kilos para corregirlos: tampoco
    await escribir(h, "#rsv-kg", "");
    assert.ok(!/de 0 a/.test(await plano(ayuda)), await plano(ayuda));
    // Y no se guarda sin kilos
    await h.page.locator("#rsv-cliente").fill("Sin Kilos");
    await h.page.locator("#rsv-item").selectOption("LECHÓN");
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "Poné cuántos kilos necesita").waitFor();
    assert.equal(reservasDe(await h.dump()).length, 0);
  } finally {
    await h.close();
  }
});

// ── Backup ─────────────────────────────────────────────────────────────────

test("backup: una seña que cubre el mínimo del rango no deja un «resta cobrar» negativo", async () => {
  const seed = buildSeed();
  seed.reservas = {
    a: reserva({ cliente: "Cubre El Mínimo", item: "CORDERO", kg: 12, kgHasta: 14, sena: 130000 }), // en la pantalla: "Resta: hasta $10.000"
    b: reserva({ cliente: "Paga El Tope", item: "CORDERO", kg: 12, kgHasta: 14, sena: 140000, fechaReserva: "2026-11-06" }), // en la pantalla: PAGADO
    c: reserva({ cliente: "Rango Con Seña", kg: 10, kgHasta: 12.5, sena: 20000, fechaReserva: "2026-11-07" }),
    d: reserva({ cliente: "Peso Justo", kg: 8, sena: 30000, fechaReserva: "2026-11-08" }),
  };
  const h = await launch({ rol: "director", etiqueta: "rsvrevrango", seed });
  try {
    await h.ir("backup.html");
    const [descarga] = await Promise.all([h.page.waitForEvent("download", { timeout: 25000 }), h.page.locator("#btnBackup").click()]);
    const XLSX = (await import("xlsx")).default || (await import("xlsx"));
    const libro = XLSX.read(fs.readFileSync(await descarga.path()));
    const filas = XLSX.utils.sheet_to_json(libro.Sheets.Reservas, { header: 1, range: 3, defval: "" });
    assert.deepEqual(filas[0].slice(5, 11), ["Kg", "Kg hasta", "Precio por kg ($)", "Total estimado ($)", "Seña ($)", "Resta cobrar ($)"]);
    assert.deepEqual(filas.slice(1).map((f) => [f[2], f[5], f[6], f[8], f[9], f[10]]), [
      ["Cubre El Mínimo", 12, 14, 120000, 130000, 0], // con 12 kg ya está pago: no "resta" -$10.000
      ["Paga El Tope", 12, 14, 120000, 140000, 0],
      ["Rango Con Seña", 10, 12.5, 100000, 20000, 80000],
      ["Peso Justo", 8, "", 80000, 30000, 50000],
    ]);
  } finally {
    await h.close();
  }
});

// ── Revisado y sin defectos (queda cubierto) ───────────────────────────────

test("formulario: «Kilos» sigue siendo un solo campo; salir con solo el «hasta» escrito pregunta antes de perderlo", async () => {
  const h = await abrir({ a: reserva({ cliente: "Ya Estaba" }) });
  try {
    await boton(h, "+ Nueva").click();
    await h.page.getByText("Nueva reserva").waitFor();
    assert.equal(await h.page.getByLabel("Kilos").count(), 1, "«Kilos» tiene que nombrar un solo campo");
    assert.equal(await h.page.getByLabel("Hasta").count(), 1);
    assert.deepEqual(await h.page.locator("#rsv-kg-hasta").evaluate((el) => [el.inputMode, getComputedStyle(el).fontSize]), ["decimal", "16px"]);
    await escribir(h, "#rsv-kg-hasta", "12,");
    await h.page.getByRole("button", { name: "Volver" }).click();
    assert.match(await contestar(h, "Seguir cargando"), /salir sin guardar/i);
    assert.equal(await h.page.locator("#rsv-kg-hasta").inputValue(), "12,");
    await h.page.getByRole("button", { name: "Volver" }).click();
    await contestar(h, "Salir");
    await tarjeta(h, "Ya Estaba").waitFor();
    assert.equal(reservasDe(await h.dump()).length, 1);
  } finally {
    await h.close();
  }
});

test("editar mientras otro teléfono le pone o le cambia el tope: no se lo pisa; sin cambios no escribe nada", async () => {
  const h = await abrir({
    a: reserva({ cliente: "Jorge Giménez" }), // cargada antes del cambio: sin el campo kgHasta
    b: reserva({ cliente: "Marta Ruiz", kg: 10.125, kgHasta: 12.875, sena: 20000, fechaReserva: "2026-11-06" }),
  });
  try {
    // Con rango y sin tocar nada: no escribe
    await tarjeta(h, "Marta Ruiz").getByRole("button", { name: "Editar" }).click();
    await h.page.getByText("Editar reserva").waitFor();
    assert.deepEqual([await h.page.locator("#rsv-kg").inputValue(), await h.page.locator("#rsv-kg-hasta").inputValue()], ["10,125", "12,875"]);
    await boton(h, "✓ Guardar cambios").click();
    await toast(h, "Reserva actualizada").waitFor();
    await tarjeta(h, "Marta Ruiz").waitFor();
    await h.sincronizar();
    assert.equal("actualizadoEn" in (await h.dump()).reservas.b, false, "no escribe nada si no se cambió nada");

    // Otro teléfono anota que es "de 10 a 12" y que dejó $110.000 (más que el total de 10 kg); acá solo se agrega una observación
    await tarjeta(h, "Jorge Giménez").getByRole("button", { name: "Editar" }).click();
    await h.page.getByText("Editar reserva").waitFor();
    await h.sembrar({ reservas: { a: reserva({ cliente: "Jorge Giménez", kgHasta: 12, sena: 110000 }) } });
    await h.page.waitForTimeout(700);
    await h.page.locator("#rsv-obs").fill("Abierto al medio");
    await boton(h, "✓ Guardar cambios").click();
    let db = await esperar(h, (rs) => rs.find((r) => r.id === "a").obs === "Abierto al medio");
    assert.deepEqual([db.reservas.a.kg, db.reservas.a.kgHasta, db.reservas.a.sena], [10, 12, 110000]);
    assert.ok((await plano(tarjeta(h, "Jorge Giménez"))).includes("LECHÓN · 10 a 12 kg"));

    // Otro teléfono le sube el tope a 14; acá solo se cambia la seña
    await tarjeta(h, "Marta Ruiz").getByRole("button", { name: "Editar" }).click();
    await h.page.getByText("Editar reserva").waitFor();
    await h.sembrar({ reservas: { b: reserva({ cliente: "Marta Ruiz", kg: 10.125, kgHasta: 14, sena: 20000, fechaReserva: "2026-11-06" }) } });
    await h.page.waitForTimeout(700);
    await escribir(h, "#rsv-sena", "30000");
    await boton(h, "✓ Guardar cambios").click();
    db = await esperar(h, (rs) => rs.find((r) => r.id === "b").sena === 30000);
    assert.deepEqual([db.reservas.b.kg, db.reservas.b.kgHasta], [10.125, 14]);
  } finally {
    await h.close();
  }
});

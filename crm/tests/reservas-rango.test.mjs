// Reservas con rango de kilos: el cliente no pide un peso justo sino "de 10 a
// 12 kg". Se anota el tope (hasta cuántos kilos se le puede vender) y los
// totales, lo que resta cobrar y el resumen pasan a ser un rango.
import test from "node:test";
import assert from "node:assert/strict";
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
async function abrir(reservas = {}) {
  const seed = buildSeed();
  seed.reservas = reservas;
  const h = await launch({ rol: "director", etiqueta: "rsvrango", seed });
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

test("alta con rango: «de 10 a 12,5 kg» se guarda con su tope y todo lo que depende de los kilos se muestra como rango", async () => {
  const h = await abrir();
  try {
    await boton(h, "+ Nueva").click();
    await h.page.locator("#rsv-cliente").fill("Rango Pérez");
    await h.page.locator("#rsv-item").selectOption("LECHÓN");
    await escribir(h, "#rsv-kg", "10");
    // Sin tope todavía: explica para qué sirve el campo
    assert.match(await plano(h.page.locator("#rsv-kg-ayuda")), /poné en Hasta el máximo que se le puede vender/);
    assert.equal(await h.page.locator("#rsv-kg-hasta").getAttribute("inputmode"), "decimal", "teclado con coma, como los kilos");
    await escribir(h, "#rsv-kg-hasta", "12,5");
    assert.equal(await plano(h.page.locator("#rsv-kg-ayuda")), "Se le puede vender de 10 a 12,5 kg.");
    await escribir(h, "#rsv-precio", "10000");
    await escribir(h, "#rsv-sena", "20000");
    await boton(h, "24/12").click();
    await h.page.getByText("Total estimado: $100.000 a $125.000 según lo que pese").waitFor();
    await h.page.getByText("Resta cobrar al retirar: $80.000 a $105.000").waitFor();
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "Reserva guardada: Rango Pérez · LECHÓN").waitFor();

    const db = await esperar(h, (rs) => rs.length === 1);
    const r = reservasDe(db)[0];
    assert.deepEqual([r.kg, r.kgHasta, r.precioKg, r.sena], [10, 12.5, 10000, 20000]);

    // Tarjeta
    const t = await plano(tarjeta(h, "Rango Pérez"));
    for (const esperado of ["LECHÓN · 10 a 12,5 kg", "Resta: $80.000 a $105.000", "Total: $100.000 a $125.000", "Seña: $20.000", "$10.000/kg"]) {
      assert.ok(t.includes(esperado), "falta «" + esperado + "» en: " + t);
    }
    // Resumen: mínimo y tope de lo que hay que tener, y de lo que resta cobrar
    const pagina = await plano(h.page.locator(".crm-page"));
    for (const esperado of ["10 kg reservados hasta 12,5 kg", "LECHÓN × 1 10 a 12,5 kg", "Resta cobrar al entregar: $80.000 a $105.000"]) {
      assert.ok(pagina.includes(esperado), "falta «" + esperado + "» en: " + pagina.slice(0, 600));
    }
    // Al entregar avisa que lo que resta depende del peso
    await tarjeta(h, "Rango Pérez").getByRole("button", { name: "✓ Entregada" }).click();
    const hoja = h.page.locator(".ss-hoja");
    await hoja.waitFor();
    assert.match(await hoja.innerText(), /Rango Pérez · LECHÓN · 10 a 12,5 kg[\s\S]*Resta cobrar: \$80\.000 a \$105\.000 \(según lo que pese, de 10 a 12,5 kg\)/);
    await h.page.waitForTimeout(450);
    await hoja.locator(".ss-btn", { hasText: "Cancelar" }).click();
    // Al eliminar también se ve el rango
    await tarjeta(h, "Rango Pérez").getByRole("button", { name: "Eliminar la reserva de Rango Pérez" }).click();
    await hoja.waitFor();
    assert.match(await hoja.innerText(), /Rango Pérez · LECHÓN · 10 a 12,5 kg/);
    await h.page.waitForTimeout(450);
    await hoja.locator(".ss-btn", { hasText: "Cancelar" }).click();
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("el tope tiene que ser mayor que los kilos; igual a los kilos es un peso justo; la seña se compara contra el tope", async () => {
  const h = await abrir();
  try {
    await boton(h, "+ Nueva").click();
    await h.page.locator("#rsv-cliente").fill("Tope Gómez");
    await h.page.locator("#rsv-item").selectOption("CORDERO");
    await escribir(h, "#rsv-kg", "12");
    await escribir(h, "#rsv-kg-hasta", "10");
    await escribir(h, "#rsv-precio", "10000");
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "El «hasta» tiene que ser mayor que los kilos").waitFor();
    assert.equal(await h.page.evaluate(() => document.activeElement && document.activeElement.id), "rsv-kg-hasta", "deja el cursor en el campo a corregir");
    assert.equal(reservasDe(await h.dump()).length, 0, "no guarda nada");
    assert.equal(await h.page.locator("#rsv-cliente").inputValue(), "Tope Gómez", "no pierde lo escrito");

    // Seña mayor que el total con el tope: no puede ser
    await escribir(h, "#rsv-kg-hasta", "14");
    await escribir(h, "#rsv-sena", "150000");
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "La seña es mayor que el total de la reserva").waitFor();
    assert.equal(reservasDe(await h.dump()).length, 0);

    // Seña que cubre el mínimo (12 kg = $120.000) pero no el tope (14 kg = $140.000): vale, y resta "hasta $10.000"
    await escribir(h, "#rsv-sena", "130000");
    await h.page.getByText("Resta cobrar al retirar: hasta $10.000").waitFor();
    await boton(h, "Guardar y cargar otro ítem de este cliente").click();
    await esperar(h, (rs) => rs.length === 1 && rs[0].kgHasta === 14);
    // Para el ítem siguiente quedan vacíos los kilos y el tope, y avisa lo ya cargado con su rango
    await h.page.getByText("Ya guardado para Tope Gómez:").waitFor();
    assert.match(await plano(h.page.locator(".crm-page")), /Ya guardado para Tope Gómez: CORDERO · 12 a 14 kg/);
    assert.deepEqual([await h.page.locator("#rsv-kg").inputValue(), await h.page.locator("#rsv-kg-hasta").inputValue()], ["", ""]);

    // Tope igual a los kilos: es un peso justo, se guarda sin tope
    await h.page.locator("#rsv-item").selectOption("LECHÓN");
    await escribir(h, "#rsv-kg", "9,5");
    await escribir(h, "#rsv-kg-hasta", "9,5");
    await escribir(h, "#rsv-precio", "10000");
    await h.page.getByText("Total estimado: $95.000", { exact: true }).waitFor();
    await boton(h, "✓ Guardar reserva").click();
    const db = await esperar(h, (rs) => rs.length === 2);
    const lechon = reservasDe(db).find((r) => r.item === "LECHÓN");
    assert.deepEqual([lechon.kg, lechon.kgHasta], [9.5, null]);

    const cordero = await plano(tarjeta(h, "Tope Gómez").filter({ hasText: "CORDERO" }));
    assert.ok(cordero.includes("Resta: hasta $10.000"), cordero);
    const justo = await plano(tarjeta(h, "Tope Gómez").filter({ hasText: "LECHÓN" }));
    assert.ok(justo.includes("LECHÓN · 9,5 kg") && justo.includes("Total: $95.000 "), justo);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("editar: una reserva vieja (sin tope) no se toca si no se cambia nada; se le puede poner y sacar el tope", async () => {
  const h = await abrir({
    vieja: reserva({ cliente: "Vieja Sin Tope" }), // como las cargadas antes de este cambio: sin el campo kgHasta
    rango: reserva({ cliente: "Con Rango", kgHasta: 12, fechaReserva: "2026-11-06" }),
  });
  try {
    // Sin cambios: no escribe nada (ni kgHasta ni actualizadoEn)
    await tarjeta(h, "Vieja Sin Tope").getByRole("button", { name: "Editar" }).click();
    await h.page.getByText("Editar reserva").waitFor();
    assert.equal(await h.page.locator("#rsv-kg-hasta").inputValue(), "");
    await boton(h, "✓ Guardar cambios").click();
    await toast(h, "Reserva actualizada").waitFor();
    await tarjeta(h, "Vieja Sin Tope").waitFor();
    await h.sincronizar();
    let vieja = (await h.dump()).reservas.vieja;
    assert.equal("kgHasta" in vieja, false, "no agrega el campo si no se cargó un tope");
    assert.equal("actualizadoEn" in vieja, false, "no escribe nada si no se cambió nada");

    // Se le pone un tope
    await tarjeta(h, "Vieja Sin Tope").getByRole("button", { name: "Editar" }).click();
    await escribir(h, "#rsv-kg-hasta", "11,5");
    await boton(h, "✓ Guardar cambios").click();
    await esperar(h, (rs) => rs.find((r) => r.id === "vieja").kgHasta === 11.5);
    assert.ok((await plano(tarjeta(h, "Vieja Sin Tope"))).includes("LECHÓN · 10 a 11,5 kg"));

    // La que tenía rango abre con su tope; se lo saca y vuelve a ser un peso justo
    await tarjeta(h, "Con Rango").getByRole("button", { name: "Editar" }).click();
    assert.deepEqual([await h.page.locator("#rsv-kg").inputValue(), await h.page.locator("#rsv-kg-hasta").inputValue()], ["10", "12"]);
    await escribir(h, "#rsv-kg-hasta", "");
    await boton(h, "✓ Guardar cambios").click();
    const db = await esperar(h, (rs) => rs.find((r) => r.id === "rango").kgHasta === null);
    assert.equal(db.reservas.rango.kg, 10);
    const t = await plano(tarjeta(h, "Con Rango"));
    assert.ok(t.includes("LECHÓN · 10 kg") && !t.includes(" a 12"), t);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("resumen y días de retiro: suman mínimos y topes; un tope mal cargado en la base se ignora", async () => {
  const h = await abrir({
    a: reserva({ cliente: "Uno", kg: 10, kgHasta: 12, sena: 20000 }), // resta $80.000 a $100.000
    b: reserva({ cliente: "Dos", kg: 8.5, fechaReserva: "2026-11-06" }), // peso justo: resta $85.000
    c: reserva({ cliente: "Tres", item: "CORDERO", kg: 14, kgHasta: 16, precioKg: null, fechaReserva: "2026-11-07", fechaRetiro: "2026-12-31" }), // a convenir
    d: reserva({ cliente: "Cuatro", item: "CORDERO", kg: 15, kgHasta: 9, fechaReserva: "2026-11-08", fechaRetiro: "2026-12-31" }), // tope menor que los kilos: no vale
    e: reserva({ cliente: "Cinco", item: "COCHINILLO", kg: 5, kgHasta: "seis", fechaReserva: "2026-11-09", fechaRetiro: "" }), // tope que no es un número
    f: reserva({ cliente: "Entregada", kg: 10, kgHasta: 30, estado: "entregada" }), // las entregadas no cuentan
  });
  try {
    await tarjeta(h, "Uno").waitFor();
    const pagina = await plano(h.page.locator(".crm-page"));
    // mínimos: 10 + 8,5 + 14 + 15 + 5 = 52,5 · topes: 12 + 8,5 + 16 + 15 + 5 = 56,5
    for (const esperado of ["52,5 kg reservados hasta 56,5 kg", "CORDERO × 2 29 a 31 kg", "LECHÓN × 2 18,5 a 20,5 kg", "COCHINILLO × 1 5 kg",
      // resta: 80.000 + 85.000 + 150.000 + 50.000 = 365.000 · con topes: 100.000 + 85.000 + 150.000 + 50.000 = 385.000
      "Resta cobrar al entregar: $365.000 a $385.000"]) {
      assert.ok(pagina.includes(esperado), "falta «" + esperado + "» en: " + pagina.slice(0, 700));
    }
    assert.ok((await plano(tarjeta(h, "Cuatro"))).includes("CORDERO · 15 kg"), "tope menor que los kilos: se muestra como peso justo");
    assert.ok((await plano(tarjeta(h, "Cinco"))).includes("COCHINILLO · 5 kg"));
    assert.ok((await plano(tarjeta(h, "Tres"))).includes("CORDERO · 14 a 16 kg"), "a convenir: igual muestra el rango de kilos");

    // Por día de retiro: cada día con su rango
    await boton(h, "Retiro").click();
    await h.page.getByText("Retiro a confirmar").waitFor();
    const porDia = await plano(h.page.locator(".crm-page"));
    for (const esperado of ["2 · 18,5 a 20,5 kg", "2 · 29 a 31 kg", "1 · 5 kg"]) {
      assert.ok(porDia.includes(esperado), "falta «" + esperado + "» en: " + porDia.slice(0, 900));
    }
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("backup: la hoja Reservas trae la columna «Kg hasta»", async () => {
  const seed = buildSeed();
  seed.reservas = {
    a: reserva({ cliente: "Con Rango", kg: 10, kgHasta: 12.5, sena: 20000 }),
    b: reserva({ cliente: "Peso Justo", kg: 8, fechaReserva: "2026-11-06" }),
    c: reserva({ cliente: "Tope Inválido", kg: 8, kgHasta: 6, fechaReserva: "2026-11-07" }),
  };
  const h = await launch({ rol: "director", etiqueta: "rsvrango", seed });
  try {
    await h.ir("backup.html");
    const [descarga] = await Promise.all([h.page.waitForEvent("download"), h.page.locator("#btnBackup").click()]);
    const XLSX = (await import("xlsx")).default || (await import("xlsx"));
    const fs = await import("node:fs");
    const libro = XLSX.read(fs.readFileSync(await descarga.path()));
    const filas = XLSX.utils.sheet_to_json(libro.Sheets.Reservas, { header: 1, range: 3, defval: "" });
    assert.deepEqual(filas[0].slice(4, 11), ["Ítem", "Kg", "Kg hasta", "Precio por kg ($)", "Total estimado ($)", "Seña ($)", "Resta cobrar ($)"]);
    assert.deepEqual(filas.slice(1).map((f) => [f[2], f[5], f[6], f[7], f[8], f[9], f[10]]), [
      ["Con Rango", 10, 12.5, 10000, 100000, 20000, 80000], // el total y el resto de la planilla se calculan con los kilos (el mínimo)
      ["Peso Justo", 8, "", 10000, 80000, 0, 80000],
      ["Tope Inválido", 8, "", 10000, 80000, 0, 80000],
    ]);
  } finally {
    await h.close();
  }
});

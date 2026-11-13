// Reservas de fin de año: alta con todos los datos, orden por fecha, ítems
// predefinidos / del catálogo / texto libre, seña, entrega, edición y borrado.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const HOY = "2026-11-10";
const boton = (h, t) => h.page.getByRole("button", { name: t, exact: true });
const toast = (h, t) => h.page.locator(".ss-toast", { hasText: t });
const tarjetas = (h) => h.page.locator("[data-reserva]");
const tarjeta = (h, cliente) => h.page.locator("[data-reserva]", { hasText: cliente });
const reservasDe = (db) => Object.entries(db.reservas || {}).map(([id, r]) => ({ id, ...r }));

function reserva(extra) {
  return { fechaReserva: "2026-11-05", cliente: "Cliente", contacto: "", item: "LECHÓN", kg: 10, precioKg: 14500, sena: 0, fechaRetiro: "2026-12-24", obs: "", estado: "pendiente", creadoEn: "2026-11-05T12:00:00.000Z", creadoPor: "nacho", ...extra };
}

async function abrir(reservas = {}, opts = {}) {
  const seed = buildSeed();
  seed.reservas = reservas;
  const h = await launch({ rol: "director", etiqueta: "rsv", seed, ...opts });
  h.seed = seed;
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
async function llenar(h, { cliente, contacto, item, otro, kg, precio, sena, retiro, obs, fecha }) {
  const p = h.page;
  if (fecha != null) await p.locator("#rsv-fecha").fill(fecha);
  if (cliente != null) await p.locator("#rsv-cliente").fill(cliente);
  if (contacto != null) await p.locator("#rsv-contacto").fill(contacto);
  if (item != null) await p.locator("#rsv-item").selectOption(item);
  if (otro != null) await p.getByLabel("Otro ítem").fill(otro);
  if (kg != null) { await p.getByLabel("Kilos").fill(""); await p.getByLabel("Kilos").pressSequentially(kg); }
  if (precio != null) { await p.getByLabel("Precio por kg").fill(""); await p.getByLabel("Precio por kg").pressSequentially(precio); }
  if (sena != null) { await p.getByLabel("Seña").fill(""); await p.getByLabel("Seña").pressSequentially(sena); }
  if (retiro != null) await p.locator("#rsv-retiro").fill(retiro);
  if (obs != null) await p.locator("#rsv-obs").fill(obs);
}

test("alta: se guarda con todos los datos, con decimales en los kilos y la seña", async () => {
  const h = await abrir();
  try {
    await h.page.getByText("Todavía no hay reservas").waitFor();
    await boton(h, "+ Nueva").click();
    assert.equal(await h.page.locator("#rsv-fecha").inputValue(), HOY, "propone la fecha de hoy");
    // Las opciones predeterminadas, en el orden pedido, y después el catálogo y «Otro»
    const opciones = await h.page.locator("#rsv-item option").allInnerTexts();
    assert.deepEqual(opciones.slice(0, 6), ["Elegir…", "LECHÓN", "CORDERO", "COCHINILLO", "MEDIO LECHÓN", "MEDIO CORDERO"]);
    assert.ok(opciones.includes("Jamón Cocido Natural Sublime"), "trae los productos del catálogo de pedidos");
    assert.equal(opciones[opciones.length - 1], "Otro (escribir)…");

    await llenar(h, { cliente: "  María   Fernández ", contacto: "11 5555-1234\nRetira el marido", item: "LECHÓN", kg: "10,5", precio: "14500", sena: "50000", obs: "Lo quiere abierto" });
    await boton(h, "24/12").click();
    await h.page.getByText("Total estimado: $152.250").waitFor();
    await h.page.getByText("Resta cobrar al retirar: $102.250").waitFor();
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "Reserva guardada: María Fernández · LECHÓN").waitFor();

    const db = await esperar(h, (rs) => rs.length === 1);
    const r = reservasDe(db)[0];
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(r.creadoEn));
    assert.deepEqual({ ...r, id: "", creadoEn: "" }, {
      id: "", creadoEn: "", fechaReserva: HOY, cliente: "María Fernández", contacto: "11 5555-1234\nRetira el marido", item: "LECHÓN",
      kg: 10.5, precioKg: 14500, sena: 50000, fechaRetiro: "2026-12-24", obs: "Lo quiere abierto", estado: "pendiente", creadoPor: "nacho",
    });

    // Vuelve a la lista y muestra la tarjeta con sus importes
    const t = tarjeta(h, "María Fernández");
    await t.waitFor();
    const texto = (await t.innerText()).replace(/\s+/g, " ");
    for (const esperado of ["#1", "LECHÓN", "10,5 kg", "Reservó: 10/11/2026", "Retira: 24/12/2026", "en 44 días", "$14.500/kg", "Total: $152.250", "Seña: $50.000", "Resta: $102.250", "Lo quiere abierto"]) {
      assert.ok(texto.includes(esperado), "falta «" + esperado + "» en: " + texto);
    }
    assert.equal(await t.getByRole("link", { name: "WhatsApp a María Fernández" }).getAttribute("href"), "https://wa.me/5491155551234?text=");
    assert.equal(await t.getByRole("link", { name: "Llamar a María Fernández" }).getAttribute("href"), "tel:1155551234");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("alta: sin seña, precio a convenir, retiro a confirmar; ítem escrito a mano y producto del catálogo", async () => {
  const h = await abrir();
  try {
    await boton(h, "+ Nueva").click();
    await llenar(h, { cliente: "Lucía Paredes", item: "__otro__", otro: "Pavita rellena", kg: "4.25" });
    await boton(h, "Guardar y cargar otro ítem de este cliente").click();
    await toast(h, "Reserva guardada: Lucía Paredes · Pavita rellena").waitFor();
    // Sigue en el formulario con el mismo cliente, listo para el segundo ítem
    assert.equal(await h.page.locator("#rsv-cliente").inputValue(), "Lucía Paredes");
    assert.equal(await h.page.locator("#rsv-item").inputValue(), "");
    assert.equal(await h.page.getByLabel("Kilos").inputValue(), "");
    await llenar(h, { item: "Jamón Cocido Natural Sublime", kg: "3", precio: "8990" });
    await boton(h, "✓ Guardar reserva").click();

    const db = await esperar(h, (rs) => rs.length === 2);
    const [pavita, jamon] = reservasDe(db).sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
    assert.deepEqual([pavita.item, pavita.kg, pavita.precioKg, pavita.sena, pavita.fechaRetiro], ["Pavita rellena", 4.25, null, 0, ""]);
    assert.deepEqual([jamon.item, jamon.kg, jamon.precioKg, jamon.sena], ["Jamón Cocido Natural Sublime", 3, 8990, 0]);

    const t = tarjeta(h, "Pavita rellena");
    await t.waitFor();
    const texto = (await t.innerText()).replace(/\s+/g, " ");
    for (const esperado of ["Sin seña", "Precio: a convenir", "Retira: a confirmar", "4,25 kg"]) assert.ok(texto.includes(esperado), "falta «" + esperado + "»: " + texto);
    assert.equal(await t.getByRole("link").count(), 0, "sin teléfono no ofrece llamar ni WhatsApp");
  } finally {
    await h.close();
  }
});

test("alta: no guarda si falta el nombre, el ítem o los kilos, y no pierde lo escrito", async () => {
  const h = await abrir();
  try {
    await boton(h, "+ Nueva").click();
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "Escribí el nombre del cliente.").waitFor();
    await llenar(h, { cliente: "Ana Sosa" });
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "Elegí qué reserva.").waitFor();
    await llenar(h, { item: "__otro__" });
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "Escribí qué reserva.").waitFor();
    await llenar(h, { item: "CORDERO" });
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "Poné cuántos kilos necesita.").waitFor();
    await llenar(h, { kg: "12", precio: "1000", sena: "50000" });
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "La seña es mayor que el total").waitFor();
    await llenar(h, { sena: "2000", retiro: "2026-11-01" });
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "La fecha de retiro no puede ser anterior").waitFor();
    assert.equal(await h.page.locator("#rsv-cliente").inputValue(), "Ana Sosa", "el formulario queda como estaba");
    assert.equal(reservasDe(await h.dump()).length, 0);
    await llenar(h, { retiro: "2026-12-23" });
    await boton(h, "✓ Guardar reserva").click();
    await esperar(h, (rs) => rs.length === 1 && rs[0].sena === 2000);
  } finally {
    await h.close();
  }
});

test("lista: ordenada por fecha de reserva (y por retiro si se pide), con el resumen de lo que hay que tener", async () => {
  const h = await abrir({
    a: reserva({ cliente: "Tercero", fechaReserva: "2026-11-08", fechaRetiro: "2026-12-23", item: "CORDERO", kg: 14, precioKg: 16900, creadoEn: "2026-11-08T12:00:00.000Z" }),
    b: reserva({ cliente: "Primero", fechaReserva: "2026-11-03", fechaRetiro: "2026-12-31", item: "LECHÓN", kg: 10.5, sena: 50000, creadoEn: "2026-11-03T12:00:00.000Z" }),
    c: reserva({ cliente: "Segundo B", fechaReserva: "2026-11-05", fechaRetiro: "", item: "LECHÓN", kg: 8, creadoEn: "2026-11-05T18:00:00.000Z" }),
    d: reserva({ cliente: "Segundo A", fechaReserva: "2026-11-05", fechaRetiro: "2026-12-24", item: "MEDIO LECHÓN", kg: 6, sena: 20000, creadoEn: "2026-11-05T09:00:00.000Z" }),
    e: reserva({ cliente: "Ya entregado", fechaReserva: "2026-11-01", item: "COCHINILLO", kg: 5, sena: 90000, estado: "entregada" }),
  });
  try {
    const nombres = async () => (await tarjetas(h).locator("div[style*='font-weight: 800']").allInnerTexts());
    await tarjeta(h, "Primero").waitFor();
    assert.deepEqual(await nombres(), ["Primero", "Segundo A", "Segundo B", "Tercero"], "por orden de reserva; el mismo día, por orden de carga");
    assert.match(await tarjeta(h, "Primero").innerText(), /#1/);
    assert.match(await tarjeta(h, "Tercero").innerText(), /#4/);

    await boton(h, "Retiro").click();
    assert.deepEqual(await nombres(), ["Tercero", "Segundo A", "Primero", "Segundo B"], "por fecha de retiro; sin fecha, al final");
    assert.match(await tarjeta(h, "Tercero").innerText(), /#4/, "el número sigue siendo el del orden de reserva");
    // El orden elegido se recuerda al volver a entrar
    await h.page.getByRole("button", { name: "Volver" }).click();
    await h.page.getByText("Reservas fin de año").first().click();
    await tarjeta(h, "Primero").waitFor();
    assert.deepEqual(await nombres(), ["Tercero", "Segundo A", "Primero", "Segundo B"]);
    await boton(h, "Reserva").click();

    // Resumen: solo lo pendiente
    const pagina = (await h.page.locator(".crm-page").innerText()).replace(/\s+/g, " ");
    for (const esperado of ["4 pendientes", "38,5 kg reservados", "$70.000 en señas", "LECHÓN × 2 18,5 kg", "CORDERO × 1 14 kg", "MEDIO LECHÓN × 1 6 kg", "Pendientes (4)", "Entregadas (1)", "Todas (5)"]) {
      assert.ok(pagina.includes(esperado), "falta «" + esperado + "» en: " + pagina.slice(0, 600));
    }
    assert.ok(!pagina.includes("COCHINILLO ×"), "lo entregado no cuenta en lo que hay que tener");

    await boton(h, "Entregadas (1)").click();
    assert.deepEqual(await nombres(), ["Ya entregado"]);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("entregar, volver a pendiente, editar y eliminar", async () => {
  const h = await abrir({
    a: reserva({ cliente: "Jorge Giménez", item: "CORDERO", kg: 14, precioKg: 16900, sena: 30000 }),
    b: reserva({ cliente: "Otra Persona", fechaReserva: "2026-11-06" }),
  });
  try {
    // Entregada: pide confirmación y avisa cuánto resta cobrar
    await tarjeta(h, "Jorge Giménez").getByRole("button", { name: "✓ Entregada" }).click();
    const hoja = h.page.locator(".ss-hoja");
    await hoja.waitFor();
    assert.match(await hoja.innerText(), /Jorge Giménez · CORDERO · 14 kg[\s\S]*Resta cobrar: \$206\.600/);
    await h.page.waitForTimeout(450);
    await hoja.locator(".ss-btn", { hasText: "Cancelar" }).click();
    assert.equal((await h.dump()).reservas.a.estado, "pendiente", "cancelar no cambia nada");
    await tarjeta(h, "Jorge Giménez").getByRole("button", { name: "✓ Entregada" }).click();
    await hoja.waitFor();
    await h.page.waitForTimeout(450);
    await hoja.locator(".ss-btn", { hasText: "Entregada" }).click();
    await esperar(h, (rs) => rs.find((r) => r.id === "a").estado === "entregada");
    await tarjeta(h, "Jorge Giménez").waitFor({ state: "detached" });
    await boton(h, "Pendientes (1)").waitFor();

    await boton(h, "Entregadas (1)").click();
    await tarjeta(h, "Jorge Giménez").getByRole("button", { name: "↩ Volver a pendiente" }).click();
    await esperar(h, (rs) => rs.find((r) => r.id === "a").estado === "pendiente");
    await boton(h, "Pendientes (2)").click();

    // Editar: abre con los datos cargados y guarda solo lo cambiado
    await tarjeta(h, "Jorge Giménez").getByRole("button", { name: "Editar" }).click();
    await h.page.getByText("Editar reserva").waitFor();
    assert.equal(await h.page.locator("#rsv-item").inputValue(), "CORDERO");
    assert.equal(await h.page.getByLabel("Kilos").inputValue(), "14");
    assert.equal(await h.page.getByLabel("Seña").inputValue(), "30.000");
    await llenar(h, { kg: "15,2", retiro: "2026-12-30" });
    await boton(h, "✓ Guardar cambios").click();
    const db = await esperar(h, (rs) => rs.find((r) => r.id === "a").kg === 15.2);
    const a = db.reservas.a;
    assert.deepEqual([a.cliente, a.item, a.kg, a.precioKg, a.sena, a.fechaRetiro, a.estado, a.creadoEn], ["Jorge Giménez", "CORDERO", 15.2, 16900, 30000, "2026-12-30", "pendiente", "2026-11-05T12:00:00.000Z"]);

    // Eliminar: avisa que hay una seña y pide confirmación
    await tarjeta(h, "Jorge Giménez").getByRole("button", { name: "Eliminar la reserva de Jorge Giménez" }).click();
    await hoja.waitFor();
    assert.match(await hoja.innerText(), /dejó una seña de \$30\.000/);
    await h.page.waitForTimeout(450);
    await hoja.locator(".ss-btn", { hasText: "Eliminar" }).click();
    await esperar(h, (rs) => rs.length === 1 && rs[0].id === "b");
    await tarjeta(h, "Jorge Giménez").waitFor({ state: "detached" });
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("dos toques en Guardar cargan una sola reserva, y lo que carga otro teléfono aparece solo", async () => {
  const h = await abrir();
  try {
    await boton(h, "+ Nueva").click();
    await llenar(h, { cliente: "Doble Toque", item: "COCHINILLO", kg: "5" });
    await boton(h, "✓ Guardar reserva").dblclick();
    await tarjeta(h, "Doble Toque").waitFor();
    await h.page.waitForTimeout(600);
    assert.equal(reservasDe(await h.dump()).length, 1);

    await h.sembrar({ reservas: { otro: reserva({ cliente: "Desde Otro Teléfono", fechaReserva: "2026-11-02" }) } });
    await tarjeta(h, "Desde Otro Teléfono").waitFor();
    assert.match(await tarjeta(h, "Desde Otro Teléfono").innerText(), /#1/, "entra en su lugar por fecha de reserva");
  } finally {
    await h.close();
  }
});

test("sin señal: la reserva queda guardada en el teléfono y se envía al volver", async () => {
  const h = await abrir({ a: reserva({ cliente: "Ya Estaba" }) });
  try {
    await tarjeta(h, "Ya Estaba").waitFor();
    await h.sinRed(true);
    await boton(h, "+ Nueva").click();
    await llenar(h, { cliente: "Sin Señal", item: "MEDIO CORDERO", kg: "7,5", precio: "17000", sena: "10000" });
    await boton(h, "✓ Guardar reserva").click();
    await tarjeta(h, "Sin Señal").waitFor();
    assert.equal(reservasDe(await h.dump()).length, 1, "todavía no llegó al servidor");
    await h.page.getByText("1 cambio guardado en el teléfono", { exact: false }).waitFor();
    await h.sinRed(false);
    const db = await esperar(h, (rs) => rs.length === 2, 25000);
    const r = reservasDe(db).find((x) => x.cliente === "Sin Señal");
    assert.deepEqual([r.item, r.kg, r.precioKg, r.sena], ["MEDIO CORDERO", 7.5, 17000, 10000]);
  } finally {
    await h.close();
  }
});

test("acceso directo desde el panel, gesto atrás y hoja en el backup", async () => {
  const seed = buildSeed();
  seed.reservas = { a: reserva({ cliente: "María Fernández", kg: 10.5, sena: 50000, contacto: "11 5555-1234" }), b: reserva({ cliente: "Antes", fechaReserva: "2026-11-01", precioKg: null }) };
  const h = await launch({ rol: "director", etiqueta: "rsv", seed });
  try {
    await h.ir("index.html");
    // El pedido de abrir Reservas va en la dirección y vale una sola vez (se saca al usarlo)
    assert.equal(await h.page.getByRole("link", { name: "Reservas de fin de año" }).getAttribute("href"), "pedidos.html?reservas=1");
    await h.page.getByText("Reservas de fin de año").click();
    await h.page.waitForURL(/pedidos\.html/);
    await tarjeta(h, "María Fernández").waitFor();
    // El gesto atrás cierra el formulario y después vuelve al inicio de Pedidos
    await boton(h, "+ Nueva").click();
    await h.page.getByText("Nueva reserva").waitFor();
    await h.page.goBack();
    await tarjeta(h, "María Fernández").waitFor();
    await h.page.goBack();
    await h.page.getByText("¿Quién sos?", { exact: false }).waitFor();

    // Backup: hoja Reservas, ordenada por fecha del pedido
    await h.ir("backup.html");
    const [descarga] = await Promise.all([h.page.waitForEvent("download"), h.page.locator("#btnBackup").click()]);
    const ruta = await descarga.path();
    const XLSX = (await import("xlsx")).default || (await import("xlsx"));
    const fs = await import("node:fs");
    const libro = XLSX.read(fs.readFileSync(ruta));
    assert.ok(libro.SheetNames.includes("Reservas"), "hojas: " + libro.SheetNames.join(", "));
    const filas = XLSX.utils.sheet_to_json(libro.Sheets.Reservas, { header: 1, range: 3 });
    assert.deepEqual(filas[0], ["ID", "Fecha del pedido", "Cliente", "Contacto", "Ítem", "Kg", "Precio por kg ($)", "Total estimado ($)", "Seña ($)", "Resta cobrar ($)", "Fecha de retiro", "Estado", "Observaciones"]);
    assert.deepEqual(filas.slice(1).map((f) => [f[1], f[2], f[5], f[7], f[8], f[9]]), [
      ["2026-11-01", "Antes", 10, "", 0, ""], // precio a convenir: sin total ni resto
      ["2026-11-05", "María Fernández", 10.5, 152250, 50000, 102250],
    ]);
  } finally {
    await h.close();
  }
});

test("el operario no ve las reservas", async () => {
  const seed = buildSeed();
  seed.reservas = { a: reserva({ cliente: "María Fernández" }) };
  const h = await launch({ rol: "operario", etiqueta: "rsv", seed });
  try {
    await h.ir("pedidos.html?reservas=1");
    await h.page.waitForTimeout(800);
    assert.equal(await h.page.getByText("Reservas fin de año").count(), 0);
    assert.equal(await tarjetas(h).count(), 0);
  } finally {
    await h.close();
  }
});

// ── Uso con muchas reservas (días de entrega) ────────────────────────────────

function muchas() {
  const nombres = ["María Fernández", "Jorge Giménez", "Restaurante Lo de Néstor", "Lucía Paredes", "Carlos Ibáñez", "Ana Sosa", "Pedro Acosta", "Susana Díaz", "Raúl Benítez", "Mónica Ledesma", "Héctor Vera", "Elsa Quiroga"];
  const items = ["LECHÓN", "CORDERO", "MEDIO LECHÓN", "LECHÓN", "COCHINILLO", "LECHÓN", "MEDIO CORDERO", "LECHÓN", "CORDERO", "LECHÓN", "COCHINILLO", "LECHÓN"];
  const retiros = ["2026-11-10", "2026-11-11", "2026-12-23", "2026-12-24", "2026-12-24", "2026-12-24", "2026-12-30", "2026-12-31", "2026-12-31", "", "2026-11-09", "2026-12-23"];
  const out = {};
  nombres.forEach((n, i) => {
    out["r" + String(i).padStart(2, "0")] = reserva({
      cliente: n, item: items[i], kg: 6 + i, precioKg: items[i] === "LECHÓN" ? 14500 + i * 100 : 16900, sena: i % 2 ? 20000 : 0,
      fechaReserva: "2026-11-" + String(1 + (i % 9)).padStart(2, "0"), fechaRetiro: retiros[i],
      estado: i === 4 ? "entregada" : "pendiente", creadoEn: "2026-11-0" + (1 + (i % 9)) + "T1" + (i % 10) + ":00:00.000Z",
    });
  });
  return out;
}

test("con muchas reservas: tarjetas plegadas, buscador que encuentra también las entregadas y días de retiro separados", async () => {
  const h = await abrir(muchas());
  try {
    const maria = tarjeta(h, "María Fernández");
    await maria.waitFor();
    // Plegada: se ve quién, qué, cuándo retira y cuánto resta; las acciones aparecen al tocarla
    const plegada = (await maria.innerText()).replace(/\s+/g, " ");
    for (const esperado of ["María Fernández", "LECHÓN", "6 kg", "Retira: 10/11/2026", "HOY", "Resta: $87.000"]) assert.ok(plegada.includes(esperado), "falta «" + esperado + "»: " + plegada);
    assert.equal(await maria.getByRole("button", { name: "✓ Entregada" }).count(), 0);
    await maria.click();
    await maria.getByRole("button", { name: "✓ Entregada" }).waitFor();
    await maria.getByRole("button", { name: "Editar" }).waitFor();

    // El buscador está arriba y busca en todas, también en las entregadas
    const buscador = h.page.getByLabel("Buscar reserva");
    await buscador.fill("ibañez");
    await tarjeta(h, "Carlos Ibáñez").waitFor();
    await h.page.getByText("1 reserva encontrada (pendientes y entregadas)").waitFor();
    assert.match(await tarjeta(h, "Carlos Ibáñez").innerText(), /ENTREGADA/);
    assert.equal(await tarjetas(h).count(), 1);
    await h.page.getByRole("button", { name: "Borrar la búsqueda" }).click();
    await maria.waitFor();

    // Por retiro: una franja por día, con cuántas son y cuántos kilos
    await boton(h, "Retiro").click();
    const pagina = (await h.page.locator(".crm-page").innerText()).replace(/\s+/g, " ");
    for (const esperado of ["Lunes 09/11 — sin retirar (ayer) 1 · 16 kg", "Martes 10/11 — HOY 1 · 6 kg", "Miércoles 11/11 — MAÑANA 1 · 7 kg", "Jueves 24/12 — en 44 días 2 · 20 kg", "Retiro a confirmar 1 · 15 kg"]) {
      assert.ok(pagina.includes(esperado), "falta la franja «" + esperado + "» en: " + pagina.slice(0, 900));
    }
    assert.ok(pagina.indexOf("sin retirar (ayer)") < pagina.indexOf("— HOY") && pagina.indexOf("— HOY") < pagina.indexOf("— MAÑANA"), "lo atrasado primero, después hoy y mañana");
    assert.equal(await h.page.evaluate(() => document.documentElement.scrollWidth), 390, "sin desborde a lo ancho");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("formulario: abre arriba aunque la lista esté bajada, y propone el último precio del ítem", async () => {
  const h = await abrir(muchas());
  try {
    await tarjeta(h, "María Fernández").waitFor();
    await h.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await boton(h, "+ Nueva").click();
    await h.page.getByText("Nueva reserva").waitFor();
    await h.page.waitForFunction(() => window.scrollY === 0);
    assert.ok(await h.page.locator("#rsv-cliente").isVisible());

    // Último LECHÓN reservado (por fecha de reserva, el 08/11): Susana Díaz, $15.200
    await h.page.locator("#rsv-item").selectOption("LECHÓN");
    assert.equal(await h.page.getByLabel("Precio por kg").inputValue(), "15.200");
    // Si el precio se escribió a mano, cambiar de ítem no lo pisa
    await llenar(h, { precio: "15000" });
    await h.page.locator("#rsv-item").selectOption("CORDERO");
    assert.equal(await h.page.getByLabel("Precio por kg").inputValue(), "15.000");
    // Un ítem sin reservas anteriores no propone nada
    await h.page.getByLabel("Precio por kg").fill("");
    await h.page.locator("#rsv-item").selectOption("MEDIO CORDERO");
    assert.equal(await h.page.getByLabel("Precio por kg").inputValue(), "16.900");
    await h.page.locator("#rsv-item").selectOption("Queso Tybo");
    assert.equal(await h.page.getByLabel("Precio por kg").inputValue(), "");
  } finally {
    await h.close();
  }
});

test("el nombre es texto libre (no sugiere los clientes del CRM) y los campos de fecha no se salen del ancho", async () => {
  const h = await abrir();
  try {
    await boton(h, "+ Nueva").click();
    const nombre = h.page.locator("#rsv-cliente");
    await nombre.waitFor();
    assert.equal(await nombre.getAttribute("list"), null, "sin lista de sugerencias");
    assert.equal(await h.page.locator("datalist").count(), 0);
    assert.equal(await nombre.getAttribute("autocomplete"), "off");
    // Los campos de fecha miden lo mismo que los demás y la página no se pasa del ancho del teléfono
    const ancho = (sel) => h.page.locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().right));
    const derecha = await ancho("#rsv-cliente");
    assert.equal(await ancho("#rsv-fecha"), derecha);
    assert.equal(await ancho("#rsv-retiro"), derecha);
    for (const id of ["#rsv-fecha", "#rsv-retiro"]) {
      const estilo = await h.page.locator(id).evaluate((el) => { const c = getComputedStyle(el); return { apariencia: c.appearance || c.webkitAppearance, minimo: c.minWidth, maximo: c.maxWidth }; });
      assert.deepEqual(estilo, { apariencia: "none", minimo: "0px", maximo: "100%" }, id);
    }
    assert.equal(await h.page.evaluate(() => document.documentElement.scrollWidth), 390);
    assert.equal(await h.page.evaluate(() => getComputedStyle(document.body).overflowX), "clip");
  } finally {
    await h.close();
  }
});

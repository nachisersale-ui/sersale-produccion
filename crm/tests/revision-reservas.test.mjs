// Revisión independiente de Reservas de fin de año: cada prueba reproduce un
// defecto encontrado en la lógica o en los datos (y queda como red de seguridad).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";
import { setRules } from "./lib/emulator.mjs";

const boton = (h, t) => h.page.getByRole("button", { name: t, exact: true });
const toast = (h, t) => h.page.locator(".ss-toast", { hasText: t });
const tarjetas = (h) => h.page.locator("[data-reserva]");
const tarjeta = (h, cliente) => h.page.locator("[data-reserva]", { hasText: cliente });
const reservasDe = (db) => Object.entries(db.reservas || {}).map(([id, r]) => ({ id, ...r }));
const nombres = (h) => tarjetas(h).locator("div[style*='font-weight: 800']").allInnerTexts();
const CORTO = { timeout: 8000 }; // lo que hoy falla no tiene por qué esperar medio minuto

function reserva(extra) {
  return { fechaReserva: "2026-11-05", cliente: "Cliente", contacto: "", item: "LECHÓN", kg: 10, precioKg: 14500, sena: 0, fechaRetiro: "2026-12-24", obs: "", estado: "pendiente", creadoEn: "2026-11-05T12:00:00.000Z", creadoPor: "nacho", ...extra };
}
async function abrir(reservas = {}, opts = {}) {
  const seed = opts.seed || buildSeed();
  seed.reservas = reservas;
  const h = await launch({ rol: "director", etiqueta: "rsvrev", ...opts, seed });
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
/** Contesta la hoja de confirmación que esté abierta con el botón `texto`. */
async function contestar(h, texto) {
  const hoja = h.page.locator(".ss-hoja");
  await hoja.waitFor(CORTO);
  const cuerpo = await hoja.innerText();
  await h.page.waitForTimeout(450);
  await hoja.locator(".ss-btn", { hasText: texto }).click();
  await hoja.waitFor({ state: "detached" });
  return cuerpo;
}
/** Lo que haría otro teléfono: borrar un documento directo en el servidor. */
async function borrarEnServidor(h, ruta) {
  const r = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${h.projectId}/databases/(default)/documents/${ruta}`, { method: "DELETE", headers: { Authorization: "Bearer owner" } });
  assert.ok(r.ok, "no se pudo borrar " + ruta);
}
// Reglas de una base que todavía no habilitó la colección nueva.
const REGLAS_SIN_RESERVAS = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{coleccion}/{documento=**} { allow read, write: if coleccion != 'reservas'; }
  }
}`;

// ── Números ────────────────────────────────────────────────────────────────

test("kilos con tres decimales: «10,250» son diez kilos y cuarto, no diez mil", async () => {
  const h = await abrir({ viejo: reserva({ cliente: "Costillar Chico", item: "Ribs", kg: 0.125, precioKg: 8000, fechaReserva: "2026-11-01" }) });
  try {
    await boton(h, "+ Nueva").click();
    await llenar(h, { cliente: "Balanza Exacta", item: "LECHÓN", kg: "10,250", precio: "14500" });
    assert.equal(await h.page.getByLabel("Kilos").inputValue(), "10,250");
    await h.page.getByText("Total estimado: $148.625").waitFor(CORTO);
    await boton(h, "✓ Guardar reserva").click();
    let db = await esperar(h, (rs) => rs.length === 2);
    assert.equal(reservasDe(db).find((r) => r.cliente === "Balanza Exacta").kg, 10.25);
    assert.match((await tarjeta(h, "Balanza Exacta").innerText()).replace(/\s+/g, " "), /10,25 kg/);

    // Con punto (teclado en otra región): el campo muestra 1,500 y eso es un kilo y medio
    await boton(h, "+ Nueva").click();
    await llenar(h, { cliente: "Con Punto", item: "COCHINILLO", kg: "1.500" });
    assert.equal(await h.page.getByLabel("Kilos").inputValue(), "1,500");
    await boton(h, "✓ Guardar reserva").click();
    db = await esperar(h, (rs) => rs.length === 3);
    assert.equal(reservasDe(db).find((r) => r.cliente === "Con Punto").kg, 1.5);

    // Editar otra cosa de una reserva de 0,125 kg no la convierte en 125 kg
    await tarjeta(h, "Costillar Chico").getByRole("button", { name: "Editar" }).click();
    assert.equal(await h.page.getByLabel("Kilos").inputValue(), "0,125");
    await llenar(h, { obs: "cortado fino" });
    await boton(h, "✓ Guardar cambios").click();
    db = await esperar(h, (rs) => rs.find((r) => r.id === "viejo").obs === "cortado fino");
    assert.equal(db.reservas.viejo.kg, 0.125);
    const pagina = (await h.page.locator(".crm-page").innerText()).replace(/\s+/g, " ");
    assert.ok(pagina.includes("11,9 kg reservados"), "total de kilos: " + pagina.slice(0, 200));
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("una seña o un precio negativos (pegados) no se guardan", async () => {
  const h = await abrir();
  try {
    await boton(h, "+ Nueva").click();
    await llenar(h, { cliente: "Pegó Mal", item: "CORDERO", kg: "12", precio: "16900" });
    await h.page.getByLabel("Seña").focus();
    await h.page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text", "-50.000,00");
      document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "negativ").waitFor(CORTO);
    assert.equal(await h.page.locator("#rsv-cliente").inputValue(), "Pegó Mal", "el formulario queda como estaba");
    assert.equal(reservasDe(await h.dump()).length, 0);
  } finally {
    await h.close();
  }
});

// ── Ítems ──────────────────────────────────────────────────────────────────

test("un ítem escrito a mano que ya está en la lista se guarda con el nombre de la lista, y «qué hay que tener» lo suma junto", async () => {
  const h = await abrir({
    a: reserva({ cliente: "Uno", item: "LECHÓN", kg: 10 }),
    b: reserva({ cliente: "Dos", item: "Lechon", kg: 8, creadoEn: "2026-11-05T13:00:00.000Z" }),
    c: reserva({ cliente: "Tres", item: "lechón", kg: 2.5, creadoEn: "2026-11-05T14:00:00.000Z" }),
    d: reserva({ cliente: "Cuatro", item: "Pavita rellena", kg: 4, creadoEn: "2026-11-05T15:00:00.000Z" }),
    e: reserva({ cliente: "Cinco", item: "pavita  RELLENA", kg: 3, creadoEn: "2026-11-05T16:00:00.000Z" }),
  });
  try {
    await tarjeta(h, "Cinco").waitFor();
    const pagina = (await h.page.locator(".crm-page").innerText()).replace(/\s+/g, " ");
    assert.ok(pagina.includes("LECHÓN × 3 20,5 kg"), "el lechón, todo junto: " + pagina.slice(0, 400));
    assert.ok(pagina.includes("Pavita rellena × 2 7 kg"), "lo escrito a mano también: " + pagina.slice(0, 400));
    assert.ok(!/Lechon ×|lechón ×/.test(pagina));

    await boton(h, "+ Nueva").click();
    await llenar(h, { cliente: "Seis", item: "__otro__", otro: " medio  lechon ", kg: "5" });
    await boton(h, "Guardar y cargar otro ítem de este cliente").click();
    await toast(h, "Reserva guardada: Seis · MEDIO LECHÓN").waitFor(CORTO);
    await llenar(h, { item: "__otro__", otro: "jamon cocido natural sublime", kg: "3" });
    await boton(h, "✓ Guardar reserva").click();
    const db = await esperar(h, (rs) => rs.length === 7);
    assert.deepEqual(reservasDe(db).filter((r) => r.cliente === "Seis").map((r) => r.item).sort(), ["Jamón Cocido Natural Sublime", "MEDIO LECHÓN"]);
  } finally {
    await h.close();
  }
});

// ── Contacto ───────────────────────────────────────────────────────────────

test("contacto: WhatsApp y Llamar solo cuando lo escrito cierra como teléfono, con el número correcto", async () => {
  const h = await abrir();
  try {
    const CASOS = [
      // [lo escrito, WhatsApp, Llamar]
      ["11 5555-1234", "5491155551234", "1155551234"],
      ["11-6763-7860", "5491167637860", "1167637860"],
      ["Cel:  11  5555-1234 (Marta)", "5491155551234", "1155551234"],
      ["15-5555-1234", "5491155551234", "1555551234"], // 15 y ocho cifras: celular de Buenos Aires
      ["1555551234", "5491155551234", "1555551234"],
      ["011 15 5555 1234", "5491155551234", "0111555551234"],
      ["+54 9 11 5555-1234", "5491155551234", "+5491155551234"],
      ["+54 11 5555-1234", "5491155551234", "+541155551234"],
      ["(0221) 15-555-1234", "5492215551234", "0221155551234"],
      ["0221 555-1234", "5492215551234", "02215551234"],
      ["4943-2106", "", "49432106"], // fijo sin característica: se puede llamar, no escribir
      ["4943-2106 / 11 5555-1234", "5491155551234", "49432106"],
      ["11 5555-1234 / 11 4444-9876", "5491155551234", "1155551234"],
      ["011 4943-2106 (fijo) / 15-5555-1234", "5491155551234", "01149432106"], // WhatsApp al que está escrito como celular
      ["Senillosa 626", "", ""],
      ["Senillosa 626\n11 5555-1234", "5491155551234", "1155551234"],
      ["Senillosa 626 - 11 5555-1234", "5491155551234", "1155551234"],
      ["Senillosa 626 11 5555-1234", "5491155551234", "1155551234"],
      ["Senillosa 26 4943-2106", "", "49432106"],
      ["Depto 3. 4943-2106", "", "49432106"],
      ["Seña $50.000 / total $1.500.000", "", ""],
      ["Caseros 2560 4943-2106", "", "49432106"],
      ["maria.fernandez1985@gmail.com", "", ""],
      ["pedidos20261224@gmail.com", "", ""],
      ["DNI 28.123.456", "", ""],
      ["CUIT 30-70227633-7", "", ""],
      ["Retira el 24-12-2026", "", ""],
      ["", "", ""],
      [null, "", ""],
      [1155551234, "5491155551234", "1155551234"], // cargado a mano como número
    ];
    const salida = await h.page.evaluate((cs) => cs.map(([c]) => [c, rsvWhatsApp(c), rsvTelefono(c)]), CASOS);
    assert.deepEqual(salida, CASOS);
  } finally {
    await h.close();
  }
});

// ── Navegación ─────────────────────────────────────────────────────────────

test("el acceso directo ?reservas=1 vale una sola vez: al recargar se vuelve a donde se estaba", async () => {
  const seed = buildSeed();
  seed.reservas = { a: reserva({ cliente: "María Fernández" }) };
  const h = await launch({ rol: "director", etiqueta: "rsvrev", seed });
  try {
    await h.ir("pedidos.html?reservas=1");
    await tarjeta(h, "María Fernández").waitFor();
    await h.page.getByRole("button", { name: "Volver" }).click();
    await h.page.getByText("¿Quién sos?", { exact: false }).waitFor();
    await h.page.waitForTimeout(300);
    await h.page.reload();
    await h.esperarApp();
    await h.page.waitForTimeout(500);
    assert.equal(await h.page.getByText("¿Quién sos?", { exact: false }).count(), 1, "tiene que quedar en el inicio de Pedidos, no volver a Reservas");
    assert.equal(await tarjetas(h).count(), 0);
  } finally {
    await h.close();
  }
});

test("volver con una reserva a medio cargar (flecha o gesto atrás) pregunta antes de perderla", async () => {
  const h = await abrir({ a: reserva({ cliente: "Ya Estaba" }) });
  try {
    // Sin nada escrito no hay nada que preguntar
    await boton(h, "+ Nueva").click();
    await h.page.getByText("Nueva reserva").waitFor();
    await h.page.getByRole("button", { name: "Volver" }).click();
    await tarjeta(h, "Ya Estaba").waitFor();
    assert.equal(await h.page.locator(".ss-hoja").count(), 0);

    await boton(h, "+ Nueva").click();
    await llenar(h, { cliente: "Ana Sosa", contacto: "11 5555-1234", item: "CORDERO", kg: "12", sena: "30000" });
    // La flecha
    await h.page.getByRole("button", { name: "Volver" }).click();
    assert.match(await contestar(h, "Seguir cargando"), /salir sin guardar/i);
    assert.equal(await h.page.locator("#rsv-cliente").inputValue(), "Ana Sosa");
    // El gesto atrás del teléfono, dos veces seguidas
    await h.page.goBack();
    await contestar(h, "Seguir cargando");
    assert.equal(await h.page.getByLabel("Seña").inputValue(), "30.000");
    await h.page.goBack();
    await contestar(h, "Seguir cargando");
    assert.equal(await h.page.getByLabel("Kilos").inputValue(), "12");
    // Guardar sigue andando después de todo eso
    await boton(h, "Guardar y cargar otro ítem de este cliente").click();
    await esperar(h, (rs) => rs.length === 2);
    await toast(h, "Reserva guardada: Ana Sosa · CORDERO").waitFor();
    await h.page.waitForFunction(() => document.querySelector("[aria-label='Kilos']").value === "");
    // Lo que queda (nombre y contacto para el ítem siguiente) ya está guardado: no pregunta
    await h.page.goBack();
    await tarjeta(h, "Ana Sosa").waitFor(CORTO);
    assert.equal(await h.page.locator(".ss-hoja").count(), 0);

    // Editar: si se cambió algo, pregunta; si se decide salir, no guarda
    await tarjeta(h, "Ana Sosa").getByRole("button", { name: "Editar" }).click();
    await h.page.getByText("Editar reserva").waitFor();
    await llenar(h, { kg: "99" });
    await h.page.goBack();
    await contestar(h, "Salir");
    await tarjeta(h, "Ana Sosa").waitFor();
    assert.match(await tarjeta(h, "Ana Sosa").innerText(), /12 kg/);
    // …y el historial quedó sano: el atrás siguiente vuelve al inicio de Pedidos
    await h.page.goBack();
    await h.page.getByText("¿Quién sos?", { exact: false }).waitFor(CORTO);
    assert.equal(reservasDe(await h.dump()).find((r) => r.cliente === "Ana Sosa").kg, 12);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── La lista en vivo ───────────────────────────────────────────────────────

test("sin señal en un teléfono que nunca bajó las reservas: no dice que no hay ninguna", async () => {
  const seed = buildSeed();
  seed.reservas = { a: reserva({ cliente: "Ya Reservó" }) };
  const h = await launch({ rol: "director", etiqueta: "rsvrev", seed });
  try {
    await h.ir("pedidos.html");
    await h.page.getByText("¿Quién sos?", { exact: false }).waitFor();
    await h.sincronizar();
    await h.sinRed(true);
    await h.page.getByText("Reservas fin de año").first().click();
    await h.page.getByText("Ordenar por fecha de").waitFor({ timeout: 30000 });
    await h.page.waitForTimeout(400);
    const pagina = (await h.page.locator(".crm-page").innerText()).replace(/\s+/g, " ");
    assert.ok(!pagina.includes("Todavía no hay reservas"), "afirma que no hay reservas sin haber podido leerlas: " + pagina);
    assert.match(pagina, /no se pudieron traer las reservas/);

    // Igual se puede anotar; la lista avisa que no está completa
    await boton(h, "+ Nueva").click();
    await llenar(h, { cliente: "Anotada Sin Señal", item: "LECHÓN", kg: "9" });
    await boton(h, "✓ Guardar reserva").click();
    await tarjeta(h, "Anotada Sin Señal").waitFor();
    assert.match((await h.page.locator(".crm-page").innerText()).replace(/\s+/g, " "), /no se pudieron traer las reservas/);

    await h.sinRed(false);
    await tarjeta(h, "Ya Reservó").waitFor({ timeout: 40000 });
    await esperar(h, (rs) => rs.length === 2, 30000);
    await h.page.getByText("no se pudieron traer las reservas", { exact: false }).waitFor({ state: "detached", timeout: 20000 });
    assert.deepEqual(await nombres(h), ["Ya Reservó", "Anotada Sin Señal"]);
  } finally {
    await h.close();
  }
});

test("si la base no permite la colección nueva, lo dice (no le echa la culpa a la señal)", async () => {
  const seed = buildSeed();
  seed.reservas = { a: reserva({ cliente: "María Fernández" }) };
  const h = await launch({ rol: "director", etiqueta: "rsvrev", seed });
  try {
    await setRules(h.projectId, REGLAS_SIN_RESERVAS);
    await h.ir("pedidos.html");
    await h.page.getByText("Reservas fin de año").first().click();
    await h.page.getByText("No se pudieron cargar las reservas").waitFor();
    const pagina = (await h.page.locator(".crm-page").innerText()).replace(/\s+/g, " ");
    assert.match(pagina, /La base de datos no permite ver las reservas/);
    assert.ok(!pagina.includes("Puede ser la señal"));
    // Al guardar ya lo decía
    await boton(h, "+ Nueva").click();
    await llenar(h, { cliente: "No Entra", item: "LECHÓN", kg: "9" });
    await boton(h, "✓ Guardar reserva").click();
    await toast(h, "La base de datos no permite guardar reservas").waitFor();
    assert.equal(await h.page.locator("#rsv-cliente").inputValue(), "No Entra");
  } finally {
    await h.close();
  }
});

test("editar una reserva mientras otro teléfono le anota la seña: no se la pisa", async () => {
  const h = await abrir({ a: reserva({ cliente: "Jorge Giménez", item: "CORDERO", kg: 14, precioKg: 16900, sena: 0 }) });
  try {
    await tarjeta(h, "Jorge Giménez").getByRole("button", { name: "Editar" }).click();
    await h.page.getByText("Editar reserva").waitFor();
    // Mientras tanto, en el mostrador, otro teléfono anota que dejó $50.000 y que lo quiere abierto
    await h.sembrar({ reservas: { a: reserva({ cliente: "Jorge Giménez", item: "CORDERO", kg: 14, precioKg: 16900, sena: 50000, obs: "Abierto al medio", actualizadoEn: "2026-11-10T13:31:00.000Z" }) } });
    await h.page.waitForTimeout(700);
    await llenar(h, { retiro: "2026-12-30" });
    await boton(h, "✓ Guardar cambios").click();
    const db = await esperar(h, (rs) => rs[0].fechaRetiro === "2026-12-30");
    const a = db.reservas.a;
    assert.deepEqual([a.sena, a.obs, a.kg, a.precioKg, a.estado, a.creadoEn, a.creadoPor], [50000, "Abierto al medio", 14, 16900, "pendiente", "2026-11-05T12:00:00.000Z", "nacho"]);
    await tarjeta(h, "Jorge Giménez").waitFor();
    assert.match((await tarjeta(h, "Jorge Giménez").innerText()).replace(/\s+/g, " "), /Retira: 30\/12\/2026.*Seña: \$50\.000/);
  } finally {
    await h.close();
  }
});

test("guardar los cambios de una reserva que otro teléfono eliminó: avisa que ya no existe", async () => {
  const h = await abrir({ a: reserva({ cliente: "Se Borra" }), b: reserva({ cliente: "Queda" }) });
  try {
    await tarjeta(h, "Se Borra").getByRole("button", { name: "Editar" }).click();
    await h.page.getByText("Editar reserva").waitFor();
    await borrarEnServidor(h, "reservas/a");
    await h.page.waitForTimeout(700);
    await llenar(h, { kg: "12" });
    await boton(h, "✓ Guardar cambios").click();
    await toast(h, "ya no existe").waitFor(CORTO);
    assert.equal(await toast(h, "Probá de nuevo").count(), 0, "reintentar no sirve: no hay que sugerirlo");
    assert.deepEqual(reservasDe(await h.dump()).map((r) => r.id), ["b"], "no la vuelve a crear a medias");
  } finally {
    await h.close();
  }
});

test("el buscador no desaparece con una búsqueda puesta", async () => {
  const rs = {};
  ["Ana", "Beto", "Carla", "Dario", "Elsa", "Fabio"].forEach((n, i) => { rs["r" + i] = reserva({ cliente: n + " Gómez", creadoEn: "2026-11-05T1" + i + ":00:00.000Z" }); });
  rs.p = reserva({ cliente: "Raúl Pérez", fechaReserva: "2026-11-06" });
  const h = await abrir(rs);
  try {
    await tarjeta(h, "Raúl Pérez").waitFor();
    await h.page.getByLabel("Buscar reserva").fill("perez");
    assert.deepEqual(await nombres(h), ["Raúl Pérez"]);
    await tarjeta(h, "Raúl Pérez").getByRole("button", { name: "Eliminar la reserva de Raúl Pérez" }).click();
    await contestar(h, "Eliminar");
    await esperar(h, (lista) => lista.length === 6);
    await tarjeta(h, "Raúl Pérez").waitFor({ state: "detached" });
    // Quedan seis reservas y ninguna a la vista: tiene que poder borrarse la búsqueda
    await h.page.getByLabel("Buscar reserva").waitFor(CORTO);
    await h.page.getByLabel("Buscar reserva").fill("");
    assert.equal((await nombres(h)).length, 6);
  } finally {
    await h.close();
  }
});

// ── Documentos tocados a mano ──────────────────────────────────────────────

test("una reserva cargada a mano en la base con otros tipos de dato no rompe la lista ni el orden por retiro", async () => {
  const h = await abrir({
    vacia: {},
    mano: { cliente: "Tocada A Mano", contacto: 1155551234, item: "Pavita", kg: "10.5", precioKg: "14500", sena: "20000", fechaReserva: "2026-11-05", fechaRetiro: 20261224, estado: "pendiente" },
    bien: reserva({ cliente: "Bien Cargada", fechaRetiro: "2026-12-23" }),
  });
  try {
    await tarjeta(h, "Tocada A Mano").waitFor();
    await boton(h, "Retiro").click();
    await h.page.waitForTimeout(300);
    assert.equal(await h.page.getByText("Esta pantalla no se pudo mostrar").count(), 0, "la pantalla se cayó al ordenar por retiro");
    assert.equal(await tarjetas(h).count(), 3);
    const texto = (await tarjeta(h, "Tocada A Mano").innerText()).replace(/\s+/g, " ");
    for (const esperado of ["Pavita", "10,5 kg", "$14.500/kg", "Total: $152.250", "Seña: $20.000", "Resta: $132.250"]) assert.ok(texto.includes(esperado), "falta «" + esperado + "» en: " + texto);
    assert.equal(await tarjeta(h, "Tocada A Mano").getByRole("link", { name: /WhatsApp/ }).getAttribute("href"), "https://wa.me/5491155551234?text=");
  } finally {
    await h.close();
  }
});

test("editar una reserva cargada a mano (teléfono como número, catálogo con una categoría rota) guarda igual", async () => {
  const seed = buildSeed();
  seed.config.productos.categorias["Rota"] = { a: "Producto suelto" };
  seed.config.productos.categorias["Con huecos"] = ["Bondiola Fresca", null, ""];
  const h = await abrir({ mano: { cliente: "Tocada A Mano", contacto: 1155551234, item: "Pavita", kg: 10.5, fechaReserva: "2026-11-05", estado: "pendiente" } }, { seed });
  try {
    await tarjeta(h, "Tocada A Mano").getByRole("button", { name: "Editar" }).click();
    await h.page.getByText("Editar reserva").waitFor(CORTO);
    assert.equal(await h.page.locator("#rsv-contacto").inputValue(), "1155551234");
    assert.equal(await h.page.getByLabel("Otro ítem").inputValue(), "Pavita");
    await llenar(h, { obs: "revisada" });
    await boton(h, "✓ Guardar cambios").click();
    const db = await esperar(h, (rs) => rs[0].obs === "revisada", 8000);
    assert.deepEqual([db.reservas.mano.item, db.reservas.mano.kg, db.reservas.mano.cliente], ["Pavita", 10.5, "Tocada A Mano"]);
    assert.equal(await h.page.getByText("Esta pantalla no se pudo mostrar").count(), 0);
  } finally {
    await h.close();
  }
});

// ── Backup ─────────────────────────────────────────────────────────────────

async function bajarBackup(h) {
  await h.ir("backup.html");
  const [descarga] = await Promise.all([h.page.waitForEvent("download", { timeout: 25000 }), h.page.locator("#btnBackup").click()]);
  const XLSX = (await import("xlsx")).default || (await import("xlsx"));
  return { XLSX, libro: XLSX.read(fs.readFileSync(await descarga.path())) };
}

test("backup: las reservas del mismo día salen en el orden en que se cargaron", async () => {
  const seed = buildSeed();
  seed.reservas = {
    a: reserva({ cliente: "Tercera", creadoEn: "2026-11-05T18:00:00.000Z" }),
    b: reserva({ cliente: "Primera", creadoEn: "2026-11-05T09:00:00.000Z" }),
    c: reserva({ cliente: "Segunda", creadoEn: "2026-11-05T12:00:00.000Z" }),
    d: reserva({ cliente: "Del Día Anterior", fechaReserva: "2026-11-04", creadoEn: "2026-11-06T09:00:00.000Z" }),
    e: {}, // sin datos: no rompe la hoja
  };
  const h = await launch({ rol: "director", etiqueta: "rsvrev", seed });
  try {
    const { XLSX, libro } = await bajarBackup(h);
    const filas = XLSX.utils.sheet_to_json(libro.Sheets.Reservas, { header: 1, range: 4, defval: "" });
    assert.deepEqual(filas.map((f) => f[2]), ["", "Del Día Anterior", "Primera", "Segunda", "Tercera"]);
    assert.deepEqual(filas[0].slice(1), ["", "", "", "", 0, "", "", 0, "", "", "", ""]);
  } finally {
    await h.close();
  }
});

test("backup: si la base no deja leer las reservas, el resto del backup se genera igual y avisa", async () => {
  const seed = buildSeed();
  seed.reservas = { a: reserva({ cliente: "María Fernández" }) };
  const h = await launch({ rol: "director", etiqueta: "rsvrev", seed });
  try {
    await setRules(h.projectId, REGLAS_SIN_RESERVAS);
    const { XLSX, libro } = await bajarBackup(h);
    assert.ok(XLSX.utils.sheet_to_json(libro.Sheets.Pedidos, { header: 1, range: 4 }).length > 5, "los pedidos están");
    assert.match(String(libro.Sheets.Reservas.A1.v), /NO SE PUDIERON LEER/);
    assert.match(await h.page.locator("#status").innerText(), /Backup generado.*reservas/i);
  } finally {
    await h.close();
  }
});

// ── Fechas (hoy funciona; queda cubierto) ──────────────────────────────────

test("31 de diciembre a las 22:30: la fecha del pedido y los atajos son los de hoy", async () => {
  const h = await abrir({ a: reserva({ cliente: "Para Hoy", fechaRetiro: "2026-12-31" }), b: reserva({ cliente: "Se Pasó", fechaRetiro: "2026-12-24", creadoEn: "2026-11-05T13:00:00.000Z" }) }, { now: "2026-12-31T22:30:00-03:00" });
  try {
    assert.match(await tarjeta(h, "Para Hoy").innerText(), /HOY/);
    assert.match(await tarjeta(h, "Se Pasó").innerText(), /hace 7 días/);
    await boton(h, "+ Nueva").click();
    assert.equal(await h.page.locator("#rsv-fecha").inputValue(), "2026-12-31");
    assert.equal(await boton(h, "31/12").count(), 1);
    assert.equal(await boton(h, "24/12").count(), 0, "el 24 ya pasó");
    await boton(h, "31/12").click();
    assert.equal(await h.page.locator("#rsv-retiro").inputValue(), "2026-12-31");
  } finally {
    await h.close();
  }
});

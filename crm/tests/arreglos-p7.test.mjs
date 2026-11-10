// Arreglos del área "alertas de recontacto y hoja de ruta"
// (src/pedidos/07-alertas-hoja-ruta.jsx). Cada prueba maneja la pantalla real
// del Director como una persona con el iPhone, a las 22:30 (en UTC ya es el día
// siguiente), y después mira qué quedó guardado en Firestore, qué se ve y qué
// links se abrieron (WhatsApp, Maps).
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const NOCHE = "2026-11-10T22:30:00-03:00";
const HOY = "2026-11-10";
const PLANTA = "24 de Noviembre 1926, Parque Patricios, Buenos Aires";

const boton = (h, t) => h.page.locator("button", { hasText: t });
const texto = (h, t, o) => h.page.getByText(t, o);
const toast = (h, re) => h.page.locator(".ss-toast", { hasText: re });
const idDe = (coleccion, cond) => Object.keys(coleccion).find((id) => cond(coleccion[id]));
const pantalla = (h) => h.page.locator("#root").innerText();

async function abrirDirector({ seed = buildSeed(), mapa } = {}) {
  const h = await launch({ rol: "director", etiqueta: "p7", seed, now: NOCHE });
  h.seed = seed;
  h.consultas = []; // lo que se le preguntó al buscador de direcciones
  // El buscador de direcciones (Nominatim): por defecto encuentra todo.
  await h.context.route(/^https:\/\/nominatim\.openstreetmap\.org\/search/, async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    h.consultas.push(q);
    const r = mapa ? mapa(q) : [{ lat: "-34.6345", lon: "-58.4012" }];
    if (r === "caida") return route.abort();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(r) });
  });
  await h.ir("pedidos.html");
  await boton(h, "Panel general y cuentas corrientes").click();
  await texto(h, "Activos", { exact: true }).waitFor();
  return h;
}

/** Director → Por Día → botón "Ruta" del día que dice `etiqueta` ("HOY", "MAÑANA"). */
async function abrirRuta(h, etiqueta) {
  await boton(h, "Por Día").first().click();
  await h.page.locator(`div:has(> span:has-text("— ${etiqueta}")) button:text-is("Ruta")`).click();
  await texto(h, "Hoja de Ruta").waitFor();
  await boton(h, /Optimizar ruta \(\d+ parada/).waitFor();
}
async function optimizar(h, fin = /Ruta optimizada — \d+ paradas/) {
  await boton(h, /Optimizar ruta/).click();
  await texto(h, fin).waitFor({ timeout: 60000 });
}
async function ultimoLink(h, re) {
  const todos = await h.abiertos();
  const propios = todos.filter((u) => re.test(u));
  assert.ok(propios.length > 0, "no se abrió ningún link " + re + ": " + JSON.stringify(todos));
  return new URL(propios[propios.length - 1]);
}
const textoWA = async (h) => (await ultimoLink(h, /^https:\/\/wa\.me\//)).searchParams.get("text");
async function esperarDoc(h, ruta, cond, ms = 15000) {
  const fin = Date.now() + ms;
  let ultimo = null;
  while (Date.now() < fin) {
    ultimo = await h.doc(ruta);
    if (cond(ultimo)) return ultimo;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("El documento " + ruta + " no llegó al estado esperado: " + JSON.stringify(ultimo).slice(0, 400));
}
const pedido = (cliente, items, extra = {}) => ({
  cliente, cuentaCorriente: false, tipo: "envio", fechaPedido: { __ts: "2026-11-09T14:00:00.000Z" }, fechaPedidoISO: "2026-11-09T14:00:00.000Z",
  fechaEntrega: HOY, items, obs: "", estado: "pendiente", historial: [{ estado: "pendiente", fecha: "2026-11-09T14:00:00.000Z", nota: "Pedido creado" }], ...extra,
});
const item = (producto, cantidad, unidad = "kg", kgReal = null) => ({ categoria: "Artículos Varios", producto, cantidad: String(cantidad), unidad, obs: "", kgReal });

// ── Hoja de ruta ────────────────────────────────────────────────────────────

test("hoja de ruta por WhatsApp: llega entera aunque un cliente tenga «&» en el nombre, y Caballito se busca bien", async () => {
  const h = await abrirDirector();
  try {
    await abrirRuta(h, "MAÑANA"); // Pérez & Hijos (Boedo) y Gamas Caballito
    await optimizar(h);
    await boton(h, "Enviar por WA").click();

    const link = await ultimoLink(h, /^https:\/\/wa\.me\//);
    assert.equal(link.origin + link.pathname, "https://wa.me/");
    assert.deepEqual([...link.searchParams.keys()], ["text"], "el texto no puede partirse en otros parámetros");
    assert.equal(link.hash, "");
    const t = link.searchParams.get("text");
    assert.match(t, /^Hoja de Ruta MIÉRCOLES, 11 DE NOVIEMBRE\n\nSalida: Frigorifico Sersale\n\n/);
    for (const esperado of [
      "Carnicería Los Hermanos Pérez & Hijos\nAv. La Plata 2215, Boedo\n",
      "  - Chorizo Especial Vacuno/Cerdo: 30 kg\n",
      "Panificadora Gamas - Sucursal Caballito\nAv. Rivadavia 5120, Caballito\n",
      "  - Queso Mozzarella: 18 kg\n",
    ]) assert.ok(t.includes(esperado), "falta en la hoja: " + JSON.stringify(esperado) + "\n" + t);
    assert.ok(t.endsWith("\n\nFrigorifico Sersale - (011) 6763-7860"), "la hoja llegó cortada:\n" + t);

    // Al buscador le llega la dirección entera (antes "Av. Rivadavia 5120llito")
    assert.ok(h.consultas.includes("Av. Rivadavia 5120, Caballito, Buenos Aires, Argentina"), JSON.stringify(h.consultas));
    assert.ok(!h.consultas.some((q) => /llito/.test(q) && !/Caballito/.test(q)), JSON.stringify(h.consultas));
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("hoja de ruta: la parada que el mapa no encuentra sigue en la lista, en Maps y en WhatsApp; los kg pesados no se muestran como piezas", async () => {
  const h = await abrirDirector({
    // Don Ángel: el buscador no devuelve nada. Gamas Boedo: se corta la conexión.
    mapa: (q) => (/Caseros 2840/.test(q) ? [] : /San Juan 3601/.test(q) ? "caida" : [{ lat: "-34.64", lon: "-58.38" }]),
  });
  try {
    const pedidosAntes = (await h.dump()).pedidos;
    await abrirRuta(h, "HOY");
    await optimizar(h, "Ruta optimizada — 3 paradas");

    const p = await pantalla(h);
    assert.match(p, /No se pudo ubicar: Panificadora Gamas - Sucursal Boedo, Fiambrería Don Ángel/);
    assert.equal((p.match(/Sin ubicar en el mapa/g) || []).length, 2);
    // Las tres paradas están en la lista: primero la ubicada, después las otras dos
    const pos = ["Distribuidora Mayorista del Sur S.R.L.", "Panificadora Gamas - Sucursal Boedo", "Fiambrería Don Ángel"].map((n) => p.lastIndexOf("\n" + n + "\n"));
    assert.ok(pos[0] > 0 && pos[0] < pos[1] && pos[1] < pos[2], "orden de paradas: " + pos + "\n" + p);
    // Lo pesado son kilos: 4 piezas que pesaron 31,6 kg (antes "31.6 piezas")
    assert.ok(p.includes("Jamón Crudo c/ Hueso 12 Meses: 4 piezas · 31,6 kg"), p);
    assert.ok(!/31[.,]6 piezas/.test(p), p);
    assert.ok(p.includes("Salamín Picado Fino: 3 ganchos"), p);

    await boton(h, "Abrir en Maps").click();
    const maps = await ultimoLink(h, /^https:\/\/www\.google\.com\/maps\/dir\//);
    assert.equal(maps.searchParams.get("origin"), PLANTA);
    assert.equal(maps.searchParams.get("destination"), PLANTA);
    assert.deepEqual(maps.searchParams.get("waypoints").split("|"), [
      "Av. Vélez Sarsfield 1840, Barracas, Buenos Aires", "Av. San Juan 3601, Boedo, Buenos Aires", "Av. Caseros 2840, Parque Patricios, Buenos Aires",
    ]);

    await boton(h, "Enviar por WA").click();
    const t = await textoWA(h);
    for (const esperado of [
      "1. Distribuidora Mayorista del Sur S.R.L.\nAv. Vélez Sarsfield 1840, Barracas\n",
      "  - Jamón Cocido Natural Sublime: 40,35 kg\n",
      "  - Jamón Crudo c/ Hueso 12 Meses: 4 piezas · 31,6 kg\n",
      "2. Panificadora Gamas - Sucursal Boedo\nAv. San Juan 3601, Boedo\n  - Fiambre de Cerdo p/ Emparedados: 15,2 kg\n  - Queso Mozzarella: 20 kg\n",
      "3. Fiambrería Don Ángel\nAv. Caseros 2840, Parque Patricios\n",
      // El envío sin dirección cargada también va, con lo que hay que llevar
      "4. Almacén Doña Rosa\nSin direccion cargada\n  - Mortadela Familiar: 2 kg\n  - Queso Cremoso: 3 kg\n  - Chorizo Puro Cerdo: 4 kg\n",
    ]) assert.ok(t.includes(esperado), "falta en la hoja: " + JSON.stringify(esperado) + "\n" + t);
    assert.ok(t.endsWith("Frigorifico Sersale - (011) 6763-7860"));

    // Mirar la ruta no toca los pedidos
    assert.deepEqual((await h.dump()).pedidos, pedidosAntes);
  } finally {
    await h.close();
  }
});

test("hoja de ruta: si el buscador de direcciones no responde, la hoja igual se puede mandar y abrir en Maps", async () => {
  const h = await abrirDirector({ mapa: () => "caida" });
  try {
    await abrirRuta(h, "HOY");
    await optimizar(h, "No se pudo geocodificar ninguna dirección");

    // Las paradas siguen a la vista, en el orden cargado
    const p = await pantalla(h);
    for (const n of ["Distribuidora Mayorista del Sur S.R.L.", "Panificadora Gamas - Sucursal Boedo", "Fiambrería Don Ángel"]) assert.ok(p.includes("\n" + n + "\n"), p);

    await boton(h, "Enviar por WA").click();
    const t = await textoWA(h);
    for (const n of ["1. Distribuidora Mayorista del Sur S.R.L.\n", "2. Panificadora Gamas - Sucursal Boedo\n", "3. Fiambrería Don Ángel\n", "4. Almacén Doña Rosa\n"]) assert.ok(t.includes(n), t);

    await boton(h, "Abrir en Maps").click();
    const maps = await ultimoLink(h, /^https:\/\/www\.google\.com\/maps\/dir\//);
    assert.equal(maps.searchParams.get("waypoints").split("|").length, 3);

    await boton(h, "Reintentar").click();
    await boton(h, "Optimizar ruta (3 paradas)").waitFor();
  } finally {
    await h.close();
  }
});

test("hoja de ruta: con más de 9 paradas, Maps se abre en tramos y no queda ninguna afuera", async () => {
  const seed = buildSeed();
  const otros = ["Carnicería El Trébol", "Carnicería Los Hermanos Pérez & Hijos", "Almacén D'Agostino", "Almacén y Despensa Güemes",
    "Panificadora Gamas - Sucursal Caballito", "Panificadora Gamas - Sucursal Pompeya", "Rotisería El Buen Sabor", "Carnicería Don Julio"];
  otros.forEach((cliente, i) => { seed.pedidos["ped_p7_" + i] = pedido(cliente, [item("Salamín Picado Fino", 5)]); });
  const h = await abrirDirector({ seed });
  try {
    await abrirRuta(h, "HOY");
    await optimizar(h, "Ruta optimizada — 11 paradas");
    await texto(h, "la ruta va en 2 tramos").waitFor();
    assert.equal(await boton(h, "Abrir en Maps").count(), 0);

    await boton(h, "Maps: paradas 1 a 9").click();
    const uno = await ultimoLink(h, /^https:\/\/www\.google\.com\/maps\/dir\//);
    await boton(h, "Maps: paradas 10 a 11").click();
    const dos = await ultimoLink(h, /^https:\/\/www\.google\.com\/maps\/dir\//);

    const wp = (u) => (u.searchParams.get("waypoints") || "").split("|").filter(Boolean);
    assert.ok(wp(uno).length <= 9 && wp(dos).length <= 9, "Maps acepta hasta 9 paradas intermedias por link");
    assert.equal(uno.searchParams.get("origin"), PLANTA);
    assert.equal(dos.searchParams.get("origin"), uno.searchParams.get("destination"), "el segundo tramo arranca donde termina el primero");
    assert.equal(dos.searchParams.get("destination"), PLANTA);

    const recorridas = [...wp(uno), uno.searchParams.get("destination"), ...wp(dos)];
    const esperadas = Object.values(seed.pedidos)
      .filter((p) => p.fechaEntrega === HOY && p.tipo === "envio" && !["cancelado", "despachado"].includes(p.estado))
      .map((p) => Object.values(seed.clientes).find((c) => c.nombre === p.cliente).direccion)
      .filter(Boolean)
      .map((d) => d + ", Buenos Aires");
    assert.equal(esperadas.length, 11);
    assert.deepEqual([...recorridas].sort(), [...esperadas].sort());
  } finally {
    await h.close();
  }
});

test("hoja de ruta: encuentra la dirección aunque el pedido tenga el nombre escrito distinto, y deja cargar la que falta", async () => {
  const seed = buildSeed();
  // El pedido de Don Ángel se cargó sin acentos, en mayúsculas y con un espacio de más
  const idAngel = idDe(seed.pedidos, (p) => p.cliente === "Fiambrería Don Ángel" && p.fechaEntrega === HOY);
  seed.pedidos[idAngel].cliente = "FIAMBRERIA  DON ANGEL ";
  const idRosa = idDe(seed.clientes, (c) => c.nombre === "Almacén Doña Rosa");
  const h = await abrirDirector({ seed });
  try {
    await abrirRuta(h, "HOY");
    await boton(h, "Optimizar ruta (3 paradas)").waitFor();
    let p = await pantalla(h);
    assert.ok(p.includes("Av. Caseros 2840, Parque Patricios"), "Don Ángel tiene dirección cargada:\n" + p);
    assert.match(p, /Sin dirección:\s*Almacén Doña Rosa\n/);

    // Cargarle la dirección a Doña Rosa sin salir de la hoja
    await boton(h, "Almacén Doña Rosa").click();
    await texto(h, "Editar dirección").waitFor();
    const guardar = boton(h, /^Guardar$/);
    assert.equal(await guardar.isDisabled(), true, "sin dirección escrita no se puede guardar");
    await h.page.locator('input[aria-label="Dirección"]').fill("  Av. Jujuy 1250, San Cristóbal ");
    await guardar.click();
    await toast(h, "Dirección guardada").waitFor();

    const doc = await esperarDoc(h, "clientes/" + idRosa, (d) => d && d.direccion);
    assert.equal(doc.direccion, "Av. Jujuy 1250, San Cristóbal");
    assert.equal(doc.nombre, "Almacén Doña Rosa");
    assert.equal(doc.telefono, seed.clientes[idRosa].telefono);

    await boton(h, "Optimizar ruta (4 paradas)").waitFor();
    p = await pantalla(h);
    assert.ok(!p.includes("Sin dirección:"), p);
    assert.ok(p.includes("Almacén Doña Rosa\nAv. Jujuy 1250, San Cristóbal"), p);
    assert.equal(await texto(h, "Editar dirección").count(), 0);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Alertas de recontacto ───────────────────────────────────────────────────

test("aviso de recontacto por WhatsApp: lleva la fecha del último pedido y llega entero aunque el cliente tenga «&»", async () => {
  const seed = buildSeed();
  seed.clientes.cli_p7 = { nombre: "Fiambrería López & Hijos", telefono: "", direccion: "", cuentaCorriente: false, creadoEn: { __ts: "2026-09-01T12:00:00.000Z" } };
  seed.pedidos.ped_p7 = pedido("Fiambrería López & Hijos", [item("Queso 50% descremado #2", 2, "piezas", 9.4), item("Salamín Picado Fino", 10)], {
    tipo: "retiro", fechaEntrega: "2026-10-01", estado: "despachado",
    fechaPedido: { __ts: "2026-09-30T14:00:00.000Z" }, fechaPedidoISO: "2026-09-30T14:00:00.000Z",
  });
  const h = await abrirDirector({ seed });
  try {
    await boton(h, "Alertas").first().click();
    const tarjeta = h.page.locator("div", { hasText: "Fiambrería López & Hijos" }).filter({ has: boton(h, "Avisar por WA") }).last();
    await tarjeta.waitFor();
    assert.match(await tarjeta.innerText(), /40d sin pedir \(límite: 14d\)[\s\S]*Ultimo pedido: 01\/10\/2026/);
    await tarjeta.locator("button", { hasText: "Avisar por WA" }).click();

    const link = await ultimoLink(h, /^https:\/\/wa\.me\//);
    assert.equal(link.origin + link.pathname, "https://wa.me/5491167637860");
    assert.deepEqual([...link.searchParams.keys()], ["text"]);
    assert.equal(link.hash, "");
    assert.equal(
      link.searchParams.get("text"),
      "Recontacto cliente\n\nCliente: Fiambrería López & Hijos\nDias sin pedir: 40d\n" +
        "Ultimo pedido (01/10/2026): Queso 50% descremado #2 (2 piezas · 9,4 kg), Salamín Picado Fino (10 kg)\nFrigorifico Sersale"
    );
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("alertas: el campo Días guarda solo números válidos, y avisa cuando el límite es automático", async () => {
  const h = await abrirDirector();
  try {
    const seed = h.seed;
    const idVasquito = idDe(seed.clientes, (c) => c.nombre === "Fiambrería El Vasquito"); // un solo pedido: límite a mano (30)
    const idJulio = idDe(seed.clientes, (c) => c.nombre === "Carnicería Don Julio"); // pide cada 21 días: límite automático (24)
    await boton(h, "Alertas").first().click();
    const campo = h.page.locator('input[aria-label="Días de alerta de Fiambrería El Vasquito"]');
    await campo.waitFor();
    assert.equal(await campo.inputValue(), "30");
    assert.equal(await campo.getAttribute("inputmode"), "numeric");

    // Vacío, cero o negativo: no se guarda nada (antes quedaba NaN, 0 o -3 en el cliente)
    for (const malo of ["", "0", "-3"]) {
      await campo.fill(malo);
      await texto(h, /Requieren recontacto \(\d+\)/).click(); // tocar afuera del campo
      await toast(h, "entre 1 y 365").last().waitFor();
      await h.page.waitForFunction((el) => el.value === "30", await campo.elementHandle());
      assert.equal((await h.doc("clientes/" + idVasquito)).diasAlerta, 30, "con «" + malo + "» no se tiene que guardar");
    }

    // Tocar el campo y salir sin cambiarlo tampoco escribe
    await campo.click();
    await texto(h, /Requieren recontacto \(\d+\)/).click();

    // Un número válido se guarda y la tarjeta lo refleja
    await campo.fill("33");
    await texto(h, /Requieren recontacto \(\d+\)/).click();
    const doc = await esperarDoc(h, "clientes/" + idVasquito, (d) => d && d.diasAlerta === 33);
    assert.equal(doc.nombre, "Fiambrería El Vasquito");
    await texto(h, "31d sin pedir (límite: 33d)").waitFor();
    assert.equal(await h.page.locator('input[aria-label="Días de alerta de Fiambrería El Vasquito"]').inputValue(), "33");

    // Cliente con frecuencia automática: el campo no se edita y explica por qué
    const auto = h.page.locator('input[aria-label="Días de alerta de Carnicería Don Julio"]');
    assert.equal(await auto.inputValue(), "24");
    assert.equal(await auto.evaluate((el) => el.readOnly), true);
    await auto.click();
    await toast(h, "se calcula solo").waitFor();
    assert.equal((await h.doc("clientes/" + idJulio)).diasAlerta, 24);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

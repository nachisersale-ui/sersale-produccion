// Arreglos del área "base, historial de precios y productos"
// (src/pedidos/01-base-precios-productos.jsx y la cabecera de src/pedidos.html).
// Cada prueba maneja la pantalla real como una persona con el iPhone y después
// mira qué quedó guardado en Firestore y qué se ve.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed, CATALOGO, PRODUCTO_AGREGADO } from "./lib/seed.mjs";

const NOCHE = "2026-11-10T22:30:00-03:00"; // en UTC ya es el día siguiente
const CLIENTE = "Fiambrería Don Ángel";
const JAMON = "Jamón Cocido Natural Sublime"; // 4 precios guardados: 10.390, 10.990, 11.590 y 11.590
const copia = (o) => structuredClone(o);

/**
 * Abre pedidos.html como Director. Deja dos llaves para simular un servidor
 * que no contesta bien (cuota agotada, error pasajero):
 *   window.__fallarCatalogo = true  -> falla la lectura de config/productos
 *   window.__fallarListas   = true  -> fallan las lecturas de listas (getDocs)
 */
async function abrir({ seed = buildSeed(), now, antes } = {}) {
  const h = await launch({ rol: "director", etiqueta: "p1", seed, ...(now ? { now } : {}) });
  await h.context.addInitScript(() => {
    let real;
    const error = () => Promise.reject(Object.assign(new Error("Quota exceeded."), { code: "resource-exhausted", name: "FirebaseError" }));
    Object.defineProperty(window, "__fb", {
      configurable: true,
      get() { return real; },
      set(v) {
        real = {
          ...v,
          getDoc: (ref, ...r) => (window.__fallarCatalogo && ref && ref.path === "config/productos" ? error() : v.getDoc(ref, ...r)),
          getDocs: (q, ...r) => (window.__fallarListas ? error() : v.getDocs(q, ...r)),
        };
      },
    });
  });
  if (antes) await antes(h);
  await h.ir("pedidos.html");
  await h.page.getByText("¿Quién sos?").waitFor();
  h.seed = seed;
  return h;
}
const boton = (h, t) => h.page.locator("button", { hasText: t });
const texto = (h, t, o) => h.page.getByText(t, o);
const toast = (h, re) => h.page.locator(".ss-toast", { hasText: re });
const hoja = (h) => h.page.locator(".ss-hoja");
const llave = (h, nombre, valor) => h.page.evaluate(([n, v]) => { window[n] = v; }, [nombre, valor]);

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
/** Espera a que la colección cumpla una condición y devuelve sus documentos { id: datos }. */
async function esperarColeccion(h, nombre, cond, ms = 15000) {
  const fin = Date.now() + ms;
  let ultimo = null;
  while (Date.now() < fin) {
    ultimo = (await h.dump())[nombre] || {};
    if (cond(ultimo)) return ultimo;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("La colección " + nombre + " no llegó al estado esperado (" + Object.keys(ultimo || {}).length + " documentos)");
}
const preciosDe = (db, cliente, producto) =>
  Object.entries(db)
    .filter(([, p]) => p.cliente === cliente && (!producto || p.producto === producto))
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

// ── Navegación ──────────────────────────────────────────────────────────────
async function irAProductos(h) {
  await boton(h, "Agregar productos a cada categoría").click();
  await texto(h, "Gestión de Productos").waitFor();
}
async function irAPreciosDe(h, cliente) {
  await boton(h, "Agregar, editar y eliminar clientes").click();
  const fila = h.page.locator("div", { has: h.page.getByText(cliente, { exact: true }) }).filter({ has: h.page.locator("button", { hasText: "📈" }) }).last();
  await fila.locator("button", { hasText: "📈" }).click();
  await texto(h, "Precios — " + cliente).waitFor();
}
/** La tarjeta de un producto en el historial de precios. */
const tarjeta = (h, producto) => h.page.locator(`xpath=//div[./div/div/div[normalize-space(.)="${producto}"]]`);
const abrirCategoria = (h, cat) => texto(h, cat, { exact: true }).click();
const campoPrecio = (h) => h.page.locator('input[inputmode="decimal"]').last();

// ── Catálogo de productos ───────────────────────────────────────────────────

test("productos: si el catálogo no se pudo leer, no muestra la lista de fábrica ni pisa el catálogo guardado", async () => {
  const h = await abrir();
  try {
    const guardado = copia(h.seed.config.productos.categorias);
    assert.ok(guardado[PRODUCTO_AGREGADO.categoria].includes(PRODUCTO_AGREGADO.producto), "el catálogo guardado tiene un producto que no está en el código");

    await llave(h, "__fallarCatalogo", true);
    await irAProductos(h);
    await texto(h, "No se pudo cargar el catálogo de productos").waitFor();
    // Nada de la lista fija, ni botones para agregar o sacar.
    assert.equal(await texto(h, "Jamones Cocidos", { exact: true }).count(), 0);
    assert.equal(await boton(h, "+ Categoría").count(), 0);
    assert.equal(await boton(h, "+ Agregar producto").count(), 0);
    assert.deepEqual((await h.doc("config/productos")).categorias, guardado);

    // Vuelve la conexión: Reintentar trae el catálogo real, con el producto agregado.
    await llave(h, "__fallarCatalogo", false);
    await boton(h, "Reintentar").click();
    await texto(h, "10 categorías · 67 productos").waitFor();
    await abrirCategoria(h, PRODUCTO_AGREGADO.categoria);
    await texto(h, PRODUCTO_AGREGADO.producto, { exact: true }).waitFor();

    // Agregar un producto ahora no pierde nada de lo que ya estaba.
    await abrirCategoria(h, PRODUCTO_AGREGADO.categoria); // cierra
    await abrirCategoria(h, "Jamones Crudos y Bondiolas");
    await boton(h, "+ Agregar producto").click();
    await h.page.getByPlaceholder("Ej: Jamón Serrano").fill("Jamón Serrano");
    await boton(h, /^Agregar$/).click();
    await toast(h, /Producto agregado/).first().waitFor();
    const doc = await esperarDoc(h, "config/productos", (d) => d.categorias["Jamones Crudos y Bondiolas"].includes("Jamón Serrano"));
    const esperado = copia(guardado);
    esperado["Jamones Crudos y Bondiolas"].push("Jamón Serrano");
    assert.deepEqual(doc.categorias, esperado);
    await texto(h, "10 categorías · 68 productos").waitFor();
  } finally {
    await h.close();
  }
});

test("productos: lo que agregó o sacó otro teléfono no se pisa al guardar desde una pantalla vieja", async () => {
  const h = await abrir();
  try {
    await irAProductos(h);
    await texto(h, "10 categorías · 67 productos").waitFor();

    // Mientras esta pantalla está abierta, desde la PC agregan un producto y sacan otro.
    const otro = copia(h.seed.config.productos);
    otro.categorias["Quesos"].push("Queso Azul");
    otro.categorias["Cerdo y Varios"] = otro.categorias["Cerdo y Varios"].filter((p) => p !== "Ribs");
    otro.updatedAt = "2026-11-10T13:31:00.000Z";
    await h.sembrar({ config: { productos: otro } });

    // 1. Agregar un producto desde el teléfono.
    await abrirCategoria(h, "Pastas Finas");
    await boton(h, "+ Agregar producto").click();
    await h.page.getByPlaceholder("Ej: Jamón Serrano").fill("Mortadela con Pistacho");
    await boton(h, /^Agregar$/).click();
    await toast(h, /Producto agregado/).first().waitFor();
    let doc = await esperarDoc(h, "config/productos", (d) => d.categorias["Pastas Finas"].includes("Mortadela con Pistacho"));
    assert.ok(doc.categorias["Quesos"].includes("Queso Azul"), "sigue el producto que agregó la PC");
    assert.ok(!doc.categorias["Cerdo y Varios"].includes("Ribs"), "no revive el producto que sacó la PC");
    // La pantalla quedó al día con lo guardado.
    await texto(h, "10 categorías · 68 productos").waitFor();

    // 2. Otro cambio desde la PC y, desde el teléfono, eliminar un producto.
    const otro2 = copia(doc);
    otro2.categorias["Quesos"].push("Queso Brie");
    await h.sembrar({ config: { productos: otro2 } });
    await texto(h, "Mortadela Bocha", { exact: true }).waitFor();
    await h.page.getByRole("button", { name: "Eliminar Mortadela Bocha" }).click();
    await hoja(h).getByText("¿Eliminar el producto?").waitFor();
    await hoja(h).locator(".ss-btn", { hasText: "Eliminar" }).click();
    await toast(h, /Producto eliminado/).first().waitFor();
    doc = await esperarDoc(h, "config/productos", (d) => !d.categorias["Pastas Finas"].includes("Mortadela Bocha"));
    assert.ok(doc.categorias["Quesos"].includes("Queso Brie"));
    assert.ok(doc.categorias["Quesos"].includes("Queso Azul"));
    assert.ok(doc.categorias["Pastas Finas"].includes("Mortadela con Pistacho"));
    assert.equal(Object.keys(doc.categorias).length, 10);
    // Todo lo demás, igual que antes.
    for (const cat of ["Jamones Cocidos", "Embutidos Secos", "Pancetas y Ahumados"]) assert.deepEqual(doc.categorias[cat], h.seed.config.productos.categorias[cat]);

    // 3. Nueva categoría y repetidos (sin mirar acentos ni mayúsculas).
    await boton(h, "+ Categoría").click();
    await h.page.getByPlaceholder("Ej: Fiambres Importados").fill("quesos");
    await boton(h, "Crear categoría").click();
    await toast(h, /Ya existe esa categoría/).first().waitFor();
    assert.equal(await h.page.getByPlaceholder("Ej: Fiambres Importados").inputValue(), "quesos", "lo escrito sigue en el campo");
    await h.page.getByPlaceholder("Ej: Fiambres Importados").fill("Fiambres Importados");
    await boton(h, "Crear categoría").click();
    await toast(h, /Categoría creada/).first().waitFor();
    doc = await esperarDoc(h, "config/productos", (d) => "Fiambres Importados" in d.categorias);
    assert.deepEqual(doc.categorias["Fiambres Importados"], []);
    assert.equal(Object.keys(doc.categorias).length, 11);
    assert.equal(typeof doc.updatedAt, "string");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("productos: sin conexión avisa, no guarda y deja lo escrito; con conexión guarda una sola vez", async () => {
  const h = await abrir();
  try {
    const antes = copia(h.seed.config.productos);
    await irAProductos(h);
    await texto(h, "10 categorías · 67 productos").waitFor();
    await abrirCategoria(h, "Quesos");
    await boton(h, "+ Agregar producto").click();
    const campo = h.page.getByPlaceholder("Ej: Jamón Serrano");
    await campo.fill("Queso Fontina");

    await h.sinRed(true);
    await boton(h, /^Agregar$/).click();
    await toast(h, /Sin conexión: no se guardó/).first().waitFor();
    assert.equal(await campo.inputValue(), "Queso Fontina", "la hoja sigue abierta con lo escrito");
    assert.equal(await boton(h, /^Agregar$/).isEnabled(), true, "el botón no queda trabado en Guardando");

    await h.sinRed(false);
    await boton(h, /^Agregar$/).dblclick(); // doble toque: se guarda una sola vez
    await toast(h, /Producto agregado/).first().waitFor();
    const doc = await esperarDoc(h, "config/productos", (d) => d.categorias["Quesos"].includes("Queso Fontina"));
    assert.equal(doc.categorias["Quesos"].filter((p) => p === "Queso Fontina").length, 1);
    assert.deepEqual(doc.categorias["Quesos"], [...antes.categorias["Quesos"], "Queso Fontina"]);
    assert.equal(await campo.count(), 0, "la hoja se cerró");
  } finally {
    await h.close();
  }
});

test("productos: una categoría que solo tiene renglones vacíos se puede eliminar", async () => {
  const seed = buildSeed();
  seed.config.productos.categorias["Artículos Varios"] = [""];
  const h = await abrir({ seed });
  try {
    await irAProductos(h);
    const fila = h.page.locator("div", { has: h.page.getByText("Artículos Varios", { exact: true }) }).filter({ has: h.page.locator("button", { hasText: "Eliminar" }) }).last();
    await fila.locator("button", { hasText: "Eliminar" }).click();
    await hoja(h).getByText("¿Eliminar la categoría?").waitFor();
    await hoja(h).locator(".ss-btn", { hasText: "Eliminar" }).click();
    await toast(h, /Categoría eliminada/).first().waitFor();
    const doc = await esperarDoc(h, "config/productos", (d) => !("Artículos Varios" in d.categorias));
    assert.equal(Object.keys(doc.categorias).length, 9);
    assert.deepEqual(doc.categorias["Quesos"], CATALOGO["Quesos"]);
  } finally {
    await h.close();
  }
});

test("catálogo: un producto agregado en Productos se puede poner en precio desde la pestaña Precios", async () => {
  const h = await abrir();
  try {
    // El catálogo guardado tiene 67 productos; la lista fija del código, 66.
    await boton(h, "Panel general y cuentas corrientes").click();
    await boton(h, "💲 Precios").click();
    await h.page.locator("select").filter({ has: h.page.locator("option", { hasText: "Seleccioná un cliente" }) }).selectOption(CLIENTE);
    await texto(h, /de 67 productos con precio acordado/).waitFor();
    await texto(h, PRODUCTO_AGREGADO.producto, { exact: true }).first().waitFor();
    assert.equal(await h.page.evaluate(() => window.PRODUCTOS === window.__productosOverride), true);

    // Y uno recién agregado aparece sin recargar la página.
    await h.page.goBack(); // gesto "atrás": vuelve al inicio de Pedidos
    await texto(h, "¿Quién sos?").waitFor();
    await irAProductos(h);
    await abrirCategoria(h, "Quesos");
    await boton(h, "+ Agregar producto").click();
    await h.page.getByPlaceholder("Ej: Jamón Serrano").fill("Queso Fontina");
    await boton(h, /^Agregar$/).click();
    await toast(h, /Producto agregado/).first().waitFor();
    await h.page.getByRole("button", { name: "Volver" }).click();
    await boton(h, "Panel general y cuentas corrientes").click();
    await boton(h, "💲 Precios").click();
    await h.page.locator("select").filter({ has: h.page.locator("option", { hasText: "Seleccioná un cliente" }) }).selectOption(CLIENTE);
    await texto(h, /de 68 productos con precio acordado/).waitFor();
    await texto(h, "Queso Fontina", { exact: true }).first().waitFor();

    // La página también ofrece lo que pidieron otros arreglos (borrados en lote, lectura del servidor).
    const api = await h.page.evaluate(() => ({ lote: typeof window.__fb.writeBatch, servidor: typeof window.__fb.getDocsFromServer }));
    assert.deepEqual(api, { lote: "function", servidor: "function" });
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Importes ────────────────────────────────────────────────────────────────

test("importe: el punto del teclado vale como coma decimal y un importe pegado no se multiplica por 100", async () => {
  const h = await abrir({ now: NOCHE });
  try {
    await h.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await irAPreciosDe(h, CLIENTE);
    await tarjeta(h, JAMON).waitFor();
    await boton(h, "+ Nuevo").click();
    await texto(h, "Agregar precio").waitFor();
    await h.page.locator("select").last().selectOption("Queso Sardo");
    const campo = campoPrecio(h);

    // Escrito con punto decimal (teclado numérico de la PC, iPhone en otra región).
    await campo.click();
    await h.page.keyboard.type("8990.50");
    assert.equal(await campo.inputValue(), "8.990,50");
    // Un segundo punto o una segunda coma no rompen el número.
    await h.page.keyboard.type(".");
    assert.equal(await campo.inputValue(), "8.990,50");
    // Coma al principio: queda "0,5", no "5,".
    await campo.fill("");
    await h.page.keyboard.type(",5");
    assert.equal(await campo.inputValue(), "0,5");

    // Pegado desde el banco o una planilla, con punto o con coma decimal.
    for (const [pegado, visto] of [["152340.50", "152.340,5"], ["152.340,50", "152.340,5"], ["$ 8.990", "8.990"], ["8,990.75", "8.990,75"], ["9200.5", "9.200,5"]]) {
      await campo.fill("");
      await h.page.evaluate((t) => navigator.clipboard.writeText(t), pegado);
      await campo.click();
      await h.page.keyboard.press("Control+V");
      await h.page.waitForFunction((v) => document.querySelector('input[inputmode="decimal"]').value === v, visto).catch(() => {});
      assert.equal(await campo.inputValue(), visto, "pegando " + pegado);
    }

    await boton(h, "💾 Guardar").click();
    await toast(h, /Precio guardado/).first().waitFor();
    const db = await esperarColeccion(h, "precios_cliente", (c) => preciosDe(c, CLIENTE, "Queso Sardo").length === 1);
    const nuevo = preciosDe(db, CLIENTE, "Queso Sardo")[0];
    assert.equal(nuevo.precio, 9200.5);
    assert.equal(typeof nuevo.precio, "number");
    // Guardado a las 22:30 del 10/11: la fecha es el instante en UTC (formato de siempre)…
    assert.match(nuevo.fecha, /^2026-11-11T01:3\d:\d\d\.\d{3}Z$/);
    // …y en pantalla es 10/11, el día de Buenos Aires.
    const t = tarjeta(h, "Queso Sardo");
    await t.waitFor();
    await t.getByText("$9.200,5/kg").first().waitFor();
    await t.getByText("10/11/26").waitFor();
    assert.equal(Object.keys(db).length, Object.keys(h.seed.precios_cliente).length + 1);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Historial de precios ────────────────────────────────────────────────────

test("precios: la ✕ de la tarjeta saca el producto entero y la del renglón avisa qué precio queda vigente", async () => {
  const h = await abrir();
  try {
    const antes = preciosDe(h.seed.precios_cliente, CLIENTE);
    const delJamon = antes.filter((p) => p.producto === JAMON);
    assert.deepEqual(delJamon.map((p) => p.precio), [11590, 11590, 10990, 10390]);
    const delSalame = antes.filter((p) => p.producto === "Salame Tipo Milán");
    assert.deepEqual(delSalame.map((p) => p.precio).slice(0, 2), [14990, 14190]);

    await irAPreciosDe(h, CLIENTE);
    const tj = tarjeta(h, JAMON);
    await tj.waitFor();
    await tj.getByText("$11.590/kg").first().waitFor();
    // Mismo precio que el anterior: no es una baja.
    await tj.getByText("= igual que el anterior").waitFor();
    assert.equal(await h.page.getByText(/▼ 0/).count(), 0);
    // Las tarjetas vuelven a tener borde (variables de color que faltaban en la página).
    assert.equal(await tj.evaluate((el) => getComputedStyle(el).borderTopWidth + " " + getComputedStyle(el).borderTopColor), "1px rgb(216, 220, 224)");

    // 1. ✕ del renglón más nuevo del salame: borra ese solo y dice cuál queda.
    const ts = tarjeta(h, "Salame Tipo Milán");
    await ts.getByText("$14.990/kg").first().waitFor();
    await ts.getByRole("button", { name: /^Eliminar el precio del/ }).first().click();
    await hoja(h).getByText("¿Eliminar este precio?").waitFor();
    await hoja(h).getByText(/Salame Tipo Milán: \$14\.990 del 03\/11\/26\. Vuelve a quedar vigente el anterior: \$14\.190 del 13\/10\/26\./).waitFor();
    await hoja(h).locator(".ss-btn", { hasText: "Eliminar" }).click();
    await toast(h, /Precio eliminado/).first().waitFor();
    let db = await esperarColeccion(h, "precios_cliente", (c) => !(delSalame[0].id in c));
    assert.equal(preciosDe(db, CLIENTE, "Salame Tipo Milán").length, delSalame.length - 1);
    await ts.getByText("$14.190/kg").first().waitFor();

    // 2. ✕ de la tarjeta del jamón: cancelar no borra nada.
    await tj.getByRole("button", { name: "Sacar " + JAMON + " de los precios" }).click();
    await hoja(h).getByText("¿Sacar " + JAMON + " de los precios de este cliente?").waitFor();
    await hoja(h).getByText(/Se borran los 4 precios guardados de este producto/).waitFor();
    await hoja(h).locator(".ss-btn", { hasText: "Cancelar" }).click();
    await hoja(h).waitFor({ state: "detached" });
    assert.equal(preciosDe((await h.dump()).precios_cliente, CLIENTE, JAMON).length, 4);

    // 3. Aceptar: se van los 4 juntos y la tarjeta desaparece (no queda el precio viejo como vigente).
    await tj.getByRole("button", { name: "Sacar " + JAMON + " de los precios" }).click();
    await hoja(h).locator(".ss-btn", { hasText: "Borrar los 4" }).click();
    await toast(h, /Producto quitado de los precios/).first().waitFor();
    db = await esperarColeccion(h, "precios_cliente", (c) => preciosDe(c, CLIENTE, JAMON).length === 0);
    await tj.waitFor({ state: "detached" });
    // Los demás precios, del cliente y de los otros, no se tocaron.
    assert.equal(Object.keys(db).length, Object.keys(h.seed.precios_cliente).length - 5);
    for (const p of antes) {
      if (p.producto === JAMON || p.id === delSalame[0].id) continue;
      const { id, ...datos } = p;
      assert.deepEqual(db[id], datos, id);
    }
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("precios: si no se pudieron leer, lo dice y deja reintentar (no muestra 'Sin precios registrados')", async () => {
  const h = await abrir();
  try {
    await boton(h, "Agregar, editar y eliminar clientes").click();
    const fila = h.page.locator("div", { has: h.page.getByText(CLIENTE, { exact: true }) }).filter({ has: h.page.locator("button", { hasText: "📈" }) }).last();
    await fila.waitFor();
    await llave(h, "__fallarListas", true);
    await fila.locator("button", { hasText: "📈" }).click();
    await texto(h, "No se pudieron cargar los precios").waitFor();
    assert.equal(await texto(h, /Sin precios registrados/).count(), 0);

    await llave(h, "__fallarListas", false);
    await boton(h, "Reintentar").click();
    await tarjeta(h, JAMON).waitFor();
    assert.equal(await texto(h, "No se pudieron cargar los precios").count(), 0);

    // Buscar sin acentos encuentra; sin coincidencias no dice que el cliente no tiene precios.
    const buscar = h.page.getByPlaceholder("🔍 Buscar producto...");
    await buscar.fill("jamon cocido");
    await tarjeta(h, JAMON).waitFor();
    assert.equal(await tarjeta(h, "Salame Tipo Milán").count(), 0);
    await buscar.fill("zzz");
    await texto(h, 'Sin resultados para "zzz"').waitFor();
    assert.equal(await texto(h, /Sin precios registrados/).count(), 0);
  } finally {
    await h.close();
  }
});

test("precios: se ven los precios guardados con el nombre del cliente escrito distinto (mayúsculas, acentos)", async () => {
  // Un remito de un pedido cargado a mano como "fiambreria el vasquito" dejó su precio con ese nombre.
  const seed = buildSeed();
  seed.precios_cliente.pre_variante = { cliente: "fiambreria  el vasquito", producto: "Queso Tybo", precio: 9990, fecha: "2026-11-05T14:00:00.000Z" };
  const h = await abrir({ seed });
  try {
    await irAPreciosDe(h, "Fiambrería El Vasquito");
    const tj = tarjeta(h, "Queso Tybo");
    await tj.getByText("$9.990/kg").first().waitFor();
    await tj.getByText("05/11/26").waitFor();
    assert.equal(await texto(h, /Sin precios registrados/).count(), 0);
  } finally {
    await h.close();
  }
});

test("precios: sin conexión avisa y no guarda; al volver la señal se guarda una sola vez, sin cambiar el nombre del producto", async () => {
  const h = await abrir();
  try {
    const delJamon = preciosDe(h.seed.precios_cliente, CLIENTE, JAMON);
    await irAPreciosDe(h, CLIENTE);
    const tj = tarjeta(h, JAMON);
    await tj.getByText("$11.590/kg").first().click(); // tocar el precio abre "Editar precio"
    await texto(h, "Editar precio").waitFor();
    // El producto se muestra, no se puede reescribir (renombrar un renglón partía el historial).
    const modal = h.page.locator("div", { has: h.page.locator("h3", { hasText: "Editar precio" }) }).last();
    await modal.getByText(JAMON, { exact: true }).waitFor();
    assert.equal(await modal.locator("input, select").count(), 1, "el único campo es el precio");
    const campo = campoPrecio(h);
    assert.equal(await campo.inputValue(), "11.590");
    await campo.fill("12.250");

    await h.sinRed(true);
    await boton(h, "💾 Guardar").click();
    await toast(h, /Sin conexión: no se guardó/).first().waitFor();
    assert.equal(await campo.inputValue(), "12.250", "el formulario queda con lo escrito");
    assert.equal(await boton(h, "💾 Guardar").isEnabled(), true);
    assert.equal((await h.doc("precios_cliente/" + delJamon[0].id)).precio, 11590);

    await h.sinRed(false);
    await boton(h, "💾 Guardar").dblclick();
    await toast(h, /Precio guardado/).first().waitFor();
    const doc = await esperarDoc(h, "precios_cliente/" + delJamon[0].id, (d) => d.precio === 12250);
    assert.equal(doc.producto, JAMON);
    assert.equal(doc.cliente, CLIENTE);
    await tj.getByText("$12.250/kg").first().waitFor();
    await tj.getByText("▲ 5,7% vs anterior").waitFor();
    const db = (await h.dump()).precios_cliente;
    assert.equal(Object.keys(db).length, Object.keys(h.seed.precios_cliente).length, "no se duplicó ningún renglón");
    assert.equal(preciosDe(db, CLIENTE, JAMON).length, 4);
  } finally {
    await h.close();
  }
});

test("precios: con señal floja no queda en 'Guardando...' para siempre", async () => {
  const h = await abrir({
    antes: (h) =>
      h.context.addInitScript(() => {
        // Teléfono "con red" pero sin llegada real al servidor.
        Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => true });
      }),
  });
  try {
    await irAPreciosDe(h, CLIENTE);
    await tarjeta(h, JAMON).waitFor();
    await boton(h, "+ Nuevo").click();
    await h.page.locator("select").last().selectOption("Queso Sardo");
    await campoPrecio(h).fill("9.300");

    await h.sinRed(true);
    await boton(h, "💾 Guardar").click();
    await texto(h, "Guardando...").waitFor();
    await h.page.clock.fastForward(9000); // pasa el plazo de espera sin respuesta del servidor
    await toast(h, /Guardado en el teléfono/).first().waitFor();
    await texto(h, "Agregar precio").waitFor({ state: "detached" });

    // Vuelve la señal: el precio llega solo, una vez.
    await h.sinRed(false);
    const db = await esperarColeccion(h, "precios_cliente", (c) => preciosDe(c, CLIENTE, "Queso Sardo").length === 1, 30000);
    assert.equal(preciosDe(db, CLIENTE, "Queso Sardo")[0].precio, 9300);
    assert.equal(Object.keys(db).length, Object.keys(h.seed.precios_cliente).length + 1);
  } finally {
    await h.close();
  }
});

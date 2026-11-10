// Revisión independiente de depósito, alertas, hoja de ruta, vista director y devoluciones
// (src/pedidos/04-deposito-remitos-historial.jsx, 07-alertas-hoja-ruta.jsx y
// 08-director-devoluciones-app.jsx). Cada prueba reproduce, manejando la pantalla real,
// un defecto que quedaba después de los arreglos. Detalle en docs/auditoria/revision-deposito.md.
import test from "node:test";
import assert from "node:assert/strict";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

const copia = (o) => structuredClone(o);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const entradas = (o) => Object.entries(o || {});

const ANGEL = "Fiambrería Don Ángel";
const ROSA = "Almacén Doña Rosa";
const BUEN_SABOR = "Rotisería El Buen Sabor";
const GAMAS_BOEDO = "Panificadora Gamas - Sucursal Boedo";
const GAMAS_CABALLITO = "Panificadora Gamas - Sucursal Caballito";

// ── Ayudas ──────────────────────────────────────────────────────────────────

async function abrir({ rol = "operario", seed = buildSeed(), now, antes } = {}) {
  const h = await launch({ rol, etiqueta: "rvdep", seed, ...(now ? { now } : {}) });
  try {
    // `window.__pausarEscuchas = true` (ver congelarPantalla) hace que la pantalla deje de recibir
    // las novedades en vivo: un teléfono con señal lenta que todavía muestra el pedido como estaba.
    await h.context.addInitScript(() => {
      let real;
      Object.defineProperty(window, "__fb", {
        configurable: true,
        get() { return real; },
        set(v) {
          real = {
            ...v,
            onSnapshot: (q, ...resto) =>
              v.onSnapshot(q, ...resto.map((f) => (typeof f === "function" ? (...a) => { if (!window.__pausarEscuchas) f(...a); } : f))),
          };
        },
      });
    });
    if (antes) await antes(h);
    await h.ir("pedidos.html");
    await h.sincronizar();
  } catch (e) {
    await h.close(); // si la página no llegó a abrir, que no quede el navegador colgado
    throw e;
  }
  h.seed = seed;
  return h;
}
const VISTAS = {
  comercial: "Cargar y gestionar pedidos",
  director: "Panel general y cuentas corrientes",
  deposito: "Ver pedidos a preparar y despachar",
};
async function entrar(h, vista) {
  await h.page.getByText("¿Quién sos?").waitFor();
  await h.page.locator("button", { hasText: VISTAS[vista] }).click();
  if (vista === "director") await h.page.getByText("Activos", { exact: true }).first().waitFor();
  if (vista === "deposito") await h.page.getByText("Depósito", { exact: true }).waitFor();
}
const congelarPantalla = (h) => h.page.evaluate(() => { window.__pausarEscuchas = true; });
const boton = (h, t) => h.page.locator("button", { hasText: t });
const texto = (h, t, o) => h.page.getByText(t, o);
const toast = (h, re) => h.page.locator(".ss-toast", { hasText: re });
const botonHoja = (h, t) => h.page.locator(".ss-hoja .ss-btn", { hasText: t });
const camposKg = (h) => h.page.locator('input[placeholder="kg"]');

async function esperarDoc(h, ruta, cond, ms = 15000) {
  const fin = Date.now() + ms;
  let ultimo = null;
  while (Date.now() < fin) {
    ultimo = await h.doc(ruta);
    if (cond(ultimo)) return ultimo;
    await pausa(100);
  }
  throw new Error("El documento " + ruta + " no llegó al estado esperado: " + JSON.stringify(ultimo).slice(0, 400));
}
async function hastaQue(h, cond, que, ms = 20000) {
  const fin = Date.now() + ms;
  let db = null;
  while (Date.now() < fin) {
    db = await h.dump();
    if (cond(db)) return db;
    await pausa(120);
  }
  throw new Error("La base no llegó al estado esperado: " + que);
}
// Ruido conocido: cortes de red que provoca la propia prueba, choques de transacciones que el SDK
// reintenta solo (409) y el aviso de Firestore cuando el reloj fijo de la página queda unos
// milisegundos detrás del emulador ("update time that is in the future").
const sinRuidoDeRed = (errores) =>
  erroresReales(errores).filter((e) => !/offline|unavailable|Could not reach|ERR_INTERNET|ERR_CONNECTION|Failed to fetch|WebChannel|status of 409|net::ERR|update time that is in the future/i.test(e.texto));

// ── Depósito: kg desde dos teléfonos a la vez ───────────────────────────────

test("depósito: si Comercial le saca un producto al pedido mientras el operario anota los kg, los kg no quedan anotados en otro producto", async () => {
  const h = await abrir();
  try {
    const id = "ped_060"; // Fiambrería Don Ángel, pendiente: Jamón 12 kg, Queso Tybo 8 kg, Salamín 3 ganchos, Mortadela 2 unidades
    const antes = copia(h.seed.pedidos[id]);
    assert.deepEqual(antes.items.map((i) => i.producto).slice(0, 2), ["Jamón Cocido Natural Sublime", "Queso Tybo"]);
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, ANGEL, { exact: true }).first().click();
    await boton(h, "⚙️ En preparación").click();
    await texto(h, "Anotar kg por ítem").waitFor();
    await camposKg(h).nth(0).fill("12.3"); // el jamón
    await camposKg(h).nth(1).fill("8.1"); // el queso

    // Desde Comercial (otro teléfono) le sacan el jamón al pedido. La lista del depósito se actualiza sola.
    const editado = copia(antes);
    editado.items.shift();
    editado.editadoEn = "2026-11-10T13:31:00.000Z";
    await h.sembrar({ pedidos: { [id]: editado } });
    await texto(h, /3 productos/).first().waitFor();
    await pausa(400);

    // El operario, que no vio el cambio, confirma lo que tenía escrito (si la hoja sigue abierta).
    const confirmar = boton(h, "Confirmar — En preparación");
    if (await confirmar.count()) {
      await confirmar.click();
      await esperarDoc(h, "pedidos/" + id, (d) => d.estado === "preparando");
    }
    const doc = await h.doc("pedidos/" + id);
    const queso = doc.items.find((i) => i.producto === "Queso Tybo");
    const salamin = doc.items.find((i) => i.producto === "Salamín Picado Fino");
    assert.equal(doc.items.length, 3, "el pedido queda con los productos que dejó Comercial");
    assert.notEqual(queso.kgReal, 12.3, "los 12,3 kg eran del jamón: no pueden quedar anotados en el queso");
    assert.notEqual(salamin.kgReal, 8.1, "los 8,1 kg eran del queso: no pueden quedar anotados en el salamín");

    // Con la lista al día el operario anota de nuevo y queda bien.
    if (doc.estado === "pendiente") {
      await toast(h, /cambi/i).first().waitFor();
      await texto(h, "Anotar kg por ítem").waitFor({ state: "detached" });
      if (!(await boton(h, "⚙️ En preparación").count())) await texto(h, ANGEL, { exact: true }).first().click();
      await boton(h, "⚙️ En preparación").click();
      await texto(h, "Anotar kg por ítem").waitFor();
      assert.equal(await camposKg(h).count(), 3);
      assert.equal(await camposKg(h).nth(0).inputValue(), "", "la hoja arranca vacía");
      await camposKg(h).nth(0).fill("8.1");
      await boton(h, "Confirmar — En preparación").click();
      const final = await esperarDoc(h, "pedidos/" + id, (d) => d.estado === "preparando");
      assert.equal(final.items.find((i) => i.producto === "Queso Tybo").kgReal, 8.1);
      assert.equal(final.items.find((i) => i.producto === "Salamín Picado Fino").kgReal, null);
      assert.equal(final.editadoEn, editado.editadoEn);
    }
    assert.deepEqual(sinRuidoDeRed(h.errores), []);
  } finally {
    await h.close();
  }
});

test("depósito: dos teléfonos corrigiendo kg del mismo pedido listo: lo que guardó el otro no se pisa con el valor viejo", async () => {
  const h = await abrir();
  try {
    const id = "ped_055"; // Rotisería El Buen Sabor, listo: Pollo 20,26 · Pernil 9,76 · Mozzarella 5
    const antes = copia(h.seed.pedidos[id]);
    assert.deepEqual(antes.items.map((i) => i.kgReal), [20.26, 9.76, 5]);
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, BUEN_SABOR, { exact: true }).first().click();
    await boton(h, "⚖️ kg").click();
    await texto(h, "Editar kg — " + BUEN_SABOR).waitFor();
    assert.equal(await camposKg(h).nth(1).inputValue(), "9.76");

    // El director, desde su teléfono, corrige el pernil: pesaba 11,4.
    const otro = copia(antes);
    otro.items[1].kgReal = 11.4;
    await h.sembrar({ pedidos: { [id]: otro } });
    // La novedad llega sola al depósito: o se ve el kg nuevo en la tarjeta, o la hoja se cerró.
    await h.page.waitForFunction(() => /11[.,]4 kg real/.test(document.body.innerText) || !/Editar kg —/.test(document.body.innerText));
    await pausa(400);

    // El operario corrige el pollo y guarda (si su hoja sigue abierta).
    const guardar = boton(h, "✓ Guardar kg");
    if (await guardar.count()) {
      await camposKg(h).nth(0).fill("21");
      await guardar.click();
      await esperarDoc(h, "pedidos/" + id, (d) => d.items[0].kgReal === 21);
    }
    const doc = await h.doc("pedidos/" + id);
    assert.equal(doc.items[1].kgReal, 11.4, "el pernil queda con lo que guardó el director (antes volvía a 9,76 sin avisar)");

    // Si la hoja se cerró, se avisa por qué; al abrirla de nuevo trae los kg al día.
    if (doc.items[0].kgReal !== 21) {
      await toast(h, /cambi/i).first().waitFor();
      if (!(await boton(h, "⚖️ kg").count())) await texto(h, BUEN_SABOR, { exact: true }).first().click();
      await boton(h, "⚖️ kg").click();
      await texto(h, "Editar kg — " + BUEN_SABOR).waitFor();
      assert.equal(await camposKg(h).nth(1).inputValue(), "11.4");
      await camposKg(h).nth(0).fill("21");
      await boton(h, "✓ Guardar kg").click();
      const final = await esperarDoc(h, "pedidos/" + id, (d) => d.items[0].kgReal === 21);
      assert.deepEqual(final.items.map((i) => i.kgReal), [21, 11.4, 5]);
      // Lo que guardó este teléfono no vuelve a cerrar la tarjeta ni a avisar "cambió desde otro teléfono".
      await texto(h, /21 kg real/).first().waitFor();
      await pausa(600);
      assert.equal(await boton(h, "⚖️ kg").count(), 1, "la tarjeta sigue abierta después de guardar los kg propios");
    }
    assert.deepEqual(sinRuidoDeRed(h.errores), []);
  } finally {
    await h.close();
  }
});

test("depósito con señal lenta: el kg que el director corrigió un momento antes (y que esta pantalla todavía no mostraba) no se pisa", async () => {
  const h = await abrir();
  try {
    const id = "ped_055"; // Rotisería El Buen Sabor, listo: Pollo 20,26 · Pernil 9,76 · Mozzarella 5
    const antes = copia(h.seed.pedidos[id]);
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, BUEN_SABOR, { exact: true }).first().click();
    await boton(h, "⚖️ kg").click();
    await texto(h, "Editar kg — " + BUEN_SABOR).waitFor();

    // La novedad del otro teléfono todavía no llegó a esta pantalla.
    await congelarPantalla(h);
    const otro = copia(antes);
    otro.items[1].kgReal = 11.4;
    await h.sembrar({ pedidos: { [id]: otro } });

    await camposKg(h).nth(0).fill("21");
    await boton(h, "✓ Guardar kg").click();
    const doc = await esperarDoc(h, "pedidos/" + id, (d) => d.items[0].kgReal === 21);
    assert.deepEqual(doc.items.map((i) => i.kgReal), [21, 11.4, 5], "se guarda solo el kg que el operario cambió; el pernil queda como lo dejó el director");
    assert.equal(doc.historial.length, antes.historial.length + 1);
  } finally {
    await h.close();
  }
});

test("depósito sin señal: la hoja de kg no se cierra ni pierde lo escrito, y al volver la señal se guarda", async () => {
  const h = await abrir();
  try {
    const id = "ped_064"; // Almacén Doña Rosa, pendiente, 3 ítems
    const antes = copia(h.seed.pedidos[id]);
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, ROSA, { exact: true }).first().click();
    await boton(h, "⚙️ En preparación").click();
    await texto(h, "Anotar kg por ítem").waitFor();
    await camposKg(h).nth(0).fill("2.1");
    await camposKg(h).nth(1).fill("3.05");
    await camposKg(h).nth(2).fill("4.2");

    await h.sinRed(true);
    await boton(h, "Confirmar — En preparación").click();
    await toast(h, /Sin conexión/).first().waitFor();
    await pausa(2500); // la hoja se cerraba sola a los 1,5 s
    assert.equal(await texto(h, "Anotar kg por ítem").count(), 1, "la hoja sigue abierta: no se guardó nada");
    assert.deepEqual([await camposKg(h).nth(0).inputValue(), await camposKg(h).nth(1).inputValue(), await camposKg(h).nth(2).inputValue()], ["2.1", "3.05", "4.2"]);
    assert.equal((await h.doc("pedidos/" + id)).estado, "pendiente");

    await h.sinRed(false);
    await boton(h, "Confirmar — En preparación").click();
    const doc = await esperarDoc(h, "pedidos/" + id, (d) => d.estado === "preparando");
    assert.deepEqual(doc.items.map((i) => i.kgReal), [2.1, 3.05, 4.2]);
    assert.equal(doc.historial.length, antes.historial.length + 1);
    await texto(h, "Anotar kg por ítem").waitFor({ state: "detached" });
    // Con la señal normal la tarjeta pasa sola a «En preparación»: no hay aviso de "lista atrasada".
    await texto(h, /2[.,]1 kg real/).first().waitFor({ state: "attached" }).catch(() => {});
    assert.equal(await toast(h, /todavía no se actualizó/).count(), 0);
    assert.deepEqual(sinRuidoDeRed(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Depósito: la señal se corta justo al confirmar ──────────────────────────

test("depósito: si la respuesta del servidor se pierde al marcar «Listo», no dice que lo cambió otro teléfono y queda un solo cambio", async () => {
  const h = await abrir();
  try {
    const id = "ped_057"; // Panificadora Gamas - Sucursal Boedo, preparando, 3 ítems
    const antes = copia(h.seed.pedidos[id]);
    const red = await h.redQueSeCorta();
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, GAMAS_BOEDO, { exact: true }).first().click();
    await boton(h, "📋 Ítems").click();
    for (const it of antes.items) await h.page.locator("button", { hasText: it.producto }).first().click();
    await texto(h, "3 de 3 ítems listos").waitFor();

    red.perder = 1;
    await boton(h, "Marcar como Listo").click();
    const doc = await esperarDoc(h, "pedidos/" + id, (d) => d.estado === "listo");
    await texto(h, "Depósito · Vista Operario").waitFor();
    await toast(h, /listo para despachar/).first().waitFor();
    assert.equal(red.perdidas, 1, "la prueba cortó la respuesta de la primera confirmación");
    assert.equal(await toast(h, /Otro teléfono|otro teléfono/).count(), 0, "nadie más tocó el pedido: no hay que decir que lo cambió otro teléfono");
    assert.equal(await toast(h, /todavía no se actualizó/).count(), 0, "la lista ya muestra el pedido como listo");
    assert.equal(doc.historial.length, antes.historial.length + 1, "un solo cambio de estado en el historial");
    assert.deepEqual(doc.items, antes.items);
  } finally {
    await h.close();
  }
});

test("depósito (director): al cancelar con la señal cortada justo al confirmar, el «Pendiente de facturar» igual sale de la cuenta", async () => {
  const seed = buildSeed();
  const [id, pedido] = entradas(seed.pedidos).find(([, p]) => p.cliente === GAMAS_CABALLITO && p.estado === "pendiente");
  const esPendiente = (m) => m.tipo === "pedido" && m.origen === "pedido_app" && m.monto === 0 && m.remitoNro == null;
  const [pendId] = entradas(seed.cc_movimientos).find(([, m]) => norm(m.cliente) === norm(GAMAS_CABALLITO) && esPendiente(m) && m.fecha === pedido.fechaEntrega);
  const h = await abrir({ rol: "director", seed });
  try {
    const red = await h.redQueSeCorta();
    await entrar(h, "deposito");
    await h.page.locator("span", { hasText: GAMAS_CABALLITO }).first().click();
    await boton(h, "❌").click();
    red.perder = 1;
    await botonHoja(h, "Cancelar pedido").click();
    await esperarDoc(h, "pedidos/" + id, (d) => d.estado === "cancelado");
    const db = await hastaQue(h, (d) => !d.cc_movimientos[pendId], "el pendiente de facturar del pedido cancelado sale de la cuenta");
    assert.equal(red.perdidas, 1);
    assert.equal(db.pedidos[id].historial.filter((x) => x.estado === "cancelado").length, 1);
    assert.equal(await toast(h, /otro teléfono/i).count(), 0);
  } finally {
    await h.close();
  }
});

test("depósito: corregir kg con la señal cortada al confirmar no deja el cambio anotado dos veces en el historial", async () => {
  const h = await abrir();
  try {
    const id = "ped_055"; // Rotisería El Buen Sabor, listo
    const antes = copia(h.seed.pedidos[id]);
    const red = await h.redQueSeCorta();
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, BUEN_SABOR, { exact: true }).first().click();
    await boton(h, "⚖️ kg").click();
    await texto(h, "Editar kg — " + BUEN_SABOR).waitFor();
    await camposKg(h).nth(0).fill("21");
    red.perder = 1;
    await boton(h, "✓ Guardar kg").click();
    await esperarDoc(h, "pedidos/" + id, (d) => d.items[0].kgReal === 21);
    await texto(h, "Editar kg — " + BUEN_SABOR).waitFor({ state: "detached" });
    await pausa(500);
    const doc = await h.doc("pedidos/" + id);
    assert.equal(red.perdidas, 1);
    assert.equal(doc.historial.length, antes.historial.length + 1, "un solo renglón en el historial (antes quedaban dos)");
    assert.deepEqual(doc.items.map((i) => i.kgReal), [21, 9.76, 5]);
  } finally {
    await h.close();
  }
});

// ── Depósito: las novedades no llegan pero el guardado sí ───────────────────

test("depósito con las novedades cortadas: el cambio se guarda, se avisa que la lista está atrasada y repetirlo no culpa a otro teléfono", async () => {
  const h = await abrir();
  const p = h.page;
  try {
    const id = "ped_064"; // Almacén Doña Rosa, pendiente
    const antes = copia(h.seed.pedidos[id]);
    await texto(h, "Depósito · Vista Operario").waitFor();
    await texto(h, ROSA, { exact: true }).first().waitFor();

    // Señal entrecortada: el canal por el que llegan las novedades se cae; los guardados sí pasan.
    await h.cortarEscucha();
    await h.sinRed(true);
    await pausa(300);
    await h.sinRed(false);
    for (let i = 0; i < 10; i++) { await p.clock.runFor(1500); await pausa(120); }

    await texto(h, ROSA, { exact: true }).first().click();
    await boton(h, "⚙️ En preparación").click();
    await texto(h, "Anotar kg por ítem").waitFor();
    await camposKg(h).nth(0).fill("2.1");
    await boton(h, "Confirmar — En preparación").click();
    await adelantandoHasta(p, async () => (await h.doc("pedidos/" + id)).estado === "preparando", "el cambio queda guardado en el servidor");
    const guardado = await h.doc("pedidos/" + id);
    assert.equal(guardado.items[0].kgReal, 2.1);

    // La tarjeta sigue en «Pendientes» (la novedad no llegó): tiene que avisar que igual quedó guardado.
    await adelantandoHasta(p, hay(toast(h, /Guardado.*todavía no se actualizó/)), "aviso de que quedó guardado aunque la lista no cambie");
    await adelantandoHasta(p, async () => (await texto(h, "Anotar kg por ítem").count()) === 0, "la hoja se cierra");

    // Si igual lo repite, no se le dice que fue otro teléfono ni que pruebe de nuevo (daría siempre lo mismo).
    if (!(await boton(h, "⚙️ En preparación").count())) await texto(h, ROSA, { exact: true }).first().click();
    await boton(h, "⚙️ En preparación").click();
    await texto(h, "Anotar kg por ítem").waitFor();
    await boton(h, "Confirmar — En preparación").click();
    await adelantandoHasta(p, hay(toast(h, /ya está en preparación/)), "aviso de que ya estaba en preparación");
    assert.equal(await toast(h, /Otro teléfono ya cambió/).count(), 0);
    const final = await h.doc("pedidos/" + id);
    assert.equal(final.historial.length, antes.historial.length + 1, "un solo cambio guardado");
    assert.equal(final.items[0].kgReal, 2.1, "los kg del primer guardado siguen");
  } finally {
    await h.close();
  }
});

// ── Depósito: teléfono sin datos guardados ──────────────────────────────────

/** Adelanta el reloj de la página (las esperas y reintentos internos duran varios segundos) hasta que `fn` se cumpla. */
async function adelantandoHasta(p, fn, que, pasos = 80) {
  for (let i = 0; i < pasos; i++) {
    if (await fn()) return;
    await p.clock.runFor(1500);
    await pausa(200);
  }
  throw new Error("No se cumplió: " + que);
}
const hay = (loc) => async () => (await loc.count()) > 0;

test("depósito: un teléfono sin pedidos guardados que no logra conectar no afirma «No hay pedidos»; al conectar la lista aparece sola", async () => {
  const h = await launch({ rol: "operario", etiqueta: "rvdep", seed: buildSeed() });
  const p = h.page;
  try {
    // Primer uso en este teléfono (nada guardado) y el canal de novedades no conecta.
    const corte = await h.cortarEscucha();
    await p.goto(h.origin + "/pedidos.html");
    await texto(h, "Depósito · Vista Operario").waitFor();
    const pantalla = () => p.locator("#root").innerText();
    await adelantandoHasta(p, async () => /No hay pedidos en este estado|No se pudieron cargar/.test(await pantalla()), "la pantalla deja de decir «Cargando...»");
    assert.ok(!/No hay pedidos en este estado/.test(await pantalla()), "en la base hay 10 pedidos activos: la pantalla no puede afirmar que no hay ninguno");
    assert.match(await pantalla(), /No se pudieron cargar los pedidos/);
    assert.equal(await boton(h, "Reintentar").count(), 1);

    // Cuando el teléfono logra conectar, los pedidos aparecen sin tocar nada.
    corte.activo = false;
    await adelantandoHasta(p, hay(texto(h, ANGEL, { exact: true })), "la lista aparece sola al conectar");
    assert.equal(await texto(h, "No se pudieron cargar los pedidos.").count(), 0);
  } finally {
    await h.close();
  }
});

// ── Devoluciones ────────────────────────────────────────────────────────────

const nuevos = (db, seed, col) => entradas(db[col]).filter(([id]) => !(id in (seed[col] || {}))).map(([id, d]) => ({ id, ...d }));
const btnRegistrar = (h) => boton(h, "Registrar devolución");
const campoCredito = (h) => h.page.locator('input[aria-label="Crédito a favor"]');
async function abrirDevoluciones(h) {
  await boton(h, "Devol.").click();
  await boton(h, "+ Nueva").waitFor();
  await texto(h, "Resueltas", { exact: true }).first().waitFor(); // ya cargó la lista
}
async function llenarDevolucion(h, { cliente, producto, cantidad, motivo = "Producto en mal estado", monto }) {
  await boton(h, "+ Nueva").click();
  await texto(h, "Nueva Devolución").waitFor();
  await h.page.locator('select[aria-label="Cliente de la devolución"]').selectOption({ label: cliente });
  await h.page.locator('input[placeholder="Ej: Jamón cocido"]').fill(producto);
  if (cantidad != null) await h.page.locator('input[aria-label="Cantidad devuelta"]').fill(String(cantidad));
  await h.page.locator('select[aria-label="Motivo de la devolución"]').selectOption(motivo);
  if (monto != null) await campoCredito(h).fill(String(monto));
}

test("devolución: dice «No se pudo registrar» pero el servidor la había guardado; al corregir el importe y reintentar no quedan dos devoluciones ni dos créditos", async () => {
  const seed = buildSeed();
  const saldoAntes = seed.cuentas_corrientes.cc_01.saldo; // Fiambrería Don Ángel
  const h = await abrir({ rol: "director", seed });
  const p = h.page;
  try {
    const red = await h.redQueSeCorta();
    await entrar(h, "director");
    await abrirDevoluciones(h);
    await llenarDevolucion(h, { cliente: ANGEL, producto: "Queso Tybo", cantidad: "2", monto: "15000" });

    // Se corta la señal justo al confirmar: el servidor guarda, el teléfono no se entera y no puede reintentar.
    red.perder = 1;
    red.luegoSinSenal = true;
    await btnRegistrar(h).click();
    await adelantandoHasta(p, hay(toast(h, /No se pudo registrar/)), "aviso de que no se pudo registrar");
    assert.equal(red.perdidas, 1);
    let db = await h.dump();
    assert.equal(nuevos(db, seed, "devoluciones").length, 1, "el servidor sí la había guardado");
    assert.equal(db.cuentas_corrientes.cc_01.saldo, saldoAntes - 15000);
    await texto(h, "Nueva Devolución").waitFor(); // el formulario sigue abierto con lo cargado

    // Vuelve la señal. La persona ve que el importe estaba mal, lo corrige y registra de nuevo.
    red.caida = false;
    await campoCredito(h).fill("16000");
    await btnRegistrar(h).click();
    await adelantandoHasta(p, hay(toast(h, /Devolución registrada/)), "devolución registrada");

    db = await h.dump();
    const devs = nuevos(db, seed, "devoluciones");
    assert.equal(devs.length, 1, "una sola devolución (antes quedaban dos: la de $15.000 y la de $16.000)");
    assert.equal(devs[0].monto, 16000);
    const movs = nuevos(db, seed, "cc_movimientos");
    assert.equal(movs.length, 1, "un solo crédito en la cuenta");
    assert.equal(movs[0].monto, 16000);
    assert.equal(movs[0].movimiento, -16000);
    assert.equal(db.cuentas_corrientes.cc_01.saldo, saldoAntes - 16000, "el saldo baja $16.000, no $31.000");
  } finally {
    await h.close();
  }
});

test("devolución con crédito: si el teléfono no se enteró de que el cliente ya tiene cuenta, no la registra «sin crédito»", async () => {
  const seed = buildSeed();
  assert.ok(!Object.values(seed.cuentas_corrientes).some((c) => norm(c.nombre) === norm(BUEN_SABOR)), "en los datos de ejemplo no tiene cuenta");
  const h = await abrir({ rol: "director", seed });
  const p = h.page;
  try {
    await entrar(h, "director"); // este teléfono ya tiene guardadas las cuentas corrientes (sin la de El Buen Sabor)
    await abrirDevoluciones(h);

    // El canal por el que llegan las novedades deja de conectar (señal entrecortada) y se vuelve a abrir la app.
    const corte = await h.cortarEscucha();
    await p.reload();
    await adelantandoHasta(p, hay(boton(h, "Devol.")), "panel del director abierto con lo guardado en el teléfono");
    // Mientras tanto, desde otro teléfono le abren la cuenta corriente (debe $50.000).
    await h.sembrar({ cuentas_corrientes: { cta_rotiseria_el_buen_sabor: { nombre: BUEN_SABOR, saldo: 50000, creadoEn: "2026-11-10T13:20:00.000Z", ultimoMovimiento: "2026-11-10" } } });

    await boton(h, "Devol.").click();
    await adelantandoHasta(p, hay(texto(h, "Resueltas", { exact: true })), "lista de devoluciones");
    await llenarDevolucion(h, { cliente: BUEN_SABOR, producto: "Pollo", cantidad: "3", monto: "8000" });
    await btnRegistrar(h).click();
    const hojaSinCuenta = p.locator(".ss-hoja", { hasText: "no tiene cuenta corriente" });
    const avisoError = toast(h, /No se pudo registrar/);
    await adelantandoHasta(p, async () => (await hojaSinCuenta.count()) + (await avisoError.count()) > 0, "pregunta o aviso");
    if (await hojaSinCuenta.count()) {
      // La pantalla afirma que no tiene cuenta: la persona le cree y registra sin crédito.
      await botonHoja(h, "Registrar sin crédito").click();
      await adelantandoHasta(p, hay(toast(h, /Devolución registrada/)), "devolución registrada");
    }
    let db = await h.dump();
    assert.deepEqual(nuevos(db, seed, "devoluciones").filter((d) => d.creditoAsentado === false), [],
      "el cliente SÍ tiene cuenta corriente: la devolución no puede quedar guardada «sin crédito» por una copia vieja del teléfono");
    assert.equal(nuevos(db, seed, "devoluciones").length, 0, "sin poder consultar la cuenta no se registra nada");
    await texto(h, "Nueva Devolución").waitFor(); // el formulario queda cargado

    // Vuelve la conexión: ahora sí, con el crédito en la cuenta.
    corte.activo = false;
    await adelantandoHasta(p, async () => {
      if (nuevos(await h.dump(), seed, "devoluciones").length) return true;
      // Mientras el teléfono no vuelva a conectar sigue avisando que no pudo; la persona insiste.
      const libre = await p.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "Registrar devolución" && !b.disabled));
      if (libre) await btnRegistrar(h).click({ timeout: 3000 }).catch(() => {});
      return false;
    }, "devolución registrada con crédito");
    await adelantandoHasta(p, async () => (await p.getByText("Nueva Devolución").count()) === 0, "el formulario se cierra al quedar registrada");
    db = await h.dump();
    const devs = nuevos(db, seed, "devoluciones");
    assert.equal(devs.length, 1);
    assert.equal(devs[0].creditoAsentado, true);
    assert.equal(db.cuentas_corrientes.cta_rotiseria_el_buen_sabor.saldo, 42000, "$50.000 menos el crédito de $8.000");
    assert.equal(nuevos(db, seed, "cc_movimientos").filter((m) => m.origen === "devolucion").length, 1);
  } finally {
    await h.close();
  }
});

// ── Alertas de recontacto ───────────────────────────────────────────────────

/** Tarjeta de un cliente en la pestaña Alertas. */
const tarjetaAlerta = (h, cliente) => h.page.getByText(cliente, { exact: true }).locator("xpath=ancestor::div[.//input[@type='number']][1]");
const fichaVencida = (nombre) => ({
  nombre, telefono: "", direccion: "", cuentaCorriente: false, creadoEn: { __ts: "2026-09-01T12:00:00.000Z" },
  diasAlerta: 14, ultimoContacto: "2026-10-20T15:00:00.000Z", ultimoPedidoRegistrado: "2026-10-20",
});

test("alertas: «✓ Contactado» de un cliente cargado dos veces (con y sin acentos) queda marcado: no vuelve a aparecer al reabrir el panel", async () => {
  const seed = buildSeed();
  // El mismo cliente, cargado dos veces a lo largo de los años (el sistema anterior los tomaba como dos).
  seed.clientes.cli_rv1 = fichaVencida("Almacén Güemes Sur");
  seed.clientes.cli_rv2 = fichaVencida("Almacen Guemes Sur");
  const h = await abrir({ rol: "director", seed });
  try {
    await entrar(h, "director");
    await boton(h, "🔔 Alertas").click();
    const tarjeta = tarjetaAlerta(h, "Almacén Güemes Sur");
    await tarjeta.waitFor();
    assert.match(await tarjeta.innerText(), /21d sin pedir/);
    assert.equal(await texto(h, "Almacen Guemes Sur", { exact: true }).count(), 0, "es un solo cliente: una sola tarjeta");

    await tarjeta.locator("button", { hasText: "Contactado" }).click();
    await tarjeta.waitFor({ state: "detached" });
    const db = await hastaQue(h, (d) => [d.clientes.cli_rv1, d.clientes.cli_rv2].some((c) => (c.ultimoContacto || "") > "2026-11-10"), "contacto guardado en alguna de las dos fichas");
    assert.equal([db.clientes.cli_rv1, db.clientes.cli_rv2].filter((c) => (c.ultimoContacto || "") > "2026-11-10").length, 1);

    // Al día siguiente (o al volver a entrar al panel) el cliente no puede seguir "vencido".
    await boton(h, "←").first().click();
    await entrar(h, "director");
    await boton(h, "🔔 Alertas").click();
    await texto(h, /Requieren recontacto \(\d+\)/).waitFor();
    await pausa(500);
    assert.equal(await texto(h, "Almacén Güemes Sur", { exact: true }).count(), 0, "ya fue contactado hoy: no tiene que volver a la lista de recontactos");
    assert.deepEqual(sinRuidoDeRed(h.errores), []);
  } finally {
    await h.close();
  }
});

test("alertas: si «✓ Contactado» no se pudo guardar, se avisa y el cliente sigue en la lista", async () => {
  const seed = buildSeed();
  seed.clientes.cli_rv1 = fichaVencida("Despensa La Esquina");
  const h = await abrir({ rol: "director", seed });
  try {
    await entrar(h, "director");
    await boton(h, "🔔 Alertas").click();
    const tarjeta = tarjetaAlerta(h, "Despensa La Esquina");
    await tarjeta.waitFor();

    // El servidor rechaza la escritura de la ficha (lo que le pasa a la app cuando un guardado falla).
    await h.page.evaluate(() => {
      window.__updateDocReal = window.__fb.updateDoc;
      window.__fb.updateDoc = (ref, ...resto) => (/^clientes\//.test(ref.path) ? Promise.reject(new Error("rechazado (prueba)")) : window.__updateDocReal(ref, ...resto));
    });
    await tarjeta.locator("button", { hasText: "Contactado" }).click();
    await toast(h, /No se pudo marcar/).first().waitFor();
    await tarjeta.waitFor();
    assert.equal((await h.doc("clientes/cli_rv1")).ultimoContacto, "2026-10-20T15:00:00.000Z", "no se guardó nada");

    // Cuando el guardado anda, se marca y sale de la lista.
    await h.page.evaluate(() => { window.__fb.updateDoc = window.__updateDocReal; });
    await tarjeta.locator("button", { hasText: "Contactado" }).click();
    await tarjeta.waitFor({ state: "detached" });
    await esperarDoc(h, "clientes/cli_rv1", (d) => (d.ultimoContacto || "") > "2026-11-10");
  } finally {
    await h.close();
  }
});

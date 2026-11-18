// Revisión independiente de la capa compartida: datos (js/fb.js), interfaz
// (js/shell.js), sesión, app instalada y compilación. Cada prueba reproduce,
// con las páginas reales y una red que falla a propósito, un defecto que
// quedaba después de los arreglos. Detalle en docs/auditoria/revision-infra.md.
import test from "node:test";
import assert from "node:assert/strict";
import { launch } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";

// ── Ayudas ───────────────────────────────────────────────────────────────────

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
/** Espera (consultando cada tanto) a que `fn` devuelva algo verdadero. */
async function hasta(fn, que = "la condición", ms = 20000) {
  const fin = Date.now() + ms;
  let ultimo;
  for (;;) {
    try {
      ultimo = await fn();
      if (ultimo) return ultimo;
    } catch (e) {
      ultimo = e;
    }
    if (Date.now() > fin) throw new Error("No se cumplió: " + que + " (último valor: " + (ultimo instanceof Error ? ultimo.message : JSON.stringify(ultimo)) + ")");
    await pausa(80);
  }
}
const cartel = (p) => p.locator(".ss-sin-conexion");
/**
 * Abre el navegador y prepara la pantalla con `preparar(h)`. Si la preparación
 * falla, cierra todo antes de avisar (si no, la corrida queda colgada) y dice
 * en qué estaba la copia de datos y qué errores tiró la página.
 */
async function abrirCon(opciones, preparar) {
  const h = await launch({ rol: "director", etiqueta: "revinfra", ...opciones });
  try {
    await preparar(h);
    return h;
  } catch (e) {
    const estado = await h.page.evaluate(() => (window.__sersaleDatos ? window.__sersaleDatos.estado() : null)).catch(() => null);
    e.message += "\n[preparación] copia de datos: " + JSON.stringify(estado) + "\n[preparación] errores de la página: " + JSON.stringify(h.errores.slice(0, 5));
    await h.close();
    throw e;
  }
}

const SEED_CHICO = {
  clientes: {
    c1: { nombre: "Almacén Don Pepe", direccion: "Caseros 100" },
    c2: { nombre: "Carnicería El Toro", direccion: "" },
  },
  cuentas_corrientes: { cc1: { nombre: "Almacén Don Pepe", saldo: 1000 } },
};

// ── 1. Hoja de confirmación y doble toque ────────────────────────────────────

function abrirStock() {
  return abrirCon({ seed: buildSeed() }, async (h) => {
    const p = h.page;
    await h.ir("produccion.html");
    await p.getByRole("button", { name: "Vista Director" }).click();
    await p.getByText("Panel Director").waitFor();
    await p.getByRole("button", { name: /📦 Stock/ }).first().click();
    await p.locator("button", { hasText: /^🗑️$/ }).first().waitFor();
  });
}
const cuantosEnStock = async (h) => Object.keys((await h.dump()).stock_produccion).length;
/** Dos toques seguidos en el mismo punto, como un doble toque con el dedo. */
async function dobleToque(p, x, y, ms = 180) {
  await p.touchscreen.tap(x, y);
  await pausa(ms);
  await p.touchscreen.tap(x, y);
}

test("hoja: un doble toque en 🗑️ no confirma solo el borrado (el segundo toque caía en «Eliminar»)", async () => {
  const h = await abrirStock();
  const p = h.page;
  try {
    const antes = await cuantosEnStock(h);
    // Dónde aparece el botón «Eliminar» de la hoja en este teléfono.
    await p.locator("button", { hasText: /^🗑️$/ }).first().click();
    const eliminar = p.locator(".ss-hoja .ss-btn", { hasText: "Eliminar" });
    await eliminar.waitFor();
    await pausa(400);
    const zona = await eliminar.boundingBox();
    await p.locator(".ss-hoja .ss-btn", { hasText: "Cancelar" }).click();
    await p.locator(".ss-fondo").waitFor({ state: "detached" });
    const barra = await p.locator("#sersale_nav").boundingBox();
    assert.ok(zona.y < barra.y, "el botón de la hoja empieza más arriba que la barra de secciones");

    // Se desliza la lista hasta que un 🗑️ quede justo arriba de la barra de secciones,
    // en el mismo lugar donde después aparece «Eliminar».
    const punto = await p.evaluate(({ zonaY, barraY }) => {
      const tachos = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "🗑️");
      const b = tachos[tachos.length - 3];
      const r = b.getBoundingClientRect();
      window.scrollBy(0, r.top - (zonaY - 8));
      const r2 = b.getBoundingClientRect();
      const y = (Math.max(r2.top, zonaY) + Math.min(r2.bottom, barraY)) / 2;
      const x = r2.left + r2.width / 2;
      const hay = document.elementFromPoint(x, y);
      return { x, y, esElTacho: hay === b || b.contains(hay) };
    }, { zonaY: zona.y, barraY: barra.y });
    assert.ok(punto.esElTacho, "el punto del toque está sobre el 🗑️");
    assert.ok(punto.x > zona.x && punto.x < zona.x + zona.width && punto.y > zona.y, "y coincide con el lugar de «Eliminar»");

    await dobleToque(p, punto.x, punto.y);
    await pausa(1200);
    assert.equal(await cuantosEnStock(h), antes, "no se borró ningún ítem sin que la persona lo confirme");
    assert.equal(await p.locator(".ss-hoja", { hasText: "¿Eliminar este ítem?" }).count(), 1, "la pregunta sigue en pantalla, esperando la respuesta");

    // Y la hoja sigue andando: pasado el primer instante, «Eliminar» borra.
    await eliminar.click();
    await hasta(async () => (await cuantosEnStock(h)) === antes - 1, "que se borre al confirmar");
  } finally {
    await h.close();
  }
});

test("hoja: un doble toque en «Eliminar» no cambia de sección (el segundo toque caía en la barra de abajo)", async () => {
  const h = await abrirStock();
  const p = h.page;
  try {
    const antes = await cuantosEnStock(h);
    await p.locator("button", { hasText: /^🗑️$/ }).first().click();
    const eliminar = p.locator(".ss-hoja .ss-btn", { hasText: "Eliminar" });
    await eliminar.waitFor();
    await pausa(600);
    const zona = await eliminar.boundingBox();
    const barra = await p.locator("#sersale_nav").boundingBox();
    // La mitad de abajo del botón está encima de la barra de secciones.
    const x = zona.x + zona.width / 2;
    const y = zona.y + zona.height * 0.7;
    assert.ok(y > barra.y, "debajo de ese punto está la barra de secciones");

    for (const ms of [200, 300]) {
      if (ms !== 200) {
        await p.locator("button", { hasText: /^🗑️$/ }).first().click();
        await eliminar.waitFor();
        await pausa(600);
      }
      await dobleToque(p, x, y, ms);
      await pausa(1200);
      assert.ok(p.url().includes("produccion"), "sigue en Producción (con " + ms + " ms entre toques terminó en " + p.url().split("/").pop() + ")");
    }
    await hasta(async () => (await cuantosEnStock(h)) === antes - 2, "que se borren los dos ítems confirmados");
  } finally {
    await h.close();
  }
});

// ── 2. Señal entrecortada: después de guardar no se muestra el dato de antes ──

const TREBOL = "Carnicería El Trébol";

/** Director → pestaña CC, con todo bajado al teléfono. Devuelve la tarjeta de la cuenta de `cliente`. */
async function abrirCuentas(cliente) {
  const h = await abrirCon({ seed: buildSeed() }, async (h) => {
    const p = h.page;
    await h.ir("pedidos.html");
    await h.sincronizar();
    await p.getByText("¿Quién sos?").waitFor();
    await p.locator("button", { hasText: "Panel general y cuentas corrientes" }).click();
    await p.getByText("Activos", { exact: true }).first().waitFor();
    await p.locator("button", { hasText: "💳 CC" }).click();
    await p.getByText("Deuda total").waitFor();
  });
  const p = h.page;
  const tarjeta = p.locator("div", { has: p.getByText(cliente, { exact: true }) }).filter({ has: p.locator("button", { hasText: "Ver movimientos" }) }).last();
  const saldoEnPantalla = async () => (await tarjeta.locator("[data-saldo]").innerText()).trim();
  return { h, p, tarjeta, saldoEnPantalla };
}
/**
 * Señal entrecortada: se corta un momento y el canal por el que el teléfono escucha
 * los cambios no vuelve a conectar. Firestore reintenta cada vez más espaciado
 * (hasta un minuto); se deja pasar el tiempo para que quede en esa espera larga.
 */
async function senalEntrecortada(h) {
  const corte = { activo: true, intentos: 0 };
  await h.page.route(/\/Listen\/channel/, (ruta) => {
    if (!corte.activo) return ruta.continue();
    corte.intentos++;
    return ruta.abort("connectionfailed");
  });
  await h.sinRed(true);
  await pausa(1200);
  await h.sinRed(false);
  // Se adelanta el reloj hasta que Firestore lleve muchos intentos fallidos y acabe de
  // fallar otro: a esa altura espera cerca de un minuto (nunca menos de 25 s) para el próximo.
  let antes = corte.intentos;
  for (let i = 0; i < 400; i++) {
    await h.page.clock.runFor(2000);
    await pausa(60);
    if (corte.intentos > antes && corte.intentos >= 12) break;
    antes = corte.intentos;
  }
  assert.ok(corte.intentos >= 12, "Firestore reintentó la escucha varias veces sin lograrlo (" + corte.intentos + ")");
  const estado = await h.page.evaluate(() => window.__sersaleDatos.estado());
  assert.equal(estado.cuentas_corrientes.sincronizado, false, "la escucha quedó caída");
  return corte;
}
async function pagar(p, tarjeta, monto) {
  await tarjeta.locator("button", { hasText: "Registrar pago" }).click();
  await p.getByText("Registrar pago", { exact: true }).first().waitFor();
  await p.locator('input[placeholder="0"]').fill(String(monto));
  await p.locator("button", { hasText: "✓ Confirmar pago" }).click();
  await p.locator(".ss-toast", { hasText: "registrado" }).waitFor({ timeout: 60000 });
}

test("señal entrecortada: después de registrar un pago la lista muestra el saldo nuevo (antes seguía el saldo viejo, sin ningún aviso)", async () => {
  const { h, p, tarjeta, saldoEnPantalla } = await abrirCuentas(TREBOL);
  try {
    assert.equal(await saldoEnPantalla(), "$660.925");
    const corte = await senalEntrecortada(h);
    // La señal ya volvió, pero Firestore todavía está esperando para reconectar la escucha.
    corte.activo = false;
    await pagar(p, tarjeta, 10000);
    const db = await h.dump();
    const cuenta = Object.values(db.cuentas_corrientes).find((c) => c.nombre === TREBOL);
    assert.equal(cuenta.saldo, 650925, "el pago quedó guardado en el servidor");
    await hasta(async () => (await saldoEnPantalla()) === "$650.925", "que la lista muestre el saldo que dejó el pago (si muestra el viejo, la persona puede cargar el pago otra vez)", 6000);
    assert.equal(await cartel(p).count(), 0, "con los datos al día no hay franja de aviso");
  } finally {
    await h.close();
  }
});

test("señal entrecortada: si el servidor sigue sin contestar, se avisa que lo que se ve puede estar desactualizado, y el aviso se va cuando vuelve", async () => {
  const { h, p, tarjeta, saldoEnPantalla } = await abrirCuentas(TREBOL);
  try {
    const corte = await senalEntrecortada(h);
    await pagar(p, tarjeta, 10000);
    const cuenta = Object.values((await h.dump()).cuentas_corrientes).find((c) => c.nombre === TREBOL);
    assert.equal(cuenta.saldo, 650925, "el pago quedó guardado en el servidor");
    // El teléfono no puede bajar el saldo nuevo: la lista muestra el guardado, pero avisando.
    await cartel(p).waitFor({ timeout: 15000 });
    assert.match(await cartel(p).innerText(), /Señal débil.*puede estar desactualizado/);
    assert.equal(await saldoEnPantalla(), "$660.925", "la lista todavía muestra lo guardado en el teléfono");

    // Vuelve la señal: la escucha reconecta, el aviso se va y la lectura siguiente trae el saldo nuevo.
    corte.activo = false;
    for (let i = 0; i < 80 && (await cartel(p).count()); i++) {
      await p.clock.runFor(5000);
      await pausa(300);
    }
    const queda = { cartel: await cartel(p).allInnerTexts(), escuchas: await p.evaluate(() => window.__sersaleDatos.estado()) };
    assert.equal(queda.cartel.length, 0, "el aviso se va cuando la copia vuelve a estar al día: " + JSON.stringify(queda));
    const saldo = await p.evaluate(async () => {
      const m = await import("/js/fb.js");
      const snap = await m.getDocs(m.collection(m.db, "cuentas_corrientes"));
      return snap.docs.map((d) => d.data()).find((c) => c.nombre === "Carnicería El Trébol").saldo;
    });
    assert.equal(saldo, 650925);
  } finally {
    await h.close();
  }
});

// ── 3. La copia guardada en el teléfono ──────────────────────────────────────

/** Lee una colección entera con js/fb.js desde la página: { nombres } o { error }. */
const leerColeccion = (p, col) =>
  p.evaluate(async (col) => {
    const m = await import("/js/fb.js");
    try {
      const snap = await m.getDocs(m.collection(m.db, col));
      return { cantidad: snap.size, nombres: snap.docs.map((d) => d.data().nombre).sort() };
    } catch (e) {
      return { error: e.code || String(e) };
    }
  }, col);

test("teléfono que no deja guardar datos (IndexedDB caído): sin señal no se dice «guardado en el teléfono» ni se muestran listas vacías", async () => {
  const h = await launch({ rol: "director", etiqueta: "revinfra", seed: SEED_CHICO });
  const p = h.page;
  try {
    // Un día normal: los clientes se bajan y queda anotado que este teléfono los tiene.
    await h.ir("pedidos.html");
    await h.sincronizar();
    assert.equal((await leerColeccion(p, "clientes")).cantidad, 2);

    // Otro día la base local del teléfono no abre (en el iPhone pasa: "Connection to
    // Indexed Database server lost"). Firestore sigue andando, con todo solo en memoria.
    await h.context.addInitScript(() => {
      IDBFactory.prototype.open = function () {
        const pedido = { addEventListener(t, f) { pedido["on" + t] = f; }, removeEventListener() {} };
        setTimeout(() => {
          pedido.error = new DOMException("Connection to Indexed Database server lost. Refresh the page to try again", "UnknownError");
          if (pedido.onerror) pedido.onerror({ target: pedido, preventDefault() {} });
        }, 5);
        return pedido;
      };
    });
    await h.ir("pedidos.html");
    await h.sincronizar();
    await h.sinRed(true);
    await cartel(p).waitFor();
    const r = await p.evaluate(async () => {
      const m = await import("/js/fb.js");
      window.__altaLista = false;
      window.__alta = m.addDoc(m.collection(m.db, "clientes"), { nombre: "Alta sin señal" }).then(() => { window.__altaLista = true; });
      await new Promise((ok) => setTimeout(ok, 2500));
      return { lista: window.__altaLista, pendientes: m.cambiosPendientes().cantidad, cartel: document.querySelector(".ss-sin-conexion").textContent };
    });
    assert.equal(r.lista, false, "el alta no se da por guardada: si se cierra la app, se pierde");
    assert.equal(r.pendientes, 0);
    assert.doesNotMatch(r.cartel, /guardado en el teléfono/, "no se promete que quedó guardado en el teléfono");

    // Con la app todavía abierta vuelve la señal: el alta se envía y recién ahí termina.
    await h.sinRed(false);
    await p.waitForFunction(() => window.__altaLista === true, null, { timeout: 20000 });
    assert.ok(Object.values((await h.dump()).clientes).some((c) => c.nombre === "Alta sin señal"));

    // Se vuelve a abrir sin llegar al servidor: no hay nada guardado de verdad, aunque
    // la marca de "clientes bajados" del primer día siga. Tiene que avisar, no mostrar una lista vacía.
    const t = await p.evaluate(() => window.__SERSALE_TEST__);
    await p.route((url) => url.href.startsWith(`http://${t.emulatorHost}:${t.emulatorPort}`), (ruta) => ruta.abort("connectionfailed"));
    await h.ir("pedidos.html");
    await h.sinRed(true);
    const leido = await leerColeccion(p, "clientes");
    assert.equal(leido.error, "unavailable", "sin copia de verdad, leer falla (antes devolvía una lista vacía como si no hubiera clientes): " + JSON.stringify(leido));
  } finally {
    await h.close();
  }
});

test("copia grande (más de 40 MB): dejar la app abierta no borra del teléfono colecciones que después se muestran sin señal", async () => {
  // Remitos pesados para pasar los 40 MB que Firestore dejaba ocupar a la copia.
  const relleno = "x".repeat(940000);
  const remitos = {};
  for (let i = 0; i < 46; i++) remitos["r" + String(i).padStart(2, "0")] = { nro: i + 1, cliente: "Almacén Don Pepe", relleno };
  const clientes = {};
  for (let i = 0; i < 30; i++) clientes["c" + String(i).padStart(2, "0")] = { nombre: "Cliente " + String(i).padStart(2, "0") };
  const h = await launch({ rol: "director", etiqueta: "revinfra", seed: { clientes, usuarios: { nacho: { usuario: "nacho", nombre: "Nacho", activo: true, passwordHash: "x" } } } });
  const p = h.page;
  try {
    for (const [id, datos] of Object.entries(remitos)) await h.sembrar({ remitos: { [id]: datos } });
    // Pedidos baja clientes y demás; después se abren los remitos (como hace el Panel).
    await h.ir("pedidos.html");
    await h.sincronizar();
    await p.evaluate(async () => {
      const m = await import("/js/fb.js");
      m.precalentar(["remitos"]);
    });
    await hasta(() => p.evaluate(() => (window.__sersaleDatos.estado().remitos || {}).sincronizado === true), "que bajen los remitos", 90000);
    // El uso de todos los días deja muchas consultas anotadas en la copia (una por cada
    // documento que una transacción escribe y vuelve a leer).
    await p.evaluate(async () => {
      const m = await import("/js/fb.js");
      for (let i = 0; i < 24; i++) await m.getDocFromServer(m.doc(m.db, "cc_movimientos", "mov" + i));
    });
    assert.equal((await leerColeccion(p, "clientes")).cantidad, 30);

    // La app queda abierta en el inicio (que no usa clientes) varios minutos.
    await h.ir("index.html");
    await p.getByText("Panel director").first().waitFor();
    for (let i = 0; i < 14; i++) {
      await p.clock.runFor(30000);
      await pausa(400);
    }
    // Sin señal (cámara de frío): los clientes guardados tienen que estar todos, o avisar que no hay copia.
    await h.sinRed(true);
    const leido = await leerColeccion(p, "clientes");
    assert.ok(leido.error === "unavailable" || leido.cantidad === 30, "sin señal se ven los 30 clientes guardados (o se avisa que no hay copia), no una lista incompleta: " + JSON.stringify({ error: leido.error, cantidad: leido.cantidad }));
  } finally {
    await h.limpiar().catch(() => {}); // 43 MB menos en el emulador para las pruebas que siguen
    await h.close();
  }
});

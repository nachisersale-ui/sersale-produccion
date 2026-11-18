// Arreglos del ingreso, el panel del director, la gestión de usuarios (index.html)
// y el backup en Excel (backup.html). Cada prueba usa la página real como en el
// iPhone y revisa lo que queda en Firestore y lo que se ve (o se descarga).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed, sha256Hex } from "./lib/seed.mjs";

const XLSX = createRequire(import.meta.url)("xlsx");

const NOCHE = "2026-11-10T22:30:00-03:00"; // martes a la noche: en UTC ya es miércoles 11
const HOY = "2026-11-10";
const SEED = buildSeed();
const copia = (o) => JSON.parse(JSON.stringify(o));
const USUARIOS = SEED.usuarios; // nacho (sersale123), romina (administracion26), claudio (desactivado)
const diaBA = (v) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v));

const aviso = (p, texto) => p.locator(".ss-toast", { hasText: texto }).first();
const enPanel = (p) => p.getByText("Panel director").first();
const enIngreso = (p) => p.locator("button.acceso", { hasText: "Director" });
const usuariosGuardados = async (h) => (await h.dump()).usuarios || {};

/** Simula mala señal: el teléfono dice que hay red, pero el servidor de la base no contesta. */
async function cortarServidor(h) {
  const t = await h.page.evaluate(() => window.__SERSALE_TEST__);
  const base = `http://${t.emulatorHost}:${t.emulatorPort}`;
  const filtro = (url) => url.href.startsWith(base);
  await h.page.route(filtro, (r) => r.abort("connectionfailed"));
  return () => h.page.unroute(filtro);
}

// ── Ingreso ─────────────────────────────────────────────────────────────────

async function abrirIngreso(opts = {}) {
  const h = await launch({ etiqueta: "index", seed: { usuarios: copia(USUARIOS) }, ...opts });
  await h.ir("index.html");
  return h;
}
async function abrirLogin(p) {
  await enIngreso(p).tap();
  await p.locator("#__login_user").waitFor();
}
/** Completa el formulario, toca Ingresar y espera a que el intento termine: devuelve el mensaje, o null si entró. */
async function intentar(p, usuario, clave) {
  if (usuario != null) await p.fill("#__login_user", usuario);
  if (clave != null) await p.fill("#__login_pwd", clave);
  // Se borra el mensaje del intento anterior para esperar el de este (la página hace lo mismo al empezar).
  await p.evaluate(() => { document.getElementById("__login_msg").textContent = ""; });
  await p.tap("#__login_btn");
  await p.waitForFunction(() => {
    const b = document.getElementById("__login_btn");
    return !b || (!b.disabled && document.getElementById("__login_msg").textContent.trim() !== "");
  }, null, { timeout: 60000 });
  return p.evaluate(() => (document.getElementById("__login_msg") ? document.getElementById("__login_msg").textContent.trim() : null));
}

test("ingreso con mala señal en un teléfono sin datos guardados: no crea ni pisa un Director", async () => {
  const h = await abrirIngreso();
  const p = h.page;
  try {
    const volver = await cortarServidor(h);
    await abrirLogin(p);

    // Usuario real con la clave mal escrita: antes quedaba "Creando primer usuario Director..."
    // y, al volver la señal, la clave de nacho quedaba reemplazada por la equivocada.
    const dicho = await intentar(p, "nacho", "clave-mal-escrita");
    assert.match(dicho, /Sin conexión con el servidor/);
    assert.equal(await enPanel(p).count(), 0, "no tiene que entrar al panel");
    assert.equal(await p.evaluate(() => sessionStorage.getItem("sersale_role")), null);
    assert.equal(await p.inputValue("#__login_user"), "nacho", "el formulario queda como estaba");
    assert.equal(await p.inputValue("#__login_pwd"), "clave-mal-escrita");

    // Alguien que inventa un usuario durante el corte tampoco entra.
    assert.match(await intentar(p, "intruso", "clave1234"), /Sin conexión con el servidor/);
    assert.equal(await enPanel(p).count(), 0);

    // Vuelve la señal: los mismos datos se rechazan y la base queda igual.
    await volver();
    await h.sincronizar();
    let resultado = await intentar(p);
    for (let i = 0; i < 8 && /Sin conexión/.test(resultado || ""); i++) resultado = await intentar(p);
    assert.equal(resultado, "Usuario o contraseña incorrectos");
    assert.equal(await intentar(p, "nacho", "clave-mal-escrita"), "Usuario o contraseña incorrectos");
    assert.deepEqual(await usuariosGuardados(h), USUARIOS, "ningún usuario creado ni modificado");

    // Con la clave de siempre, nacho entra.
    assert.equal(await intentar(p, "nacho", "sersale123"), null);
    await enPanel(p).waitFor();
    assert.equal(await p.evaluate(() => sessionStorage.getItem("sersale_usuario")), "nacho");
    assert.deepEqual(await usuariosGuardados(h), USUARIOS);
  } finally {
    await h.close();
  }
});

test("base sin usuarios: el primer ingreso crea al primer Director (y solo con un usuario válido)", async () => {
  const h = await launch({ etiqueta: "index0" });
  const p = h.page;
  try {
    await h.ir("index.html");
    await abrirLogin(p);
    assert.match(await intentar(p, "Nacho Sersale", "sersale123"), /solo letras minúsculas/);
    assert.deepEqual(await usuariosGuardados(h), {});
    assert.equal(await intentar(p, "nacho", "sersale123"), null);
    await enPanel(p).waitFor();
    const u = await usuariosGuardados(h);
    assert.deepEqual(Object.keys(u), ["nacho"]);
    assert.equal(u.nacho.usuario, "nacho");
    assert.equal(u.nacho.nombre, "Nacho");
    assert.equal(u.nacho.activo, true);
    assert.equal(u.nacho.passwordHash, sha256Hex("sersale123"));
    assert.ok(u.nacho.creado && u.nacho.creado.__ts, "creado es un Timestamp");
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Sesión ──────────────────────────────────────────────────────────────────

test("un director desactivado desde otro teléfono pierde la sesión recordada al volver a abrir la app", async () => {
  const h = await abrirIngreso();
  const p = h.page;
  try {
    await abrirLogin(p);
    assert.equal(await intentar(p, "romina", "administracion26"), null); // "Recordarme" viene tildado
    await enPanel(p).waitFor();
    await p.getByText("Romina").first().waitFor();
    assert.ok(await p.evaluate(() => !!localStorage.getItem("sersale_sesion")), "la sesión quedó recordada");

    // Otro director la desactiva desde su teléfono.
    await h.sembrar({ usuarios: { romina: { ...copia(USUARIOS.romina), activo: false } } });
    // Romina cierra la app y la vuelve a abrir: el iPhone borra sessionStorage y se restaura lo recordado.
    await p.evaluate(() => sessionStorage.clear());
    await h.ir("index.html");
    await aviso(p, "Tu usuario fue desactivado").waitFor();
    await enIngreso(p).waitFor();
    assert.equal(await enPanel(p).count(), 0, "no queda el panel del director");
    assert.deepEqual(
      await p.evaluate(() => [sessionStorage.getItem("sersale_role"), sessionStorage.getItem("sersale_auth"), localStorage.getItem("sersale_sesion")]),
      [null, null, null],
      "sesión cerrada y olvidada"
    );
    await p.goto(h.origin + "/pedidos.html");
    await p.waitForURL(/index\.html$/); // las páginas internas ya no la dejan pasar

    // No puede volver a entrar hasta que la activen.
    await h.esperarApp();
    await abrirLogin(p);
    assert.equal(await intentar(p, "romina", "administracion26"), "Usuario desactivado");
    await h.sembrar({ usuarios: { romina: copia(USUARIOS.romina) } });
    await p.waitForFunction(async () => {
      const m = await import("/js/fb.js"); // hasta que el cambio llega a este teléfono
      const snap = await m.getDocs(m.collection(m.db, "usuarios"));
      return snap.docs.some((d) => d.id === "romina" && d.data().activo === true);
    });
    assert.equal(await intentar(p), null);
    await enPanel(p).waitFor();
    assert.equal(await p.locator(".ss-toast", { hasText: "desactivado" }).count(), 0);
    assert.equal(await p.evaluate(() => sessionStorage.getItem("sersale_role")), "director", "un usuario activo sigue adentro");
  } finally {
    await h.close();
  }
});

test("una sesión de un usuario que fue eliminado se cierra; la de un usuario activo sigue", async () => {
  const h = await launch({ etiqueta: "index", seed: { usuarios: copia(USUARIOS) } });
  const p = h.page;
  try {
    await h.sesion("director", { usuario: "fantasma", nombre: "Fantasma" });
    await h.ir("index.html");
    await aviso(p, "Tu usuario ya no existe").waitFor();
    await enIngreso(p).waitFor();
    assert.equal(await p.evaluate(() => sessionStorage.getItem("sersale_role")), null);
    assert.deepEqual(await usuariosGuardados(h), USUARIOS, "no se toca la lista de usuarios");
  } finally {
    await h.close();
  }
  const h2 = await launch({ rol: "director", etiqueta: "index", seed: { usuarios: copia(USUARIOS) } });
  try {
    await h2.ir("index.html");
    await h2.sincronizar();
    await enPanel(h2.page).waitFor();
    await h2.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // vuelve a la app
    await h2.sincronizar();
    assert.equal(await h2.page.evaluate(() => sessionStorage.getItem("sersale_role")), "director");
    assert.equal(await enIngreso(h2.page).count(), 0);
    assert.deepEqual(erroresReales(h2.errores), []);
  } finally {
    await h2.close();
  }
});

test("panel: saludo y fecha de Buenos Aires, y al volver a la app al otro día se actualizan", async () => {
  const h = await launch({ rol: "director", etiqueta: "panel", seed: { usuarios: copia(USUARIOS) }, now: NOCHE });
  const p = h.page;
  const cabecera = () => p.evaluate(() => document.querySelector(".topbar").innerText.replace(/\s+/g, " "));
  try {
    await h.ir("index.html");
    await enPanel(p).waitFor();
    assert.match(await cabecera(), /Buenas noches, Nacho · martes, 10 de noviembre/);
    // La app queda abierta en el teléfono; se vuelve a mirar a las 8:30 del miércoles.
    await p.clock.fastForward("10:00:00");
    await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await p.waitForFunction(() => /Buenos días, Nacho · miércoles, 11 de noviembre/.test(document.querySelector(".topbar").innerText.replace(/\s+/g, " ")));
    assert.equal(await p.evaluate(() => sessionStorage.getItem("sersale_role")), "director");
  } finally {
    await h.close();
  }
});

// ── Gestión de usuarios ─────────────────────────────────────────────────────

async function abrirUsuarios(opts = {}) {
  const { usuarios, ...resto } = opts;
  const h = await launch({ rol: "director", etiqueta: "usuarios", seed: { usuarios: usuarios || copia(USUARIOS) }, ...resto });
  await h.ir("index.html");
  await h.page.locator("a.mod", { hasText: "Usuarios" }).tap();
  await h.page.locator("#__usr_lista", { hasText: "@nacho" }).waitFor();
  return h;
}
const ventanas = (p) => p.evaluate(() => document.querySelectorAll(".modal-bg").length);
const fila = (p, usr) => p.locator("#__usr_lista > div > div", { hasText: "@" + usr });
const boton = (p, texto) => p.locator("#__usr_modal button", { hasText: texto });
async function hoja(p, botonTexto, escribir) {
  const caja = p.locator(".ss-hoja");
  await caja.waitFor();
  const dicho = await caja.innerText();
  if (escribir != null) await caja.locator(".ss-campo").fill(escribir);
  await caja.locator(".ss-btn", { hasText: botonTexto }).tap();
  await caja.waitFor({ state: "detached" });
  return dicho;
}

test("usuarios: «Nuevo Director» sigue andando después de «Volver», se crean dos seguidos y queda una sola ventana", async () => {
  const h = await abrirUsuarios();
  const p = h.page;
  try {
    await boton(p, "Nuevo Director").tap();
    await p.locator("#__nu_nombre").waitFor();
    await boton(p, "Volver").tap();
    await fila(p, "nacho").waitFor();
    assert.equal(await ventanas(p), 1, "una sola ventana después de Volver");

    // Antes, este segundo toque no hacía nada: el formulario se abría en la ventana tapada.
    await boton(p, "Nuevo Director").tap();
    await p.locator("#__nu_nombre").waitFor();
    assert.ok(await p.locator("#__nu_nombre").isVisible());
    await p.fill("#__nu_nombre", "Fernando García");
    await p.fill("#__nu_usuario", "Fernando");
    await p.fill("#__nu_pwd", "clave2026");
    await p.fill("#__nu_pwd2", "clave2026");
    await boton(p, "Crear usuario").tap();
    await fila(p, "fernando").waitFor();
    await aviso(p, "Usuario @fernando creado").waitFor();
    assert.equal(await ventanas(p), 1, "una sola ventana después de crear");
    let u = await usuariosGuardados(h);
    assert.equal(u.fernando.usuario, "fernando");
    assert.equal(u.fernando.nombre, "Fernando García");
    assert.equal(u.fernando.activo, true);
    assert.equal(u.fernando.passwordHash, sha256Hex("clave2026"));
    assert.ok(u.fernando.creado && u.fernando.creado.__ts);

    // Otro enseguida, sin cerrar: un usuario repetido se rechaza y no pisa al que existe.
    await boton(p, "Nuevo Director").tap();
    await p.fill("#__nu_nombre", "Otro Nacho");
    await p.fill("#__nu_usuario", "NACHO");
    await p.fill("#__nu_pwd", "otraclave");
    await p.fill("#__nu_pwd2", "otraclave");
    await boton(p, "Crear usuario").tap();
    await p.locator("#__nu_msg", { hasText: "Ya existe un usuario con ese nombre" }).waitFor();
    assert.equal(await p.inputValue("#__nu_nombre"), "Otro Nacho", "el formulario queda como estaba");
    // Y uno más, válido.
    await p.fill("#__nu_nombre", "Lucía Sersale");
    await p.fill("#__nu_usuario", "lucia");
    await boton(p, "Crear usuario").tap();
    await fila(p, "lucia").waitFor();
    u = await usuariosGuardados(h);
    assert.deepEqual(u.nacho, USUARIOS.nacho, "nacho quedó como estaba");
    assert.deepEqual(Object.keys(u).sort(), ["claudio", "fernando", "lucia", "nacho", "romina"]);
    assert.equal(u.lucia.passwordHash, sha256Hex("otraclave"));

    // «Cerrar» cierra de un toque.
    assert.equal(await ventanas(p), 1);
    await boton(p, "Cerrar").tap();
    await p.waitForFunction(() => document.querySelectorAll(".modal-bg").length === 0);

    // El usuario nuevo entra con su clave.
    await p.locator("button.salir").tap();
    await abrirLogin(p);
    assert.equal(await intentar(p, "fernando", "clave2026"), null);
    await p.getByText("Fernando García").first().waitFor();
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("usuarios: cambiar clave, desactivar y eliminar actúan sobre el documento correcto (id distinto del usuario, nombres con comilla)", async () => {
  const VIEJO = { usuario: "Fernando", passwordHash: sha256Hex("vieja123"), nombre: "Fernando O'Higgins", activo: true };
  const PAT = { usuario: "o'brien", passwordHash: sha256Hex("irlanda1"), nombre: "Pat O'Brien", activo: true };
  const h = await abrirUsuarios({ usuarios: { ...copia(USUARIOS), usr_viejo_01: VIEJO, usr_02: PAT } });
  const p = h.page;
  try {
    // Cambiar la clave: una hoja propia (no el prompt del navegador), sin mayúscula automática.
    await fila(p, "Fernando").locator('button[data-usr-accion="clave"]').tap();
    const campo = p.locator(".ss-hoja .ss-campo");
    await campo.waitFor();
    assert.equal(await campo.getAttribute("autocapitalize"), "none");
    assert.match(await hoja(p, "Guardar", "nueva2026"), /@fernando/i);
    await aviso(p, "Contraseña de @Fernando actualizada").waitFor();
    let u = await usuariosGuardados(h);
    assert.deepEqual(u.usr_viejo_01, { ...VIEJO, passwordHash: sha256Hex("nueva2026") });
    assert.equal(u.Fernando, undefined, "no se crea ni se busca un documento con el nombre de usuario");

    // Una clave corta se rechaza con aviso y no cambia nada.
    await fila(p, "nacho").locator('button[data-usr-accion="clave"]').tap();
    await hoja(p, "Guardar", "abc");
    await aviso(p, "al menos 4 caracteres").waitFor();
    // Cancelar tampoco cambia nada.
    await fila(p, "nacho").locator('button[data-usr-accion="clave"]').tap();
    await hoja(p, "Cancelar", "otraclave99");
    assert.deepEqual((await usuariosGuardados(h)).nacho, USUARIOS.nacho);
    assert.equal(await fila(p, "nacho").locator('button[data-usr-accion="eliminar"]').count(), 0, "no se puede eliminar a uno mismo");

    // Desactivar y volver a activar.
    await fila(p, "Fernando").locator('button[data-usr-accion="desactivar"]').tap();
    await fila(p, "Fernando").locator('button[data-usr-accion="activar"]').waitFor();
    assert.match(await fila(p, "Fernando").innerText(), /Desactivado/);
    assert.equal((await usuariosGuardados(h)).usr_viejo_01.activo, false);
    await fila(p, "Fernando").locator('button[data-usr-accion="activar"]').tap();
    await fila(p, "Fernando").locator('button[data-usr-accion="desactivar"]').waitFor();
    assert.equal((await usuariosGuardados(h)).usr_viejo_01.activo, true);

    // Eliminar: pregunta en una hoja propia; cancelar no borra, confirmar borra ese documento y ningún otro.
    await fila(p, "o'brien").locator('button[data-usr-accion="eliminar"]').tap();
    assert.match(await hoja(p, "Cancelar"), /¿Eliminar al usuario @o'brien\?/i);
    assert.deepEqual((await usuariosGuardados(h)).usr_02, PAT);
    await fila(p, "o'brien").locator('button[data-usr-accion="eliminar"]').tap();
    await hoja(p, "Eliminar");
    await aviso(p, "Usuario @o'brien eliminado").waitFor();
    await p.waitForFunction(() => !document.getElementById("__usr_lista").innerText.includes("o'brien"));
    u = await usuariosGuardados(h);
    assert.deepEqual(Object.keys(u).sort(), ["claudio", "nacho", "romina", "usr_viejo_01"]);
    assert.equal(h.llamadas.dialogos.length, 0, "ningún confirm() / prompt() del navegador");

    // La clave nueva sirve para entrar.
    await boton(p, "Cerrar").tap();
    await p.locator("button.salir").tap();
    await abrirLogin(p);
    assert.equal(await intentar(p, "fernando", "vieja123"), "Usuario o contraseña incorrectos");
    assert.equal(await intentar(p, "fernando", "nueva2026"), null);
    await p.getByText("Fernando O'Higgins").first().waitFor();
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

// ── Backup ──────────────────────────────────────────────────────────────────

const ESTADO = "#status";
const estado = (p, texto) => p.locator(ESTADO, { hasText: texto });
/** Lee el Excel descargado: { hojas: { nombre: { titulo, generado, encabezados, filas: [{columna: valor}] } }, orden } */
function leerLibro(bytes) {
  const wb = XLSX.read(bytes, { type: "buffer" });
  const hojas = {};
  for (const nombre of wb.SheetNames) {
    const m = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: "", blankrows: true });
    if (nombre === "Resumen") {
      hojas[nombre] = { matriz: m, conteos: Object.fromEntries(m.slice(6).filter((r) => r[0] !== "").map((r) => [r[0], r[1]])) };
      continue;
    }
    const encabezados = m[3] || [];
    hojas[nombre] = {
      titulo: m[0] && m[0][0],
      generado: m[1] && m[1][0],
      encabezados,
      filas: m.slice(4).map((r) => Object.fromEntries(encabezados.map((e, i) => [e, r[i] === undefined ? "" : r[i]]))),
    };
  }
  return { hojas, orden: wb.SheetNames };
}
async function generar(h) {
  const [descarga] = await Promise.all([h.page.waitForEvent("download"), h.page.locator("#btnBackup").tap()]);
  const bytes = fs.readFileSync(await descarga.path());
  await estado(h.page, "Backup generado").waitFor();
  return { nombre: descarga.suggestedFilename(), libro: leerLibro(bytes) };
}

test("backup sin señal: avisa y no descarga un Excel vacío; cuando vuelve la señal se genera completo", async () => {
  const h = await launch({ rol: "director", etiqueta: "backup", seed: copia(SEED) });
  const p = h.page;
  try {
    await h.ir("backup.html");

    // 1) El teléfono dice que hay red pero la base no contesta (antes: Excel con 0 registros y "✅ Backup generado").
    const volver = await cortarServidor(h);
    await p.locator("#btnBackup").tap();
    await estado(p, "No se pudo leer la base").waitFor({ timeout: 60000 });
    await aviso(p, "No se generó ningún archivo").waitFor();
    assert.equal(h.llamadas.descargas.length, 0, "no se descargó nada");
    assert.equal(await p.isEnabled("#btnBackup"), true, "se puede volver a intentar");
    await volver();

    // 2) Sin conexión (modo avión): avisa en el momento.
    await h.sinRed(true);
    await p.locator("#btnBackup").tap();
    await estado(p, "Sin conexión").waitFor();
    assert.equal(h.llamadas.descargas.length, 0);
    await h.sinRed(false);

    // 3) Con señal: un solo archivo aunque se toque dos veces, con todo adentro.
    // (Si Firestore deja la lectura colgada justo al volver la señal, la página reintenta sola a los 45 s.)
    const espera = p.waitForEvent("download", { timeout: 150000 }).catch(() => null);
    await p.locator("#btnBackup").tap();
    await p.locator("#btnBackup").tap({ force: true }).catch(() => {});
    const descarga = await espera;
    assert.ok(descarga, "se descargó el archivo (estado: " + (await p.textContent(ESTADO)) + ")");
    await estado(p, "Backup generado").waitFor();
    const libro = leerLibro(fs.readFileSync(await descarga.path()));
    assert.equal(libro.hojas.Pedidos.filas.length, Object.keys(SEED.pedidos).length);
    assert.equal(libro.hojas["CC Movimientos"].filas.length, Object.keys(SEED.cc_movimientos).length);
    await p.waitForFunction(() => !document.getElementById("btnBackup").disabled);
    assert.equal(h.llamadas.descargas.length, 1, "un solo archivo");
  } finally {
    await h.close();
  }
});

test("backup: si la lectura de una colección queda colgada, reintenta solo y el archivo sale completo", async () => {
  const h = await launch({ rol: "director", etiqueta: "backup", seed: copia(SEED) });
  const p = h.page;
  try {
    await h.ir("backup.html");
    // Se imita la falla vista en Firestore: la primera lectura de pedidos no contesta nunca.
    await p.evaluate(() => {
      const original = window.db.collection.bind(window.db);
      let veces = 0;
      window.db.collection = (nombre) => {
        const c = original(nombre);
        if (nombre === "pedidos" && veces++ === 0) c.get = () => new Promise(() => {});
        return c;
      };
    });
    const espera = p.waitForEvent("download", { timeout: 150000 }).catch(() => null);
    await p.locator("#btnBackup").tap();
    await estado(p, "(13 de 14)").waitFor(); // el resto ya se leyó; pedidos no llega
    assert.equal(h.llamadas.descargas.length, 0);
    await p.clock.fastForward("00:46"); // pasan los 45 segundos sin avance
    const descarga = await espera;
    assert.ok(descarga, "se descargó el archivo (estado: " + (await p.textContent(ESTADO)) + ")");
    await estado(p, "Backup generado").waitFor();
    const libro = leerLibro(fs.readFileSync(await descarga.path()));
    assert.equal(libro.hojas.Pedidos.filas.length, Object.keys(SEED.pedidos).length, "pedidos completos después del reintento");
    assert.equal(libro.hojas["CC Saldos"].filas.length, Object.keys(SEED.cuentas_corrientes).length);
    assert.equal(h.llamadas.descargas.length, 1);
  } finally {
    await h.close();
  }
});

test("backup a las 22:30: archivo y fechas con el día de Buenos Aires, todas las colecciones, y un registro raro no deja una hoja afuera", async () => {
  const seed = copia(SEED);
  // Pedido cargado hoy a las 22:10 (en UTC ya es el 11).
  seed.pedidos.ped_noche = {
    cliente: "Fiambrería Don Ángel", tipo: "reparto", cuentaCorriente: true, estado: "pendiente", obs: "",
    fechaPedido: { __ts: "2026-11-11T01:10:00.000Z" }, fechaPedidoISO: "2026-11-11T01:10:00.000Z", fechaEntrega: "2026-11-11",
    items: [{ producto: "Salame Tipo Milán", cantidad: "3", unidad: "kg", obs: "" }],
  };
  // Pedido viejo sin fechaPedido (orderBy lo dejaba afuera del backup).
  seed.pedidos.ped_sin_fecha = {
    cliente: "Cliente de 2025", tipo: "retiro", estado: "despachado", fechaEntrega: "2025-03-01",
    items: [{ producto: "Bondiola", cantidad: "2,5", unidad: "kg", precio: 10000, kgReal: 2.4 }],
  };
  // Remito con un ítem roto: antes se perdía la hoja Remitos entera, sin aviso.
  seed.remitos.rem_roto = { nro: 9999, cliente: "Remito Roto", fecha: "2026-11-01", items: [null], total: 100 };
  // Faena con la fecha guardada como Timestamp, a las 21:30 de ayer.
  seed.faenas.fae_ts = { fecha: { __ts: "2026-11-10T00:30:00.000Z" }, tipo: "Cerdo", cantidad: 10, pesoTotal: 1100, pesoPromedio: 110, obs: "" };

  const h = await launch({ rol: "director", etiqueta: "backup", seed, now: NOCHE });
  const p = h.page;
  try {
    await h.ir("backup.html");
    const { nombre, libro } = await generar(h);
    const H = libro.hojas;

    assert.equal(nombre, `Backup_CRM_Sersale_${HOY}.xlsx`, "el archivo lleva la fecha de hoy, no la de mañana");
    assert.match(H.Pedidos.generado, /^Generado: 10\/11\/2026 22:3\d$/);
    assert.deepEqual(libro.orden, ["Resumen", "Pedidos", "Remitos", "Clientes", "CC Saldos", "CC Movimientos", "Ventas Diarias", "Stock", "Faenas", "Lotes", "Precios", "Devoluciones", "Stock Movimientos", "Reportes Producción", "Reservas"]);

    // Pedidos: todos, con el día local en que se cargaron y del más nuevo al más viejo.
    const porId = (hoja) => Object.fromEntries(H[hoja].filas.map((f) => [f.ID, f]));
    const ped = porId("Pedidos");
    assert.equal(H.Pedidos.filas.length, Object.keys(seed.pedidos).length);
    assert.equal(ped.ped_noche["Fecha Pedido"], HOY);
    assert.equal(H.Pedidos.filas[0].ID, "ped_noche", "el más nuevo va primero");
    assert.equal(ped.ped_sin_fecha.Cliente, "Cliente de 2025");
    assert.equal(ped.ped_sin_fecha.Total, 24000, "2,4 kg pesados × $10.000");
    for (const [id, d] of Object.entries(SEED.pedidos)) {
      assert.equal(ped[id]["Fecha Pedido"], diaBA(d.fechaPedidoISO), "fecha de " + id);
      assert.equal(ped[id].Cliente, d.cliente);
      if (d.origen === "venta_rapida") assert.equal(ped[id].Total, Math.round(d.items.reduce((s, it) => s + it.cantidad * it.precio, 0)), "total de " + id);
    }

    // Remitos: están todos; el roto queda marcado en su fila y se avisa.
    const rem = porId("Remitos");
    assert.equal(H.Remitos.filas.length, Object.keys(seed.remitos).length);
    assert.match(String(rem.rem_roto.Nro), /No se pudo leer este registro/);
    for (const [id, d] of Object.entries(SEED.remitos)) {
      assert.equal(rem[id].Nro, d.nro);
      assert.equal(rem[id].Total, d.total, "total del remito " + id);
    }
    assert.match(await p.textContent(ESTADO), /1 registro con formato inesperado/);
    await aviso(p, "Revisá las filas con ⚠").waitFor();

    // Saldos y movimientos de cuenta corriente, tal cual están guardados.
    const cc = porId("CC Saldos");
    assert.equal(H["CC Saldos"].filas.length, Object.keys(SEED.cuentas_corrientes).length);
    for (const [id, d] of Object.entries(SEED.cuentas_corrientes)) assert.equal(cc[id]["Saldo ($)"], d.saldo, "saldo de " + d.nombre);
    const mov = porId("CC Movimientos");
    assert.equal(H["CC Movimientos"].filas.length, Object.keys(SEED.cc_movimientos).length);
    for (const [id, d] of Object.entries(SEED.cc_movimientos)) {
      assert.equal(mov[id]["Monto ($)"], d.monto, "monto de " + id);
      assert.equal(mov[id].Fecha, d.fecha);
    }

    // Faenas: fecha en texto igual que siempre; la guardada como Timestamp, con el día local.
    const fae = porId("Faenas");
    assert.equal(fae.fae_ts.Fecha, "2026-11-09");
    for (const [id, d] of Object.entries(SEED.faenas)) assert.equal(fae[id].Fecha, d.fecha);

    // Lo que no entraba en el backup.
    const dev = porId("Devoluciones");
    assert.equal(H.Devoluciones.filas.length, Object.keys(SEED.devoluciones).length);
    for (const [id, d] of Object.entries(SEED.devoluciones)) {
      assert.equal(dev[id].Cliente, d.cliente);
      assert.equal(dev[id]["Monto ($)"], d.monto || 0);
      assert.equal(dev[id].Fecha, d.fecha);
    }
    const smv = porId("Stock Movimientos");
    assert.equal(H["Stock Movimientos"].filas.length, Object.keys(SEED.stock_movimientos).length);
    for (const [id, d] of Object.entries(SEED.stock_movimientos)) {
      assert.equal(smv[id].Producto, d.nombre);
      assert.equal(smv[id].Cantidad, d.cantidad);
      assert.equal(smv[id].Tipo, d.tipo);
    }
    const filasRep = Object.values(SEED.reportes).reduce((s, r) => s + Math.max(1, (r.items || []).length), 0);
    assert.equal(H["Reportes Producción"].filas.length, filasRep);
    for (const f of H["Reportes Producción"].filas) {
      const r = SEED.reportes[f.ID];
      assert.equal(f.Fecha, diaBA(r.fechaISO));
      assert.ok(r.items.some((it) => it.producto === f.Producto && String(it.cantidad) === String(f.Cantidad)), "ítem de " + f.ID);
    }

    // El resto de las hojas, completas, y el resumen coincide con las hojas.
    assert.equal(H.Clientes.filas.length, Object.keys(SEED.clientes).length);
    assert.equal(H["Ventas Diarias"].filas.length, Object.keys(SEED.ventas_diarias).length);
    assert.equal(H.Stock.filas.length, Object.keys(SEED.stock_produccion).length);
    assert.equal(H.Precios.filas.length, Object.keys(SEED.precios_cliente).length);
    assert.equal(H.Lotes.filas.length, Object.values(SEED.trazabilidad_lotes).reduce((s, l) => s + Math.max(1, (l.productos || []).length), 0));
    const ven = porId("Ventas Diarias");
    for (const [id, d] of Object.entries(SEED.ventas_diarias)) assert.equal(ven[id].Neto, d.totalNeto, "neto de " + id);
    assert.deepEqual(H.Resumen.conteos, {
      Pedidos: H.Pedidos.filas.length, Remitos: H.Remitos.filas.length, Clientes: H.Clientes.filas.length,
      "CC Saldos": H["CC Saldos"].filas.length, "CC Mov": H["CC Movimientos"].filas.length, Ventas: H["Ventas Diarias"].filas.length,
      Stock: H.Stock.filas.length, Faenas: H.Faenas.filas.length, Lotes: H.Lotes.filas.length, Precios: H.Precios.filas.length,
      Devoluciones: H.Devoluciones.filas.length, "Stock Mov": H["Stock Movimientos"].filas.length, Reportes: H["Reportes Producción"].filas.length, Reservas: H.Reservas.filas.length,
    });
    assert.equal(H.Resumen.matriz[3][1], H.Pedidos.generado.replace("Generado: ", ""));

    // El backup solo lee: la base queda igual.
    const antes = copia(seed);
    assert.deepEqual(await h.dump(), antes);
  } finally {
    await h.close();
  }
});

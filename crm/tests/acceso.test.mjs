// Seguridad del acceso (punto 44 de docs/PARA-DECIDIR.md): cada teléfono ingresa
// con una cuenta de Firebase y la base de datos deja pasar solo a las cuentas
// con permiso. Se prueban las dos etapas: con la base todavía abierta (como
// está hoy la real: nada cambia a la vista, pero cada ingreso deja lista la
// cuenta) y con las reglas de crm/firestore.rules cargadas (base protegida).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { launch, erroresReales } from "./lib/harness.mjs";
import { buildSeed } from "./lib/seed.mjs";
import { tokenFalso } from "./lib/auth-falso.mjs";

const REGLAS = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const SEED = buildSeed();
const copia = (o) => JSON.parse(JSON.stringify(o));
const USUARIOS = SEED.usuarios; // nacho (sersale123), romina (administracion26), claudio (desactivado)
const DOMINIO = "@sersale-produccion.firebaseapp.com";

const aviso = (p, texto) => p.locator(".ss-toast", { hasText: texto }).first();
const enPanel = (p) => p.getByText("Panel director").first();
const enIngreso = (p) => p.locator("button.acceso", { hasText: "Director" });
const botonOperario = (p) => p.locator("button.acceso", { hasText: "Operario" });
const boton = (p, texto) => p.locator("#__usr_modal button", { hasText: texto });
const fila = (p, usr) => p.locator("#__usr_lista > div > div", { hasText: "@" + usr });

async function abrirLogin(p) {
  await enIngreso(p).tap();
  await p.locator("#__login_user").waitFor();
}
/** Completa el formulario y toca Ingresar: devuelve el mensaje de error, o null si entró. */
async function intentar(p, usuario, clave) {
  await p.fill("#__login_user", usuario);
  await p.fill("#__login_pwd", clave);
  await p.evaluate(() => { document.getElementById("__login_msg").textContent = ""; });
  await p.tap("#__login_btn");
  await p.waitForFunction(() => {
    const b = document.getElementById("__login_btn");
    return !b || (!b.disabled && document.getElementById("__login_msg").textContent.trim() !== "");
  }, null, { timeout: 60000 });
  return p.evaluate(() => (document.getElementById("__login_msg") ? document.getElementById("__login_msg").textContent.trim() : null));
}
async function ingresar(p, usuario, clave) {
  await abrirLogin(p);
  assert.equal(await intentar(p, usuario, clave), null, "tiene que entrar " + usuario);
  await enPanel(p).waitFor();
}
async function salir(p) {
  await p.locator("button.salir").tap();
  await enIngreso(p).waitFor();
}
async function hoja(p, botonTexto, escribir) {
  const caja = p.locator(".ss-hoja");
  await caja.waitFor();
  if (escribir != null) await caja.locator(".ss-campo").fill(escribir);
  await caja.locator(".ss-btn", { hasText: botonTexto }).tap();
  await caja.waitFor({ state: "detached" });
}
async function abrirUsuarios(p) {
  await p.locator("a.mod", { hasText: "Usuarios" }).tap();
  await fila(p, "nacho").waitFor();
}
/** Lee una colección desde la página (con la sesión que tenga el teléfono): cantidad de documentos o el código del error. */
const leer = (p, coleccion) =>
  p.evaluate(async (c) => {
    const m = await import("/js/fb.js");
    try {
      return (await m.getDocsFromServer(m.collection(m.db, c))).size;
    } catch (e) {
      return e.code || String(e);
    }
  }, coleccion);
const cuentaDelTelefono = (p) => p.evaluate(() => (window.SersaleCuenta ? SersaleCuenta.actual() : null));
/** Pedido directo a la base, como lo haría alguien desde afuera del sistema. */
async function desdeAfuera(h, ruta, uid) {
  const t = await h.page.evaluate(() => window.__SERSALE_TEST__);
  const r = await fetch(`http://${t.emulatorHost}:${t.emulatorPort}/v1/projects/${h.projectId}/databases/(default)/documents${ruta}`, {
    headers: uid ? { Authorization: "Bearer " + tokenFalso(h.projectId, uid) } : {},
  });
  return r.status;
}
const accesosDe = async (h, usuario, rol = "director") => Object.entries((await h.dump()).accesos || {}).filter(([, a]) => a.usuario === usuario && a.rol === rol);

test("primer ingreso con el sistema nuevo: entra como siempre y le queda su cuenta con permiso", async () => {
  const h = await launch({ etiqueta: "acc-migra", seed: { usuarios: copia(USUARIOS), clientes: copia(SEED.clientes) } });
  const p = h.page;
  try {
    await h.ir("index.html");
    await abrirLogin(p);
    assert.equal(await intentar(p, "nacho", "otra-clave"), "Usuario o contraseña incorrectos");
    assert.equal(h.auth.cuentas.size, 0, "una clave equivocada no crea ninguna cuenta");
    assert.equal(await cuentaDelTelefono(p), null);

    assert.equal(await intentar(p, "nacho", "sersale123"), null);
    await enPanel(p).waitFor();
    assert.deepEqual([...h.auth.cuentas.keys()], ["d-nacho-g1" + DOMINIO]);
    const cuenta = await cuentaDelTelefono(p);
    assert.equal(cuenta.usuario, "nacho");
    assert.equal(cuenta.rol, "director");
    let d = await h.dump();
    assert.deepEqual(Object.keys(d.accesos), [cuenta.uid]);
    const a = d.accesos[cuenta.uid];
    assert.deepEqual({ usuario: a.usuario, rol: a.rol, activo: a.activo, gen: a.gen, nombre: a.nombre }, { usuario: "nacho", rol: "director", activo: true, gen: 1, nombre: USUARIOS.nacho.nombre });
    assert.deepEqual(d.ingreso, { "d-nacho": { gen: 1 } });
    assert.deepEqual(d.usuarios, USUARIOS, "la lista de usuarios queda como estaba");

    // Sale y vuelve a entrar: usa la misma cuenta, no crea otra.
    await salir(p);
    assert.equal(await cuentaDelTelefono(p), null, "al salir no queda la cuenta abierta en el teléfono");
    await ingresar(p, "nacho", "sersale123");
    assert.equal(h.auth.cuentas.size, 1);
    assert.equal((await cuentaDelTelefono(p)).uid, cuenta.uid);
    assert.equal(Object.keys((await h.dump()).accesos).length, 1);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("un teléfono con la sesión recordada de antes, sin cuenta: se le pide ingresar de nuevo y queda al día", async () => {
  const h = await launch({ etiqueta: "acc-reingreso", seed: { usuarios: copia(USUARIOS) } });
  const p = h.page;
  try {
    await h.sesion("director", { cuenta: false });
    await h.ir("index.html");
    await enIngreso(p).waitFor();
    await aviso(p, "ingresá de nuevo con tu usuario y clave").waitFor();
    assert.equal(await p.evaluate(() => sessionStorage.getItem("sersale_role")), null);
    await ingresar(p, "nacho", "sersale123");
    assert.equal((await cuentaDelTelefono(p)).rol, "director");
    // Ya con cuenta, al volver a abrir no se le pide nada.
    await p.reload();
    await enPanel(p).waitFor();
    assert.equal(await aviso(p, "ingresá de nuevo").count(), 0);
    assert.deepEqual(erroresReales(h.errores), []);
  } finally {
    await h.close();
  }
});

test("base protegida: entra solo quien ya tiene cuenta con permiso, y desde afuera no se lee nada", async () => {
  const h = await launch({ etiqueta: "acc-cerrada", seed: { usuarios: copia(USUARIOS), clientes: copia(SEED.clientes) } });
  const p = h.page;
  const clientes = Object.keys(SEED.clientes).length;
  try {
    await h.ir("index.html");
    await ingresar(p, "nacho", "sersale123"); // con la base todavía abierta: le deja su cuenta
    const uid = (await cuentaDelTelefono(p)).uid;
    await salir(p);

    await h.reglas(REGLAS); // se protege la base
    assert.equal(await leer(p, "clientes"), "permission-denied", "sin ingresar no se lee");
    assert.equal(await desdeAfuera(h, "/clientes", null), 403);
    assert.equal(await desdeAfuera(h, "/usuarios", null), 403);
    assert.equal(await desdeAfuera(h, "/clientes", "uid-inventado"), 403, "una cuenta cualquiera tampoco");

    // Clave equivocada, usuario inventado y un director que nunca ingresó con el sistema nuevo: no entran.
    await abrirLogin(p);
    assert.equal(await intentar(p, "nacho", "clave-mala"), "Usuario o contraseña incorrectos");
    assert.equal(await intentar(p, "intruso", "clave1234"), "Usuario o contraseña incorrectos");
    // (Su usuario y su clave son correctos y este teléfono tiene la lista guardada, pero la base no le da permiso.)
    assert.match(await intentar(p, "romina", "administracion26"), /todavía no tiene acceso con el sistema nuevo/);
    assert.equal(await enPanel(p).count(), 0);
    assert.equal(await p.evaluate(() => sessionStorage.getItem("sersale_role")), null);
    assert.equal(await cuentaDelTelefono(p), null);
    assert.equal(Object.keys((await h.dump()).accesos).length, 1, "nadie se dio permiso solo");

    // El que tiene cuenta entra y trabaja.
    assert.equal(await intentar(p, "nacho", "sersale123"), null);
    await enPanel(p).waitFor();
    assert.equal((await cuentaDelTelefono(p)).uid, uid);
    assert.equal(await leer(p, "clientes"), clientes);
    assert.equal(await leer(p, "usuarios"), Object.keys(USUARIOS).length);

    // El pase de la cuenta vence cada hora: se renueva solo y sigue leyendo.
    await p.evaluate((clave) => {
      const s = JSON.parse(localStorage.getItem(clave));
      s.vence = 0;
      localStorage.setItem(clave, JSON.stringify(s));
    }, "sersale_cuenta_" + h.projectId);
    await p.reload();
    await enPanel(p).waitFor();
    assert.equal(await leer(p, "clientes"), clientes);
    assert.ok(h.auth.pedidos.some((x) => x.ruta.endsWith("/v1/token")), "pidió renovar el pase");

    // Las otras pantallas (las de la API vieja de Firestore también) leen con la misma cuenta.
    await h.ir("ventas.html");
    assert.equal(await p.evaluate(() => window.sersaleDbCompat().collection("clientes").get().then((s) => s.size, (e) => e.code)), clientes);
    await h.ir("pedidos.html");
    await h.sincronizar();
    assert.equal(await leer(p, "clientes"), clientes);
    assert.deepEqual(erroresReales(h.errores).filter((e) => !/permission|Missing or insufficient/i.test(e.texto)), []);
  } finally {
    await h.close();
  }
});

test("base protegida: alta de un director, cambio de su clave y baja; la clave vieja y la cuenta vieja dejan de servir", async () => {
  const h = await launch({ etiqueta: "acc-usuarios", seed: { usuarios: copia(USUARIOS), clientes: copia(SEED.clientes) } });
  const p = h.page;
  try {
    await h.ir("index.html");
    await ingresar(p, "nacho", "sersale123");
    await h.reglas(REGLAS);

    // Alta: el usuario nuevo queda con cuenta y permiso sin que nacho pierda su sesión.
    const uidNacho = (await cuentaDelTelefono(p)).uid;
    await abrirUsuarios(p);
    await boton(p, "Nuevo Director").tap();
    await p.fill("#__nu_nombre", "Pedro Gómez");
    await p.fill("#__nu_usuario", "pedro");
    await p.fill("#__nu_pwd", "pedro2026");
    await p.fill("#__nu_pwd2", "pedro2026");
    await boton(p, "Crear usuario").tap();
    await fila(p, "pedro").waitFor();
    assert.equal((await cuentaDelTelefono(p)).uid, uidNacho);
    let [[uidPedro1, a1]] = await accesosDe(h, "pedro");
    assert.equal(a1.activo, true);
    assert.equal(await desdeAfuera(h, "/clientes", uidPedro1), 200);

    // Pedro entra con su clave.
    await boton(p, "Cerrar").tap();
    await salir(p);
    await ingresar(p, "pedro", "pedro2026");
    await p.getByText("Pedro Gómez").first().waitFor();
    assert.equal((await cuentaDelTelefono(p)).uid, uidPedro1);
    await salir(p);

    // Nacho le cambia la clave.
    await ingresar(p, "nacho", "sersale123");
    await abrirUsuarios(p);
    await fila(p, "pedro").locator('button[data-usr-accion="clave"]').tap();
    await hoja(p, "Guardar", "nueva-clave-9");
    await aviso(p, "Contraseña de @pedro actualizada").waitFor();
    const cuentasPedro = await accesosDe(h, "pedro");
    assert.equal(cuentasPedro.length, 2);
    assert.equal(cuentasPedro.find(([uid]) => uid === uidPedro1)[1].activo, false, "la cuenta anterior queda sin acceso");
    const [uidPedro2] = cuentasPedro.find(([, a]) => a.activo === true);
    assert.equal((await h.dump()).ingreso["d-pedro"].gen, 2);
    assert.equal(await desdeAfuera(h, "/clientes", uidPedro1), 403, "un teléfono que seguía con la sesión vieja ya no lee");
    assert.equal(await desdeAfuera(h, "/clientes", uidPedro2), 200);
    await boton(p, "Cerrar").tap();
    await salir(p);
    await abrirLogin(p);
    assert.equal(await intentar(p, "pedro", "pedro2026"), "Usuario o contraseña incorrectos");
    assert.equal(await intentar(p, "pedro", "nueva-clave-9"), null);
    await enPanel(p).waitFor();
    await salir(p);

    // Nacho cambia su propia clave: sigue adentro, con la cuenta nueva.
    await ingresar(p, "nacho", "sersale123");
    await abrirUsuarios(p);
    await fila(p, "nacho").locator('button[data-usr-accion="clave"]').tap();
    await hoja(p, "Guardar", "nacho-nueva-1");
    await aviso(p, "Contraseña de @nacho actualizada").waitFor();
    const uidNacho2 = (await cuentaDelTelefono(p)).uid;
    assert.notEqual(uidNacho2, uidNacho);
    assert.equal(await desdeAfuera(h, "/clientes", uidNacho), 403);
    assert.equal(await leer(p, "clientes"), Object.keys(SEED.clientes).length, "sigue trabajando sin volver a ingresar");

    // Desactiva a Pedro: su cuenta pierde el acceso; al reactivarlo lo recupera; al eliminarlo lo pierde.
    await fila(p, "pedro").locator('button[data-usr-accion="desactivar"]').tap();
    await fila(p, "pedro").locator('button[data-usr-accion="activar"]').waitFor();
    assert.equal(await desdeAfuera(h, "/clientes", uidPedro2), 403);
    await fila(p, "pedro").locator('button[data-usr-accion="activar"]').tap();
    await fila(p, "pedro").locator('button[data-usr-accion="desactivar"]').waitFor();
    assert.equal(await desdeAfuera(h, "/clientes", uidPedro2), 200);
    assert.equal(await desdeAfuera(h, "/clientes", uidPedro1), 403, "al reactivar vuelve solo la cuenta vigente");
    await fila(p, "pedro").locator('button[data-usr-accion="eliminar"]').tap();
    await hoja(p, "Eliminar");
    await aviso(p, "Usuario @pedro eliminado").waitFor();
    assert.equal(await desdeAfuera(h, "/clientes", uidPedro2), 403);
    await boton(p, "Cerrar").tap();
    await salir(p);
    await abrirLogin(p);
    assert.equal(await intentar(p, "pedro", "nueva-clave-9"), "Usuario desactivado");
    assert.equal(await intentar(p, "nacho", "sersale123"), "Usuario o contraseña incorrectos");
    assert.equal(await intentar(p, "nacho", "nacho-nueva-1"), null);
    await enPanel(p).waitFor();
    assert.deepEqual(erroresReales(h.errores).filter((e) => !/permission|Missing or insufficient/i.test(e.texto)), []);
  } finally {
    await h.close();
  }
});

test("PIN del depósito: sin PIN el Operario entra como siempre; con PIN lo pone una vez por teléfono y al cambiarlo se vuelve a pedir", async () => {
  const h = await launch({ etiqueta: "acc-pin", seed: { usuarios: copia(USUARIOS), pedidos: copia(SEED.pedidos || {}), clientes: copia(SEED.clientes) } });
  const p = h.page;
  const enDeposito = () => p.waitForURL(/pedidos\.html/);
  const volverAlIngreso = async () => {
    await p.goto(h.origin + "/index.html");
    await botonOperario(p).waitFor();
  };
  try {
    // Sin PIN cargado: entra sin clave, como hasta ahora.
    await h.ir("index.html");
    await botonOperario(p).tap();
    await enDeposito();
    assert.equal(await p.evaluate(() => sessionStorage.getItem("sersale_role")), "operario");
    await p.evaluate(() => sessionStorage.clear());
    await volverAlIngreso();

    // Un Director fija el PIN (y uno mal escrito no se guarda).
    await ingresar(p, "nacho", "sersale123");
    await abrirUsuarios(p);
    await p.locator("#__pin_dep_estado", { hasText: "Sin PIN" }).waitFor();
    await boton(p, "PIN del depósito").tap();
    await hoja(p, "Guardar", "12ab");
    await aviso(p, "El PIN tiene que tener 6 números").waitFor();
    assert.equal((await accesosDe(h, "operario", "operario")).length, 0);
    await boton(p, "PIN del depósito").tap();
    await hoja(p, "Guardar", "123456");
    await aviso(p, "PIN del depósito guardado").waitFor();
    await p.locator("#__pin_dep_estado", { hasText: "entra con el PIN" }).waitFor();
    const [[uidOpe1, acc]] = await accesosDe(h, "operario", "operario");
    assert.equal(acc.activo, true);
    assert.equal((await h.dump()).ingreso.operario.gen, 1);
    assert.equal((await cuentaDelTelefono(p)).rol, "director", "el Director no pierde su sesión al fijar el PIN");
    await boton(p, "Cerrar").tap();
    await salir(p);
    await h.reglas(REGLAS); // de acá en más, con la base protegida

    // El Operario: PIN equivocado no entra; con el correcto entra y trabaja.
    await botonOperario(p).tap();
    await p.locator("#__pin_campo").waitFor();
    await p.fill("#__pin_campo", "000000");
    await p.tap("#__pin_btn");
    await p.locator("#__pin_msg", { hasText: "PIN incorrecto" }).waitFor();
    assert.equal(await p.evaluate(() => sessionStorage.getItem("sersale_role")), null);
    await p.fill("#__pin_campo", "123456");
    await p.tap("#__pin_btn");
    await enDeposito();
    await h.esperarApp();
    assert.equal((await cuentaDelTelefono(p)).uid, uidOpe1);
    assert.equal(await leer(p, "clientes"), Object.keys(SEED.clientes).length);
    assert.equal(await leer(p, "usuarios"), "permission-denied", "el Operario no llega a los usuarios");

    // Otro día, mismo teléfono: no se le vuelve a pedir.
    await p.evaluate(() => sessionStorage.clear());
    await volverAlIngreso();
    await botonOperario(p).tap();
    await enDeposito();
    assert.equal(await p.locator("#__pin_modal").count(), 0);

    // Desde otro teléfono un Director cambió el PIN: la cuenta vieja queda sin acceso.
    const nueva = h.auth.crear("operario-g2" + DOMINIO, "sersale:654321");
    await h.sembrar({
      accesos: { [uidOpe1]: { ...acc, activo: false }, [nueva.uid]: { usuario: "operario", rol: "operario", nombre: "Depósito", activo: true, gen: 2 } },
      ingreso: { operario: { gen: 2 } },
    });
    await p.evaluate(() => sessionStorage.clear());
    await volverAlIngreso();
    await botonOperario(p).tap();
    await p.locator("#__pin_campo").waitFor();
    await p.fill("#__pin_campo", "123456");
    await p.tap("#__pin_btn");
    await p.locator("#__pin_msg", { hasText: "PIN incorrecto" }).waitFor();
    await p.fill("#__pin_campo", "654321");
    await p.tap("#__pin_btn");
    await enDeposito();
    assert.equal((await cuentaDelTelefono(p)).uid, nueva.uid);
    assert.deepEqual(erroresReales(h.errores).filter((e) => !/permission|Missing or insufficient/i.test(e.texto)), []);
  } finally {
    await h.close();
  }
});

test("base protegida: un teléfono al que le quitaron el acceso vuelve al ingreso con un aviso, sin pantallas vacías", async () => {
  const h = await launch({
    etiqueta: "acc-echado",
    rol: "operario",
    reglas: REGLAS,
    seed: { clientes: copia(SEED.clientes), accesos: { "uid-operario": { usuario: "operario", rol: "operario", activo: false, gen: 1 } }, ingreso: { operario: { gen: 2 } } },
  });
  const p = h.page;
  try {
    await p.goto(h.origin + "/pedidos.html");
    await p.waitForURL(/index\.html/);
    await botonOperario(p).waitFor();
    await aviso(p, "Tu acceso ya no es válido en este teléfono").waitFor();
    assert.equal(await cuentaDelTelefono(p), null);
    assert.equal(await p.evaluate(() => sessionStorage.getItem("sersale_role")), null);
  } finally {
    await h.close();
  }
});

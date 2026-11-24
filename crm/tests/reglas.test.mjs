// Reglas de seguridad de Firestore (crm/firestore.rules): quién puede leer y
// escribir qué, probado contra el emulador con las reglas cargadas. No usa el
// navegador: le habla al emulador como lo haría cualquiera desde afuera del
// sistema, con y sin una cuenta.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startEmulator, newProjectId, seedDb, setRules, getDocument } from "./lib/emulator.mjs";
import { tokenFalso } from "./lib/auth-falso.mjs";

const REGLAS = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

async function preparar(etiqueta) {
  const emu = await startEmulator();
  const projectId = newProjectId(etiqueta);
  await seedDb(projectId, {
    accesos: {
      "uid-dir": { usuario: "nacho", rol: "director", activo: true },
      "uid-ope": { usuario: "operario", rol: "operario", activo: true },
      "uid-baja": { usuario: "viejo", rol: "director", activo: false },
    },
    ingreso: { nacho: { gen: 1 } },
    usuarios: { nacho: { usuario: "nacho", nombre: "Nacho", activo: true, passwordHash: "abc" } },
    clientes: { c1: { nombre: "Almacén Don Pepe" } },
    cuentas_corrientes: { c1: { saldo: 1500 } },
    reservas: { r1: { nombre: "Marta", kg: 3.5 } },
  });
  await setRules(projectId, REGLAS);
  const base = `http://${emu.hostPort}/v1/projects/${projectId}/databases/(default)/documents`;
  const pedir = (metodo, ruta, uid, cuerpo) =>
    fetch(base + ruta, {
      method: metodo,
      headers: { "Content-Type": "application/json", ...(uid ? { Authorization: "Bearer " + tokenFalso(projectId, uid) } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    }).then((r) => r.status);
  const campo = (v) => ({ fields: { nota: { stringValue: v } } });
  return { projectId, pedir, campo };
}

test("sin cuenta no se lee ni se escribe nada del sistema", async () => {
  const { projectId, pedir, campo } = await preparar("reglas-anon");
  for (const ruta of ["/clientes/c1", "/clientes", "/cuentas_corrientes/c1", "/reservas", "/usuarios/nacho", "/usuarios", "/accesos/uid-dir", "/accesos", "/ingreso"]) {
    assert.equal(await pedir("GET", ruta, null), 403, "leer " + ruta + " sin cuenta");
  }
  assert.equal(await pedir("PATCH", "/clientes/c1", null, campo("x")), 403);
  assert.equal(await pedir("DELETE", "/cuentas_corrientes/c1", null), 403);
  assert.equal(await pedir("PATCH", "/accesos/intruso", null, { fields: { rol: { stringValue: "director" }, activo: { booleanValue: true } } }), 403);
  assert.deepEqual(await getDocument(projectId, "clientes/c1"), { nombre: "Almacén Don Pepe" });
  // Lo único que se puede consultar antes de ingresar: qué cuenta le toca a UN usuario.
  assert.equal(await pedir("GET", "/ingreso/nacho", null), 200);
  assert.equal(await pedir("PATCH", "/ingreso/nacho", null, { fields: { gen: { integerValue: "9" } } }), 403);
});

test("una cuenta recién creada, sin permiso cargado, no entra (y no se lo puede dar sola)", async () => {
  const { projectId, pedir, campo } = await preparar("reglas-intruso");
  assert.equal(await pedir("GET", "/clientes/c1", "uid-intruso"), 403);
  assert.equal(await pedir("PATCH", "/clientes/c1", "uid-intruso", campo("x")), 403);
  assert.equal(await pedir("PATCH", "/accesos/uid-intruso", "uid-intruso", { fields: { rol: { stringValue: "director" }, activo: { booleanValue: true } } }), 403);
  assert.equal(await getDocument(projectId, "accesos/uid-intruso"), null);
});

test("un usuario desactivado deja de entrar aunque su cuenta siga existiendo", async () => {
  const { pedir, campo } = await preparar("reglas-baja");
  assert.equal(await pedir("GET", "/clientes/c1", "uid-baja"), 403);
  assert.equal(await pedir("PATCH", "/reservas/r1", "uid-baja", campo("x")), 403);
  assert.equal(await pedir("PATCH", "/accesos/uid-baja", "uid-baja", { fields: { activo: { booleanValue: true } } }), 403);
});

test("el Operario trabaja con los datos pero no ve ni toca usuarios y permisos", async () => {
  const { projectId, pedir, campo } = await preparar("reglas-ope");
  assert.equal(await pedir("GET", "/clientes/c1", "uid-ope"), 200);
  assert.equal(await pedir("GET", "/reservas", "uid-ope"), 200);
  assert.equal(await pedir("PATCH", "/reservas/r1", "uid-ope", campo("retirado")), 200);
  assert.equal(await pedir("GET", "/accesos/uid-ope", "uid-ope"), 200, "su propio permiso sí lo lee");
  for (const ruta of ["/usuarios/nacho", "/usuarios", "/accesos/uid-dir", "/accesos"]) {
    assert.equal(await pedir("GET", ruta, "uid-ope"), 403, "leer " + ruta);
  }
  assert.equal(await pedir("PATCH", "/usuarios/nacho", "uid-ope", campo("x")), 403);
  assert.equal(await pedir("PATCH", "/accesos/uid-ope", "uid-ope", { fields: { rol: { stringValue: "director" }, activo: { booleanValue: true } } }), 403);
  assert.equal(await pedir("PATCH", "/ingreso/nacho", "uid-ope", { fields: { gen: { integerValue: "9" } } }), 403);
  assert.equal((await getDocument(projectId, "accesos/uid-ope")).rol, "operario");
});

test("el Director hace todo, incluido dar y quitar accesos", async () => {
  const { projectId, pedir, campo } = await preparar("reglas-dir");
  for (const ruta of ["/clientes", "/cuentas_corrientes/c1", "/usuarios", "/usuarios/nacho", "/accesos", "/accesos/uid-ope", "/ingreso"]) {
    assert.equal(await pedir("GET", ruta, "uid-dir"), 200, "leer " + ruta);
  }
  assert.equal(await pedir("PATCH", "/clientes/c1", "uid-dir", campo("ok")), 200);
  assert.equal(await pedir("PATCH", "/accesos/uid-nuevo", "uid-dir", { fields: { rol: { stringValue: "director" }, activo: { booleanValue: true } } }), 200);
  assert.equal(await pedir("GET", "/clientes/c1", "uid-nuevo"), 200, "el que recibió acceso ya entra");
  assert.equal(await pedir("PATCH", "/accesos/uid-ope?updateMask.fieldPaths=activo", "uid-dir", { fields: { activo: { booleanValue: false } } }), 200);
  assert.equal(await pedir("GET", "/clientes/c1", "uid-ope"), 403, "al que se le quitó el acceso ya no entra");
  assert.equal(await pedir("PATCH", "/ingreso/nacho", "uid-dir", { fields: { gen: { integerValue: "2" } } }), 200);
  assert.equal((await getDocument(projectId, "ingreso/nacho")).gen, 2);
});

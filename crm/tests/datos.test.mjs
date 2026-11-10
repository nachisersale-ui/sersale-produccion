// La capa de datos (js/fb.js): lecturas desde la copia local, frescura,
// transacciones y trabajo sin conexión, con el SDK real y el emulador.
import test from "node:test";
import assert from "node:assert/strict";
import { launch } from "./lib/harness.mjs";

const SEED = {
  clientes: {
    c1: { nombre: "Almacén Don Pepe", direccion: "Caseros 100" },
    c2: { nombre: "Carnicería El Toro", direccion: "" },
  },
  cuentas_corrientes: { cc1: { nombre: "Almacén Don Pepe", saldo: 1000 } },
};

async function abrir(opts = {}) {
  const h = await launch({ rol: "director", etiqueta: "datos", seed: SEED, ...opts });
  await h.ir("pedidos.html");
  await h.sincronizar();
  return h;
}
const leer = (h, col) =>
  h.page.evaluate(async (col) => {
    const m = await import("/js/fb.js");
    const antes = (m.estadoDatos()[col] || {}).lecturasLocales || 0;
    const snap = await m.getDocs(m.query(m.collection(m.db, col)));
    const despues = (m.estadoDatos()[col] || {}).lecturasLocales || 0;
    return { docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })), local: despues > antes };
  }, col);

test("con la copia al día, getDocs responde desde el teléfono", async () => {
  const h = await abrir();
  try {
    const r = await leer(h, "clientes");
    assert.equal(r.docs.length, 2);
    assert.equal(r.local, true, "debería haberse leído de la copia local");
  } finally {
    await h.close();
  }
});

test("lo que carga otro teléfono aparece solo, sin recargar", async () => {
  const h = await abrir();
  try {
    await h.sembrar({ clientes: { c3: { nombre: "Fiambrería Nueva" } } });
    await h.page.waitForFunction(async () => {
      const m = await import("/js/fb.js");
      return (await m.getDocs(m.collection(m.db, "clientes"))).size === 3;
    });
    const r = await leer(h, "clientes");
    assert.equal(r.local, true);
    assert.ok(r.docs.some((d) => d.nombre === "Fiambrería Nueva"));
  } finally {
    await h.close();
  }
});

test("después de una transacción, la lectura siguiente ya ve el cambio", async () => {
  const h = await abrir();
  try {
    const saldo = await h.page.evaluate(async () => {
      const m = await import("/js/fb.js");
      const ref = m.doc(m.db, "cuentas_corrientes", "cc1");
      await m.runTransaction(m.db, async (tx) => {
        const s = await tx.get(ref);
        tx.update(ref, { saldo: s.data().saldo + 500 });
      });
      const snap = await m.getDocs(m.collection(m.db, "cuentas_corrientes"));
      return snap.docs[0].data().saldo;
    });
    assert.equal(saldo, 1500);
  } finally {
    await h.close();
  }
});

test("transacciones seguidas: cada lectura ve el último saldo (20 veces)", async () => {
  const h = await abrir();
  try {
    const saldos = await h.page.evaluate(async () => {
      const m = await import("/js/fb.js");
      const ref = m.doc(m.db, "cuentas_corrientes", "cc1");
      const vistos = [];
      for (let i = 0; i < 20; i++) {
        await m.runTransaction(m.db, async (tx) => {
          const s = await tx.get(ref);
          tx.update(ref, { saldo: s.data().saldo + 1 });
        });
        const todos = await m.getDocs(m.collection(m.db, "cuentas_corrientes"));
        const filtrado = await m.getDocs(m.query(m.collection(m.db, "cuentas_corrientes"), m.where("nombre", "==", "Almacén Don Pepe")));
        const uno = await m.getDoc(ref);
        vistos.push([todos.docs[0].data().saldo, filtrado.docs[0].data().saldo, uno.data().saldo]);
      }
      return vistos;
    });
    saldos.forEach((v, i) => assert.deepEqual(v, [1001 + i, 1001 + i, 1001 + i], "vuelta " + i));
  } finally {
    await h.close();
  }
});

test("una transacción que crea y borra documentos se refleja enseguida", async () => {
  const h = await abrir();
  try {
    const nombres = await h.page.evaluate(async () => {
      const m = await import("/js/fb.js");
      await m.runTransaction(m.db, async (tx) => {
        tx.set(m.doc(m.db, "clientes", "nuevo"), { nombre: "Creado en transacción" });
        tx.delete(m.doc(m.db, "clientes", "c2"));
      });
      return (await m.getDocs(m.collection(m.db, "clientes"))).docs.map((d) => d.data().nombre).sort();
    });
    assert.deepEqual(nombres, ["Almacén Don Pepe", "Creado en transacción"]);
  } finally {
    await h.close();
  }
});

test("una escritura común se ve enseguida en la lectura siguiente", async () => {
  const h = await abrir();
  try {
    const r = await h.page.evaluate(async () => {
      const m = await import("/js/fb.js");
      await m.updateDoc(m.doc(m.db, "clientes", "c2"), { direccion: "Rondeau 3000" });
      await m.addDoc(m.collection(m.db, "clientes"), { nombre: "Recién creado" });
      const snap = await m.getDocs(m.query(m.collection(m.db, "clientes"), m.orderBy("nombre", "asc")));
      return snap.docs.map((d) => d.data());
    });
    assert.equal(r.length, 3);
    assert.equal(r.find((c) => c.nombre === "Carnicería El Toro").direccion, "Rondeau 3000");
  } finally {
    await h.close();
  }
});

test("sin señal: se leen los datos guardados y lo cargado se envía al volver", async () => {
  const h = await abrir();
  try {
    await h.sinRed(true);
    const r = await h.page.evaluate(async () => {
      const m = await import("/js/fb.js");
      m.addDoc(m.collection(m.db, "clientes"), { nombre: "Cargado sin señal" }); // queda en cola
      const snap = await m.getDocs(m.collection(m.db, "clientes"));
      return snap.docs.map((d) => d.data().nombre);
    });
    assert.equal(r.length, 3);
    assert.ok(r.includes("Cargado sin señal"));
    assert.equal(Object.keys((await h.dump()).clientes).length, 2, "todavía no llegó al servidor");
    await h.sinRed(false);
    await h.page.evaluate(async () => {
      const m = await import("/js/fb.js");
      await m.waitForPendingWrites(m.db);
    });
    const nombres = Object.values((await h.dump()).clientes).map((c) => c.nombre);
    assert.ok(nombres.includes("Cargado sin señal"), "llegó al servidor al volver la señal");
  } finally {
    await h.close();
  }
});

test("lo cargado sin señal sobrevive a cerrar y volver a abrir la app", async () => {
  const h = await abrir();
  try {
    await h.sinRed(true);
    await h.page.evaluate(async () => {
      const m = await import("/js/fb.js");
      m.addDoc(m.collection(m.db, "clientes"), { nombre: "Persistente" });
      await new Promise((r) => setTimeout(r, 400)); // darle tiempo a guardarlo en el teléfono
    });
    await h.page.close();
    await h.sinRed(false);
    const p2 = await h.context.newPage();
    await h.ir("pedidos.html", p2);
    await p2.evaluate(async () => {
      const m = await import("/js/fb.js");
      await m.waitForPendingWrites(m.db);
    });
    const nombres = Object.values((await h.dump()).clientes).map((c) => c.nombre);
    assert.ok(nombres.includes("Persistente"));
  } finally {
    await h.close();
  }
});

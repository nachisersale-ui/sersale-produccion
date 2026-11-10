// Conexión única a Firestore para todas las páginas del CRM.
//
// Hace tres cosas además de inicializar Firebase:
//
//  1. Guarda los datos en el teléfono (IndexedDB), así lo que se cargó sin
//     señal no se pierde al cerrar la app y se envía solo cuando vuelve.
//
//  2. Lecturas rápidas: las pantallas piden colecciones enteras con getDocs()
//     cada vez que se abren. Acá se mantiene una escucha viva por colección y,
//     mientras esa escucha esté al día con el servidor, getDocs() responde
//     desde la copia local al instante (y sin costo de lecturas). Si la copia
//     todavía no está al día se pregunta al servidor, igual que antes.
//
//  3. En las pruebas automáticas se conecta al emulador local en vez de a la
//     base real (solo si la página corre en localhost).
import { initializeApp } from "../vendor/firebase-app.js";
import * as fs from "../vendor/firebase-firestore.js";

export * from "../vendor/firebase-firestore.js";

const enLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const PRUEBA = enLocal ? window.__SERSALE_TEST__ || null : null;

const firebaseConfig = {
  apiKey: "AIzaSyDyijnox-MMjZTefC3LpT-KApfcU6uev8g",
  authDomain: "sersale-produccion.firebaseapp.com",
  projectId: "sersale-produccion",
  storageBucket: "sersale-produccion.firebasestorage.app",
  messagingSenderId: "925974326060",
  appId: "1:925974326060:web:12143f2ebb812d19dfda89",
};

export const app = initializeApp(PRUEBA ? { ...firebaseConfig, projectId: PRUEBA.projectId } : firebaseConfig);

let guardaEnTelefono = false; // ¿los cambios quedan en el teléfono aunque se cierre la app?

function crearDb() {
  const sinPersistencia = PRUEBA && PRUEBA.persistencia === false;
  if (!sinPersistencia) {
    try {
      const base = fs.initializeFirestore(app, {
        // Sin tope de tamaño. Con el tope de fábrica (40 MB), cuando la copia lo
        // pasa Firestore borra del teléfono las colecciones que hace más que no
        // se abren; sin señal esas pantallas quedaban vacías o por la mitad como
        // si fuera lo que hay (acá se anota "esta colección está entera").
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager(), cacheSizeBytes: fs.CACHE_SIZE_UNLIMITED }),
      });
      guardaEnTelefono = true;
      return base;
    } catch (e) {
      console.warn("Firestore sin guardado local:", e);
    }
  }
  return fs.getFirestore(app);
}

export const db = crearDb();
if (PRUEBA) fs.connectFirestoreEmulator(db, PRUEBA.emulatorHost, PRUEBA.emulatorPort);

// initializeFirestore no avisa si el teléfono no deja usar su base local
// (IndexedDB): Firestore sigue, en silencio, con una copia en memoria que se
// pierde al cerrar la app. En ese caso no se puede decir "guardado en el
// teléfono": se prueba la base local y, si no anda, los guardados vuelven a
// esperar al servidor y las marcas de "colección bajada" de otros días no valen.
function probarGuardado() {
  return new Promise((ok) => {
    let listo = false;
    const fin = (anda) => {
      if (listo) return;
      listo = true;
      ok(anda);
    };
    try {
      const pedido = indexedDB.open("sersale_prueba_guardado");
      pedido.onsuccess = () => {
        try {
          pedido.result.close();
        } catch (e) {}
        fin(true);
      };
      pedido.onblocked = () => fin(true);
      pedido.onerror = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        fin(false);
      };
    } catch (e) {
      fin(false);
    }
    setTimeout(() => fin(true), 4000); // no contestó: no se puede afirmar que no ande
  });
}
if (guardaEnTelefono) {
  probarGuardado().then((anda) => {
    if (anda) return;
    guardaEnTelefono = false;
    console.warn("Este teléfono no deja guardar datos (IndexedDB): se trabaja sin copia local.");
  });
}

// ── Lecturas rápidas ───────────────────────────────────────────────────────

const ESPERA_PRIMERA_SYNC_MS = 6000; // cuánto esperar a la escucha antes de ir al servidor

const origen = new WeakMap(); // referencia o consulta -> nombre de la colección raíz
const escuchas = new Map(); // nombre de colección -> estado de su escucha

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sinConexion = () => typeof navigator !== "undefined" && navigator.onLine === false;

// Señal entrecortada: el teléfono dice que hay conexión, pero el servidor no
// contestó y la lectura se respondió con la copia guardada (o se confirmó una
// transacción y la copia no pudo ponerse al día). Lo que se ve puede ser viejo:
// se avisa (js/shell.js muestra una franja) hasta que las escuchas vuelven a
// estar al día con el servidor.
let atrasado = false;
let relojAtraso = null;
function marcarAtrasado() {
  if (atrasado) return;
  atrasado = true;
  avisar();
  // Mientras dure, se insiste en reconectar (Firestore solo puede tardar hasta un minuto
  // entre intentos): apenas el servidor contesta, las escuchas se ponen al día y el aviso se va.
  if (!relojAtraso) {
    relojAtraso = setInterval(() => {
      if (!atrasado) {
        clearInterval(relojAtraso);
        relojAtraso = null;
      } else if (!sinConexion()) reconectar();
    }, 8000);
  }
}

function avisar() {
  let alDia = true;
  for (const st of escuchas.values()) if (!st.sincronizado) alDia = false;
  if (alDia) atrasado = false;
  window.dispatchEvent(new CustomEvent("sersale:datos", { detail: { alDia, enLinea: !sinConexion(), atrasado: atrasado && !sinConexion() } }));
}

// Firestore, cuando falla la conexión, espera cada vez más (hasta un minuto)
// antes de volver a intentar. Si se sabe que hay señal (acaba de confirmarse
// una transacción), se le pide que reconecte ya. Como mucho una vez cada 15 s.
let ultimaReconexion = 0;
async function reconectar() {
  if (Date.now() - ultimaReconexion < 15000) return false;
  ultimaReconexion = Date.now();
  try {
    await fs.disableNetwork(db);
    await fs.enableNetwork(db);
    return true;
  } catch (e) {
    console.warn("No se pudo reiniciar la conexión:", e);
    return false;
  }
}

function vigilar(nombre) {
  let st = escuchas.get(nombre);
  if (st) return st;
  st = { sincronizado: false, lecturas: 0 };
  st.primeraSync = new Promise((listo) => {
    st.cortar = fs.onSnapshot(
      fs.collection(db, nombre),
      { includeMetadataChanges: true },
      (snap) => {
        st.sincronizado = !snap.metadata.fromCache;
        if (st.sincronizado) {
          marcarGuardada(nombre);
          listo();
        }
        avisar();
      },
      (err) => {
        // Sin permiso o error del servidor: se deja de usar la copia local
        // para esta colección y las lecturas vuelven al camino normal.
        console.warn("Escucha de " + nombre + " caída:", err && err.code);
        st.sincronizado = false;
        escuchas.delete(nombre);
        listo();
        avisar();
      }
    );
  });
  escuchas.set(nombre, st);
  return st;
}

// Se anota en el teléfono qué colecciones se bajaron completas alguna vez.
// Sin señal y sin esa marca no hay nada guardado para mostrar: es mejor decir
// "sin conexión" que mostrar listas vacías o saldos en cero como si fueran reales.
const claveGuardada = (nombre) => "sersale_copia_" + app.options.projectId + "_" + nombre;
const bajadasAhora = new Set(); // colecciones que se bajaron completas desde que se abrió esta página
function marcarGuardada(nombre) {
  bajadasAhora.add(nombre);
  try {
    localStorage.setItem(claveGuardada(nombre), String(Date.now()));
  } catch (e) {}
}
function hayCopiaGuardada(nombre) {
  // Sin guardado en el teléfono la copia vive en memoria: solo vale lo bajado en esta página.
  if (!guardaEnTelefono) return bajadasAhora.has(nombre);
  try {
    return !!localStorage.getItem(claveGuardada(nombre));
  } catch (e) {
    return true;
  }
}
function errorSinDatos(nombre) {
  const e = new Error("Sin conexión y sin datos guardados de " + nombre + ". Conectate para cargarlos.");
  e.code = "unavailable";
  e.name = "FirebaseError";
  return e;
}

/** Empieza a traer estas colecciones apenas carga la página. */
export function precalentar(nombres) {
  for (const n of nombres) vigilar(n);
}

/** Estado de la copia local, para diagnóstico y pruebas. */
export function estadoDatos() {
  const out = {};
  for (const [n, st] of escuchas) out[n] = { sincronizado: st.sincronizado, lecturasLocales: st.lecturas };
  return out;
}

export function collection(padre, ...ruta) {
  const ref = fs.collection(padre, ...ruta);
  if (padre === db && ruta.length === 1 && !String(ruta[0]).includes("/")) origen.set(ref, ruta[0]);
  return ref;
}

export function query(base, ...restricciones) {
  const q = fs.query(base, ...restricciones);
  const n = origen.get(base);
  if (n) origen.set(q, n);
  return q;
}

export function doc(padre, ...ruta) {
  const ref = fs.doc(padre, ...ruta);
  if (padre === db && ruta.length === 2 && !String(ruta[0]).includes("/")) origen.set(ref, ruta[0]);
  else if (ruta.length <= 1 && origen.has(padre)) origen.set(ref, origen.get(padre));
  return ref;
}

async function copiaAlDia(nombre) {
  const st = vigilar(nombre);
  if (st.sincronizado) return st;
  if (sinConexion()) {
    if (!hayCopiaGuardada(nombre)) throw errorSinDatos(nombre);
    return st; // sin señal: lo guardado es lo mejor que hay
  }
  await Promise.race([st.primeraSync, espera(ESPERA_PRIMERA_SYNC_MS)]);
  return st.sincronizado ? st : null;
}

export async function getDocs(q) {
  const nombre = origen.get(q);
  if (!nombre) return fs.getDocs(q);
  const st = await copiaAlDia(nombre);
  if (!st) return delServidor(q, nombre);
  try {
    const snap = await fs.getDocsFromCache(q);
    st.lecturas++;
    return snap;
  } catch (e) {
    return delServidor(q, nombre);
  }
}

// Lectura normal del SDK. Si el servidor no responde, el SDK contesta con lo
// que tenga guardado; si en este teléfono esa colección no se bajó nunca, eso
// es una lista vacía que NO significa "no hay nada" (con eso, por ejemplo, el
// ingreso creía que no existía ningún usuario). En ese caso se informa el error.
async function delServidor(q, nombre) {
  const snap = await fs.getDocs(q);
  if (snap.metadata.fromCache) {
    if (!hayCopiaGuardada(nombre)) throw errorSinDatos(nombre);
    // Contestó la copia guardada, no el servidor: puede ser vieja. Se avisa en pantalla.
    if (!sinConexion() && escuchas.has(nombre)) marcarAtrasado();
  }
  return snap;
}

export async function getDoc(ref) {
  const nombre = origen.get(ref);
  // Solo se responde desde la copia local si esa colección ya se está escuchando.
  const st = nombre && escuchas.get(nombre);
  if (!st) return fs.getDoc(ref);
  if (!st.sincronizado) {
    const snap = await fs.getDoc(ref);
    if (snap.metadata.fromCache && !sinConexion() && escuchas.has(nombre)) marcarAtrasado();
    return snap;
  }
  try {
    const snap = await fs.getDocFromCache(ref);
    st.lecturas++;
    return snap;
  } catch (e) {
    return fs.getDoc(ref); // no está en la copia: el servidor dice si existe
  }
}

// Las transacciones se confirman directo en el servidor y la copia local se
// entera un instante después, por la escucha. Para que la pantalla que lee
// apenas termina de guardar vea el cambio, al confirmar se vuelve a pedir al
// servidor cada documento que la transacción escribió: eso actualiza la copia
// local antes de devolver el control.
//
// Con señal entrecortada esa relectura puede fallar aunque la transacción se
// haya guardado (la confirmación va por un pedido suelto; la relectura, por el
// canal de escucha, que puede estar esperando para reconectar). Como acaba de
// pasar la confirmación, hay señal: se reconecta ya y se intenta de nuevo. Si
// tampoco se puede, la copia del teléfono quedó atrás del servidor y se avisa
// en pantalla, en vez de mostrar el saldo o el stock de antes como si nada.
//
// OJO al escribir una transacción: si la confirmación llega al servidor pero la
// respuesta se pierde, Firestore vuelve a ejecutar la función y a guardar. Todo
// lo que sume o reste tiene que dar lo mismo si se ejecuta dos veces (id fijo
// del movimiento y leerlo antes de sumar; ver ccLeerAsiento en src/pedidos/00).
export async function runTransaction(base, fn, opciones) {
  const escritos = new Map();
  const resultado = await fs.runTransaction(
    base,
    (tx) => {
      escritos.clear(); // la función puede volver a ejecutarse si hubo choque con otro teléfono
      const anotar = (ref) => escritos.set(ref.path, ref);
      const envoltura = {
        get: (ref) => tx.get(ref),
        set: (ref, ...resto) => (anotar(ref), tx.set(ref, ...resto), envoltura),
        update: (ref, ...resto) => (anotar(ref), tx.update(ref, ...resto), envoltura),
        delete: (ref) => (anotar(ref), tx.delete(ref), envoltura),
      };
      return fn(envoltura);
    },
    opciones
  );
  const refs = [...escritos.values()];
  const releer = () => Promise.all(refs.map((ref) => fs.getDocFromServer(ref))).then(() => true, () => false);
  let alDia = await releer();
  if (!alDia && (await reconectar())) alDia = await Promise.race([releer(), espera(4000).then(() => false)]);
  if (!alDia && !sinConexion() && refs.some((ref) => escuchas.has(ref.path.split("/")[0]))) marcarAtrasado();
  return resultado;
}

// ── Escrituras ─────────────────────────────────────────────────────────────
//
// Para Firestore un cambio "termina" cuando el servidor lo confirma. Sin señal
// eso no pasa nunca: el botón quedaba en "Guardando…" aunque el cambio ya
// estaba a salvo en el teléfono, y si la persona lo cargaba de nuevo después
// aparecía duplicado. Acá el guardado se da por hecho cuando el cambio quedó
// en el teléfono (sin señal, enseguida; con señal mala, a los pocos segundos)
// y se lleva la cuenta de lo que falta enviar para mostrarlo en pantalla.
// Con buena señal no cambia nada: se espera la confirmación del servidor.

const ESPERA_SIN_SENAL_MS = 350;
const ESPERA_SENAL_LENTA_MS = 6000;

let pendientes = 0; // cambios guardados en el teléfono que el servidor todavía no confirmó
let deAntes = false; // quedaron cambios sin enviar de una sesión anterior
function avisarPendientes() {
  window.dispatchEvent(new CustomEvent("sersale:pendientes", { detail: { cantidad: pendientes, deAntes } }));
}

function escribir(promesa, valor) {
  if (!guardaEnTelefono) return promesa.then(() => valor);
  let confirmada = false;
  let enCola = false;
  const confirmacion = promesa.then(
    () => {
      confirmada = true;
      if (enCola) {
        pendientes--;
        avisarPendientes();
      }
      return valor;
    },
    (error) => {
      confirmada = true;
      if (enCola) {
        // Ya se había dado por guardado: avisar que el servidor lo rechazó.
        pendientes--;
        avisarPendientes();
        console.error("El servidor rechazó un cambio guardado en el teléfono:", error);
        window.dispatchEvent(new CustomEvent("sersale:cambio-rechazado", { detail: { error } }));
        return valor;
      }
      throw error;
    }
  );
  const corte = (async () => {
    const inicio = Date.now();
    while (!confirmada && Date.now() - inicio < (sinConexion() ? ESPERA_SIN_SENAL_MS : ESPERA_SENAL_LENTA_MS)) await espera(60);
    if (confirmada) return confirmacion;
    enCola = true;
    pendientes++;
    avisarPendientes();
    return valor;
  })();
  return Promise.race([confirmacion, corte]);
}

export function setDoc(ref, ...resto) {
  return escribir(fs.setDoc(ref, ...resto));
}
export function updateDoc(ref, ...resto) {
  return escribir(fs.updateDoc(ref, ...resto));
}
export function deleteDoc(ref) {
  return escribir(fs.deleteDoc(ref));
}
export function addDoc(coleccion, datos) {
  const ref = fs.doc(coleccion);
  return escribir(fs.setDoc(ref, datos), ref);
}
export function writeBatch(base) {
  const lote = fs.writeBatch(base);
  const confirmar = lote.commit.bind(lote);
  lote.commit = () => escribir(confirmar());
  return lote;
}

/** Cuántos cambios hay guardados en el teléfono sin enviar. */
export function cambiosPendientes() {
  return { cantidad: pendientes, deAntes };
}

// ¿Quedó algo sin enviar de la vez anterior? Si en un momento no se vació la
// cola, se avisa hasta que se envíe.
if (guardaEnTelefono) {
  const vacia = fs.waitForPendingWrites(db).then(() => true, () => true);
  Promise.race([vacia, espera(2500).then(() => false)]).then((listo) => {
    if (listo) return;
    deAntes = true;
    avisarPendientes();
    vacia.then(() => {
      deAntes = false;
      avisarPendientes();
    });
  });
}

window.addEventListener("online", avisar);
window.addEventListener("offline", avisar);
window.__sersaleDatos = { estado: estadoDatos, precalentar, pendientes: cambiosPendientes };

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

function crearDb() {
  const sinPersistencia = PRUEBA && PRUEBA.persistencia === false;
  if (!sinPersistencia) {
    try {
      return fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
      });
    } catch (e) {
      console.warn("Firestore sin guardado local:", e);
    }
  }
  return fs.getFirestore(app);
}

export const db = crearDb();
if (PRUEBA) fs.connectFirestoreEmulator(db, PRUEBA.emulatorHost, PRUEBA.emulatorPort);

// ── Lecturas rápidas ───────────────────────────────────────────────────────

const ESPERA_PRIMERA_SYNC_MS = 6000; // cuánto esperar a la escucha antes de ir al servidor
const CUARENTENA_MS = 3000; // después de una transacción, preguntar al servidor

const origen = new WeakMap(); // referencia o consulta -> nombre de la colección raíz
const escuchas = new Map(); // nombre de colección -> estado de su escucha
let cuarentenaHasta = 0;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const sinConexion = () => typeof navigator !== "undefined" && navigator.onLine === false;

function avisar() {
  let alDia = true;
  for (const st of escuchas.values()) if (!st.sincronizado) alDia = false;
  window.dispatchEvent(new CustomEvent("sersale:datos", { detail: { alDia, enLinea: !sinConexion() } }));
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
        if (st.sincronizado) listo();
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
  if (Date.now() < cuarentenaHasta) return null;
  if (st.sincronizado) return st;
  if (sinConexion()) return st; // sin señal: lo guardado es lo mejor que hay
  await Promise.race([st.primeraSync, espera(ESPERA_PRIMERA_SYNC_MS)]);
  if (Date.now() < cuarentenaHasta) return null;
  return st.sincronizado ? st : null;
}

export async function getDocs(q) {
  const nombre = origen.get(q);
  if (!nombre) return fs.getDocs(q);
  const st = await copiaAlDia(nombre);
  if (!st) return fs.getDocs(q);
  try {
    const snap = await fs.getDocsFromCache(q);
    st.lecturas++;
    return snap;
  } catch (e) {
    return fs.getDocs(q);
  }
}

export async function getDoc(ref) {
  const nombre = origen.get(ref);
  // Solo se responde desde la copia local si esa colección ya se está escuchando.
  const st = nombre && escuchas.get(nombre);
  if (!st || !st.sincronizado || Date.now() < cuarentenaHasta) return fs.getDoc(ref);
  try {
    const snap = await fs.getDocFromCache(ref);
    st.lecturas++;
    return snap;
  } catch (e) {
    return fs.getDoc(ref); // no está en la copia: el servidor dice si existe
  }
}

// Las transacciones se confirman directo en el servidor: la copia local se
// entera un instante después. Por unos segundos, leer del servidor.
export async function runTransaction(base, fn, opciones) {
  try {
    return await fs.runTransaction(base, fn, opciones);
  } finally {
    cuarentenaHasta = Date.now() + CUARENTENA_MS;
  }
}

window.addEventListener("online", avisar);
window.addEventListener("offline", avisar);
window.__sersaleDatos = { estado: estadoDatos, precalentar };

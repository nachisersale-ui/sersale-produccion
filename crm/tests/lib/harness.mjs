// Arnés de pruebas: abre las páginas reales del CRM (crm/dist) en Chromium
// simulando un iPhone, con el SDK real de Firebase conectado a un emulador
// local de Firestore. Cada prueba usa su propio proyecto "demo-*", así los
// datos de una no se mezclan con los de otra y nunca se toca la base real.
import path from "node:path";
import { chromium } from "./playwright.mjs";
import { startServer } from "./server.mjs";
import { startEmulator, newProjectId, seedDb, dumpDb, clearDb, getDocument } from "./emulator.mjs";

export const AHORA = "2026-11-10T10:30:00-03:00"; // martes, media mañana
const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  locale: "es-AR",
  timezoneId: "America/Argentina/Buenos_Aires",
};

// Servicios de terceros que llaman las páginas: respuestas fijas.
const TERCEROS = [
  { re: /^https:\/\/dolarapi\.com\/v1\/dolares\/(oficial|blue)/, json: (m) => ({ casa: m[1], compra: m[1] === "blue" ? 1480 : 1410, venta: m[1] === "blue" ? 1500 : 1430 }) },
  { re: /^https:\/\/nominatim\.openstreetmap\.org\/search/, json: () => [{ lat: "-34.6345", lon: "-58.4012", display_name: "Parque Patricios, CABA" }] },
  { re: /^https:\/\/api\.callmebot\.com\//, text: () => "Message queued." },
  { re: /^https:\/\/api\.emailjs\.com\//, text: () => "OK" },
];

/**
 * launch({ seed, now, rol, etiqueta, persistencia, sw, compartir, viewport })
 *   seed         { coleccion: { idDoc: { ...campos } } } (ver emulator.mjs: fechas como Date o { __ts: ISO })
 *   now          fecha y hora que ve la página (ISO con -03:00). El reloj sigue corriendo desde ahí.
 *   rol          "director" | "operario": deja la sesión iniciada sin pasar por el ingreso.
 *   compartir    false simula un teléfono sin navigator.share.
 * Devuelve { page, context, origin, projectId, llamadas, errores, inesperados,
 *            ir(pagina), sesion(rol), esperarApp(), dump(), doc(ruta), sembrar(datos), sinRed(bool), captura(nombre), close() }
 */
export async function launch(opts = {}) {
  const { seed = null, now = AHORA, rol = null, etiqueta = "t", persistencia = true, sw = false, compartir = true, viewport = null, root } = opts;
  const emu = await startEmulator();
  const projectId = newProjectId(etiqueta);
  if (seed) await seedDb(projectId, seed);
  const server = await startServer(root ? { root } : {});
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...IPHONE, ...(viewport ? { viewport } : {}), acceptDownloads: true });
  if (now) await context.clock.install({ time: new Date(now) });

  const llamadas = { abrir: [], compartir: [], terceros: [], dialogos: [], descargas: [] };
  const errores = [];
  const inesperados = [];

  await context.addInitScript(
    ({ test, compartir }) => {
      window.__SERSALE_TEST__ = test;
      window.__abiertos = [];
      window.__compartidos = [];
      const abrir = window.open;
      window.open = function (url, ...resto) {
        if (url && /^https?:/i.test(String(url))) {
          window.__abiertos.push(String(url));
          return { closed: false, close() {}, focus() {}, document: { write() {}, close() {} } };
        }
        return abrir.call(window, url, ...resto);
      };
      if (compartir) {
        navigator.canShare = () => true;
        navigator.share = async (d) => {
          window.__compartidos.push({ titulo: d.title || null, texto: d.text || null, url: d.url || null, archivos: (d.files || []).map((f) => ({ nombre: f.name, tipo: f.type, bytes: f.size })) });
        };
      } else {
        try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch (e) {}
        navigator.share = undefined;
        navigator.canShare = undefined;
      }
    },
    { test: { projectId, emulatorHost: emu.host, emulatorPort: emu.port, persistencia, sw }, compartir }
  );

  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(server.origin) || url.startsWith(`http://${emu.hostPort}`) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    for (const t of TERCEROS) {
      const m = t.re.exec(url);
      if (m) {
        llamadas.terceros.push({ url, metodo: route.request().method(), cuerpo: route.request().postData() });
        return t.json ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(t.json(m)) }) : route.fulfill({ status: 200, contentType: "text/plain", body: t.text(m) });
      }
    }
    inesperados.push(url);
    return route.abort();
  });

  const preparar = (p) => {
    p.on("pageerror", (e) => errores.push({ tipo: "pageerror", texto: String(e && e.stack ? e.stack : e), url: p.url() }));
    p.on("console", (m) => {
      if (m.type() !== "error") return;
      // Ruido del arnés, no de la app: con el reloj fijado, cada pestaña lleva su propio reloj
      // simulado y pueden diferir en 1 ms; Firestore (que comparte la copia local entre pestañas)
      // lo anota como error. En un teléfono real hay un solo reloj.
      if (/Detected an update time that is in the future/.test(m.text())) return;
      errores.push({ tipo: "console.error", texto: m.text(), url: p.url() });
    });
    p.on("dialog", async (d) => {
      const reg = { tipo: d.type(), mensaje: d.message() };
      llamadas.dialogos.push(reg);
      const r = opts.alDialogo ? await opts.alDialogo(reg) : true;
      if (r === false) await d.dismiss().catch(() => {});
      else await d.accept(typeof r === "string" ? r : undefined).catch(() => {});
    });
    p.on("download", (d) => llamadas.descargas.push({ archivo: d.suggestedFilename() }));
  };
  context.on("page", preparar);
  const page = await context.newPage();

  async function sesion(r, { usuario = "nacho", nombre = "Nacho" } = {}) {
    await context.addInitScript(
      ({ r, usuario, nombre }) => {
        if (sessionStorage.getItem("__sesion_puesta")) return;
        sessionStorage.setItem("__sesion_puesta", "1");
        sessionStorage.setItem("sersale_role", r);
        sessionStorage.setItem("sersale_auth", "ok");
        if (r === "director") {
          sessionStorage.setItem("sersale_usuario", usuario);
          sessionStorage.setItem("sersale_nombre", nombre);
        }
      },
      { r, usuario, nombre }
    );
  }
  if (rol) await sesion(rol);

  async function esperarApp(p = page) {
    await p.waitForLoadState("load");
    await p.waitForFunction(() => {
      const r = document.getElementById("root") || document.getElementById("app") || document.body;
      return !!r && r.innerText.trim().length > 15;
    });
  }
  async function ir(pagina, p = page) {
    await p.goto(server.origin + "/" + pagina.replace(/^\//, ""));
    await esperarApp(p);
    return p;
  }
  async function sincronizar(p = page) {
    await p.evaluate(async () => {
      const d = window.__sersaleDatos;
      if (!d) return;
      const fin = Date.now() + 15000;
      while (Date.now() < fin) {
        const e = d.estado();
        if (Object.keys(e).length && Object.values(e).every((x) => x.sincronizado)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    });
  }

  /**
   * Señal que se corta en el peor momento. Las transacciones van al servidor en
   * dos pedidos: leer (batchGet) y confirmar (commit).
   *   red.perder = n     las próximas n confirmaciones LLEGAN al servidor y se guardan, pero la
   *                      respuesta no vuelve al teléfono (Firestore reintenta la transacción).
   *   red.luegoSinSenal  después de eso no pasa ningún pedido de transacción (hasta red.caida = false).
   */
  async function redQueSeCorta(p = page) {
    const red = { perder: 0, luegoSinSenal: false, caida: false, perdidas: 0 };
    await p.route(/documents:(commit|batchGet)/, async (route) => {
      if (red.caida) return route.abort("connectionfailed");
      if (red.perder > 0 && /documents:commit/.test(route.request().url())) {
        red.perder--;
        red.perdidas++;
        if (red.luegoSinSenal) red.caida = true;
        await route.fetch().catch(() => null);
        return route.abort("connectionreset");
      }
      return route.continue();
    });
    return red;
  }
  /** El canal por el que la página escucha los cambios no conecta; los pedidos sueltos sí pasan. */
  async function cortarEscucha(p = page) {
    const corte = { activo: true };
    await p.route(/\/Listen\/channel/, (route) => (corte.activo ? route.abort("connectionfailed") : route.continue()));
    return corte;
  }

  return {
    redQueSeCorta, cortarEscucha,
    browser, context, page, origin: server.origin, projectId, llamadas, errores, inesperados,
    ir, sesion, esperarApp, sincronizar,
    abiertos: (p = page) => p.evaluate(() => window.__abiertos),
    compartidos: (p = page) => p.evaluate(() => window.__compartidos),
    dump: (o) => dumpDb(projectId, o),
    doc: (ruta, o) => getDocument(projectId, ruta, o),
    sembrar: (datos) => seedDb(projectId, datos),
    limpiar: () => clearDb(projectId),
    sinRed: (v) => context.setOffline(!!v),
    captura: async (nombre, { fullPage = false, p = page } = {}) => {
      const archivo = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "screenshots", process.env.SHOT_SET || "actual", nombre + ".png");
      await p.screenshot({ path: archivo, fullPage });
      return archivo;
    },
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      await server.close();
    },
  };
}

/** Errores que no son del sistema (ruido conocido del navegador de pruebas). */
export function erroresReales(errores) {
  return errores.filter((e) => !/favicon|net::ERR_INTERNET_DISCONNECTED|Failed to load resource: net::ERR_FAILED/.test(e.texto));
}

// Service worker del CRM Sersale.
//
// Guarda en el teléfono todos los archivos del sistema para que abra al
// instante y también sin señal. Cada publicación genera una versión nueva
// (build.mjs completa VERSION y ARCHIVOS): al instalarse reemplaza a la
// anterior entera, nunca se mezclan archivos de dos versiones.
//
// Los datos (Firestore) no pasan por acá: solo se atienden pedidos GET al
// mismo sitio.
const VERSION = "__VERSION__";
const ARCHIVOS = __ARCHIVOS__;

const PREFIJO = "sersale-crm-";
const CACHE = PREFIJO + VERSION;
const BASE = self.registration.scope;

// Una respuesta que llegó tras una redirección no sirve para responder una
// navegación: se copia a una respuesta limpia.
async function limpia(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        ARCHIVOS.map(async (ruta) => {
          const url = new URL(ruta, BASE).href;
          const res = await fetch(new Request(url, { cache: "reload" }));
          if (!res.ok) throw new Error("No se pudo guardar " + ruta + " (" + res.status + ")");
          await cache.put(url, await limpia(res));
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) {
        if (k.startsWith(PREFIJO) && k !== CACHE) await caches.delete(k);
      }
      await self.clients.claim();
    })()
  );
});

// Netlify sirve "/" como index.html y "/pedidos" como pedidos.html.
function archivoDe(url) {
  let ruta = url.pathname;
  if (ruta.endsWith("/")) ruta += "index.html";
  else if (!/\.[a-z0-9]+$/i.test(ruta)) ruta += ".html";
  return url.origin + ruta;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const guardado = await cache.match(archivoDe(url));
      if (guardado) return guardado;
      try {
        return await fetch(req);
      } catch (err) {
        if (req.mode === "navigate") {
          const inicio = await cache.match(new URL("index.html", BASE).href);
          if (inicio) return inicio;
        }
        throw err;
      }
    })()
  );
});

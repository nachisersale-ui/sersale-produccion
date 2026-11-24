// Prepara lo que el CRM necesita para emitir el catálogo mayorista en PDF desde
// el teléfono (pantalla Catálogo):
//
//   node tools/catalogo-recursos.mjs "<carpeta>\1 - Catalogo mayorista\catalogo" [carpeta de tipografías]
//
// Toma el catálogo que se arma en la computadora (catalogo.html + datos.js + img)
// y deja en src/catalogo-pdf/:
//   pag-*.jpg     páginas de presentación ya dibujadas (tapa, historia, etc.),
//                 sin los textos que cambian (vigencia, número de página)
//   cab-<id>.jpg  cabecera de cada línea de productos
//   linea-<id>.jpg foto de cada línea para la página "Nuestras líneas"
//   p-<art>.jpg   foto de cada producto
//   *.ttf         tipografías Poppins y Montserrat recortadas al alfabeto latino
// y en src/js/catalogo-completo.js los textos, productos, precios y medidas.
//
// Necesita Playwright (npm install --no-save playwright) e internet (tipografías
// del catálogo original). Las tipografías recortadas se generan si se pasa una
// carpeta con node_modules de subset-font y @expo-google-fonts/{poppins,montserrat}.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const origen = process.argv[2];
const dirFuentes = process.argv[3];
if (!origen || !fs.existsSync(path.join(origen, "catalogo.html"))) {
  console.error("Falta la carpeta del catálogo (la que tiene catalogo.html y datos.js).");
  process.exit(1);
}
const DESTINO = path.join(AQUI, "..", "src", "catalogo-pdf");
fs.mkdirSync(DESTINO, { recursive: true });
for (const f of fs.readdirSync(DESTINO)) if (/\.(jpg|png)$/.test(f)) fs.unlinkSync(path.join(DESTINO, f));

const { chromium } = await import("playwright");
const MM = 96 / 25.4;
const mm = (px) => Math.round((px / MM) * 100) / 100;
const url = pathToFileURL(path.join(origen, "catalogo.html")).href;
const navegador = await chromium.launch();

async function abrir(sufijo, escala, cssExtra) {
  const ctx = await navegador.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: escala });
  const p = await ctx.newPage();
  await p.goto(url + sufijo);
  await p.addStyleTag({ content: "body{background:#fff}.page{margin:0 auto}.pie{visibility:hidden}" + (cssExtra || "") });
  await p.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  });
  await p.waitForTimeout(800);
  return p;
}
const foto = (loc, nombre, calidad) => loc.screenshot({ path: path.join(DESTINO, nombre), type: "jpeg", quality: calidad || 80 });

// Rectángulo de un elemento relativo a su página, en milímetros.
const rectEn = (p, selPagina, sel) =>
  p.evaluate(([a, b, MM]) => {
    const pg = document.querySelector(a).getBoundingClientRect();
    return [...document.querySelectorAll(a + " " + b)].map((e) => {
      const r = e.getBoundingClientRect();
      const f = (n) => Math.round((n / MM) * 100) / 100;
      return { x: f(r.left - pg.left), y: f(r.top - pg.top), w: f(r.width), h: f(r.height), href: e.getAttribute("href") || undefined };
    });
  }, [selPagina, sel, MM]);

// ---------- páginas de presentación ----------
const OCULTOS = ".tapa .v,.contra .fin2,.cab .vig{visibility:hidden}";
const p = await abrir("", 2, OCULTOS);
await p.evaluate(() => {
  // Marca cada página con su clave para poder ubicarla.
  const claves = orden; // eslint-disable-line no-undef
  [...document.querySelectorAll("section.page")].forEach((s, i) => s.setAttribute("data-k", claves[i].replace(":", "-")));
});
const medidas = { enlaces: {} };
for (const k of ["tapa", "frase", "historia", "hacemos", "destacado", "como", "contra"]) {
  const sel = `section[data-k="${k}"]`;
  await foto(p.locator(sel), `pag-${k}.jpg`, k === "hacemos" || k === "como" || k === "contra" ? 86 : 80);
  medidas.enlaces[k] = await rectEn(p, sel, "a");
}
medidas.vigTapa = (await rectEn(p, 'section[data-k="tapa"]', ".v"))[0];
medidas.finContra = (await rectEn(p, 'section[data-k="contra"]', ".fin2"))[0];

// ---------- fotos de las líneas ----------
const datos = await p.evaluate(() => JSON.parse(JSON.stringify(CATALOGO))); // eslint-disable-line no-undef
const familias = datos.paginas.flat();
const tiles = p.locator('section[data-k="lineas"] .linea img');
const sinContinua = familias.filter((f) => !f.continua);
for (let i = 0; i < sinContinua.length; i++) await foto(tiles.nth(i), `linea-${sinContinua[i].id}.jpg`, 78);
await p.context().close();

// ---------- "cómo trabajamos" sin precios ----------
const ps = await abrir("?sinprecios", 2, OCULTOS);
const como = ps.locator("section.page.oscuro").filter({ has: ps.locator(".pasos") });
await foto(como, "pag-como-sinprecios.jpg", 86);
await ps.context().close();

// ---------- cabecera de cada línea ----------
// Las líneas que hoy van segundas en su página no tienen foto de cabecera
// propia: usan la de la línea con la que comparten página.
const pc = await abrir("", 2, OCULTOS);
const fondoCab = {};
datos.paginas.forEach((pg) => pg.forEach((f) => { fondoCab[f.id] = fs.existsSync(path.join(origen, "img", `cab-${f.id}.jpg`)) ? f.id : pg[0].id; }));
await pc.evaluate(([fams, fondo]) => {
  document.getElementById("app").innerHTML = fams.map((f) =>
    `<section class="page prod" style="height:40mm" data-cab="${f.id}"><div class="cab"><div class="bg" style="background-image:url(img/cab-${fondo[f.id]}.jpg)"></div><div class="in"><img class="lg" src="img/logo55.png" alt=""><div><h2>${f.nombre}</h2><p>${f.intro}</p></div></div></div></section>`).join("");
}, [familias, fondoCab]);
await pc.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));
await pc.waitForTimeout(1200);
for (const f of familias) await foto(pc.locator(`section[data-cab="${f.id}"] .cab`), `cab-${f.id}.jpg`, 80);
await pc.context().close();

// ---------- foto de cada producto ----------
const pf = await abrir("", 3, ".page:not(.prod){display:none !important}.page{height:auto !important;overflow:visible !important}.fila{height:46mm !important}.fila .thw{width:40mm !important;height:40mm !important}.fila .th{border-radius:0 !important}.fila .sg{display:none}");
const arts = familias.flatMap((f) => f.productos.map((x) => x.art));
const ths = pf.locator(".fila .th");
if ((await ths.count()) !== arts.length) throw new Error("No coincide la cantidad de fotos con la de productos");
for (let i = 0; i < arts.length; i++) await foto(ths.nth(i), `p-${arts[i]}.jpg`, 80);
await pf.context().close();
await navegador.close();

fs.copyFileSync(path.join(origen, "img", "sin-gluten.png"), path.join(DESTINO, "sin-gluten.png"));

// ---------- tipografías ----------
if (dirFuentes) {
  const req = createRequire(path.join(dirFuentes, "x.js"));
  const subsetFont = req("subset-font");
  let texto = "";
  for (let c = 0x20; c <= 0x7e; c++) texto += String.fromCharCode(c);
  for (let c = 0xa0; c <= 0xff; c++) texto += String.fromCharCode(c);
  texto += "–—‘’“”•…€™";
  const lista = {
    "Poppins-800.ttf": "@expo-google-fonts/poppins/800ExtraBold/Poppins_800ExtraBold.ttf",
    "Montserrat-400.ttf": "@expo-google-fonts/montserrat/400Regular/Montserrat_400Regular.ttf",
    "Montserrat-500.ttf": "@expo-google-fonts/montserrat/500Medium/Montserrat_500Medium.ttf",
    "Montserrat-700.ttf": "@expo-google-fonts/montserrat/700Bold/Montserrat_700Bold.ttf",
    "Montserrat-800.ttf": "@expo-google-fonts/montserrat/800ExtraBold/Montserrat_800ExtraBold.ttf",
  };
  for (const [destino, ruta] of Object.entries(lista)) {
    const original = fs.readFileSync(path.join(dirFuentes, "node_modules", ruta));
    const recortada = await subsetFont(original, texto, { targetFormat: "truetype" });
    fs.writeFileSync(path.join(DESTINO, destino), recortada);
  }
}

// ---------- datos ----------
const salida = {
  vigencia: datos.vigencia,
  contacto: datos.contacto,
  destacado: { art: datos.destacado.art },
  medidas,
  paginas: datos.paginas.map((pg) => pg.map((f) => ({
    id: f.id, nombre: f.nombre, intro: f.intro, continua: !!f.continua,
    productos: f.productos.map((x) => ({
      art: x.art, nombre: x.nombre, peso: x.peso, precio: typeof x.precio === "number" ? x.precio : null,
      tacc: !!x.tacc, desc: x.desc,
    })),
  }))),
};
fs.writeFileSync(
  path.join(AQUI, "..", "src", "js", "catalogo-completo.js"),
  "// Generado por tools/catalogo-recursos.mjs a partir del catálogo mayorista. No editar a mano.\n" +
    "window.SersaleCatalogoCompleto = " + JSON.stringify(salida, null, 1) + ";\n"
);

let peso = 0;
const archivos = fs.readdirSync(DESTINO);
for (const f of archivos) peso += fs.statSync(path.join(DESTINO, f)).size;
console.log(`catalogo-pdf: ${archivos.length} archivos, ${(peso / 1024 / 1024).toFixed(2)} MB`);

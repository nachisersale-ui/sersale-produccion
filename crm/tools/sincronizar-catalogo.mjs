// Trae al CRM el catálogo mayorista (productos, pesos y precios por kilo).
//
//   node tools/sincronizar-catalogo.mjs "<carpeta>\1 - Catalogo mayorista\catalogo"
//
// Lee datos.js del catálogo (el mismo que arma el PDF mayorista) y escribe
// src/js/catalogo.js, que usa Presupuestos. Las fotos se achican aparte con
// tools/miniaturas-catalogo.ps1 (misma carpeta de origen). Después: node build.mjs.
//
// Cada vez que cambian los precios del catálogo hay que volver a correr esto,
// así el presupuesto y el catálogo dicen lo mismo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origen = process.argv[2];
if (!origen || !fs.existsSync(path.join(origen, "datos.js"))) {
  console.error('Falta la carpeta del catálogo (la que tiene datos.js). Uso: node tools/sincronizar-catalogo.mjs "<carpeta>"');
  process.exit(1);
}

const fuente = fs.readFileSync(path.join(origen, "datos.js"), "utf8");
const CATALOGO = new Function(fuente + "\n;return CATALOGO;")();

/** "6 kg" → 6; "1,5 kg" → 1.5; "300 g" → 0.3; "10 kg x gancho · 60 un." → 10. */
function kilos(peso) {
  const m = /^([\d.,]+)\s*(kg|g)\b/i.exec(String(peso || "").trim());
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!isFinite(n) || n <= 0) return null;
  return m[2].toLowerCase() === "g" ? Math.round(n) / 1000 : n;
}
/** Cómo se cuenta una unidad de ese producto. */
function unidad(peso) {
  if (/gancho/i.test(peso)) return "gancho";
  if (/granel/i.test(peso)) return "bolsa";
  return "pieza";
}

const familias = [];
for (const pagina of CATALOGO.paginas) {
  for (const f of pagina) {
    // "Embutidos secos" ocupa dos páginas del catálogo: acá es una sola familia.
    let familia = familias.find((x) => x.nombre === f.nombre);
    if (!familia) familias.push((familia = { nombre: f.nombre, productos: [] }));
    for (const p of f.productos) {
      const foto = "p-" + p.art + ".jpg";
      familia.productos.push({
        art: p.art,
        nombre: p.nombre,
        peso: p.peso,
        kg: kilos(p.peso),
        unidad: unidad(p.peso),
        precio: typeof p.precio === "number" && p.precio > 0 ? p.precio : null,
        foto: fs.existsSync(path.join(origen, "img", foto)) ? foto : null,
      });
    }
  }
}

const total = familias.reduce((s, f) => s + f.productos.length, 0);
const repetidos = familias.flatMap((f) => f.productos.map((p) => p.art)).filter((a, i, l) => l.indexOf(a) !== i);
if (repetidos.length) throw new Error("Artículos repetidos en el catálogo: " + repetidos.join(", "));

const salida =
  "// Catálogo mayorista dentro del CRM: productos, peso por pieza y precio por kilo.\n" +
  "// Generado por tools/sincronizar-catalogo.mjs desde el datos.js del catálogo — no editar a mano.\n" +
  "window.SersaleCatalogo = " +
  JSON.stringify({ vigencia: CATALOGO.vigencia, familias }, null, 1) +
  ";\n";
fs.writeFileSync(path.join(RAIZ, "src", "js", "catalogo.js"), salida);
console.log(`catalogo.js listo: ${familias.length} familias, ${total} productos, vigencia ${CATALOGO.vigencia}`);
console.log("sin foto: " + (familias.flatMap((f) => f.productos).filter((p) => !p.foto).map((p) => p.art).join(", ") || "ninguno"));
console.log("sin precio (Consultar): " + (familias.flatMap((f) => f.productos).filter((p) => p.precio == null).map((p) => p.art).join(", ") || "ninguno"));

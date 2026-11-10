// Datos de prueba que se parecen al negocio real de Frigorífico Sersale.
//
//   import { buildSeed } from "./lib/seed.mjs";
//   const h = await launch({ seed: buildSeed(), rol: "director" });
//
// buildSeed({ today }) devuelve { coleccion: { idDoc: { ...campos } } } listo para
// launch({ seed }). Es determinista: no usa Math.random ni el reloj real, y todas
// las fechas salen de `today` (por defecto el día fijado en el arnés).
//
// Cómo se arma: en vez de escribir documentos "a mano", se SIMULA el uso del
// sistema en orden cronológico con las mismas reglas que aplican las páginas
// (alta de pedido, cambios de estado, remito, pago, venta rápida, devolución,
// reporte de producción, salida de stock...). Cada función de la simulación
// copia lo que escribe el código que se indica al lado. Así los saldos, los
// números de remito, los precios y el stock quedan coherentes por construcción,
// y al final se verifican otra vez (ver `verificar`).
import crypto from "node:crypto";

// ── Catálogo: igual al PRODUCTOS de src/pedidos/02-clientes-nuevo-pedido.jsx ──
export const CATALOGO = {
  "Jamones Cocidos": ["Jamón Cocido Natural Sublime", "Jamón Cocido Especial Bajo Sodio", "Jamón Cocido de Pata"],
  "Paletas Cocidas": ["Fiambre Cocido de Paleta de Cerdo", "Fiambre de Cerdo p/ Emparedados"],
  "Jamones Crudos y Bondiolas": ["Jamón Crudo c/ Hueso 12 Meses", "Jamón Crudo Entero Listo s/ Hueso", "Jamón Crudo Listo por 1/2 Punta", "Jamón Crudo Listo por 1/2 Garrón", "Bondiola Seca al Papel", "Bondiola Seca Serrana"],
  "Embutidos Secos": ["Salamín Picado Fino", "Salamín Picado Grueso", "Sopresatta de Cerdo", "Chorizo Tipo Candelario", "Chorizo Tipo Cantimpalo", "Longaniza Tipo Española", "Longaniza Tipo Calabresa", "Longaniza T/ Calabresa Bastón", "Salame Tipo Milán", "Salame Tipo Español", "Salame Chacarero de Campo"],
  "Embutidos Frescos": ["Chorizo Puro Cerdo", "Chorizo Especial Vacuno/Cerdo", "Chorizo Bombón", "Chorizo Bombón Puro Cerdo", "Morcilla Criolla", "Morcilla Criolla Rosca", "Morcilla Criolla Bombón", "Morcilla Vasca", "Salchicha Fresca Parrillera"],
  "Cerdo y Varios": ["Pecho c/ Manta", "Carré c/ Hueso", "Bondiola Fresca", "Pernil Fresco", "Paleta Fresca", "Costillitas de Cerdo", "Matambrito de Cerdo", "Cinta de Lomo", "Ribs", "Pollo", "Churrasquitos de Cerdo"],
  "Quesos": ["Queso Tybo", "Queso Roquefort", "Queso Pategras", "Queso Mar del Plata", "Queso Sardo", "Queso Reggianito", "Queso Gruyere", "Queso Cremoso", "Queso Port Salut", "Queso Mozzarella"],
  "Artículos Varios": [],
  "Pancetas y Ahumados": ["Panceta Ahumada", "Panceta Salada", "Lomo Ahumado", "Lomo Tipo Suizo", "Salchichas de Viena", "Salchichas de Copetin", "Pechito Ahumado"],
  "Pastas Finas": ["Mortadela Bocha", "Mortadela Bologna", "Mortadela Familiar", "Salchichón c/ Jamón", "Salchichón Primavera", "Salchichón c/ Jamón Familiar", "Salchichón Primavera Familiar"],
};
// Producto agregado desde "Productos" (GestionProductos): existe en config/productos
// pero NO en el catálogo fijo del código.
export const PRODUCTO_AGREGADO = { categoria: "Pancetas y Ahumados", producto: "Bondiola Ahumada" };

// Precio de lista vigente por kg (ARS).
const PRECIO_BASE = {
  "Jamón Cocido Natural Sublime": 11590, "Jamón Cocido Especial Bajo Sodio": 8990, "Jamón Cocido de Pata": 6990,
  "Fiambre Cocido de Paleta de Cerdo": 5990, "Fiambre de Cerdo p/ Emparedados": 4990,
  "Jamón Crudo c/ Hueso 12 Meses": 21900, "Jamón Crudo Entero Listo s/ Hueso": 26900, "Jamón Crudo Listo por 1/2 Punta": 27900,
  "Jamón Crudo Listo por 1/2 Garrón": 27900, "Bondiola Seca al Papel": 23900, "Bondiola Seca Serrana": 24900,
  "Salamín Picado Fino": 14990, "Salamín Picado Grueso": 14990, "Sopresatta de Cerdo": 15990, "Chorizo Tipo Candelario": 14990,
  "Chorizo Tipo Cantimpalo": 15490, "Longaniza Tipo Española": 14990, "Longaniza Tipo Calabresa": 14990,
  "Longaniza T/ Calabresa Bastón": 15490, "Salame Tipo Milán": 14990, "Salame Tipo Español": 15490, "Salame Chacarero de Campo": 15990,
  "Chorizo Puro Cerdo": 5990, "Chorizo Especial Vacuno/Cerdo": 5190, "Chorizo Bombón": 5390, "Chorizo Bombón Puro Cerdo": 6190,
  "Morcilla Criolla": 4590, "Morcilla Criolla Rosca": 4590, "Morcilla Criolla Bombón": 4790, "Morcilla Vasca": 5990,
  "Salchicha Fresca Parrillera": 6590,
  "Pecho c/ Manta": 5490, "Carré c/ Hueso": 6990, "Bondiola Fresca": 8990, "Pernil Fresco": 5990, "Paleta Fresca": 5490,
  "Costillitas de Cerdo": 7490, "Matambrito de Cerdo": 11990, "Cinta de Lomo": 8490, "Ribs": 8990, "Pollo": 3990,
  "Churrasquitos de Cerdo": 7990,
  "Queso Tybo": 9990, "Queso Roquefort": 17900, "Queso Pategras": 12900, "Queso Mar del Plata": 11900, "Queso Sardo": 14900,
  "Queso Reggianito": 16900, "Queso Gruyere": 18900, "Queso Cremoso": 7990, "Queso Port Salut": 8490, "Queso Mozzarella": 8990,
  "Panceta Ahumada": 14990, "Panceta Salada": 12990, "Lomo Ahumado": 14990, "Lomo Tipo Suizo": 18990,
  "Salchichas de Viena": 9990, "Salchichas de Copetin": 11990, "Pechito Ahumado": 9990, "Bondiola Ahumada": 16990,
  "Mortadela Bocha": 5890, "Mortadela Bologna": 5490, "Mortadela Familiar": 5890, "Salchichón c/ Jamón": 4990,
  "Salchichón Primavera": 4990, "Salchichón c/ Jamón Familiar": 5490, "Salchichón Primavera Familiar": 5490,
};
// Peso aproximado (kg) de una pieza / gancho / bolsa / unidad, para el kg real.
const PESO_UNIDAD = {
  "Jamón Crudo c/ Hueso 12 Meses": 7.8, "Jamón Crudo Entero Listo s/ Hueso": 5.6, "Jamón Crudo Listo por 1/2 Punta": 2.9,
  "Mortadela Bocha": 3.4, "Salamín Picado Fino": 1.6, "Salchichas de Viena": 1, "Queso Reggianito": 6.5,
};

// ── Clientes ────────────────────────────────────────────────────────────────
// k: clave interna; cc: tiene cuenta corriente; desc: factor de precio; dias: días de recontacto cargados a mano.
const CLIENTES = [
  { k: "angel", nombre: "Fiambrería Don Ángel", telefono: "11 4912-3456", direccion: "Av. Caseros 2840, Parque Patricios", cc: true },
  { k: "nata", nombre: "Fiambrería La Ñata", telefono: "1155667788", direccion: "Av. Boedo 1150, Boedo", cc: false, dias: 14 },
  { k: "trebol", nombre: "Carnicería El Trébol", telefono: "11 4918-7702", direccion: "Av. Sáenz 870, Nueva Pompeya", cc: true, desc: 0.97, dias: 10 },
  { k: "perez", nombre: "Carnicería Los Hermanos Pérez & Hijos", telefono: "+54 9 11 6123-4567", direccion: "Av. La Plata 2215, Boedo", cc: true },
  { k: "dagostino", nombre: "Almacén D'Agostino", telefono: "11 4941-0098", direccion: "Inclán 3320, Parque Patricios", cc: true },
  { k: "guemes", nombre: "Almacén y Despensa Güemes", telefono: "11 3344-5566", direccion: "Av. Chiclana 3580", cc: false, dias: 21 },
  { k: "gamasB", nombre: "Panificadora Gamas - Sucursal Boedo", telefono: "11 4931-2200", direccion: "Av. San Juan 3601, Boedo", cc: true, desc: 0.95 },
  { k: "gamasC", nombre: "Panificadora Gamas - Sucursal Caballito", telefono: "11 4902-2201", direccion: "Av. Rivadavia 5120, Caballito", cc: true, desc: 0.95 },
  { k: "gamasP", nombre: "Panificadora Gamas - Sucursal Pompeya", telefono: "11 4911-2202", direccion: "Av. Amancio Alcorta 3402, Nueva Pompeya", cc: true, desc: 0.95 },
  { k: "distri", nombre: "Distribuidora Mayorista del Sur S.R.L.", telefono: "11 4301-8800", direccion: "Av. Vélez Sarsfield 1840, Barracas", cc: true, desc: 0.92 },
  { k: "coope", nombre: "Cooperativa de Trabajo Gastronómica La Nueva Esperanza de Villa Soldati Limitada", telefono: "11 2233-4455", direccion: "Mariano Acosta 3150, Villa Soldati", cc: false, dias: 21 },
  { k: "sabor", nombre: "Rotisería El Buen Sabor", telefono: "11 4308-1122", direccion: "Av. Garay 2950", cc: false },
  { k: "cayetano", nombre: "Fiambres y Quesos San Cayetano", telefono: "11 4432-9090", direccion: "Av. Directorio 1420, Caballito", cc: true },
  { k: "espanola", nombre: "Carnicería y Granja La Española", telefono: "11 4305-6677", direccion: "Av. Juan de Garay 3340", cc: false },
  { k: "autoserv", nombre: "Autoservicio Avenida La Plata", telefono: "", direccion: "Av. La Plata 1480", cc: false, dias: 21 },
  { k: "nestor", nombre: "Restaurante Lo de Néstor", telefono: "11 4911-3030", direccion: "Av. Brasil 2990, Parque Patricios", cc: true },
  { k: "pizza", nombre: "Pizzería El Cuartito de Barracas", telefono: "11 4302-7788", direccion: "Av. Montes de Oca 1250, Barracas", cc: false },
  { k: "rosa", nombre: "Almacén Doña Rosa", telefono: "11 6677-8899", direccion: "", cc: false, alta: -16 },
  { k: "vasquito", nombre: "Fiambrería El Vasquito", telefono: "", direccion: "", cc: false, dias: 30 },
  { k: "julio", nombre: "Carnicería Don Julio", telefono: "11 4942-5151", direccion: "Av. Almafuerte 410, Parque Patricios", cc: false, dias: 30 },
  { k: "tito", nombre: "Sandwichería Lo de Tito", telefono: "11 5010-2030", direccion: "Dean Funes 1790", cc: false },
  { k: "kiosco", nombre: "Kiosco y Almacén 24hs Chiclana", telefono: "11 7001-2424", direccion: "", cc: false, dias: 10, alta: -3 },
];

// Lo que suele pedir cada uno: [producto, cantidad base, unidad].
const CANASTAS = {
  angel: [["Jamón Cocido Natural Sublime", 12, "kg"], ["Fiambre Cocido de Paleta de Cerdo", 10, "kg"], ["Salame Tipo Milán", 6, "kg"], ["Queso Tybo", 8, "kg"], ["Mortadela Bocha", 2, "unidades"], ["Salamín Picado Fino", 3, "ganchos"], ["Panceta Ahumada", 4, "kg"], ["Jamón Crudo Listo por 1/2 Punta", 1, "piezas"]],
  nata: [["Jamón Cocido Especial Bajo Sodio", 8, "kg"], ["Queso Cremoso", 6, "kg"], ["Salchichón Primavera", 4, "kg"], ["Mortadela Bologna", 5, "kg"], ["Bondiola Seca al Papel", 2, "kg"]],
  trebol: [["Chorizo Puro Cerdo", 20, "kg"], ["Morcilla Criolla", 10, "kg"], ["Costillitas de Cerdo", 15, "kg"], ["Bondiola Fresca", 12, "kg"], ["Pecho c/ Manta", 10, "kg"], ["Salchicha Fresca Parrillera", 8, "kg"]],
  perez: [["Chorizo Especial Vacuno/Cerdo", 25, "kg"], ["Chorizo Bombón", 8, "kg"], ["Morcilla Vasca", 6, "kg"], ["Carré c/ Hueso", 14, "kg"], ["Matambrito de Cerdo", 5, "kg"], ["Churrasquitos de Cerdo", 6, "kg"]],
  dagostino: [["Fiambre de Cerdo p/ Emparedados", 6, "kg"], ["Queso Cremoso", 5, "kg"], ["Salchichas de Viena", 4, "bolsas"], ["Mortadela Familiar", 3, "kg"], ["Salame Tipo Milán", 2, "kg"]],
  guemes: [["Jamón Cocido de Pata", 5, "kg"], ["Queso Port Salut", 4, "kg"], ["Salchichón c/ Jamón", 3, "kg"]],
  gamasB: [["Fiambre de Cerdo p/ Emparedados", 15, "kg"], ["Jamón Cocido de Pata", 10, "kg"], ["Queso Tybo", 12, "kg"], ["Queso Mozzarella", 20, "kg"], ["Salame Tipo Milán", 3, "kg"], ["Panceta Ahumada", 2, "kg"]],
  gamasC: [["Queso Mozzarella", 18, "kg"], ["Fiambre de Cerdo p/ Emparedados", 12, "kg"], ["Jamón Cocido de Pata", 8, "kg"], ["Queso Tybo", 10, "kg"], ["Panceta Ahumada", 2, "kg"]],
  gamasP: [["Fiambre de Cerdo p/ Emparedados", 10, "kg"], ["Queso Mozzarella", 15, "kg"], ["Jamón Cocido de Pata", 6, "kg"], ["Queso Tybo", 8, "kg"]],
  distri: [["Jamón Cocido Natural Sublime", 40, "kg"], ["Fiambre Cocido de Paleta de Cerdo", 35, "kg"], ["Salamín Picado Grueso", 20, "kg"], ["Longaniza Tipo Calabresa", 15, "kg"], ["Jamón Crudo c/ Hueso 12 Meses", 4, "piezas"], ["Mortadela Bocha", 6, "unidades"], ["Queso Pategras", 18, "kg"], ["Bondiola Seca Serrana", 8, "kg"], ["Chorizo Tipo Cantimpalo", 10, "kg"]],
  coope: [["Pollo", 30, "kg"], ["Paleta Fresca", 15, "kg"], ["Chorizo Puro Cerdo", 10, "kg"]],
  sabor: [["Pollo", 20, "kg"], ["Pernil Fresco", 10, "kg"], ["Matambrito de Cerdo", 6, "kg"], ["Ribs", 8, "kg"], ["Queso Mozzarella", 5, "kg"]],
  cayetano: [["Queso Reggianito", 4, "kg"], ["Queso Sardo", 5, "kg"], ["Queso Roquefort", 2, "kg"], ["Jamón Crudo Entero Listo s/ Hueso", 1, "piezas"], ["Salamín Picado Fino", 4, "kg"], ["Sopresatta de Cerdo", 3, "kg"], ["Lomo Tipo Suizo", 2, "kg"], ["Bondiola Ahumada", 2, "kg"]],
  espanola: [["Chorizo Puro Cerdo", 15, "kg"], ["Morcilla Criolla Rosca", 8, "kg"], ["Cinta de Lomo", 10, "kg"], ["Pollo", 25, "kg"]],
  autoserv: [["Salchichas de Viena", 10, "bolsas"], ["Mortadela Bologna", 6, "kg"], ["Queso Cremoso", 8, "kg"]],
  nestor: [["Matambrito de Cerdo", 8, "kg"], ["Bondiola Fresca", 10, "kg"], ["Chorizo Bombón Puro Cerdo", 5, "kg"], ["Morcilla Criolla Bombón", 4, "kg"], ["Queso Gruyere", 2, "kg"]],
  pizza: [["Queso Mozzarella", 30, "kg"], ["Jamón Cocido de Pata", 8, "kg"], ["Longaniza Tipo Calabresa", 4, "kg"], ["Panceta Ahumada", 3, "kg"]],
  rosa: [["Mortadela Familiar", 2, "kg"], ["Queso Cremoso", 3, "kg"], ["Salchichón Primavera Familiar", 2, "kg"], ["Chorizo Puro Cerdo", 4, "kg"]],
  vasquito: [["Jamón Cocido Natural Sublime", 6, "kg"], ["Bondiola Seca al Papel", 2, "kg"], ["Queso Mar del Plata", 5, "kg"]],
  julio: [["Carré c/ Hueso", 12, "kg"], ["Pecho c/ Manta", 10, "kg"], ["Chorizo Especial Vacuno/Cerdo", 15, "kg"]],
  tito: [["Fiambre de Cerdo p/ Emparedados", 8, "kg"], ["Queso Tybo", 6, "kg"], ["Lomo Ahumado", 3, "kg"], ["Salame Tipo Español", 2, "kg"]],
};
// Clientes a los que se les cargó lista de precios al empezar a usar el sistema.
const CON_LISTA = ["angel", "nata", "trebol", "perez", "dagostino", "gamasB", "gamasC", "gamasP", "distri", "cayetano", "nestor", "pizza", "sabor", "espanola"];

// Pedidos ya entregados: días hacia atrás (se corren un día si caen domingo).
// sinRemito: despachado sin haber hecho el remito. sinMarca: el pedido se cargó sin tildar "cuenta corriente".
const HISTORIA = {
  angel: [-35, -28, -21, -14, -7],
  distri: [-40, -30, -20, -10],
  gamasB: [-20, -13, -6],
  gamasC: [-19, -12, { d: -5, sinRemito: true }],
  gamasP: [-29, -8],
  trebol: [-62, -55, -41],
  perez: [-32, -18, -4],
  dagostino: [-25, -11],
  cayetano: [-31, -17, -3],
  nestor: [{ d: -34, sinMarca: true }, -13],
  nata: [-21, { d: -7, sinRemito: true }],
  sabor: [-29, { d: -15, sinRemito: true }],
  guemes: [-40],
  coope: [-24],
  espanola: [{ d: -27, sinRemito: true }, -6],
  autoserv: [{ d: -20, sinRemito: true }],
  pizza: [-17, { d: -10, sinRemito: true }, -3],
  rosa: [-14],
  vasquito: [{ d: -31, sinRemito: true }],
  julio: [-66, { d: -45, sinRemito: true }],
  tito: [-15, { d: -8, sinRemito: true }],
};
const CANCELADOS = [
  { k: "coope", d: -38, obs: "Cancelado: no llegaron a juntar el pago" },
  { k: "autoserv", d: -33, obs: "" },
  { k: "tito", d: -29, obs: "Pidió por error, lo repite la semana que viene" },
  { k: "cayetano", d: -10, obs: "" },
];
const OBS_PEDIDO = ["Entregar antes de las 11 hs", "Llamar antes de ir", "Dejar en la cámara del fondo", "Cobrar en efectivo al entregar", "Pasa a retirar después de las 15"];
const OBS_ITEM = ["Bien seco", "Cortado al medio", "Sin cuero", "En piezas chicas"];

// ── Utilidades deterministas ────────────────────────────────────────────────
/** Número fijo en [0,1) a partir de un texto (reemplaza a Math.random). */
function h(clave) {
  let x = 2166136261;
  for (let i = 0; i < clave.length; i++) {
    x ^= clave.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  x ^= x >>> 15; x = Math.imul(x, 2246822507); x ^= x >>> 13; x = Math.imul(x, 3266489909); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const elegir = (lista, clave) => lista[Math.floor(h(clave) * lista.length)];
const r2 = (n) => Math.round(n * 100) / 100;
const r100 = (n) => Math.round(n / 100) * 100;
const pad = (n, l = 3) => String(n).padStart(l, "0");
const copia = (o) => JSON.parse(JSON.stringify(o));
const CATEGORIA_DE = {};
for (const [cat, prods] of Object.entries(CATALOGO)) for (const p of prods) CATEGORIA_DE[p] = cat;
CATEGORIA_DE[PRODUCTO_AGREGADO.producto] = PRODUCTO_AGREGADO.categoria;

export function sha256Hex(texto) {
  return crypto.createHash("sha256").update(texto, "utf8").digest("hex");
}

export function buildSeed({ today = "2026-11-10" } = {}) {
  // Fechas: todo relativo a `today`, hora de Buenos Aires (UTC-3, sin horario de verano).
  const dia = (n) => {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const diaSemana = (fecha) => new Date(fecha + "T12:00:00Z").getUTCDay(); // 0 = domingo
  const habil = (n) => (diaSemana(dia(n)) === 0 ? n - 1 : n); // el reparto no sale los domingos
  const momento = (n, hhmm) => new Date(`${dia(n)}T${hhmm}:00-03:00`);
  const hora = (base, clave, minutos) => {
    const [hh, mm] = base.split(":").map(Number);
    const t = hh * 60 + mm + Math.floor(h(clave) * minutos);
    return pad(Math.floor(t / 60), 2) + ":" + pad(t % 60, 2);
  };

  const db = {
    usuarios: {}, config: {}, clientes: {}, precios_cliente: {}, pedidos: {}, remitos: {}, cuentas_corrientes: {},
    cc_movimientos: {}, devoluciones: {}, ventas_diarias: {}, stock_produccion: {}, stock_movimientos: {}, reportes: {},
    faenas: {}, trazabilidad_lotes: {},
  };
  const cuenta = {};
  const nuevoId = (col, prefijo, largo = 3) => {
    cuenta[col] = (cuenta[col] || 0) + 1;
    return prefijo + "_" + pad(cuenta[col], largo);
  };
  const alta = (col, prefijo, datos, largo) => {
    const id = nuevoId(col, prefijo, largo);
    db[col][id] = datos;
    return id;
  };

  // Reloj de la simulación: cada new Date() de la página cae unos milisegundos después del anterior.
  let reloj = 0;
  const iso = () => { const s = new Date(reloj).toISOString(); reloj += 173; return s; };
  const ts = () => ({ __ts: iso() });
  const hoyUTC = () => new Date(reloj).toISOString().split("T")[0];
  const eventos = [];
  const en = (cuando, fn) => eventos.push({ t: cuando.getTime(), n: eventos.length, fn });

  const C = Object.fromEntries(CLIENTES.map((c) => [c.k, c]));
  const nombreDe = (k) => C[k].nombre;
  const idCliente = {};

  // Precio que se le cobra a un cliente según la lista vigente ese día (hubo dos aumentos).
  const precioDe = (k, producto, n) => {
    const base = PRECIO_BASE[producto];
    if (!base) return 0;
    const tramo = n < -40 ? 0.9 : n < -14 ? 0.95 : 1;
    return Math.round((base * (C[k].desc || 1) * tramo) / 100) * 100 - 10;
  };

  // ── Lo que escribe cada pantalla ──────────────────────────────────────────
  // GestionClientes.guardar (02-clientes-nuevo-pedido.jsx)
  function altaCliente(c) {
    idCliente[c.k] = alta("clientes", "cli", { nombre: c.nombre, telefono: c.telefono, direccion: c.direccion, cuentaCorriente: !!c.cc, creadoEn: ts() }, 2);
  }
  // marcarContacto (02-clientes-nuevo-pedido.jsx)
  function marcarContacto(nombre) {
    const doc = Object.values(db.clientes).find((c) => c.nombre.toLowerCase().trim() === nombre.toLowerCase().trim());
    if (!doc) throw new Error("seed: pedido de un cliente que no existe: " + nombre);
    doc.ultimoContacto = iso();
    doc.ultimoPedidoRegistrado = hoyUTC();
  }
  // TabCuentasCorrientes.crearCliente (06-cuentas-corrientes-stats.jsx)
  function abrirCuenta(nombre) {
    alta("cuentas_corrientes", "cc", { nombre, saldo: 0, creadoEn: iso(), ultimoMovimiento: hoyUTC() }, 2);
  }
  const cuentaDe = (nombre) => Object.values(db.cuentas_corrientes).find((c) => c.nombre.toLowerCase().trim() === nombre.toLowerCase().trim());
  const movsDe = (nombre) => Object.values(db.cc_movimientos).filter((m) => m.cliente.toLowerCase().trim() === nombre.toLowerCase().trim());
  const saldoPorMovimientos = (nombre) => movsDe(nombre).reduce((s, m) => s + (m.tipo === "pedido" ? m.monto : -m.monto), 0);
  // TabPrecios.guardar / HistorialPrecios.guardarPrecio (alta de un precio)
  function cargarPrecio(cliente, producto, precio) {
    alta("precios_cliente", "pre", { cliente, producto, precio, fecha: iso() });
  }
  // NuevoPedido.guardar (02-clientes-nuevo-pedido.jsx)
  function nuevoPedido({ cliente, cuentaCorriente, tipo, entrega, items, obs = "" }) {
    const id = alta("pedidos", "ped", {
      cliente, cuentaCorriente, tipo, fechaPedido: ts(), fechaPedidoISO: iso(), fechaEntrega: entrega,
      items: copia(items), obs: obs.trim(), estado: "pendiente",
      historial: [{ estado: "pendiente", fecha: iso(), nota: "Pedido creado" }],
    });
    if (cuentaCorriente) {
      alta("cc_movimientos", "ccm", {
        cliente, tipo: "pedido", monto: 0, movimiento: 0, fecha: entrega, detalle: items.map((it) => it.producto).join(", "),
        obs: "Pendiente de facturar", origen: "pedido_app", createdAt: iso(),
      });
    }
    marcarContacto(cliente);
    return id;
  }
  // VistaComercial.cambiarEstado / VistaDeposito.cambiarEstado
  function cambiarEstado(id, estado, itemsConKg = null) {
    const p = db.pedidos[id];
    p.estado = estado;
    p.historial = [...p.historial, { estado, fecha: iso() }];
    if (itemsConKg) p.items = itemsConKg;
  }
  // EditarPedido.guardar (03-pedidos-comercial-remito.jsx)
  function editarPedido(id, cambios) {
    Object.assign(db.pedidos[id], cambios, { editadoEn: iso() });
  }
  // RemitoPedido: cargarNro + guardarRemito (03-pedidos-comercial-remito.jsx)
  function guardarRemito(id, k, n) {
    const pedido = db.pedidos[id];
    if (!db.config.contador_remitos) db.config.contador_remitos = { ultimo: 0, updatedAt: iso() };
    // Precios que quedan en pantalla: los últimos guardados del cliente, corregidos a la lista vigente.
    const precios = {};
    for (const it of pedido.items) {
      const p = precioDe(k, it.producto, n);
      if (p > 0) precios[it.producto] = p;
    }
    const nroFinal = (db.config.contador_remitos.ultimo || 0) + 1;
    db.config.contador_remitos = { ultimo: nroFinal, updatedAt: iso() };
    const total = pedido.items.reduce((s, it) => s + (it.kgReal || parseFloat(it.cantidad) || 0) * (parseFloat(precios[it.producto]) || 0), 0);
    alta("remitos", "rem", {
      nro: nroFinal, pedidoId: id, cliente: pedido.cliente, fecha: hoyUTC(),
      items: pedido.items.map((it) => ({
        producto: it.producto, kg: it.kgReal || it.cantidad || 0, unidad: it.unidad,
        precio: parseFloat(precios[it.producto]) || 0,
        total: (it.kgReal || parseFloat(it.cantidad) || 0) * (parseFloat(precios[it.producto]) || 0),
      })),
      total, createdAt: iso(),
    }, 4);
    for (const it of pedido.items) {
      const p = parseFloat(precios[it.producto]);
      if (p > 0) cargarPrecio(pedido.cliente, it.producto, p);
    }
    const cc = cuentaDe(pedido.cliente);
    if (pedido.cuentaCorriente || cc) {
      const montoFinal = Math.round(total);
      const hoyStr = hoyUTC();
      const productos = pedido.items.map((it) => it.producto).join(", ");
      const existente = movsDe(pedido.cliente).filter((m) => m.origen === "pedido_app" && m.fecha === pedido.fechaEntrega && m.monto === 0).pop();
      if (existente && montoFinal > 0) {
        Object.assign(existente, { monto: montoFinal, movimiento: montoFinal, detalle: productos, obs: "Remito N° " + pad(nroFinal, 4), remitoNro: nroFinal, updatedAt: iso() });
      } else if (montoFinal > 0) {
        alta("cc_movimientos", "ccm", {
          cliente: pedido.cliente, tipo: "pedido", monto: montoFinal, movimiento: montoFinal, fecha: pedido.fechaEntrega || hoyStr,
          detalle: productos, obs: "Remito N° " + pad(nroFinal, 4), origen: "remito", remitoNro: nroFinal, createdAt: iso(),
        });
      }
      if (montoFinal > 0 && cc) Object.assign(cc, { saldo: Math.round(saldoPorMovimientos(pedido.cliente)), ultimoMovimiento: hoyStr });
    }
  }
  // TabCuentasCorrientes.registrarPago (06-cuentas-corrientes-stats.jsx)
  function registrarPago(cliente, monto, formaPago, obs = "") {
    alta("cc_movimientos", "ccm", {
      cliente, tipo: "pago", formaPago, monto, movimiento: -monto, obs: obs.trim(), fecha: hoyUTC(),
      detalle: "Pago — " + formaPago, createdAt: iso(),
    });
    Object.assign(cuentaDe(cliente), { saldo: Math.round(saldoPorMovimientos(cliente)), ultimoMovimiento: hoyUTC() });
  }
  // ModalVentaRapida.guardar (05-venta-rapida-precios.jsx)
  function ventaRapida(cliente, items, obs = "") {
    const total = items.reduce((s, it) => s + it.cantidad * it.precio, 0);
    const montoFinal = Math.round(total);
    const hoy = hoyUTC();
    alta("pedidos", "ped", {
      cliente, tipo: "retiro", fechaPedido: ts(), fechaPedidoISO: iso(), fechaEntrega: hoy,
      items: items.map((it) => ({ producto: it.producto, cantidad: it.cantidad, unidad: it.unidad, precio: it.precio, kgReal: it.cantidad })),
      obs: obs.trim() ? "VR: " + obs.trim() : "Venta rapida", estado: "despachado", origen: "venta_rapida", cuentaCorriente: true,
      historial: [{ estado: "despachado", fecha: iso(), nota: "Venta rapida" }],
    });
    alta("cc_movimientos", "ccm", {
      cliente, tipo: "pedido", monto: montoFinal, movimiento: montoFinal, fecha: hoy,
      detalle: items.map((it) => `${it.producto} ${it.cantidad}${it.unidad}`).join(", "), obs: obs.trim(), origen: "venta_rapida",
      items: items.map((it) => ({ producto: it.producto, cantidad: it.cantidad, unidad: it.unidad, precio: it.precio })),
      createdAt: iso(),
    });
    const cc = cuentaDe(cliente);
    if (cc) Object.assign(cc, { saldo: Math.round(saldoPorMovimientos(cliente)), ultimoMovimiento: hoy });
    marcarContacto(cliente);
  }
  // TabDevoluciones.guardar (08-director-devoluciones-app.jsx)
  function devolucion({ cliente, producto, cantidad, unidad = "kg", motivo, descripcion = "", fechaPedidoOrig = "", monto = 0 }) {
    const id = alta("devoluciones", "dev", {
      cliente, producto, cantidad, unidad, motivo, descripcion, fechaPedidoOrig, monto, estado: "pendiente", createdAt: iso(), fecha: hoyUTC(),
    }, 2);
    const cc = cuentaDe(cliente);
    if (monto > 0 && cc) {
      const saldoActual = cc.saldo || 0;
      Object.assign(cc, { saldo: saldoActual - monto, ultimoMovimiento: hoyUTC() });
      alta("cc_movimientos", "ccm", {
        cliente, tipo: "pago", monto, movimiento: -monto, saldo: saldoActual - monto, fecha: hoyUTC(),
        detalle: "Crédito por devolución: " + producto, obs: "Devolución registrada automáticamente", origen: "devolucion", createdAt: iso(),
      });
    }
    return id;
  }

  // ── Armado de ítems ───────────────────────────────────────────────────────
  const item = (producto, cantidad, unidad = "kg", obs = "") => ({ categoria: CATEGORIA_DE[producto] || "Artículos Varios", producto, cantidad: String(cantidad), unidad, obs });
  function itemsHabituales(k, i) {
    const canasta = CANASTAS[k];
    const cuantos = Math.min(canasta.length, 2 + Math.floor(h(`${k}#${i}#n`) * 3));
    const out = [];
    for (let j = 0; j < cuantos; j++) {
      const [producto, base, unidad] = canasta[(i * 2 + j) % canasta.length];
      const factor = elegir([1, 1, 1, 1.5, 0.5], `${k}#${i}#${j}#f`);
      const q = unidad === "kg" ? Math.max(1, Math.round(base * factor * 2) / 2) : Math.max(1, Math.round(base * factor));
      out.push(item(producto, q, unidad, h(`${k}#${i}#${j}#o`) < 0.07 ? elegir(OBS_ITEM, `${k}#${i}#${j}#oi`) : ""));
    }
    return out;
  }
  // Kg que marca la balanza. En ítems por kg a veces queda en blanco (null), como permite la pantalla.
  function pesar(it, clave) {
    const q = parseFloat(it.cantidad);
    if (it.unidad === "kg") {
      if (h(clave + "#blanco") < 0.07) return null;
      return r2(q + (h(clave) - 0.5) * Math.min(0.9, q * 0.05));
    }
    const w = PESO_UNIDAD[it.producto] || 1;
    return r2(q * w * (0.94 + h(clave) * 0.12));
  }
  const conKg = (id, llenar) => db.pedidos[id].items.map((it, j) => ({ ...it, kgReal: llenar(it, j) }));

  // ── 1. Puesta en marcha: usuarios, clientes, cuentas y listas de precios ────
  en(momento(-74, "09:00"), () => {
    db.usuarios.nacho = { usuario: "nacho", passwordHash: sha256Hex("sersale123"), nombre: "Nacho", activo: true, creado: ts() };
  });
  en(momento(-60, "12:10"), () => {
    db.usuarios.romina = { usuario: "romina", passwordHash: sha256Hex("administracion26"), nombre: "Romina", activo: true, creado: ts() };
  });
  en(momento(-52, "17:45"), () => {
    db.usuarios.claudio = { usuario: "claudio", passwordHash: sha256Hex("deposito2026"), nombre: "Claudio", activo: false, creado: ts() };
  });
  CLIENTES.forEach((c, i) => en(new Date(momento(c.alta ?? -73, "10:00").getTime() + i * 120000), () => altaCliente(c)));
  // config/productos: lo deja GestionProductos.guardar al agregar el primer producto.
  en(momento(-33, "16:20"), () => {
    const categorias = copia(CATALOGO);
    categorias[PRODUCTO_AGREGADO.categoria].push(PRODUCTO_AGREGADO.producto);
    db.config.productos = { categorias, updatedAt: iso() };
  });
  CLIENTES.filter((c) => c.cc && c.k !== "nestor").forEach((c, i) => en(new Date(momento(-72, "11:00").getTime() + i * 60000), () => abrirCuenta(c.nombre)));
  en(momento(-36, "15:30"), () => abrirCuenta(nombreDe("nestor"))); // esta cuenta se abrió más tarde
  CON_LISTA.forEach((k, i) =>
    en(new Date(momento(-71, "15:00").getTime() + i * 240000), () => {
      for (const [producto] of CANASTAS[k]) if (producto !== PRODUCTO_AGREGADO.producto) cargarPrecio(nombreDe(k), producto, precioDe(k, producto, -71));
    })
  );
  // Días de recontacto tocados a mano en la pestaña Alertas (VistaDirector.actualizarDiasAlerta).
  CLIENTES.filter((c) => c.dias).forEach((c) => en(momento(Math.max(c.alta ?? -70, -70) + 1, "18:00"), () => { db.clientes[idCliente[c.k]].diasAlerta = c.dias; }));

  // ── 2. Pedidos entregados (alta → preparación → listo → remito → despacho) ──
  const pedidoDe = {}; // "angel@-7" -> id
  const creacion = (n, clave) => { let c = n - 1; if (diaSemana(dia(c)) === 0) c -= 1; return momento(c, hora("09:00", clave, 510)); };
  for (const [k, lista] of Object.entries(HISTORIA)) {
    lista.forEach((def, i) => {
      const d0 = typeof def === "number" ? def : def.d;
      const o = typeof def === "number" ? {} : def;
      const n = habil(d0);
      const clave = `${k}@${d0}`;
      const c = C[k];
      const tipo = ["sabor", "tito", "vasquito", "nestor"].includes(k) ? "retiro" : h(clave + "#tipo") < 0.12 ? "retiro" : "envio";
      const items = itemsHabituales(k, i);
      if (clave === "trebol@-55") items.push(item("Grasa de cerdo en pan", 5, "kg"));
      if (clave === "tito@-15") items.push(item("Hueso de jamón", 3, "unidades"));
      const obs = h(clave + "#obs") < 0.3 ? elegir(OBS_PEDIDO, clave + "#obsq") : "";
      en(creacion(n, clave), () => { pedidoDe[clave] = nuevoPedido({ cliente: c.nombre, cuentaCorriente: !!c.cc && !o.sinMarca, tipo, entrega: dia(n), items, obs }); });
      const pesoAlPreparar = h(clave + "#prep") < 0.6;
      const tPrep = momento(n, hora("07:00", clave + "#tp", 45));
      const tListo = momento(n, hora("08:20", clave + "#tl", 70));
      en(tPrep, () => cambiarEstado(pedidoDe[clave], "preparando", conKg(pedidoDe[clave], (it, j) => (pesoAlPreparar ? pesar(it, `${clave}#${j}`) : null))));
      en(tListo, () => cambiarEstado(pedidoDe[clave], "listo"));
      // Si no se pesó al preparar, se pesa con "⚖️ kg" cuando ya está listo (agrega otro "listo" al historial).
      if (!pesoAlPreparar) en(new Date(tListo.getTime() + 6 * 60000), () => cambiarEstado(pedidoDe[clave], "listo", conKg(pedidoDe[clave], (it, j) => pesar(it, `${clave}#${j}`))));
      if (!o.sinRemito) en(new Date(tListo.getTime() + 14 * 60000), () => guardarRemito(pedidoDe[clave], k, n));
      en(new Date(tListo.getTime() + (35 + Math.floor(h(clave + "#td") * 120)) * 60000), () => cambiarEstado(pedidoDe[clave], "despachado"));
    });
  }
  for (const x of CANCELADOS) {
    const n = habil(x.d);
    const clave = `${x.k}@${x.d}`;
    en(creacion(n, clave), () => { pedidoDe[clave] = nuevoPedido({ cliente: nombreDe(x.k), cuentaCorriente: !!C[x.k].cc, tipo: "envio", entrega: dia(n), items: itemsHabituales(x.k, 7), obs: x.obs }); });
    en(new Date(creacion(n, clave).getTime() + 95 * 60000), () => cambiarEstado(pedidoDe[clave], "cancelado"));
  }

  // ── 3. Ventas rápidas (mostrador, a cuenta corriente) ───────────────────────
  en(momento(habil(-12), "11:30"), () => ventaRapida(nombreDe("perez"), [
    { producto: "Chorizo Puro Cerdo", cantidad: 12, unidad: "kg", precio: precioDe("perez", "Chorizo Puro Cerdo", -12) },
    { producto: "Morcilla Criolla", cantidad: 5, unidad: "kg", precio: precioDe("perez", "Morcilla Criolla", -12) },
  ], "Retiró Jorge"));
  en(momento(habil(-5), "14:10"), () => ventaRapida(nombreDe("nestor"), [
    { producto: "Bondiola Fresca", cantidad: 6.5, unidad: "kg", precio: precioDe("nestor", "Bondiola Fresca", -5) },
    { producto: "Chorizo Bombón Puro Cerdo", cantidad: 4, unidad: "kg", precio: precioDe("nestor", "Chorizo Bombón Puro Cerdo", -5) },
    { producto: "Salchichas de Viena", cantidad: 3, unidad: "bolsas", precio: precioDe("nestor", "Salchichas de Viena", -5) },
  ]));

  // ── 4. Pagos y devoluciones ─────────────────────────────────────────────────
  // El monto se calcula cuando ocurre el pago, con lo que haya facturado hasta ese momento.
  const facturado = (clave) => {
    const p = db.pedidos[pedidoDe[clave]];
    const m = movsDe(p.cliente).find((x) => x.tipo === "pedido" && x.fecha === p.fechaEntrega);
    if (!m || !m.monto) throw new Error("seed: se quiso pagar un pedido sin facturar: " + clave);
    return m.monto;
  };
  const remitoDe = (clave) => Object.values(db.remitos).find((r) => r.pedidoId === pedidoDe[clave]);
  const pago = (k, n, hhmm, monto, forma, obs) => en(momento(n, hhmm), () => registrarPago(nombreDe(k), typeof monto === "function" ? monto() : monto, forma, obs));
  // Don Ángel: paga en efectivo el remito anterior cada vez que le llega el reparto.
  [[-28, -35], [-21, -28], [-14, -21], [-7, -14]].forEach(([n, d]) => pago("angel", habil(n), "12:40", () => facturado(`angel@${d}`), "efectivo", ""));
  // Distribuidora: transfiere a 15 días; del tercer remito hizo un pago a cuenta.
  pago("distri", -25, "16:05", () => facturado("distri@-40"), "transferencia", "Transf. Banco Galicia 004512");
  pago("distri", -15, "15:40", () => facturado("distri@-30"), "transferencia", "Transf. Banco Galicia 004731");
  pago("distri", -5, "17:10", 600000, "transferencia", "A cuenta — Transf. Banco Galicia 004958");
  // Panificadora Gamas: cada sucursal paga por separado.
  pago("gamasB", -8, "11:15", () => facturado("gamasB@-20") + facturado("gamasB@-13"), "cheque", "Cheque Banco Nación 30 días N° 77120345");
  pago("gamasC", -8, "11:20", () => r2(remitoDe("gamasC@-19").total), "transferencia", "Pagó el importe exacto del remito");
  pago("gamasP", -22, "10:30", () => facturado("gamasP@-29"), "transferencia", "");
  pago("gamasP", -1, "10:50", () => facturado("gamasP@-8"), "transferencia", "");
  // El Trébol: un solo pago parcial hace mucho; el resto es deuda de más de 30 días.
  pago("trebol", -50, "13:00", () => Math.round((facturado("trebol@-62") * 0.6) / 1000) * 1000, "efectivo", "Entrega a cuenta");
  // Pérez & Hijos
  pago("perez", -25, "12:15", () => facturado("perez@-32"), "efectivo", "");
  pago("perez", -11, "12:20", () => facturado("perez@-18"), "efectivo", "");
  // D'Agostino: pagó de más (redondeó para arriba) y además tuvo una devolución: queda saldo a favor.
  pago("dagostino", -20, "18:00", () => facturado("dagostino@-25"), "transferencia", "MP");
  pago("dagostino", -9, "18:20", () => Math.ceil((facturado("dagostino@-11") + 1) / 50000) * 50000, "transferencia", "Transfirió redondo");
  // San Cayetano
  pago("cayetano", -24, "09:40", () => facturado("cayetano@-31"), "cheque", "Cheque al día");
  pago("cayetano", -10, "09:55", () => facturado("cayetano@-17"), "otro", "Mitad efectivo, mitad transferencia");
  // Lo de Néstor
  pago("nestor", -27, "18:30", () => facturado("nestor@-34"), "efectivo", "");

  const devs = {};
  en(momento(-23, "10:10"), () => { devs.coope = devolucion({ cliente: nombreDe("coope"), producto: "Pollo", cantidad: 4, motivo: "Cantidad incorrecta", descripcion: "Pidieron 30 kg y llegaron 34. Se retiró la diferencia.", fechaPedidoOrig: dia(habil(-24)), monto: 0 }); });
  en(momento(-21, "09:00"), () => { db.devoluciones[devs.coope].estado = "resuelta"; });
  en(momento(-18, "11:45"), () => { devs.distri = devolucion({ cliente: nombreDe("distri"), producto: "Mortadela Bocha", cantidad: 2, unidad: "unidades", motivo: "Daño en el transporte", descripcion: "Dos bochas golpeadas, envase roto.", fechaPedidoOrig: dia(habil(-20)), monto: 38000 }); });
  en(momento(-17, "08:30"), () => { db.devoluciones[devs.distri].estado = "resuelta"; });
  en(momento(-6, "16:30"), () => { devs.dagostino = devolucion({ cliente: nombreDe("dagostino"), producto: "Queso Cremoso", cantidad: 2, motivo: "Producto en mal estado", descripcion: "Llegó con la cadena de frío cortada.", fechaPedidoOrig: dia(habil(-11)), monto: 15980 }); });
  en(momento(-5, "09:10"), () => { db.devoluciones[devs.dagostino].estado = "resuelta"; });
  en(momento(-6, "17:05"), () => devolucion({ cliente: nombreDe("nata"), producto: "Salchichón Primavera", cantidad: 4, motivo: "Error en el pedido", descripcion: "Quería salchichón con jamón. Se cambia en el próximo reparto.", fechaPedidoOrig: dia(habil(-7)), monto: 0 }));
  en(momento(-1, "15:20"), () => devolucion({ cliente: nombreDe("cayetano"), producto: "Salamín Picado Fino", cantidad: 1.5, motivo: "Calidad no conforme", descripcion: "Muy blando, le falta estacionamiento.", fechaPedidoOrig: dia(habil(-3)), monto: 22485 }));

  // ── 5. Pedidos en curso: 1 de ayer sin retirar, 4 para hoy, 3 para mañana, 2 más adelante ──
  const activo = (clave, cuando, datos) => en(cuando, () => { pedidoDe[clave] = nuevoPedido(datos); });
  activo("sabor@-1", momento(-3, "11:40"), { cliente: nombreDe("sabor"), cuentaCorriente: false, tipo: "retiro", entrega: dia(-1), obs: "Retira Gustavo con la camioneta",
    items: [item("Pollo", 20), item("Pernil Fresco", 10), item("Queso Mozzarella", 5)] });
  en(momento(-1, "08:05"), () => cambiarEstado(pedidoDe["sabor@-1"], "preparando", conKg(pedidoDe["sabor@-1"], (it, j) => pesar(it, "sabor-1#" + j))));
  en(momento(-1, "11:10"), () => cambiarEstado(pedidoDe["sabor@-1"], "listo"));
  // Hoy
  activo("angel@0", momento(-1, "16:40"), { cliente: nombreDe("angel"), cuentaCorriente: true, tipo: "envio", entrega: dia(0), obs: "Entregar antes de las 11 hs",
    items: [item("Jamón Cocido Natural Sublime", 12), item("Queso Tybo", 8), item("Salamín Picado Fino", 3, "ganchos"), item("Mortadela Bocha", 2, "unidades", "Que no sean muy grandes")] });
  activo("gamasB@0", momento(-1, "11:15"), { cliente: nombreDe("gamasB"), cuentaCorriente: true, tipo: "envio", entrega: dia(0), obs: "",
    items: [item("Fiambre de Cerdo p/ Emparedados", 15), item("Queso Mozzarella", 20), item("Jamón Cocido de Pata", 10)] });
  activo("distri@0", momento(-1, "10:05"), { cliente: nombreDe("distri"), cuentaCorriente: true, tipo: "envio", entrega: dia(0), obs: "Recibe Marcelo. Entrar por el portón de la calle Luzuriaga.",
    items: [item("Jamón Cocido Natural Sublime", 40), item("Fiambre Cocido de Paleta de Cerdo", 35), item("Jamón Crudo c/ Hueso 12 Meses", 4, "piezas"), item("Salamín Picado Grueso", 20), item("Queso Pategras", 18)] });
  en(momento(0, "07:35"), () => cambiarEstado(pedidoDe["distri@0"], "preparando", conKg(pedidoDe["distri@0"], () => null)));
  en(momento(0, "08:50"), () => cambiarEstado(pedidoDe["gamasB@0"], "preparando", conKg(pedidoDe["gamasB@0"], (it, j) => (j === 0 ? 15.2 : null))));
  en(momento(0, "09:20"), () => cambiarEstado(pedidoDe["distri@0"], "listo"));
  en(momento(0, "09:26"), () => cambiarEstado(pedidoDe["distri@0"], "listo", conKg(pedidoDe["distri@0"], (it, j) => [40.35, 34.8, 31.6, 20.1, 18.25][j])));
  activo("rosa@0", momento(0, "09:47"), { cliente: nombreDe("rosa"), cuentaCorriente: false, tipo: "envio", entrega: dia(0), obs: "Llamar antes de ir, no tiene timbre",
    items: [item("Mortadela Familiar", 2), item("Queso Cremoso", 3), item("Chorizo Puro Cerdo", 4)] });
  // Mañana
  activo("perez@1", momento(-1, "12:30"), { cliente: nombreDe("perez"), cuentaCorriente: true, tipo: "envio", entrega: dia(1), obs: "",
    items: [item("Chorizo Especial Vacuno/Cerdo", 25), item("Carré c/ Hueso", 14), item("Morcilla Vasca", 6)] });
  activo("nata@1", momento(-1, "18:05"), { cliente: nombreDe("nata"), cuentaCorriente: false, tipo: "retiro", entrega: dia(1), obs: "Pasa a retirar el hijo a la tarde",
    items: [item("Jamón Cocido Especial Bajo Sodio", 8), item("Salchichón c/ Jamón", 4), item("Queso Cremoso", 6)] });
  activo("gamasC@1", momento(0, "08:12"), { cliente: nombreDe("gamasC"), cuentaCorriente: true, tipo: "envio", entrega: dia(1), obs: "",
    items: [item("Queso Mozzarella", 18), item("Fiambre de Cerdo p/ Emparedados", 12), item("Panceta Ahumada", 2, "kg", "Feteada")] });
  en(momento(0, "08:40"), () => {
    const p = db.pedidos[pedidoDe["perez@1"]];
    editarPedido(pedidoDe["perez@1"], { items: p.items.map((it, j) => (j === 0 ? { ...it, cantidad: "30" } : it)), obs: "Agregó 5 kg de chorizo por teléfono" });
  });
  en(momento(0, "10:02"), () => cambiarEstado(pedidoDe["perez@1"], "preparando", conKg(pedidoDe["perez@1"], () => null)));
  // Más adelante
  activo("dagostino@2", momento(0, "09:15"), { cliente: nombreDe("dagostino"), cuentaCorriente: true, tipo: "envio", entrega: dia(2), obs: "",
    items: [item("Fiambre de Cerdo p/ Emparedados", 6), item("Salchichas de Viena", 4, "bolsas"), item("Bolsas camiseta 40x50", 2, "unidades")] });
  activo("pizza@4", momento(-1, "15:20"), { cliente: nombreDe("pizza"), cuentaCorriente: false, tipo: "envio", entrega: dia(4), obs: "Pedido grande por el fin de semana largo",
    items: [item("Queso Mozzarella", 45), item("Jamón Cocido de Pata", 12), item("Longaniza Tipo Calabresa", 6), item("Bondiola Ahumada", 3)] });

  // ── 6. Producción: stock, reportes de los encargados, salidas, faena y lotes ──
  const STOCK = [
    ["Jamón Cocido Natural Sublime", "Cocidos", 38, "piezas", 15, ""], ["Jamón Cocido de Pata", "Cocidos", 22, "piezas", 10, ""],
    ["Fiambre Cocido de Paleta de Cerdo", "Cocidos", 30, "piezas", 12, ""], ["Jamón Crudo c/ Hueso 12 Meses", "Jamones Crudos", 64, "piezas", 20, "Cámara 2, en estacionamiento"],
    ["Bondiola Seca al Papel", "Jamones Crudos", 26, "piezas", 20, ""], ["Salamín Picado Fino", "Secos", 120, "ganchos", 40, ""],
    ["Salame Tipo Milán", "Secos", 45, "piezas", 15, ""], ["Chorizo Puro Cerdo", "Frescos", 85, "kg", 50, ""],
    ["Morcilla Criolla", "Frescos", 46, "kg", 40, ""], ["Panceta Ahumada", "Ahumados", 26, "piezas", 10, ""],
    ["Mortadela Bocha", "Pastas", 14, "piezas", 8, ""], ["Media res de cerdo", "Materia Prima", 24, "unidades", 10, "Proveedor: Frigorífico La Pompeya"],
    ["Tripa natural calibre 32", "Insumos", 9, "bolsas", 10, "Pedir a Tripería Sur"], ["Sal entrefina x 25 kg", "Insumos", 12, "bolsas", 5, ""],
    ["Film termocontraíble", "Insumos", 3, "unidades", 2, ""],
  ];
  // VistaDirector.guardarStock (produccion/app.jsx)
  STOCK.forEach(([nombre, categoria, cantidad, unidad, minimo, obs], i) =>
    en(new Date(momento(-30, "17:00").getTime() + i * 90000), () => alta("stock_produccion", "stk", { nombre, categoria, cantidad, unidad, minimo, obs, updatedAt: iso() }, 2))
  );
  const stockDe = (nombre) => Object.entries(db.stock_produccion).find(([, s]) => s.nombre === nombre);
  // VistaEncargado.enviar (produccion/app.jsx): el reporte suma al stock lo informado en "piezas".
  function reporte(area, encargado, items, obs = "") {
    const rep = { area, encargado, fecha: ts(), fechaISO: iso(), items, obs };
    const id = alta("reportes", "rep", rep);
    for (const it of items.filter((x) => x.unidad === "piezas")) {
      const s = stockDe(it.producto);
      if (!s) continue; // el sistema avisa y no toca el stock
      s[1].cantidad = (parseFloat(s[1].cantidad) || 0) + parseFloat(it.cantidad);
      s[1].updatedAt = iso();
      alta("stock_movimientos", "smv", { stockId: s[0], nombre: it.producto, tipo: "entrada", subtipo: "produccion", cantidad: parseFloat(it.cantidad), unidad: "piezas", ref: id, encargado, fecha: hoyUTC(), createdAt: iso() });
    }
  }
  // VistaDirector.guardarSalida (produccion/app.jsx)
  function salida(tipo, destino, fecha, items, obs = "") {
    for (const it of items) {
      const s = stockDe(it.nombre);
      s[1].cantidad = Math.max(0, (parseFloat(s[1].cantidad) || 0) - it.cantidad);
      s[1].updatedAt = iso();
      alta("stock_movimientos", "smv", { stockId: s[0], nombre: it.nombre, tipo: "salida", subtipo: tipo, destino: tipo === "despacho" ? destino : tipo === "venta" ? "Planta" : "Cliente", cantidad: it.cantidad, unidad: it.unidad, fecha, obs, createdAt: iso() });
    }
  }
  const rp = (producto, cantidad, unidad = "kg", obs = "") => ({ producto, cantidad: String(cantidad), unidad, obs });
  const TANDAS = [
    ["cocidos", "Ramón", "06:50", (v) => [rp("Jamón Cocido Natural Sublime", 10 + v * 2, "piezas"), rp("Fiambre Cocido de Paleta de Cerdo", 8 + v, "piezas"), rp("Jamón Cocido de Pata", 6, "piezas")], "Horno 2 con demora por mantenimiento"],
    ["frescos", "Darío", "08:20", (v) => [rp("Chorizo Puro Cerdo", 120 + v * 15), rp("Morcilla Criolla", 60 + v * 5), rp("Salchicha Fresca Parrillera", 40)], ""],
    ["secos", "Carlos", "09:40", (v) => [rp("Salamín Picado Fino", 60 + v * 10, "ganchos"), rp("Salame Tipo Milán", 12 + v, "piezas"), rp("Longaniza Tipo Calabresa", 35)], "Pasan a secadero 3"],
    ["pastas", "Lucas", "11:30", (v) => [rp("Mortadela Bocha", 6 + v, "piezas"), rp("Mortadela Bologna", 80), rp("Salchichón c/ Jamón", 45.5)], ""],
    ["ahumados", "Ramón", "13:10", (v) => [rp("Panceta Ahumada", 8 + v, "piezas"), rp("Lomo Ahumado", 22), rp("Salchichas de Viena", 30, "bolsas")], ""],
    ["crudos", "Miguel", "14:20", (v) => [rp("Jamón Crudo c/ Hueso 12 Meses", 12, "piezas", "Salado, entran a cámara"), rp("Bondiola Seca al Papel", 6 + v, "piezas")], ""],
  ];
  for (let n = -9; n <= 0; n++) {
    if (diaSemana(dia(n)) === 0) continue;
    TANDAS.forEach(([area, encargado, hhmm, items, obs], i) => {
      // Hoy se cargaron las tres primeras (es media mañana); los otros días, tres o cuatro áreas.
      const toca = n === 0 ? i < 3 : (i + (n + 90)) % 2 === 0 || i < 2;
      if (!toca) return;
      const v = Math.floor(h(`tanda${n}#${i}`) * 3);
      en(momento(n, hhmm), () => reporte(area, encargado, items(v), h(`tanda${n}#${i}#o`) < 0.3 ? obs : ""));
    });
  }
  for (const n of [-8, -6, -4, -1]) {
    if (diaSemana(dia(n)) === 0) continue;
    en(momento(n, "15:30"), () => salida("despacho", n % 2 ? "PP" : "CAB", dia(n), [
      { nombre: "Jamón Cocido Natural Sublime", cantidad: 6, unidad: "piezas" }, { nombre: "Fiambre Cocido de Paleta de Cerdo", cantidad: 5, unidad: "piezas" },
      { nombre: "Chorizo Puro Cerdo", cantidad: 18, unidad: "kg" }, { nombre: "Mortadela Bocha", cantidad: 4, unidad: "piezas" },
    ], "Reposición de sucursal"));
  }
  en(momento(-7, "12:00"), () => salida("pedido", "", dia(-7), [{ nombre: "Jamón Crudo c/ Hueso 12 Meses", cantidad: 4, unidad: "piezas" }, { nombre: "Salamín Picado Fino", cantidad: 40, unidad: "ganchos" }], "Pedido Distribuidora Mayorista del Sur"));
  en(momento(-5, "10:45"), () => salida("venta", "", dia(-5), [{ nombre: "Morcilla Criolla", cantidad: 22, unidad: "kg" }, { nombre: "Bondiola Seca al Papel", cantidad: 9, unidad: "piezas" }], "Venta en planta a un vecino"));
  en(momento(-3, "09:30"), () => salida("venta", "", dia(-3), [{ nombre: "Media res de cerdo", cantidad: 3, unidad: "unidades" }, { nombre: "Panceta Ahumada", cantidad: 12, unidad: "piezas" }], ""));
  en(momento(-1, "16:10"), () => salida("pedido", "", dia(-1), [{ nombre: "Salame Tipo Milán", cantidad: 20, unidad: "piezas" }, { nombre: "Bondiola Seca al Papel", cantidad: 14, unidad: "piezas" }], "Pedidos de la semana"));

  // VistaDirector.guardarFaena (produccion/app.jsx)
  [[-50, "Cerdo", 44, 4972], [-43, "Cerdo", 48, 5510], [-40, "Vaca", 6, 1422], [-36, "Cerdo", 40, 4488], [-29, "Cerdo", 52, 6032], [-22, "Cerdo", 46, 5244],
   [-15, "Cerdo", 50, 5625], [-12, "Vaca", 8, 1936], [-8, "Cerdo", 42, 4830], [-1, "Cerdo", 47, 5381]].forEach(([n, tipo, cantidad, pesoTotal], i) =>
    en(momento(n, "13:30"), () => alta("faenas", "fae", {
      fecha: dia(n), tipo, cantidad, pesoTotal, pesoPromedio: Math.round((pesoTotal / cantidad) * 10) / 10,
      obs: ["", "Tropa de Saladillo", "", "Dos decomisos parciales por SENASA", ""][i % 5], createdAt: iso(),
    }, 2))
  );
  // VistaDirector.guardarLote (produccion/app.jsx)
  const lote = (n, vence, operario, materiasPrimas, productos, obs = "") =>
    en(momento(n, "12:00"), () => {
      const prefijo = dia(n).replace(/-/g, "");
      const seq = Object.values(db.trazabilidad_lotes).filter((l) => l.nroLote.startsWith(prefijo)).length + 1;
      alta("trazabilidad_lotes", "lot", { nroLote: prefijo + "-" + pad(seq), fechaElab: dia(n), fechaVenc: dia(n + vence), operario, materiasPrimas, productos, obs, createdAt: iso() }, 2);
    });
  const mp = (tipo, corte, proveedor, kg) => ({ tipo, corte, proveedor, kg });
  const pr = (nombre, cantidad, unidad = "piezas") => ({ nombre, cantidad, unidad });
  lote(-34, 30, "Ramón", [mp("cerdo", "Pernil", "Frigorífico La Pompeya", 420)], [pr("Jamón Cocido Natural Sublime", 48), pr("Jamón Cocido de Pata", 20)]);
  lote(-27, 20, "Darío", [mp("cerdo", "Recorte", "Frigorífico La Pompeya", 260), mp("vacuno", "Aguja", "Carnes del Salado S.A.", 90)], [pr("Chorizo Especial Vacuno/Cerdo", 330, "kg")], "Tripa calibre 32");
  lote(-8, 5, "Darío", [mp("cerdo", "Recorte y tocino", "Frigorífico La Pompeya", 310)], [pr("Chorizo Puro Cerdo", 290, "kg"), pr("Salchicha Fresca Parrillera", 40, "kg")]);
  lote(-8, 45, "Lucas", [mp("cerdo", "Paleta", "Porcinos Roque Pérez", 180), mp("vacuno", "", "Carnes del Salado S.A.", 60)], [pr("Mortadela Bocha", 36), pr("Mortadela Bologna", 80, "kg")]);
  lote(-7, 30, "Ramón", [mp("cerdo", "Pernil", "Porcinos Roque Pérez", 510)], [pr("Jamón Cocido Natural Sublime", 54), pr("Fiambre Cocido de Paleta de Cerdo", 30)]);
  lote(-6, 90, "Carlos", [mp("cerdo", "Paleta y tocino", "Frigorífico La Pompeya", 240)], [pr("Salamín Picado Fino", 180, "unidades"), pr("Salame Tipo Milán", 40)], "Secadero 3. Control de merma semanal.");
  lote(-3, 8, "Darío", [mp("cerdo", "Sangre y cuero", "Frigorífico La Pompeya", 95)], [pr("Morcilla Criolla", 110, "kg")]);
  lote(-1, 365, "Miguel", [mp("cerdo", "Pernil con hueso", "Porcinos Roque Pérez", 620)], [pr("Jamón Crudo c/ Hueso 12 Meses", 56)], "Salado en pila, 14 días");
  en(momento(-20, "10:00"), () => { db.config.whatsapp = { phone: "5491155550101", apikey: "0000000" }; }); // ConfigWhatsApp.guardar (datos falsos)

  // ── 7. Cierres de caja de las dos sucursales (ventas.html → guardar) ────────
  for (let n = -45; n <= -1; n++) {
    for (const suc of ["PP", "CAB"]) {
      const fecha = dia(n);
      const kk = `${suc}${n}`;
      const totalZ = r100((suc === "PP" ? 1150000 : 820000) * [0.55, 0.85, 0.9, 0.95, 1, 1.25, 1.6][diaSemana(fecha)] * (0.85 + 0.3 * h(kk + "z")));
      const extras = h(kk + "e") < 0.25 ? [{ desc: elegir(["Venta mayorista mostrador", "Picadas para evento", "Venta a comercio vecino"], kk + "ed"), monto: r100(20000 + 70000 * h(kk + "em")) }] : [];
      const gastos = [{ desc: "Bolsas y descartables", monto: r100(4000 + 9000 * h(kk + "g1")) }];
      if (h(kk + "g2") < 0.45) gastos.push({ desc: elegir(["Flete", "Limpieza", "Adelanto de sueldo", "Librería", "Arreglo de cortadora"], kk + "g2d"), monto: r100(8000 + 42000 * h(kk + "g2m")) });
      const extraZ = extras.reduce((s, e) => s + e.monto, 0);
      const totalGasto = gastos.reduce((s, g) => s + g.monto, 0);
      const totalVentas = totalZ + extraZ;
      const cobEfec = r100(totalVentas * (0.3 + 0.12 * h(kk + "ce")));
      const cobTarj = r100(totalVentas * (0.22 + 0.1 * h(kk + "ct")));
      const cobOtro = h(kk + "co") < 0.2 ? r100(totalVentas * 0.03) : 0;
      const cobMP = totalVentas - cobEfec - cobTarj - cobOtro;
      en(momento(n, suc === "PP" ? "20:15" : "20:40"), () => {
        db.ventas_diarias[fecha + "_" + suc] = {
          fecha, sucursal: suc, totalZ, cobEfec, cobTarj, cobMP, cobOtro, usdOficial: 1395 + Math.round((n + 45) * 0.6), usdBlue: 1450 + Math.round((n + 45) * 0.9),
          extraZ, extraDesc: extras.map((e) => e.desc).join(", "), extras, gastos, totalGasto, totalCobros: cobEfec + cobTarj + cobMP + cobOtro, totalVentas,
          totalNeto: totalVentas - totalGasto, obs: diaSemana(fecha) === 0 ? "Domingo: medio día" : h(kk + "ob") < 0.1 ? "Se cortó la luz una hora" : "", ts: ts(),
        };
      });
    }
  }

  // ── Correr todo en orden ──────────────────────────────────────────────────
  const fin = momento(0, "10:05").getTime(); // nada ocurre después de "ahora"
  eventos.sort((a, b) => a.t - b.t || a.n - b.n);
  for (const e of eventos) {
    if (e.t > fin) throw new Error("seed: hay un evento posterior al momento actual");
    reloj = e.t;
    e.fn();
  }

  // ── 8. Lo que deja el panel del Director al abrirse (VistaDirector.calcularAlertas) ──
  // Frecuencia de compra y días de recontacto recalculados para cada cliente con historial,
  // y el registro del último mail de alertas (verificarYEnviarAlertas).
  reloj = fin;
  const fechasDe = {};
  for (const p of Object.values(db.pedidos)) if (p.estado !== "cancelado") (fechasDe[p.cliente] ||= new Set()).add(p.fechaEntrega);
  const fechasCC = {};
  for (const m of Object.values(db.cc_movimientos)) (fechasCC[m.cliente] ||= new Set()).add(m.fecha.substring(0, 10));
  const difDias = (a, b) => Math.round((new Date(a + "T12:00:00Z") - new Date(b + "T12:00:00Z")) / 86400000);
  let enAlerta = 0;
  for (const c of Object.values(db.clientes)) {
    const fechas = [...(fechasDe[c.nombre] || [])].sort();
    const difs = [];
    for (let i = 1; i < fechas.length; i++) { const d = difDias(fechas[i], fechas[i - 1]); if (d > 0 && d < 120) difs.push(d); }
    if (difs.length) {
      c.freqCalculada = Math.round(difs.reduce((a, b) => a + b, 0) / difs.length);
      c.diasAlerta = c.freqCalculada + 3;
      c.freqActualizado = iso();
    }
    let ultima = fechas[fechas.length - 1] || "";
    for (const f of fechasCC[c.nombre] || []) if (f > ultima) ultima = f;
    if (c.ultimoContacto && c.ultimoContacto.substring(0, 10) > ultima) ultima = c.ultimoContacto.substring(0, 10);
    if (c.ultimoPedidoRegistrado && c.ultimoPedidoRegistrado > ultima) ultima = c.ultimoPedidoRegistrado;
    if (ultima && difDias(today, ultima) >= (c.diasAlerta || 14)) enAlerta++;
  }
  db.config.ultima_alerta_email = { fecha: today, cantidad: enAlerta, updatedAt: iso() };

  verificar(db, today);
  return db;
}

/** Comprueba la coherencia interna del seed con las reglas del sistema. Tira un error si algo no cierra. */
export function verificar(db, today) {
  const falla = (m) => { throw new Error("seed incoherente: " + m); };
  // Cuentas corrientes: saldo guardado = lo que suman sus movimientos (pedido suma, cualquier otro tipo resta).
  for (const [id, cc] of Object.entries(db.cuentas_corrientes)) {
    const suma = Object.values(db.cc_movimientos).filter((m) => m.cliente === cc.nombre).reduce((s, m) => s + (m.tipo === "pedido" ? m.monto : -m.monto), 0);
    if (Math.round(suma) !== cc.saldo) falla(`saldo de ${cc.nombre} (${id}): guardado ${cc.saldo}, movimientos ${suma}`);
    if (!Object.values(db.clientes).some((c) => c.nombre === cc.nombre && c.cuentaCorriente)) falla("cuenta sin cliente marcado: " + cc.nombre);
  }
  for (const m of Object.values(db.cc_movimientos)) {
    if (typeof m.monto !== "number" || m.movimiento !== (m.tipo === "pedido" ? m.monto : -m.monto)) falla("movimiento mal formado: " + JSON.stringify(m));
    if (!Object.values(db.cuentas_corrientes).some((c) => c.nombre === m.cliente)) falla("movimiento sin cuenta: " + m.cliente);
    // Todo movimiento de venta corresponde a un pedido de ese cliente y esa fecha (si no, el Director inventa un "pedido virtual").
    if (m.tipo === "pedido" && !Object.values(db.pedidos).some((p) => p.cliente === m.cliente && p.fechaEntrega === m.fecha)) falla("movimiento sin pedido: " + m.cliente + " " + m.fecha);
  }
  // Remitos: total = suma de ítems; ítems = los del pedido; el movimiento de cuenta corriente lleva ese total redondeado.
  const nros = new Set();
  for (const [id, r] of Object.entries(db.remitos)) {
    const p = db.pedidos[r.pedidoId];
    if (!p) falla("remito sin pedido: " + id);
    if (nros.has(r.nro)) falla("número de remito repetido: " + r.nro);
    nros.add(r.nro);
    if (r.cliente !== p.cliente || r.items.length !== p.items.length) falla("remito que no coincide con su pedido: " + id);
    let suma = 0;
    r.items.forEach((it, i) => {
      const pi = p.items[i];
      const kg = pi.kgReal || parseFloat(pi.cantidad) || 0;
      if (it.producto !== pi.producto || parseFloat(it.kg) !== kg || it.total !== kg * it.precio) falla("ítem de remito distinto al pedido: " + id + " " + it.producto);
      suma += it.total;
    });
    if (Math.abs(suma - r.total) > 1e-6) falla("total de remito: " + id);
    const mov = Object.values(db.cc_movimientos).find((m) => m.remitoNro === r.nro);
    if (mov && (mov.monto !== Math.round(r.total) || mov.cliente !== r.cliente || mov.fecha !== p.fechaEntrega)) falla("movimiento del remito " + r.nro);
    if (!mov && Object.values(db.cuentas_corrientes).some((c) => c.nombre === r.cliente) && Math.round(r.total) > 0) falla("remito de cliente con cuenta sin movimiento: " + r.nro);
  }
  if (db.remitos && Object.keys(db.remitos).length && db.config.contador_remitos.ultimo !== Math.max(...nros)) falla("contador de remitos");
  // Pedidos: cliente existente, estado conocido, formas de los ítems.
  const estados = { pendiente: 0, preparando: 0, listo: 0, despachado: 0, cancelado: 0 };
  for (const [id, p] of Object.entries(db.pedidos)) {
    if (!(p.estado in estados)) falla("estado desconocido: " + id);
    estados[p.estado]++;
    if (!Object.values(db.clientes).some((c) => c.nombre === p.cliente)) falla("pedido de cliente inexistente: " + id);
    if (p.historial[p.historial.length - 1].estado !== p.estado) falla("historial que no termina en el estado actual: " + id);
    if (p.fechaPedidoISO > today + "T23:59:59Z") falla("pedido cargado en el futuro: " + id);
    for (const it of p.items) {
      const rapida = p.origen === "venta_rapida";
      if (typeof it.cantidad !== (rapida ? "number" : "string")) falla("cantidad con tipo equivocado: " + id);
      if (!rapida && "precio" in it) falla("pedido común con precio: " + id);
    }
  }
  for (const e of Object.keys(estados)) if (!estados[e]) falla("no hay pedidos en estado " + e);
  // Precios: todo precio es de un cliente existente y es un número positivo.
  for (const pr of Object.values(db.precios_cliente)) {
    if (!(pr.precio > 0) || !Object.values(db.clientes).some((c) => c.nombre === pr.cliente)) falla("precio mal formado: " + JSON.stringify(pr));
  }
  // Stock: los movimientos apuntan a un ítem que existe y se llama igual.
  for (const m of Object.values(db.stock_movimientos)) {
    if (!db.stock_produccion[m.stockId] || db.stock_produccion[m.stockId].nombre !== m.nombre) falla("movimiento de stock huérfano: " + m.nombre);
    if (m.ref && !db.reportes[m.ref]) falla("entrada de stock sin reporte");
  }
  // Ventas diarias: los totales cierran.
  for (const [id, v] of Object.entries(db.ventas_diarias)) {
    if (id !== v.fecha + "_" + v.sucursal) falla("id de venta diaria: " + id);
    if (v.totalVentas !== v.totalZ + v.extraZ || v.totalNeto !== v.totalVentas - v.totalGasto || v.totalCobros !== v.cobEfec + v.cobTarj + v.cobMP + v.cobOtro) falla("totales de venta diaria: " + id);
    if (v.totalGasto !== v.gastos.reduce((s, g) => s + g.monto, 0) || v.extraZ !== v.extras.reduce((s, g) => s + g.monto, 0)) falla("gastos/extras de venta diaria: " + id);
  }
  return true;
}

/** Cantidad de documentos por colección (para informes). */
export function conteo(seed) {
  return Object.fromEntries(Object.entries(seed).map(([col, docs]) => [col, Object.keys(docs).length]));
}

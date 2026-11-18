// Recorrido con capturas: siembra la base con datos parecidos a los reales,
// entra como lo haría Nacho y visita las pantallas principales.
//
//   SHOT_SET=antes node tests/tour.mjs
//
// Deja tests/screenshots/<SHOT_SET o "actual">/NN-pagina-pantalla.png y un
// index.json con cómo se llegó a cada pantalla y los errores que aparecieron
// ahí. Si una pantalla no se puede alcanzar, se anota y se sigue con la próxima.
// No guarda nada a propósito (los formularios se llenan pero no se envían); lo
// único que se escribe es lo que las páginas escriben solas al abrirse.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, erroresReales, AHORA } from "./lib/harness.mjs";
import { buildSeed, conteo } from "./lib/seed.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SET = process.env.SHOT_SET || "actual";
const DIR = path.join(AQUI, "screenshots", SET);
const HOY = AHORA.slice(0, 10);
const masDias = (n) => {
  const d = new Date(HOY + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

fs.mkdirSync(DIR, { recursive: true });
for (const f of fs.readdirSync(DIR)) if (/\.png$|^index\.json$/.test(f)) fs.rmSync(path.join(DIR, f));

const seed = buildSeed({ today: HOY });
const h = await launch({ seed, etiqueta: "tour" });
const page = h.page;
page.setDefaultTimeout(9000);

const PANTALLA = { width: 390, height: 844 }; // la del iPhone que simula el arnés
const indice = [];
let rol = "sin sesión";

/** Espera a que la pantalla termine de cargar: sin carteles de "Cargando", con las tipografías puestas. */
async function asentar() {
  await page.waitForFunction(() => !/Cargando\.\.\.|Calculando[^\n]*\.\.\./.test(document.body.innerText), null, { timeout: 9000 }).catch(() => {});
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {});
  await page.waitForTimeout(450);
}

/** Un paso del recorrido: hace `accion`, saca la captura y anota lo que pasó. Nunca corta el recorrido. */
async function paso(nombre, pagina, como, accion, { fullPage = false } = {}) {
  const e0 = h.errores.length;
  const d0 = h.llamadas.dialogos.length;
  const reg = { file: nombre + ".png", page: pagina, role: rol, how: como, reached: true };
  try {
    await accion();
    await asentar();
    let entera = false;
    if (fullPage) {
      // Página entera: se "alarga el teléfono" hasta el alto del contenido. Así la cabecera queda arriba y la
      // barra inferior abajo, en vez de quedar pegadas en el medio de la captura tapando datos.
      const m = await page.evaluate(() => {
        window.scrollTo(0, 0);
        return { alto: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), ancho: document.documentElement.scrollWidth };
      });
      if (m.alto > PANTALLA.height) {
        await page.setViewportSize({ width: PANTALLA.width, height: Math.min(m.alto, 12000) });
        await page.waitForTimeout(400);
      }
      entera = m.ancho > PANTALLA.width + 1; // si la página es más ancha que la pantalla, que se vea todo el ancho
    }
    try {
      await h.captura(nombre, { fullPage: entera });
    } finally {
      if (fullPage) await page.setViewportSize(PANTALLA).catch(() => {});
    }
  } catch (e) {
    reg.reached = false;
    reg.problem = String(e && e.message ? e.message : e).split("\n").slice(0, 3).join(" | ");
    reg.file = nombre + "-NO-ALCANZADA.png";
    await h.captura(nombre + "-NO-ALCANZADA").catch(() => { reg.file = null; });
  }
  reg.role = rol;
  // Ancho real de la página: si supera al de la pantalla, en el teléfono se ve achicada o con scroll lateral.
  const medida = await page.evaluate(() => ({ pantalla: Math.round(visualViewport.width), pagina: document.documentElement.scrollWidth, texto: document.body.innerText })).catch(() => null);
  if (medida) {
    reg.overflowX = medida.pagina > medida.pantalla + 1 ? { pantalla: medida.pantalla, pagina: medida.pagina } : null;
    reg.visibleText = medida.texto.replace(/\s+/g, " ").trim().slice(0, 300);
    if (process.env.TOUR_TEXT_DIR) {
      fs.mkdirSync(process.env.TOUR_TEXT_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.TOUR_TEXT_DIR, nombre + ".txt"), medida.texto);
    }
  }
  reg.url = (() => { try { const u = new URL(page.url()); return u.pathname.slice(1) + u.search; } catch { return page.url(); } })();
  reg.errors = erroresReales(h.errores.slice(e0)).map((e) => ({ tipo: e.tipo, texto: e.texto.slice(0, 600) }));
  reg.dialogs = h.llamadas.dialogos.slice(d0);
  indice.push(reg);
  const marca = (!reg.reached ? "NO ALCANZADA" : reg.errors.length ? `${reg.errors.length} error(es)` : "ok") + (reg.overflowX ? `  [página de ${reg.overflowX.pagina}px en pantalla de ${reg.overflowX.pantalla}px]` : "");
  console.log(`${nombre.padEnd(40)} ${marca}${reg.problem ? "  " + reg.problem : ""}`);
}

const texto = (t, o) => page.getByText(t, o);
const boton = (t) => page.locator("button", { hasText: t });
const VISTAS = {
  comercial: "Cargar y gestionar pedidos",
  deposito: "Ver pedidos a preparar y despachar",
  director: "Panel general y cuentas corrientes",
  clientes: "Agregar, editar y eliminar clientes",
  productos: "Agregar productos a cada categoría",
};
async function pedidosHome() {
  await page.evaluate(() => sessionStorage.removeItem("sersale_vista")).catch(() => {});
  await h.ir("pedidos.html");
  await texto("¿Quién sos?").waitFor();
}
async function entrar(vista) {
  await pedidosHome();
  await boton(VISTAS[vista]).click();
}
async function pestanaDirector(nombre) {
  if (!(await texto("Director v2.4").count())) {
    await entrar("director");
    await texto("Activos", { exact: true }).waitFor();
  }
  await boton(nombre).first().click();
}
/** Tarjeta de pedido (o de cuenta, cliente...) que contiene un texto: el bloque más chico que lo envuelve y tiene botones o cursor de mano. */
const tarjeta = (t) => texto(t, { exact: true }).first();

try {
  // ── index.html ────────────────────────────────────────────────────────────
  await paso("01-index-ingreso", "index.html", "Abrir index.html sin sesión", async () => {
    await h.ir("index.html");
    await page.locator("button.acceso").first().waitFor();
  });
  await paso("02-index-login", "index.html", "Tocar «Director» y completar usuario nacho / clave", async () => {
    await page.locator("button.acceso", { hasText: "Director" }).click();
    await page.fill("#__login_user", "nacho");
    await page.fill("#__login_pwd", "sersale123");
  });
  await paso("03-index-panel-director", "index.html", "Tocar «Ingresar» (login real contra la colección usuarios)", async () => {
    await page.click("#__login_btn");
    await texto("Panel director").waitFor();
    rol = "director";
    // El teléfono "vio" los pedidos por última vez hoy a las 7: los cargados después cuentan como nuevos.
    await page.evaluate((v) => localStorage.setItem("sersale_last_seen", v), new Date(HOY + "T07:00:00-03:00").toISOString());
  });
  rol = "director";
  await paso("04-index-usuarios", "index.html", "Panel director → tarjeta «Usuarios»", async () => {
    await page.locator("a.mod", { hasText: "Usuarios" }).click();
    await texto("@nacho").first().waitFor();
  });

  // ── pedidos.html ──────────────────────────────────────────────────────────
  await paso("05-pedidos-inicio", "pedidos.html", "Abrir pedidos.html (pantalla «¿Quién sos?»)", async () => {
    await pedidosHome();
    await texto("desde tu última visita").waitFor({ timeout: 5000 }).catch(() => {});
  });
  await paso("06-pedidos-nuevo-vacio", "pedidos.html", "Inicio → Comercial → «+ Nuevo»", async () => {
    await entrar("comercial");
    await boton("+ Nuevo").click();
    await texto("Nuevo Pedido").waitFor();
  }, { fullPage: true });
  await paso("07-pedidos-nuevo-con-productos", "pedidos.html", "Nuevo pedido: elegir Fiambrería Don Ángel, envío para mañana, agregar 2 productos con el buscador (sin guardar)", async () => {
    await boton("— Seleccioná un cliente —").click();
    await page.getByPlaceholder("Buscar cliente...").fill("Don Áng");
    await boton("Fiambrería Don Ángel").click();
    await boton("Envío / Reparto").click();
    await page.locator('input[type="date"]').fill(masDias(1));
    const buscador = page.getByPlaceholder("Buscar producto y agregarlo...");
    await buscador.fill("sublime");
    await boton("Jamón Cocido Natural Sublime").first().click();
    await page.getByPlaceholder("Cantidad").nth(0).fill("12");
    await buscador.fill("queso tybo");
    await boton("Queso Tybo").first().click();
    await page.getByPlaceholder("Cantidad").nth(1).fill("8");
    await page.getByPlaceholder("Notas sobre el pedido, horario de entrega, etc.").fill("Entregar antes de las 11");
  }, { fullPage: true });
  await paso("08-pedidos-comercial-activos", "pedidos.html", "Inicio → Comercial (pestaña Activos)", async () => {
    await entrar("comercial");
    await texto(/Activos \(\d+\)/).waitFor();
    await texto("HOY").first().waitFor();
  });
  await paso("09-pedidos-tarjeta-expandida", "pedidos.html", "Comercial → tocar la tarjeta de Distribuidora Mayorista del Sur (pedido LISTO de hoy)", async () => {
    await tarjeta("Distribuidora Mayorista del Sur S.R.L.").click();
    await boton("🧾 Remito").waitFor();
    await boton("🧾 Remito").scrollIntoViewIfNeeded();
  });
  await paso("10-pedidos-editar", "pedidos.html", "Tarjeta expandida → «✏️»", async () => {
    await boton("✏️").first().click();
    await texto("Editar Pedido").waitFor();
  }, { fullPage: true });
  await paso("11-pedidos-remito", "pedidos.html", "Volver → expandir la misma tarjeta → «🧾 Remito»", async () => {
    await entrar("comercial");
    await tarjeta("Distribuidora Mayorista del Sur S.R.L.").click();
    await boton("🧾 Remito").click();
    await texto("Remito — Distribuidora Mayorista del Sur S.R.L.").waitFor();
    await texto("TOTAL").first().waitFor();
    await page.waitForTimeout(800); // precios guardados del cliente y número de remito
  }, { fullPage: true });
  await paso("12-pedidos-comercial-historial", "pedidos.html", "Comercial → pestaña «Historial»", async () => {
    await entrar("comercial");
    await boton(/Historial \(\d+\)/).click();
    await texto("DESPACHADO").first().waitFor();
  });
  await paso("13-pedidos-deposito-director", "pedidos.html", "Inicio → Depósito (como director)", async () => {
    await entrar("deposito");
    await texto("Depósito", { exact: true }).waitFor();
    await texto("HOY").first().waitFor();
  });
  await paso("14-pedidos-detalle-preparacion", "pedidos.html", "Depósito → tarjeta de Panificadora Gamas Boedo (PREPARANDO) → «📋 Ítems»", async () => {
    await tarjeta("Panificadora Gamas - Sucursal Boedo").click();
    await boton("📋 Ítems").click();
    await texto("Preparando — Panificadora Gamas - Sucursal Boedo").waitFor();
    await texto("Fiambre de Cerdo p/ Emparedados").first().click(); // tildar el primer ítem
  });
  await paso("15-pedidos-director-resumen", "pedidos.html", "Inicio → Director (pestaña Resumen)", async () => {
    await entrar("director");
    await texto("Preparar hoy").waitFor();
  });
  await paso("16-pedidos-director-por-dia", "pedidos.html", "Director → pestaña «Por Día»", async () => {
    await pestanaDirector("Por Día");
    await boton("Ruta").first().waitFor();
  });
  await paso("17-pedidos-hoja-de-ruta", "pedidos.html", "Por Día → «Ruta» del día de hoy → «Optimizar ruta»", async () => {
    await boton("Ruta").first().click();
    await texto("Hoja de Ruta").waitFor();
    await boton("Optimizar ruta").click();
    await boton("✏️ Editar").waitFor({ timeout: 20000 });
  }, { fullPage: true });
  await paso("18-pedidos-director-stats", "pedidos.html", "Director → pestaña «Stats»", async () => {
    await entrar("director");
    await pestanaDirector("Stats");
    await texto("Top productos por cantidad").waitFor();
  }, { fullPage: true });
  await paso("19-pedidos-director-alertas", "pedidos.html", "Director → pestaña «Alertas» (recontactos)", async () => {
    await pestanaDirector("Alertas");
    await texto("Requieren recontacto").first().waitFor();
  }, { fullPage: true });
  await paso("20-pedidos-director-cc-lista", "pedidos.html", "Director → pestaña «CC»", async () => {
    await pestanaDirector("CC");
    await texto("Deuda total").waitFor();
  }, { fullPage: true });
  await paso("21-pedidos-director-cc-detalle", "pedidos.html", "CC → «Ver movimientos» de Distribuidora Mayorista del Sur", async () => {
    const fila = page.locator("div", { has: page.getByText("Distribuidora Mayorista del Sur S.R.L.", { exact: true }) }).filter({ has: boton("Ver movimientos") }).last();
    await fila.locator("button", { hasText: "Ver movimientos" }).click();
    await texto("Remito N°").first().waitFor();
  }, { fullPage: true });
  await paso("22-pedidos-director-precios", "pedidos.html", "Director → pestaña «Precios» → elegir Fiambrería Don Ángel", async () => {
    await entrar("director");
    await pestanaDirector("Precios");
    await page.locator("select").first().selectOption({ label: "Fiambrería Don Ángel" });
    await texto("Jamón Cocido Natural Sublime").first().waitFor();
  }, { fullPage: true });
  await paso("23-pedidos-director-devoluciones", "pedidos.html", "Director → pestaña «Devol.» → abrir la primera", async () => {
    await pestanaDirector("Devol.");
    await texto("Salamín Picado Fino").first().waitFor();
    await texto("Salamín Picado Fino").first().click();
  }, { fullPage: true });
  await paso("24-pedidos-venta-rapida", "pedidos.html", "Inicio → Director → botón flotante «⚡» → completar una venta (sin guardar)", async () => {
    await entrar("director");
    await texto("Preparar hoy").waitFor();
    await page.click("#btn-venta-rapida");
    await texto("Registrar en cuenta corriente").waitFor();
    await page.locator("select", { has: page.locator("option", { hasText: "— Seleccioná un cliente —" }) }).last().selectOption({ label: "Restaurante Lo de Néstor" });
    await page.getByPlaceholder("Producto").first().fill("Bondiola Fresca");
    await page.getByPlaceholder("Cant.").first().fill("6.5");
    await page.getByPlaceholder("Precio").first().fill("8990");
  });
  await paso("25-pedidos-director-remitos-cliente", "pedidos.html", "Director → pestaña «Clientes» → Fiambrería Don Ángel → «Remitos»", async () => {
    await entrar("director");
    await pestanaDirector("Clientes");
    await page.locator("button", { hasText: "Fiambrería Don Ángel" }).first().click();
    await boton("🧾 Remitos").click();
    await texto(/^N° \d{4}$/).first().waitFor();
  });
  await paso("26-pedidos-remito-guardado", "pedidos.html", "Remitos del cliente → abrir el más reciente", async () => {
    await texto(/^N° \d{4}$/).first().click();
    await texto(/^Remito N° \d{4}$/).waitFor();
  }, { fullPage: true });
  await paso("27-pedidos-clientes-lista", "pedidos.html", "Inicio → Clientes", async () => {
    await entrar("clientes");
    await texto("Almacén D'Agostino").first().waitFor();
  }, { fullPage: true });
  await paso("28-pedidos-clientes-editar", "pedidos.html", "Clientes → «✏️» de Almacén D'Agostino", async () => {
    const fila = page.locator("div", { has: page.getByText("Almacén D'Agostino", { exact: true }) }).filter({ has: boton("✏️") }).last();
    await fila.locator("button", { hasText: "✏️" }).click();
    await page.getByPlaceholder("Nombre del cliente *").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
  });
  await paso("29-pedidos-productos", "pedidos.html", "Inicio → Productos → abrir «Pancetas y Ahumados»", async () => {
    await entrar("productos");
    await texto("Gestión de Productos").waitFor();
    await texto("Pancetas y Ahumados").first().click();
    await texto("Bondiola Ahumada").first().waitFor({ timeout: 4000 }).catch(() => {});
  }, { fullPage: true });

  // ── produccion.html ───────────────────────────────────────────────────────
  await paso("30-produccion-encargado", "produccion.html", "Abrir produccion.html (vista del encargado: elegir área)", async () => {
    await h.ir("produccion.html");
    await texto("Reporte de Producción").first().waitFor();
  });
  await paso("31-produccion-director-reportes", "produccion.html", "«Vista Director» (pestaña Reportes, día de hoy)", async () => {
    await boton("Vista Director").click();
    await texto("Panel Director").waitFor();
    await texto("Ramón").first().waitFor();
  }, { fullPage: true });
  await paso("32-produccion-director-stock", "produccion.html", "Vista Director → pestaña «Stock»", async () => {
    await boton("📦 Stock").click();
    await texto("Chorizo Puro Cerdo").first().waitFor();
  }, { fullPage: true });
  await paso("33-produccion-director-faena", "produccion.html", "Vista Director → pestaña «Faena»", async () => {
    await boton("🐖 Faena").click();
    await texto("Cabezas faenadas").waitFor();
  }, { fullPage: true });
  await paso("34-produccion-director-lotes", "produccion.html", "Vista Director → pestaña «Lotes»", async () => {
    await boton("🏷️ Lotes").click();
    await texto(/\d{8}-\d{3}/).first().waitFor();
  }, { fullPage: true });

  // ── ventas.html ───────────────────────────────────────────────────────────
  await paso("35-ventas-carga", "ventas.html", "Abrir ventas.html (carga del día)", async () => {
    await h.ir("ventas.html");
    await page.locator("#btnSave").waitFor();
  }, { fullPage: true });
  await paso("36-ventas-historial", "ventas.html", "Pestaña «Historial» → abrir el primer registro", async () => {
    await page.click("#nb-hist");
    await page.locator("#histContent table.tbl tbody tr").first().waitFor();
    await page.locator("#histContent table.tbl tbody tr").first().click();
  });
  await paso("37-ventas-reportes", "ventas.html", "Pestaña «Reportes» (este mes, ambas sucursales)", async () => {
    await page.click("#nb-rep");
    await page.locator("#repContent .kpi").first().waitFor();
  }, { fullPage: true });

  // ── dashboard, presupuestos, backup ───────────────────────────────────────
  await paso("38-dashboard", "dashboard.html", "Abrir dashboard.html (mes en curso)", async () => {
    await h.ir("dashboard.html");
    await page.waitForFunction(() => !document.body.innerText.includes("Cargando..."), null, { timeout: 15000 });
    await page.waitForTimeout(900); // animación de los gráficos
  }, { fullPage: true });
  await paso("39-presupuestos", "presupuestos.html", "Abrir presupuestos.html", async () => {
    await h.ir("presupuestos.html");
  });
  await paso("40-backup", "backup.html", "Abrir backup.html → «Generar Backup Excel»", async () => {
    await h.ir("backup.html");
    await boton("Generar Backup Excel").click();
    await texto("Backup generado").waitFor({ timeout: 20000 });
  });

  // ── operario ──────────────────────────────────────────────────────────────
  await paso("41-pedidos-deposito-operario", "pedidos.html", "index.html → «Salir» → «Operario» (entra directo a Depósito) → abrir un pedido pendiente", async () => {
    await page.evaluate(() => sessionStorage.removeItem("sersale_vista")).catch(() => {});
    await h.ir("index.html");
    await boton("Salir").click();
    await page.locator("button.acceso", { hasText: "Operario" }).click();
    await page.waitForURL(/pedidos\.html/);
    rol = "operario";
    await texto("Depósito · Vista Operario").waitFor();
    await tarjeta("Fiambrería Don Ángel").click();
    await boton("⚙️ En preparación").waitFor();
  });
} finally {
  const resumen = {
    set: SET,
    ahoraSimulado: AHORA,
    semilla: conteo(seed),
    capturas: indice.filter((r) => r.reached).length,
    noAlcanzadas: indice.filter((r) => !r.reached).map((r) => r.file),
    conErrores: indice.filter((r) => r.errors.length).map((r) => r.file),
    masAnchasQueLaPantalla: indice.filter((r) => r.overflowX).map((r) => r.file),
    pedidosExternosInesperados: h.inesperados,
    tercerosLlamados: h.llamadas.terceros.map((t) => t.url.split("?")[0]),
    descargas: h.llamadas.descargas,
    pantallas: indice,
  };
  fs.writeFileSync(path.join(DIR, "index.json"), JSON.stringify(resumen, null, 2) + "\n");
  console.log(`\n${resumen.capturas} capturas en ${path.relative(process.cwd(), DIR)} · no alcanzadas: ${resumen.noAlcanzadas.length} · con errores: ${resumen.conErrores.length}`);
  await h.close();
}
process.exit(0);

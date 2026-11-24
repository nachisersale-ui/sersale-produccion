// Arma el PDF del catálogo mayorista en el teléfono (pantalla Catálogo).
//
// El diseño es el del catálogo que se armaba en la computadora. Las páginas de
// presentación (tapa, historia, etc.) vienen ya dibujadas como imagen en
// catalogo-pdf/ y acá se les escribe encima lo que cambia (vigencia, número de
// página). Las páginas de productos se dibujan enteras acá, con los precios
// que se pidan. Todo lo prepara tools/catalogo-recursos.mjs.
//
//   SersaleCatalogoPDF.planear(catalogo, opciones)  → lista de páginas (sin dibujar)
//   SersaleCatalogoPDF.generar(opciones, alAvanzar) → { pdf, paginas, textos }
//
// opciones: { vigencia, precios: {art: número|null}, sinPrecios, presentacion,
//             arts: [art…] | null (null = todos) }
(function () {
  "use strict";

  var PT = 0.3528; // un punto tipográfico en milímetros
  var BASE = "catalogo-pdf/";
  var ANCHO = 210, ALTO = 297;
  var COLOR = {
    carbon: [28, 26, 25], lacre: [192, 34, 43], hueso: [244, 239, 230], linea: [217, 209, 195],
    gris: [111, 104, 98], tinta: [42, 38, 37], blanco: [255, 255, 255], desc: [89, 82, 77],
    bajada: [74, 68, 64], pieOscuro: [165, 156, 146], lineaOscura: [74, 69, 66], subP: [221, 213, 201], tile: [228, 220, 208],
  };
  var FUENTES = { Pop800: "Poppins-800.ttf", Mon400: "Montserrat-400.ttf", Mon500: "Montserrat-500.ttf", Mon700: "Montserrat-700.ttf", Mon800: "Montserrat-800.ttf" };

  // ── Recursos (imágenes y tipografías), se bajan una sola vez por sesión ──
  var guardados = {};
  function leer(ruta) {
    if (!guardados[ruta]) {
      guardados[ruta] = fetch(BASE + ruta)
        .then(function (r) {
          if (!r.ok) throw new Error("No se pudo cargar " + ruta);
          return r.blob();
        })
        .then(function (blob) {
          return new Promise(function (ok, mal) {
            var fr = new FileReader();
            fr.onload = function () { ok(String(fr.result)); };
            fr.onerror = function () { mal(new Error("No se pudo leer " + ruta)); };
            fr.readAsDataURL(blob);
          });
        })
        .catch(function (e) {
          delete guardados[ruta];
          throw e;
        });
    }
    return guardados[ruta];
  }

  // ── Qué páginas lleva el catálogo ──
  function copiaFamilia(f, productos, continua) {
    return { id: f.id, nombre: f.nombre, intro: f.intro, continua: !!continua, productos: productos };
  }
  // Páginas de productos. Con todos los productos se respeta el armado original;
  // con una selección se reacomodan para no dejar páginas casi vacías.
  function paginasDeProductos(C, arts) {
    if (!arts) return C.paginas.map(function (pg) { return pg.map(function (f) { return copiaFamilia(f, f.productos.slice(), f.continua); }); });
    var elegido = {};
    arts.forEach(function (a) { elegido[a] = true; });
    var familias = [];
    C.paginas.forEach(function (pg) {
      pg.forEach(function (f) {
        var ps = f.productos.filter(function (p) { return elegido[p.art]; });
        if (!ps.length) return;
        var ultima = familias[familias.length - 1];
        if (ultima && ultima.nombre === f.nombre) ultima.productos = ultima.productos.concat(ps);
        else familias.push(copiaFamilia(f, ps, false));
      });
    });
    // Una línea con más de 8 productos no entra en una página: se parte en partes parejas.
    var trozos = [];
    familias.forEach(function (f) {
      var n = f.productos.length;
      if (n <= 8) { trozos.push(f); return; }
      var partes = Math.ceil(n / 6), cada = Math.ceil(n / partes);
      for (var i = 0; i < partes; i++) trozos.push(copiaFamilia(f, f.productos.slice(i * cada, (i + 1) * cada), i > 0));
    });
    var paginas = [], actual = [], usado = 0, LUGAR = ALTO - 40 - 15, FILA = 33;
    trozos.forEach(function (t) {
      var costo = (actual.length ? 14.6 : 0) + 7.6 + t.productos.length * FILA;
      if (actual.length && usado + costo > LUGAR) {
        paginas.push(actual); actual = []; usado = 0;
        costo = 7.6 + t.productos.length * FILA;
      }
      actual.push(t); usado += costo;
    });
    if (actual.length) paginas.push(actual);
    return paginas;
  }

  function planear(C, o) {
    o = o || {};
    var prods = paginasDeProductos(C, o.arts && o.arts.length ? o.arts : null);
    var plan = [{ tipo: "tapa" }];
    if (o.presentacion !== false) plan.push({ tipo: "frase" }, { tipo: "historia" }, { tipo: "hacemos" }, { tipo: "lineas" });
    prods.forEach(function (pg) {
      var tieneDestacado = pg.some(function (f) { return f.productos.some(function (p) { return p.art === C.destacado.art; }); });
      if (o.presentacion !== false && tieneDestacado) plan.push({ tipo: "destacado" });
      plan.push({ tipo: "prod", familias: pg });
    });
    if (o.presentacion !== false) plan.push({ tipo: "como" });
    plan.push({ tipo: "contra" });
    plan.forEach(function (p, i) { p.nro = i + 1; });
    // Líneas para la página "Nuestras líneas": una por nombre, con su cantidad y su página.
    var lineas = [];
    plan.forEach(function (p) {
      if (p.tipo !== "prod") return;
      p.familias.forEach(function (f) {
        var l = lineas.filter(function (x) { return x.nombre === f.nombre; })[0];
        if (!l) lineas.push((l = { id: f.id, nombre: f.nombre, cantidad: 0, pagina: p.nro }));
        l.cantidad += f.productos.length;
      });
    });
    plan.lineas = lineas;
    return plan;
  }

  function precioTexto(n) {
    return "$ " + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  // ── Dibujo ──
  function lapiz(pdf, textos) {
    var L = {
      pagina: 0,
      color: function (c) { pdf.setTextColor(c[0], c[1], c[2]); },
      relleno: function (c) { pdf.setFillColor(c[0], c[1], c[2]); },
      trazo: function (c, ancho) { pdf.setDrawColor(c[0], c[1], c[2]); pdf.setLineWidth(ancho); },
      fuente: function (f, pt) { pdf.setFont(f, "normal"); pdf.setFontSize(pt); },
      // Ancho de un texto con el espaciado entre letras "em" (como letter-spacing de CSS).
      ancho: function (s, f, pt, em) {
        L.fuente(f, pt);
        return pdf.getTextWidth(s) + (em || 0) * pt * PT * s.length;
      },
      // Escribe una línea. y es el centro vertical de la línea; alin: "izq" | "centro" | "der".
      texto: function (s, x, y, f, pt, color, op) {
        op = op || {};
        s = String(s);
        var em = op.em || 0, w = L.ancho(s, f, pt, em);
        var x0 = op.alin === "centro" ? x - (w - em * pt * PT) / 2 : op.alin === "der" ? x - (w - em * pt * PT) : x;
        L.color(color);
        pdf.text(s, x0, y + 0.35 * pt * PT, { charSpace: em * pt * PT });
        textos.push({ pagina: L.pagina, texto: s });
        return { x: x0, w: w };
      },
      partir: function (s, f, pt, anchoMax, em) {
        L.fuente(f, pt);
        // El espaciado entre letras no lo cuenta jsPDF: se le descuenta al ancho disponible.
        var largo = em ? anchoMax / (1 + em / 0.6) : anchoMax;
        return pdf.splitTextToSize(String(s), largo);
      },
    };
    return L;
  }

  function pie(pdf, L, nro, oscuro, contacto) {
    var yLinea = ALTO - 6 - 4.94 - 2.2 - 0.15, yTexto = ALTO - 6 - 2.47;
    L.trazo(oscuro ? COLOR.lineaOscura : COLOR.linea, 0.3);
    pdf.line(10, yLinea, ANCHO - 10, yLinea);
    var color = oscuro ? COLOR.pieOscuro : COLOR.gris;
    var a = "FRIGORÍFICO SERSALE · WhatsApp ", b = contacto.whatsapp, c = " · ", d = contacto.instagram;
    var x = 10, t;
    x += L.texto(a, x, yTexto, "Mon500", 7.8, color, { em: 0.03 }).w;
    t = L.texto(b, x, yTexto, "Mon500", 7.8, color, { em: 0.03 });
    pdf.link(t.x, yTexto - 2, t.w, 4, { url: contacto.whatsappLink + "?text=" + encodeURIComponent(contacto.whatsappMensaje) });
    x += t.w;
    x += L.texto(c, x, yTexto, "Mon500", 7.8, color, { em: 0.03 }).w;
    t = L.texto(d, x, yTexto, "Mon500", 7.8, color, { em: 0.03 });
    pdf.link(t.x, yTexto - 2, t.w, 4, { url: contacto.instagramLink });
    L.texto((nro < 10 ? "0" : "") + nro, ANCHO - 10, yTexto, "Mon800", 10, COLOR.lacre, { em: 0.06, alin: "der" });
  }

  function chapaVigencia(pdf, L, vigencia) {
    var s = vigencia.toUpperCase(), pt = 8.2, em = 0.16;
    var w = L.ancho(s, "Mon700", pt, em) + 6, h = 6.2, x = ANCHO - 10 - w, y = 5;
    L.trazo(COLOR.blanco, 0.3);
    pdf.rect(x, y, w, h, "S");
    L.texto(s, x + 3, y + h / 2, "Mon700", pt, COLOR.blanco, { em: em });
  }

  function paginaProductos(pdf, L, R, pagina, o, C) {
    var fams = pagina.familias;
    var total = fams.reduce(function (a, f) { return a + f.productos.length; }, 0);
    var amplia = total <= 5 && fams.length === 1, compacta = total >= 7;
    var disp = ALTO - 40 - 15 - fams.length * 7.6 - (fams.length - 1) * 14.6;
    var rh = Math.min(disp / total, amplia ? 51 : 41), th = Math.min(rh - 4, amplia ? 44 : 35);
    var sinp = !!o.sinPrecios;
    var c1 = amplia ? 43 : 34, wPr = amplia ? 36 : 33, wPeso = sinp ? (amplia ? 36 : 34) : 27;
    var xTexto = 10 + c1 + 4;
    var xPrecio = ANCHO - 10 - wPr / 2;
    var xPeso = sinp ? ANCHO - 10 - wPeso / 2 : ANCHO - 10 - wPr - 4 - wPeso / 2;
    var wTexto = (sinp ? ANCHO - 10 - wPeso : ANCHO - 10 - wPr - 4 - wPeso) - 4 - xTexto;
    var ptNombre = amplia ? 14.5 : compacta ? 11 : 12.4, ptDesc = amplia ? 10.8 : compacta ? 8.5 : 9.3;
    var ptChapa = compacta ? 7 : 7.6, ptPrecio = amplia ? 22 : compacta ? 18.5 : 20.5, ptCons = amplia ? 11.5 : 10.5;
    var altoDesc = compacta ? 1.28 : 1.34, mChapa = compacta ? 0.8 : 1.3, mDesc = compacta ? 0.8 : 1.2;

    L.relleno(COLOR.hueso);
    pdf.rect(0, 0, ANCHO, ALTO, "F");
    var y = 0;
    fams.forEach(function (f, j) {
      if (j === 0) {
        pdf.addImage(R["cab-" + f.id + ".jpg"], "JPEG", 0, 0, ANCHO, 40, "cab-" + f.id, "FAST");
        chapaVigencia(pdf, L, o.vigencia);
        y = 40;
      } else {
        y += 1.5;
        L.relleno(COLOR.carbon);
        pdf.rect(0, y, ANCHO, 12.3, "F");
        var t = L.texto(f.nombre.toUpperCase(), 10, y + 6.15, "Pop800", 15.5, COLOR.blanco, { em: -0.01 });
        var lugar = ANCHO - 10 - (t.x + t.w + 6);
        // La bajada va en un renglón: si no entra se achica un poco y, si aun así no, se corta.
        var ptIntro = Math.max(8, Math.min(9.6, (9.6 * lugar) / L.ancho(f.intro, "Mon500", 9.6)));
        var intro = f.intro;
        if (L.ancho(intro, "Mon500", ptIntro) > lugar) {
          intro = (L.partir(intro, "Mon500", ptIntro, lugar - 3)[0] || "").replace(/[s,.;:]+$/, "") + "…";
        }
        L.texto(intro, t.x + t.w + 6, y + 6.5, "Mon500", ptIntro, COLOR.subP);
        y += 12.3;
      }
      // encabezado de columnas
      var yCol = y + 2.4 + 1.88;
      L.texto("PRODUCTO", xTexto, yCol, "Mon800", 7.6, COLOR.gris, { em: 0.16 });
      L.texto("PESO APROX.", xPeso, yCol, "Mon800", 7.6, COLOR.gris, { em: 0.16, alin: "centro" });
      if (!sinp) L.texto("PRECIO", xPrecio, yCol, "Mon800", 7.6, COLOR.gris, { em: 0.16, alin: "centro" });
      y += 7.6;

      f.productos.forEach(function (p) {
        L.trazo(COLOR.linea, 0.3);
        pdf.line(0, y + 0.15, ANCHO, y + 0.15);
        var medio = y + rh / 2;
        // foto y sello sin gluten
        var xFoto = 10 + (c1 - th) / 2, yFoto = medio - th / 2;
        if (R["p-" + p.art + ".jpg"]) pdf.addImage(R["p-" + p.art + ".jpg"], "JPEG", xFoto, yFoto, th, th, "p-" + p.art, "FAST");
        if (p.tacc) {
          var ws = amplia ? 13.5 : 11.5;
          pdf.addImage(R["sin-gluten.png"], "PNG", xFoto - 2.5, yFoto - 1.2, ws, ws * R.proporcionSello, "sin-gluten", "FAST");
        }
        // artículo, nombre y descripción
        var nombre = L.partir(p.nombre.toUpperCase(), "Mon800", ptNombre, wTexto, 0.01);
        var desc = L.partir(p.desc || "", "Mon400", ptDesc, wTexto);
        var hChapa = ptChapa * 1.4 * PT + 1, hNombre = ptNombre * 1.15 * PT, hDesc = ptDesc * altoDesc * PT;
        var alto = hChapa + mChapa + nombre.length * hNombre + (desc.length ? mDesc + desc.length * hDesc : 0);
        var yy = medio - alto / 2;
        var chapa = "ART. " + p.art;
        var wChapa = L.ancho(chapa, "Mon800", ptChapa, 0.08) + 4.4;
        L.relleno(COLOR.carbon);
        pdf.roundedRect(xTexto, yy, wChapa, hChapa, 0.8, 0.8, "F");
        L.texto(chapa, xTexto + 2.2, yy + hChapa / 2, "Mon800", ptChapa, COLOR.blanco, { em: 0.08 });
        yy += hChapa + mChapa;
        nombre.forEach(function (ln) { L.texto(ln, xTexto, yy + hNombre / 2, "Mon800", ptNombre, COLOR.carbon, { em: 0.01 }); yy += hNombre; });
        if (desc.length) yy += mDesc;
        desc.forEach(function (ln) { L.texto(ln, xTexto, yy + hDesc / 2, "Mon400", ptDesc, COLOR.desc); yy += hDesc; });
        // peso
        var partes = String(p.peso).split(" · ");
        var l1 = L.partir(partes[0], "Mon700", 11.5, wPeso), l2 = partes.length > 1 ? L.partir(partes.slice(1).join(" · "), "Mon500", 8.6, wPeso) : [];
        var h1 = 11.5 * 1.1 * PT, h2 = 8.6 * 1.1 * PT;
        var yp = medio - (l1.length * h1 + (l2.length ? 0.5 + l2.length * h2 : 0)) / 2;
        l1.forEach(function (ln) { L.texto(ln, xPeso, yp + h1 / 2, "Mon700", 11.5, COLOR.tinta, { alin: "centro" }); yp += h1; });
        if (l2.length) yp += 0.5;
        l2.forEach(function (ln) { L.texto(ln, xPeso, yp + h2 / 2, "Mon500", 8.6, COLOR.gris, { alin: "centro" }); yp += h2; });
        // precio
        if (!sinp) {
          var precio = o.precios ? o.precios[p.art] : p.precio;
          if (typeof precio === "number" && precio > 0) {
            var hp = ptPrecio * PT, hk = 7 * PT;
            var y0 = medio - (hp + 0.8 + hk) / 2;
            L.texto(precioTexto(precio), xPrecio, y0 + hp / 2, "Pop800", ptPrecio, COLOR.lacre, { em: -0.03, alin: "centro" });
            L.texto("POR KILO", xPrecio, y0 + hp + 0.8 + hk / 2, "Mon700", 7, COLOR.gris, { em: 0.08, alin: "centro" });
          } else {
            L.texto("CONSULTAR", xPrecio, medio, "Pop800", ptCons, COLOR.carbon, { em: 0.06, alin: "centro" });
          }
        }
        y += rh;
      });
    });
    pie(pdf, L, pagina.nro, false, C.contacto);
  }

  function paginaLineas(pdf, L, R, pagina, plan, C) {
    L.relleno(COLOR.hueso);
    pdf.rect(0, 0, ANCHO, ALTO, "F");
    var lineas = plan.lineas, total = lineas.reduce(function (a, l) { return a + l.cantidad; }, 0);
    L.texto("NUESTRAS LÍNEAS", 11, 16.2, "Mon700", 9, COLOR.lacre, { em: 0.28 });
    var titulo = total + (total === 1 ? " producto, " : " productos, ") + lineas.length + (lineas.length === 1 ? " línea" : " líneas");
    L.texto(titulo, 11, 26.4, "Pop800", 33, COLOR.carbon, { em: -0.028 });
    var y = 36.4;
    L.partir("Todo lo que necesita un mostrador, una cocina o una parrilla, de un mismo elaborador.", "Mon500", 13, 172).forEach(function (ln) {
      L.texto(ln, 11, y + 3.32, "Mon500", 13, COLOR.bajada);
      y += 6.65;
    });
    y += 7;
    var W = 60, HI = 52, HT = 19, SEP = 4;
    lineas.forEach(function (l, i) {
      var x = 11 + (i % 3) * (W + SEP), yt = y + Math.floor(i / 3) * (HI + HT + SEP);
      if (R["linea-" + l.id + ".jpg"]) pdf.addImage(R["linea-" + l.id + ".jpg"], "JPEG", x, yt, W, HI, "linea-" + l.id, "FAST");
      L.relleno(COLOR.carbon);
      pdf.rect(x, yt + HI, W, HT, "F");
      var nombre = L.partir(l.nombre.toUpperCase(), "Mon800", 11.5, W - 8, 0.01);
      var hn = 11.5 * 1.15 * PT, hs = 8.8 * 1.4 * PT;
      var yy = yt + HI + (HT - nombre.length * hn - hs) / 2;
      nombre.forEach(function (ln) { L.texto(ln, x + 4, yy + hn / 2, "Mon800", 11.5, COLOR.blanco, { em: 0.01 }); yy += hn; });
      L.texto(l.cantidad + (l.cantidad === 1 ? " producto" : " productos"), x + 4, yy + hs / 2, "Mon400", 8.8, COLOR.tile, { em: 0.04 });
      var pg = "PÁG. " + (l.pagina < 10 ? "0" : "") + l.pagina;
      var wp = L.ancho(pg, "Mon800", 9, 0.06) + 6;
      L.relleno(COLOR.lacre);
      pdf.rect(x + W - wp, yt, wp, 6.85, "F");
      L.texto(pg, x + W - wp + 3, yt + 3.43, "Mon800", 9, COLOR.blanco, { em: 0.06 });
    });
    pie(pdf, L, pagina.nro, false, C.contacto);
  }

  function paginaFija(pdf, L, R, pagina, o, C) {
    var k = pagina.tipo;
    var archivo = k === "como" && o.sinPrecios ? "pag-como-sinprecios.jpg" : "pag-" + k + ".jpg";
    pdf.addImage(R[archivo], "JPEG", 0, 0, ANCHO, ALTO, archivo, "FAST");
    var conPie = k !== "tapa" && k !== "contra";
    (C.medidas.enlaces[k] || []).forEach(function (e) {
      if (conPie && e.y > 280) return; // los del pie se dibujan con el pie
      if (e.href) pdf.link(e.x, e.y, e.w, e.h, { url: e.href });
    });
    if (k === "tapa") {
      var m = C.medidas.vigTapa, s = o.vigencia.toUpperCase();
      var w = L.ancho(s, "Mon800", 10.5, 0.24) + 12, cx = m.x + m.w / 2;
      L.trazo(COLOR.blanco, 0.45);
      pdf.rect(cx - w / 2, m.y + 0.22, w, m.h - 0.45, "S");
      L.texto(s, cx - w / 2 + 6, m.y + m.h / 2, "Mon800", 10.5, COLOR.blanco, { em: 0.24 });
    }
    if (k === "contra") {
      var f = C.medidas.finContra;
      L.texto(C.contacto.senasa + " · Catálogo mayorista " + o.vigencia, f.x + f.w / 2, f.y + f.h / 2, "Mon400", 8.4, COLOR.gris, { em: 0.05, alin: "centro" });
    }
    if (conPie) pie(pdf, L, pagina.nro, k === "frase" || k === "destacado" || k === "como", C.contacto);
  }

  function respiro() {
    return new Promise(function (ok) { setTimeout(ok, 0); });
  }

  async function generar(o, alAvanzar) {
    var C = window.SersaleCatalogoCompleto;
    if (!C || !window.jspdf) throw new Error("La página no terminó de cargar. Recargala y probá de nuevo.");
    o = Object.assign({ vigencia: C.vigencia, sinPrecios: false, presentacion: true, arts: null, precios: null }, o);
    o.vigencia = String(o.vigencia || "").trim() || C.vigencia;
    var avisar = alAvanzar || function () {};
    var plan = planear(C, o);

    // Qué archivos hacen falta para este plan.
    var hacen = Object.keys(FUENTES).map(function (k) { return FUENTES[k]; });
    plan.forEach(function (p) {
      if (p.tipo === "prod") {
        hacen.push("cab-" + p.familias[0].id + ".jpg");
        p.familias.forEach(function (f) {
          f.productos.forEach(function (x) {
            hacen.push("p-" + x.art + ".jpg");
            if (x.tacc) hacen.push("sin-gluten.png");
          });
        });
      } else if (p.tipo === "lineas") plan.lineas.forEach(function (l) { hacen.push("linea-" + l.id + ".jpg"); });
      else hacen.push(p.tipo === "como" && o.sinPrecios ? "pag-como-sinprecios.jpg" : "pag-" + p.tipo + ".jpg");
    });
    hacen = hacen.filter(function (x, i) { return hacen.indexOf(x) === i; });
    var R = {}, listos = 0;
    avisar({ paso: "recursos", hecho: 0, total: hacen.length });
    await Promise.all(hacen.map(function (ruta) {
      return leer(ruta).then(function (d) {
        R[ruta] = d;
        avisar({ paso: "recursos", hecho: ++listos, total: hacen.length });
      });
    }));

    var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
    Object.keys(FUENTES).forEach(function (nombre) {
      pdf.addFileToVFS(FUENTES[nombre], R[FUENTES[nombre]].split(",")[1]);
      pdf.addFont(FUENTES[nombre], nombre, "normal");
    });
    if (R["sin-gluten.png"]) {
      var pr = pdf.getImageProperties(R["sin-gluten.png"]);
      R.proporcionSello = pr.height / pr.width;
    }
    var textos = [], L = lapiz(pdf, textos);
    for (var i = 0; i < plan.length; i++) {
      var p = plan[i];
      if (i) pdf.addPage();
      L.pagina = p.nro;
      if (p.tipo === "prod") paginaProductos(pdf, L, R, p, o, C);
      else if (p.tipo === "lineas") paginaLineas(pdf, L, R, p, plan, C);
      else paginaFija(pdf, L, R, p, o, C);
      avisar({ paso: "paginas", hecho: i + 1, total: plan.length });
      await respiro();
    }
    pdf.setProperties({ title: "Catálogo Mayorista Sersale · " + o.vigencia, author: "Frigorífico Sersale" });
    return { pdf: pdf, paginas: plan, textos: textos };
  }

  window.SersaleCatalogoPDF = { planear: planear, generar: generar, precioTexto: precioTexto };
})();

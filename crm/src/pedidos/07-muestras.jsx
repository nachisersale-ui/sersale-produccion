    // ══════════════════════════════════════════════════════
    //  MUESTRAS: certificado de entrega y seguimiento por cliente
    // ══════════════════════════════════════════════════════
    // Colección "muestras": un documento por certificado de entrega.
    //   nro            número correlativo (1, 2, 3…); se muestra como M-0001
    //   fecha          "AAAA-MM-DD" de la entrega
    //   cliente        nombre (de la lista de clientes o escrito a mano si todavía no es cliente)
    //   contacto       texto libre (teléfono, quién recibe…)
    //   entrega        quién entrega por el frigorífico
    //   obs            observaciones generales
    //   items          [{ id, producto, cantidad, unidad, nota, estado, estadoEn, historial:[{ estado, en, nota, por }] }]
    //   firma          imagen (data:image/png) de la firma de quien recibe, o ""
    //   aclaracion     aclaración de la firma
    //   firmadoEn      ISO, cuándo se firmó en el teléfono
    //   creadoEn / actualizadoEn (ISO), creadoPor (usuario)
    // El número sale de config/contador_muestras { ultimo }, dentro de una transacción.
    const MUE_UNIDADES = ["kg", "piezas", "unidades"];
    const MUE_OTRO = "__otro__";
    const MUE_DIAS_SIN_NOVEDAD = 7;
    // Estados del seguimiento de cada muestra, en el orden en que suelen darse.
    const MUE_ESTADOS = [
      { k: "entregada",    t: "Entregada",       color: "#26536E", fondo: "#E3EDF3" },
      { k: "probada",      t: "Probada",         color: "#6B4E8E", fondo: "#ECE6F3" },
      { k: "interesa",     t: "Le interesó",     color: "#2F6B4F", fondo: "#DDEBE3" },
      { k: "pidio_precio", t: "Pidió precio",    color: "#784212", fondo: "#F0E7D9" },
      { k: "compro",       t: "Compró",          color: "#1F4D38", fondo: "#CFE5D8" },
      { k: "no_interesa",  t: "No le interesó",  color: "#5C666F", fondo: "#E8EAEC" },
    ];
    const MUE_CERRADOS = ["compro", "no_interesa"]; // ya no hay que recontactar
    const MUE_EMPRESA = {
      nombre: "FRIGORÍFICO SERSALE S.R.L.",
      lineas: ["CUIT 30-70227633-7  ·  SENASA Est. 3839", "24 de Noviembre 1926, Parque Patricios, CABA", "Tel. (011) 6763-7860  ·  @sersalefrigorifico"],
    };

    const mueEstado = k => MUE_ESTADOS.find(e => e.k === k) || MUE_ESTADOS[0];
    const mueNumero = m => "M-" + String(Number(m && m.nro) || 0).padStart(4, "0");
    const mueItems = m => (Array.isArray(m && m.items) ? m.items : []);
    // "2,5 kg", "1 pieza", "3 unidades"
    function mueCantidad(it) {
      const n = Number(it && it.cantidad) || 0;
      if (!(n > 0)) return "";
      const u = it.unidad === "piezas" ? (n === 1 ? "pieza" : "piezas") : it.unidad === "unidades" ? (n === 1 ? "unidad" : "unidades") : "kg";
      return String(SersaleBase.redondear(n, 3)).replace(".", ",") + " " + u;
    }
    // Día ("AAAA-MM-DD", hora de Buenos Aires) de la última novedad de una muestra.
    function mueUltimaNovedad(m, it) {
      const en = it && it.estadoEn;
      return (en && SersaleBase.diaDe(en)) || m.fecha || "";
    }
    // Días que lleva sin novedad una muestra que todavía está abierta (null si ya cerró).
    function mueDiasQuieta(m, it) {
      if (MUE_CERRADOS.includes(it.estado)) return null;
      const dia = mueUltimaNovedad(m, it);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
      return SersaleBase.diasEntre(dia, SersaleBase.hoy());
    }
    const muePideRecontacto = (m, it) => { const d = mueDiasQuieta(m, it); return d != null && d >= MUE_DIAS_SIN_NOVEDAD; };
    // Las más nuevas primero (por fecha de entrega y, en el mismo día, por número).
    function mueOrdenar(lista) {
      return lista.slice().sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")) || (Number(b.nro) || 0) - (Number(a.nro) || 0));
    }

    const MUE_CAMPO = { width:"100%", padding:"12px 14px", borderRadius:12, border:"1.5px solid #D8DCE0", fontSize:16, background:"#fff", outline:"none", boxSizing:"border-box" };
    const MUE_ETIQUETA = { display:"block", fontWeight:600, fontSize:13, color:"#3A424A", margin:"14px 0 6px" };
    const MUE_CHAPA = { background:"#12161A", borderBottom:"2px solid #A4232A", color:"#fff", padding:"14px 20px", display:"flex", alignItems:"center", gap:12, position:"sticky", top:0, zIndex:10, boxShadow:"0 4px 20px rgba(192,57,43,0.35)" };

    function MueChip({ estado, chico }) {
      const e = mueEstado(estado);
      return <span style={{display:"inline-block",padding:chico?"2px 8px":"4px 10px",borderRadius:99,background:e.fondo,color:e.color,fontWeight:700,fontSize:chico?11:12,whiteSpace:"nowrap"}}>{e.t}</span>;
    }

    // ── PDF: certificado con ORIGINAL y DUPLICADO ──
    // Una hoja A4 con las dos copias (se corta por la línea). Si las muestras no entran
    // en media hoja, cada copia va en su propia hoja.
    function muePDF(m) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      const mx = 14, pw = W - mx * 2;
      const items = mueItems(m);
      const ALTO_FILA = 6.2;
      const enMedia = items.length <= 6; // más de 6 filas no dejan lugar para las firmas en media hoja
      const logo = window.__sersaleLogoMuestras;
      const texto = v => String(v == null ? "" : v);
      // Corta un texto para que entre en `ancho` mm (con "…" si no entra).
      function corto(t, ancho) {
        t = texto(t);
        if (doc.getTextWidth(t) <= ancho) return t;
        while (t.length > 1 && doc.getTextWidth(t + "...") > ancho) t = t.slice(0, -1);
        return t + "...";
      }

      function copia(titulo, y0, alto) {
        let y = y0 + 9;
        // Encabezado: logo y datos del frigorífico
        try { if (logo) doc.addImage(logo.datos, "JPEG", mx, y - 4, 24, 24 * logo.alto / logo.ancho, "logo"); } catch (e) { console.error("Logo del certificado:", e); }
        doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(164, 35, 42);
        doc.text(MUE_EMPRESA.nombre, mx + 28, y + 2);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(90);
        MUE_EMPRESA.lineas.forEach((l, i) => doc.text(l, mx + 28, y + 7 + i * 3.7));
        // Título, número y copia
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120);
        doc.text("CERTIFICADO DE ENTREGA DE MUESTRAS", W - mx, y - 1, { align: "right" });
        doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(164, 35, 42);
        doc.text("N° " + mueNumero(m), W - mx, y + 7, { align: "right" });
        doc.setFontSize(8.5); doc.setTextColor(40);
        doc.text(titulo, W - mx, y + 13, { align: "right" });
        y += 23;
        doc.setDrawColor(164, 35, 42); doc.setLineWidth(0.7); doc.line(mx, y, W - mx, y);
        y += 6;

        // Datos de la entrega
        const dato = (rotulo, valor, x, ancho) => {
          doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(140);
          doc.text(rotulo, x, y);
          doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(30);
          doc.text(corto(valor || "-", ancho), x, y + 4.5);
        };
        dato("CLIENTE", m.cliente, mx, pw * 0.62);
        dato("FECHA DE ENTREGA", SersaleBase.fmtFecha(m.fecha), mx + pw * 0.66, pw * 0.34);
        y += 10;
        dato("CONTACTO", m.contacto ? texto(m.contacto).replace(/\s+/g, " ") : "-", mx, pw * 0.62);
        dato("ENTREGÓ", m.entrega, mx + pw * 0.66, pw * 0.34);
        y += 9;

        // Tabla de muestras
        const cx = [mx, mx + 9, mx + pw * 0.52, mx + pw * 0.70];
        const encabezado = () => {
          doc.setFillColor(42, 51, 59); doc.rect(mx, y, pw, 6.5, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(255);
          doc.text("N°", cx[0] + 2, y + 4.4);
          doc.text("MUESTRA", cx[1] + 1, y + 4.4);
          doc.text("CANTIDAD", cx[2] + 1, y + 4.4);
          doc.text("OBSERVACIÓN", cx[3] + 1, y + 4.4);
          y += 6.5;
        };
        encabezado();
        const piso = y0 + alto - 44; // lugar reservado para la leyenda y las firmas
        items.forEach((it, i) => {
          if (y + ALTO_FILA > piso) { doc.addPage(); y = 16; encabezado(); }
          doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(40);
          doc.text(String(i + 1), cx[0] + 2, y + 4.3);
          doc.text(corto(it.producto, cx[2] - cx[1] - 3), cx[1] + 1, y + 4.3);
          doc.text(corto(mueCantidad(it) || "-", cx[3] - cx[2] - 3), cx[2] + 1, y + 4.3);
          doc.setFontSize(8); doc.setTextColor(90);
          doc.text(corto(it.nota || "", mx + pw - cx[3] - 3), cx[3] + 1, y + 4.3);
          doc.setDrawColor(225); doc.setLineWidth(0.2); doc.line(mx, y + ALTO_FILA, W - mx, y + ALTO_FILA);
          y += ALTO_FILA;
        });
        if (m.obs) {
          doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(70);
          doc.text(corto("Observaciones: " + texto(m.obs).replace(/\s+/g, " "), pw), mx, y + 5);
        }

        // Leyenda y firmas, al pie de la copia
        let yf = y0 + alto - 33;
        doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(90);
        doc.text("Se deja constancia de la entrega, sin cargo, de las muestras detalladas para su evaluación.", mx, yf);
        yf += 20;
        const anchoFirma = pw * 0.29, sep = (pw - anchoFirma * 3) / 2;
        const cajas = [
          { x: mx, rotulo: "Entregó (Frigorífico Sersale)", valor: m.entrega || "" },
          { x: mx + anchoFirma + sep, rotulo: "Recibí conforme - Firma", valor: "" },
          { x: mx + (anchoFirma + sep) * 2, rotulo: "Aclaración", valor: m.aclaracion || "" },
        ];
        // La firma hecha en el teléfono, sobre la línea de "Firma"
        if (m.firma) { try { doc.addImage(m.firma, "PNG", cajas[1].x + 2, yf - 15, anchoFirma - 4, 14, "firma", "FAST"); } catch (e) { console.error("Firma del certificado:", e); } }
        cajas.forEach(c => {
          doc.setDrawColor(60); doc.setLineWidth(0.3); doc.line(c.x, yf, c.x + anchoFirma, yf);
          if (c.valor) { doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(30); doc.text(corto(c.valor, anchoFirma - 2), c.x + 1, yf - 1.5); }
          doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(120);
          doc.text(c.rotulo, c.x, yf + 3.5);
        });
      }

      if (enMedia) {
        copia("ORIGINAL", 0, H / 2);
        doc.setDrawColor(150); doc.setLineWidth(0.2);
        doc.setLineDashPattern([2, 2], 0); doc.line(6, H / 2, W - 6, H / 2); doc.setLineDashPattern([], 0);
        copia("DUPLICADO", H / 2, H / 2);
      } else {
        copia("ORIGINAL", 0, H);
        doc.addPage();
        copia("DUPLICADO", 0, H);
      }
      return doc;
    }
    const mueArchivo = m => "Certificado de muestras " + mueNumero(m) + " - " + String(m.cliente || "Cliente").replace(/[\\/:*?"<>|]/g, " ") + ".pdf";

    // ── Firma con el dedo ──
    // (El gesto "atrás" del teléfono lo atiende Muestras para todas sus pantallas: cada
    // una deja en `atras.current` lo que tiene que pasar al volver.)
    function MuestraFirma({ muestra, onCerrar, atras }) {
      const lienzo = React.useRef(null);
      const trazo = React.useRef({ dibujando: false, hay: false });
      const [aclaracion, setAclaracion] = useState(muestra.aclaracion || "");
      const [hayTrazo, setHayTrazo] = useState(false);
      atras.current = onCerrar;
      useEffect(() => {
        const c = lienzo.current;
        const escala = Math.min(window.devicePixelRatio || 1, 3);
        c.width = Math.round(c.clientWidth * escala);
        c.height = Math.round(c.clientHeight * escala);
        const ctx = c.getContext("2d");
        ctx.scale(escala, escala);
        ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#12161A";
      }, []);
      function punto(e) {
        const r = lienzo.current.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      }
      function empezar(e) {
        e.preventDefault();
        try { lienzo.current.setPointerCapture(e.pointerId); } catch (err) {}
        const p = punto(e), ctx = lienzo.current.getContext("2d");
        trazo.current.dibujando = true;
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke(); // un toque también deja marca
      }
      function mover(e) {
        if (!trazo.current.dibujando) return;
        e.preventDefault();
        const p = punto(e), ctx = lienzo.current.getContext("2d");
        ctx.lineTo(p.x, p.y); ctx.stroke();
        if (!trazo.current.hay) { trazo.current.hay = true; setHayTrazo(true); }
      }
      function terminar() { trazo.current.dibujando = false; }
      function borrar() {
        const c = lienzo.current;
        c.getContext("2d").clearRect(0, 0, c.width, c.height);
        trazo.current.hay = false; setHayTrazo(false);
      }
      // La firma se guarda achicada (600 px de ancho): alcanza para el PDF y pesa poco.
      function imagen() {
        const c = lienzo.current, salida = document.createElement("canvas");
        salida.width = 600; salida.height = Math.round(600 * c.height / c.width);
        salida.getContext("2d").drawImage(c, 0, 0, salida.width, salida.height);
        return salida.toDataURL("image/png");
      }
      const [guardar, guardando] = SersaleBase.useAccion(async () => {
        if (!hayTrazo) { SersaleUI.toast("Falta la firma: se firma con el dedo en el recuadro.", { tipo: "error" }); return; }
        if (!aclaracion.trim()) { SersaleUI.toast("Escribí la aclaración (nombre y apellido de quien firma).", { tipo: "error" }); return; }
        try {
          const { db, doc, updateDoc } = fb();
          const ahora = new Date().toISOString();
          await updateDoc(doc(db, "muestras", muestra.id), { firma: imagen(), aclaracion: aclaracion.trim().replace(/\s+/g, " "), firmadoEn: ahora, actualizadoEn: ahora });
          SersaleUI.toast("Firma guardada", { tipo: "ok" });
          onCerrar();
        } catch (e) {
          console.error(e);
          SersaleUI.toast("No se pudo guardar la firma. Probá de nuevo.", { tipo: "error" });
        }
      });
      return (
        <div className="crm-page">
          <div className="chapa" style={MUE_CHAPA}>
            <button onClick={onCerrar} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:"4px 8px 4px 0",minHeight:44,minWidth:44,textAlign:"left"}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Firma de quien recibe</div>
          </div>
          <div style={{padding:"14px 16px 24px"}}>
            <div style={{fontSize:13,color:"#5C666F",marginBottom:10}}>{mueNumero(muestra)} · {muestra.cliente} · {mueItems(muestra).length} {mueItems(muestra).length === 1 ? "muestra" : "muestras"}</div>
            <div style={{position:"relative",background:"#fff",border:"1.5px solid #2A333B",borderRadius:14,overflow:"hidden"}}>
              <canvas ref={lienzo} id="mue-firma" aria-label="Recuadro para firmar"
                onPointerDown={empezar} onPointerMove={mover} onPointerUp={terminar} onPointerCancel={terminar} onPointerLeave={terminar}
                style={{display:"block",width:"100%",height:200,touchAction:"none",cursor:"crosshair"}} />
              {!hayTrazo && <div style={{position:"absolute",left:0,right:0,bottom:14,textAlign:"center",fontSize:13,color:"#A3ABB3",pointerEvents:"none"}}>Firmá acá con el dedo</div>}
              <div style={{position:"absolute",left:18,right:18,bottom:38,borderBottom:"1px dashed #C9CED3",pointerEvents:"none"}} />
            </div>
            <button type="button" onClick={borrar} disabled={!hayTrazo} style={{minHeight:44,marginTop:8,padding:"0 14px",borderRadius:10,border:"1.5px solid #D8DCE0",background:"#fff",color:hayTrazo?"#3A424A":"#A3ABB3",fontWeight:600,fontSize:13,cursor:"pointer"}}>Borrar y firmar de nuevo</button>
            <label style={MUE_ETIQUETA} htmlFor="mue-aclaracion">Aclaración</label>
            <input id="mue-aclaracion" style={MUE_CAMPO} placeholder="Nombre y apellido de quien firma" autoComplete="off" autoCapitalize="words" autoCorrect="off" spellCheck={false}
              value={aclaracion} onChange={e=>setAclaracion(e.target.value)} />
            <button disabled={guardando} onClick={()=>guardar()}
              style={{width:"100%",minHeight:52,marginTop:20,borderRadius:14,border:"none",background:guardando?"#A3ABB3":"#A4232A",color:"#fff",fontWeight:700,fontSize:16,cursor:"pointer"}}>
              {guardando ? "Guardando..." : "✓ Guardar firma"}
            </button>
          </div>
        </div>
      );
    }

    // ── Selector de producto con buscador ──
    // El catálogo es largo: en vez de recorrer una lista, se escribe parte del nombre
    // (sin importar acentos ni mayúsculas) y se toca el producto. Si no está en el
    // catálogo, «Otro» deja cargado lo que se escribió.
    function MueSelectorProducto({ valor, libre, catalogo, etiqueta, id, onElegir }) {
      const [abierto, setAbierto] = useState(false);
      const [busqueda, setBusqueda] = useState("");
      const campo = React.useRef(null);
      useEffect(() => { if (abierto && campo.current) campo.current.focus(); }, [abierto]);
      const q = busqueda.trim();
      const grupos = Object.keys(catalogo)
        .map(cat => ({ cat, productos: p1ProductosDe(catalogo, cat).filter(p => !q || SersaleBase.coincide(p, q)) }))
        .filter(g => g.productos.length > 0);
      const cantidad = grupos.reduce((s, g) => s + g.productos.length, 0);
      const mostrado = valor === MUE_OTRO ? (libre.trim() || "Otro (escribir)") : valor;
      function elegir(sel, texto) { onElegir(sel, texto); setAbierto(false); setBusqueda(""); }
      return (
        <div>
          <button type="button" id={id} aria-label={etiqueta} aria-expanded={abierto} onClick={()=>setAbierto(!abierto)}
            style={{...MUE_CAMPO, display:"flex", alignItems:"center", justifyContent:"space-between", textAlign:"left", cursor:"pointer", minHeight:48}}>
            <span style={{color:mostrado ? "#191E23" : "#79828B", overflowWrap:"anywhere"}}>{mostrado || "Elegir producto…"}</span>
            <span style={{color:"#79828B",fontSize:12,marginLeft:8,flexShrink:0}}>{abierto ? "▲" : "▼"}</span>
          </button>
          {abierto && (
            <div style={{marginTop:6,border:"1.5px solid #2A333B",borderRadius:12,background:"#fff",overflow:"hidden"}}>
              <div style={{padding:8,borderBottom:"1px solid #E4E7EA"}}>
                <input ref={campo} style={{...MUE_CAMPO, padding:"10px 12px"}} placeholder="🔍 Buscar producto por nombre" aria-label={"Buscar " + etiqueta.toLowerCase()}
                  enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
                  value={busqueda} onChange={e=>setBusqueda(e.target.value)} />
              </div>
              <div style={{maxHeight:280,overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
                {grupos.map(g => (
                  <div key={g.cat}>
                    <div style={{padding:"6px 14px",background:"#F2F3F5",fontSize:11,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"#5C666F"}}>{g.cat}</div>
                    {g.productos.map(p => (
                      <button key={g.cat + "|" + p} type="button" onClick={()=>elegir(p, "")}
                        style={{display:"block",width:"100%",minHeight:44,padding:"8px 14px",border:"none",borderBottom:"1px solid #F2F3F5",background:p === valor ? "#F7EAEA" : "#fff",textAlign:"left",fontSize:15,color:"#191E23",fontWeight:p === valor ? 600 : 400,cursor:"pointer"}}>{p}</button>
                    ))}
                  </div>
                ))}
                {cantidad === 0 && <div style={{padding:"14px",fontSize:13,color:"#79828B"}}>Ningún producto del catálogo coincide.</div>}
                <button type="button" onClick={()=>elegir(MUE_OTRO, q)}
                  style={{display:"block",width:"100%",minHeight:46,padding:"8px 14px",border:"none",background:"#fff",textAlign:"left",fontSize:15,color:"#6B4E8E",fontWeight:600,cursor:"pointer"}}>
                  {q ? "➕ Otro: «" + q + "»" : "➕ Otro (escribir el nombre)"}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── Formulario (alta y edición de un certificado) ──
    function MuestraForm({ muestra, clientes, onCerrar, onGuardada, atras }) {
      const nueva = !muestra || !muestra.id;
      const previa = muestra || {};
      const catalogo = getProductos() || {};
      const productosDe = cat => p1ProductosDe(catalogo, cat);
      const esDelCatalogo = p => Object.keys(catalogo).some(cat => productosDe(cat).includes(p));
      const nombres = (clientes || []).map(c => c.nombre).filter(Boolean);
      const idFila = React.useRef(0);
      const filaVacia = () => ({ fila: "f" + (idFila.current++), id: "", sel: "", libre: "", cantidad: "", unidad: "kg", nota: "" });

      const [fecha, setFecha] = useState(/^\d{4}-\d{2}-\d{2}$/.test(previa.fecha) ? previa.fecha : SersaleBase.hoy());
      const clientePrevio = String(previa.cliente || "");
      const [cliente, setCliente] = useState(clientePrevio === "" ? "" : nombres.includes(clientePrevio) ? clientePrevio : "Otro");
      const [clienteLibre, setClienteLibre] = useState(clientePrevio !== "" && !nombres.includes(clientePrevio) ? clientePrevio : "");
      const [contacto, setContacto] = useState(String(previa.contacto || ""));
      const [entrega, setEntrega] = useState(nueva ? (sessionStorage.getItem("sersale_nombre") || "") : String(previa.entrega || ""));
      const [obs, setObs] = useState(String(previa.obs || ""));
      const [filas, setFilas] = useState(() => {
        const its = mueItems(previa);
        if (its.length === 0) return [filaVacia()];
        return its.map(it => {
          const p = String(it.producto || "");
          return { fila: "f" + (idFila.current++), id: it.id || "", sel: esDelCatalogo(p) ? p : MUE_OTRO, libre: esDelCatalogo(p) ? "" : p, cantidad: it.cantidad != null ? String(it.cantidad).replace(".", ",") : "", unidad: MUE_UNIDADES.includes(it.unidad) ? it.unidad : "kg", nota: String(it.nota || "") };
        });
      });
      useEffect(() => { const t = setTimeout(() => window.scrollTo(0, 0), 0); return () => clearTimeout(t); }, []);

      const cambiarFila = (fila, cambios) => setFilas(fs => fs.map(f => (f.fila === fila ? { ...f, ...cambios } : f)));
      const productoDe = f => (f.sel === MUE_OTRO ? f.libre.trim().replace(/\s+/g, " ") : f.sel);
      const filaEnBlanco = f => !productoDe(f) && !f.cantidad.trim() && !f.nota.trim();

      // Al elegir un cliente de la lista se propone su teléfono como contacto (si no se escribió otro).
      function elegirCliente(val, buscado) {
        setCliente(val);
        if (val === "Otro" && buscado && !clienteLibre.trim()) setClienteLibre(buscado);
        const c = (clientes || []).find(x => x.nombre === val);
        if (c && !contacto.trim()) setContacto([c.telefono, c.direccion].filter(Boolean).join(" · "));
      }

      // ── Salir con algo a medio cargar: se pregunta antes de perderlo ──
      const firma = JSON.stringify([fecha, cliente, clienteLibre, contacto, entrega, obs, filas.map(f => [f.sel, f.libre, f.cantidad, f.unidad, f.nota])]);
      const firmaBase = React.useRef(null);
      if (firmaBase.current === null) firmaBase.current = firma;
      const preguntando = React.useRef(false);
      async function salir() {
        if (preguntando.current) return;
        if (firma !== firmaBase.current) {
          preguntando.current = true;
          let ok = false;
          try {
            ok = await SersaleUI.confirmar({ titulo: "¿Salir sin guardar?", cuerpo: nueva ? "Se pierde lo que cargaste en este certificado." : "Se pierden los cambios que hiciste en este certificado.", aceptar: "Salir", cancelar: "Seguir cargando", peligro: true });
          } finally { preguntando.current = false; }
          if (!ok) return;
        }
        onCerrar();
      }
      atras.current = salir; // el gesto "atrás" hace lo mismo que la flecha

      function datos() {
        const falta = (m, id) => {
          SersaleUI.toast(m, { tipo: "error" });
          const el = id && document.getElementById(id);
          if (el) { el.scrollIntoView({ block: "center" }); try { el.focus({ preventScroll: true }); } catch (e) {} }
          return null;
        };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return falta("Poné la fecha de la entrega.", "mue-fecha");
        const nombre = (cliente === "Otro" ? clienteLibre : cliente).trim().replace(/\s+/g, " ");
        if (!nombre) return falta(cliente === "Otro" ? "Escribí el nombre del cliente." : "Elegí a qué cliente va dirigida.", cliente === "Otro" ? "mue-cliente-libre" : "mue-cliente");
        const cargadas = filas.filter(f => !filaEnBlanco(f));
        if (cargadas.length === 0) return falta("Cargá al menos una muestra.", "mue-prod-" + filas[0].fila);
        const items = [];
        for (const f of cargadas) {
          const producto = productoDe(f);
          if (!producto) return falta(f.sel === MUE_OTRO ? "Escribí qué muestra es." : "Elegí qué muestra es.", (f.sel === MUE_OTRO ? "mue-libre-" : "mue-prod-") + f.fila);
          const cantidad = SersaleBase.numero(f.cantidad);
          if (!(cantidad > 0)) return falta("Poné la cantidad de " + producto + ".", "mue-cant-" + f.fila);
          items.push({ fila: f, producto, cantidad: SersaleBase.redondear(cantidad, 3), unidad: f.unidad, nota: f.nota.trim() });
        }
        return { fecha, cliente: nombre, contacto: contacto.trim(), entrega: entrega.trim().replace(/\s+/g, " "), obs: obs.trim(), items };
      }

      const [guardar, guardando] = SersaleBase.useAccion(async () => {
        const d = datos();
        if (!d) return;
        if (navigator.onLine === false) { SersaleUI.toast("Sin conexión: el certificado necesita señal para tomar su número. Probá de nuevo cuando haya.", { tipo: "error" }); return; }
        const ahora = new Date().toISOString();
        const por = sessionStorage.getItem("sersale_usuario") || "";
        try {
          const { db, collection, doc, getDoc, getDocs, updateDoc, runTransaction } = fb();
          if (nueva) {
            const items = d.items.map((it, i) => ({ id: "m" + Date.now().toString(36) + i, producto: it.producto, cantidad: it.cantidad, unidad: it.unidad, nota: it.nota, estado: "entregada", estadoEn: ahora, historial: [{ estado: "entregada", en: ahora, nota: "", por }] }));
            const contadorRef = doc(db, "config", "contador_muestras");
            // Sin contador (primera vez): se parte del mayor número ya usado.
            let maximo = 0;
            if (!(await getDoc(contadorRef)).exists()) {
              (await getDocs(collection(db, "muestras"))).docs.forEach(x => { const n = Number(x.data().nro) || 0; if (n > maximo) maximo = n; });
            }
            const ref = doc(collection(db, "muestras"));
            // Número y certificado se guardan juntos: dos teléfonos a la vez no repiten número.
            // Si la confirmación se pierde y Firestore repite la función, el certificado ya
            // está guardado: no se toma otro número.
            const nro = await runTransaction(db, async tx => {
              const ya = await tx.get(ref);
              if (ya.exists()) return ya.data().nro;
              const cont = await tx.get(contadorRef);
              const n = (cont.exists() ? Number(cont.data().ultimo) || 0 : maximo) + 1;
              tx.set(contadorRef, { ultimo: n, actualizadoEn: ahora });
              tx.set(ref, { nro: n, fecha: d.fecha, cliente: d.cliente, contacto: d.contacto, entrega: d.entrega, obs: d.obs, items, firma: "", aclaracion: "", creadoEn: ahora, creadoPor: por });
              return n;
            });
            SersaleUI.toast("Certificado " + mueNumero({ nro }) + " guardado: " + d.cliente, { tipo: "ok" });
            onGuardada(ref.id);
          } else {
            // Se parte de lo que hay guardado AHORA: el seguimiento que otro teléfono anotó
            // mientras tanto (estado e historial de cada muestra) no se pisa.
            await runTransaction(db, async tx => {
              const ref = doc(db, "muestras", muestra.id);
              const snap = await tx.get(ref);
              if (!snap.exists()) { const e = new Error("no existe"); e.code = "not-found"; throw e; }
              const guardados = mueItems(snap.data());
              const items = d.items.map((it, i) => {
                const antes = it.fila.id ? guardados.find(g => g.id === it.fila.id) : null;
                return antes
                  ? { ...antes, producto: it.producto, cantidad: it.cantidad, unidad: it.unidad, nota: it.nota }
                  : { id: "m" + Date.now().toString(36) + i, producto: it.producto, cantidad: it.cantidad, unidad: it.unidad, nota: it.nota, estado: "entregada", estadoEn: ahora, historial: [{ estado: "entregada", en: ahora, nota: "", por }] };
              });
              tx.update(ref, { fecha: d.fecha, cliente: d.cliente, contacto: d.contacto, entrega: d.entrega, obs: d.obs, items, actualizadoEn: ahora });
            });
            SersaleUI.toast("Certificado actualizado", { tipo: "ok" });
            onGuardada(muestra.id);
          }
        } catch (e) {
          console.error(e);
          SersaleUI.toast(e && e.code === "permission-denied"
            ? "La base de datos no permite guardar muestras. Avisá para que se habilite."
            : e && e.code === "not-found"
            ? "Este certificado ya no existe: lo eliminaron desde otro teléfono. No se guardó nada."
            : "No se pudo guardar el certificado. Revisá la señal y probá de nuevo.", { tipo: "error" });
        }
      });

      return (
        <div className="crm-page">
          <div className="chapa" style={{...MUE_CHAPA, padding:"18px 20px"}}>
            <button onClick={()=>salir()} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:"4px 8px 4px 0",minHeight:44}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>{nueva ? "Nueva entrega de muestras" : "Editar " + mueNumero(muestra)}</div>
          </div>
          <div style={{padding:"6px 20px 24px"}}>
            <label style={MUE_ETIQUETA} htmlFor="mue-fecha">Fecha de la entrega</label>
            <input id="mue-fecha" type="date" style={MUE_CAMPO} value={fecha} onChange={e=>setFecha(e.target.value)} />

            <label style={MUE_ETIQUETA} id="mue-cliente-rotulo">Cliente</label>
            <div id="mue-cliente" tabIndex={-1} aria-labelledby="mue-cliente-rotulo">
              <SelectorClienteBuscable valor={cliente} onChange={elegirCliente} clientes={[...nombres, "Otro"]} placeholder="— Elegí el cliente —" />
            </div>
            {cliente === "Otro" && (
              <input id="mue-cliente-libre" style={MUE_CAMPO} placeholder="Nombre del cliente o del comercio" aria-label="Nombre del cliente" autoComplete="off" autoCapitalize="words" autoCorrect="off" spellCheck={false}
                value={clienteLibre} onChange={e=>setClienteLibre(e.target.value)} />
            )}

            <label style={MUE_ETIQUETA} htmlFor="mue-contacto">Contacto <span style={{fontWeight:400}}>(opcional)</span></label>
            <input id="mue-contacto" style={MUE_CAMPO} placeholder="Teléfono, quién recibe…" autoComplete="off" value={contacto} onChange={e=>setContacto(e.target.value)} />

            <div style={{...MUE_ETIQUETA, marginTop:20}}>Muestras que se entregan</div>
            {filas.map((f, i) => (
              <div key={f.fila} data-mue-fila={i + 1} style={{background:"#fff",border:"1px solid #D8DCE0",borderRadius:14,padding:"10px 12px 12px",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontWeight:700,fontSize:12,color:"#79828B",letterSpacing:".06em"}}>MUESTRA {i + 1}</span>
                  {filas.length > 1 && <button type="button" onClick={()=>setFilas(fs => fs.filter(x => x.fila !== f.fila))} aria-label={"Quitar la muestra " + (i + 1)} style={{minWidth:44,minHeight:44,margin:"-10px -8px -6px 0",border:"none",background:"transparent",color:"#C33039",fontSize:18,cursor:"pointer"}}>✕</button>}
                </div>
                <MueSelectorProducto id={"mue-prod-" + f.fila} etiqueta={"Producto de la muestra " + (i + 1)} valor={f.sel} libre={f.libre} catalogo={catalogo}
                  onElegir={(sel, texto) => cambiarFila(f.fila, sel === MUE_OTRO ? { sel, libre: texto || f.libre } : { sel, libre: "" })} />
                {f.sel === MUE_OTRO && (
                  <input id={"mue-libre-" + f.fila} style={{...MUE_CAMPO, marginTop:8}} placeholder="Escribí qué muestra es" aria-label={"Nombre de la muestra " + (i + 1)} autoComplete="off"
                    value={f.libre} onChange={e=>cambiarFila(f.fila, { libre: e.target.value })} />
                )}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:8}}>
                  <SersaleBase.InputDecimal id={"mue-cant-" + f.fila} style={MUE_CAMPO} placeholder="Cantidad" aria-label={"Cantidad de la muestra " + (i + 1)} value={f.cantidad} onChange={e=>cambiarFila(f.fila, { cantidad: e.target.value })} />
                  <select aria-label={"Unidad de la muestra " + (i + 1)} style={MUE_CAMPO} value={f.unidad} onChange={e=>cambiarFila(f.fila, { unidad: e.target.value })}>
                    {MUE_UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <input style={{...MUE_CAMPO, marginTop:8}} placeholder="Nota (opcional): feteado, pieza entera…" aria-label={"Nota de la muestra " + (i + 1)} autoComplete="off"
                  value={f.nota} onChange={e=>cambiarFila(f.fila, { nota: e.target.value })} />
              </div>
            ))}
            <button type="button" onClick={()=>setFilas(fs => fs.concat(filaVacia()))}
              style={{width:"100%",minHeight:46,borderRadius:12,border:"1.5px dashed #79828B",background:"#fff",color:"#2A333B",fontWeight:600,fontSize:14,cursor:"pointer"}}>+ Agregar otra muestra</button>

            <label style={MUE_ETIQUETA} htmlFor="mue-entrega">Quién entrega</label>
            <input id="mue-entrega" style={MUE_CAMPO} placeholder="Nombre de quien lleva las muestras" autoComplete="off" autoCapitalize="words" value={entrega} onChange={e=>setEntrega(e.target.value)} />

            <label style={MUE_ETIQUETA} htmlFor="mue-obs">Observaciones <span style={{fontWeight:400}}>(opcional)</span></label>
            <input id="mue-obs" style={MUE_CAMPO} placeholder="Ej: para evaluar en la carta de verano" autoComplete="off" value={obs} onChange={e=>setObs(e.target.value)} />

            <button disabled={guardando} onClick={()=>guardar()}
              style={{width:"100%",minHeight:52,marginTop:22,borderRadius:14,border:"none",background:guardando?"#A3ABB3":"#A4232A",color:"#fff",fontWeight:700,fontSize:16,cursor:"pointer"}}>
              {guardando ? "Guardando..." : nueva ? "✓ Guardar certificado" : "✓ Guardar cambios"}
            </button>
          </div>
        </div>
      );
    }

    // ── Detalle de un certificado: documento, firma y seguimiento de cada muestra ──
    function MuestraDetalle({ muestra, onCerrar, onEditar, onFirmar, atras }) {
      const [abierta, setAbierta] = useState(null); // id de la muestra a la que se le está anotando una novedad
      const [estadoNuevo, setEstadoNuevo] = useState("");
      const [nota, setNota] = useState("");
      atras.current = onCerrar;
      useEffect(() => { const t = setTimeout(() => window.scrollTo(0, 0), 0); return () => clearTimeout(t); }, []);

      function abrirNovedad(it) { setAbierta(it.id); setEstadoNuevo(it.estado || "entregada"); setNota(""); }

      const [anotar, anotando] = SersaleBase.useAccion(async (it) => {
        const texto = nota.trim();
        if (estadoNuevo === it.estado && !texto) { SersaleUI.toast("Elegí otro estado o escribí una nota.", { tipo: "error" }); return; }
        try {
          const { db, doc, runTransaction } = fb();
          const ahora = new Date().toISOString();
          const por = sessionStorage.getItem("sersale_usuario") || "";
          // Se lee el certificado en el momento y se cambia solo esa muestra: lo que otro
          // teléfono anotó en las demás no se pisa.
          await runTransaction(db, async tx => {
            const ref = doc(db, "muestras", muestra.id);
            const snap = await tx.get(ref);
            if (!snap.exists()) { const e = new Error("no existe"); e.code = "not-found"; throw e; }
            const items = mueItems(snap.data()).map(x => {
              if (x.id !== it.id) return x;
              const historial = Array.isArray(x.historial) ? x.historial.slice() : [];
              // Si Firestore repite la función (confirmación perdida), la novedad no se anota dos veces.
              if (!historial.some(h => h.en === ahora)) historial.push({ estado: estadoNuevo, en: ahora, nota: texto, por });
              return { ...x, estado: estadoNuevo, estadoEn: ahora, historial };
            });
            tx.update(ref, { items, actualizadoEn: ahora });
          });
          SersaleUI.toast(it.producto + ": " + mueEstado(estadoNuevo).t, { tipo: "ok" });
          setAbierta(null);
        } catch (e) {
          console.error(e);
          SersaleUI.toast(e && e.code === "not-found" ? "Este certificado ya no existe: lo eliminaron desde otro teléfono." : "No se pudo guardar la novedad. Revisá la señal y probá de nuevo.", { tipo: "error" });
        }
      });

      function pdf(compartir) {
        try {
          const doc = muePDF(muestra);
          if (compartir) window.compartirOdescargarPDF(doc, mueArchivo(muestra));
          else doc.save(mueArchivo(muestra));
        } catch (e) {
          console.error(e);
          SersaleUI.toast("No se pudo armar el PDF. Probá de nuevo.", { tipo: "error" });
        }
      }

      const boton = { minHeight:48, borderRadius:12, border:"1.5px solid #2A333B", background:"#fff", color:"#2A333B", fontWeight:700, fontSize:14, cursor:"pointer", padding:"0 12px" };
      return (
        <div className="crm-page">
          <div className="chapa" style={MUE_CHAPA}>
            <button onClick={onCerrar} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:"4px 8px 4px 0",minHeight:44,minWidth:44,textAlign:"left"}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Certificado {mueNumero(muestra)}</div>
            <button onClick={()=>onEditar(muestra)} style={{minHeight:44,padding:"0 14px",borderRadius:10,border:"1px solid rgba(239,234,225,0.3)",background:"rgba(239,234,225,0.12)",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Editar</button>
          </div>
          <div style={{padding:"16px 16px 24px"}}>
            <div style={{background:"#fff",border:"1px solid #D8DCE0",borderRadius:14,padding:"14px 16px",marginBottom:12}}>
              <div style={{fontWeight:800,fontSize:17,color:"#191E23",overflowWrap:"anywhere"}}>{muestra.cliente}</div>
              <div style={{fontSize:13,color:"#5C666F",marginTop:4}}>Entregado el {SersaleBase.fmtFecha(muestra.fecha)}{muestra.entrega ? " · por " + muestra.entrega : ""}</div>
              {muestra.contacto && <div style={{fontSize:13,color:"#5C666F",marginTop:2,overflowWrap:"anywhere"}}>{muestra.contacto}</div>}
              {muestra.obs && <div style={{fontSize:13,color:"#3A424A",marginTop:6,overflowWrap:"anywhere"}}>{muestra.obs}</div>}
              <div style={{marginTop:10,padding:"8px 10px",borderRadius:10,background:muestra.firma?"#DDEBE3":"#F0E7D9",color:muestra.firma?"#1F4D38":"#784212",fontSize:13,fontWeight:600}}>
                {muestra.firma ? "✓ Firmado por " + (muestra.aclaracion || "quien recibió") : "Sin firma en el teléfono (se puede firmar acá o en el papel)"}
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <button onClick={()=>pdf(false)} style={{...boton, background:"#A4232A", borderColor:"#A4232A", color:"#fff"}}>🖨️ PDF para imprimir</button>
              <button onClick={()=>pdf(true)} style={boton}>📤 Compartir PDF</button>
            </div>
            <button onClick={()=>onFirmar(muestra)} style={{...boton, width:"100%", marginBottom:18}}>✍️ {muestra.firma ? "Firmar de nuevo" : "Firmar en el teléfono"}</button>

            <div style={{fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#5C666F",margin:"0 2px 8px"}}>Seguimiento de cada muestra</div>
            {mueItems(muestra).map(it => {
              const quieta = mueDiasQuieta(muestra, it);
              const historial = Array.isArray(it.historial) ? it.historial : [];
              return (
                <div key={it.id} data-mue-item={it.producto} style={{background:"#fff",border:"1px solid #D8DCE0",borderRadius:14,padding:"12px 14px",marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:15,color:"#191E23",overflowWrap:"anywhere"}}>{it.producto}</div>
                      <div style={{fontSize:13,color:"#5C666F"}}>{mueCantidad(it)}{it.nota ? " · " + it.nota : ""}</div>
                    </div>
                    <MueChip estado={it.estado} />
                  </div>
                  {quieta != null && quieta >= MUE_DIAS_SIN_NOVEDAD && <div style={{marginTop:8,fontSize:12,fontWeight:600,color:"#C33039"}}>Hace {quieta} días que no hay novedad: conviene recontactar.</div>}
                  {historial.length > 0 && (
                    <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #EDEEF0"}}>
                      {historial.map((h, i) => (
                        <div key={i} style={{display:"flex",gap:8,fontSize:12,color:"#3A424A",padding:"2px 0"}}>
                          <span style={{color:"#79828B",flexShrink:0,fontFamily:"'IBM Plex Mono',ui-monospace,monospace"}}>{SersaleBase.fmtFecha(SersaleBase.diaDe(h.en))}</span>
                          <span style={{overflowWrap:"anywhere"}}><strong>{mueEstado(h.estado).t}</strong>{h.nota ? " — " + h.nota : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {abierta === it.id ? (
                    <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #EDEEF0"}}>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {MUE_ESTADOS.map(e => (
                          <button key={e.k} type="button" onClick={()=>setEstadoNuevo(e.k)} aria-pressed={estadoNuevo === e.k}
                            style={{minHeight:44,padding:"0 12px",borderRadius:22,border:"1.5px solid " + (estadoNuevo === e.k ? e.color : "#D8DCE0"),background:estadoNuevo === e.k ? e.color : "#fff",color:estadoNuevo === e.k ? "#fff" : "#3A424A",fontWeight:600,fontSize:13,cursor:"pointer"}}>{e.t}</button>
                        ))}
                      </div>
                      <input style={{...MUE_CAMPO, marginTop:8}} placeholder="Nota (opcional): qué dijo el cliente" aria-label={"Nota de la novedad de " + it.producto} autoComplete="off" value={nota} onChange={e=>setNota(e.target.value)} />
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
                        <button type="button" disabled={anotando} onClick={()=>setAbierta(null)} style={{...boton, borderColor:"#D8DCE0", color:"#5C666F"}}>Cancelar</button>
                        <button type="button" disabled={anotando} onClick={()=>anotar(it)} style={{...boton, background:anotando?"#A3ABB3":"#2A333B", color:"#fff"}}>{anotando ? "Guardando..." : "Guardar novedad"}</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={()=>abrirNovedad(it)} aria-label={"Anotar novedad de " + it.producto} style={{...boton, width:"100%", marginTop:10, minHeight:44, fontWeight:600, fontSize:13}}>Anotar novedad</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ── Pantalla de muestras ──
    function Muestras({ onBack }) {
      const [muestras, setMuestras] = useState(null); // null = cargando
      const [error, setError] = useState(null); // null | "permiso" | "otro"
      const [intento, setIntento] = useState(0);
      const [clientes, setClientes] = useState([]);
      const [pantalla, setPantalla] = useState(null); // null | { tipo: "form"|"detalle"|"firma", id }
      const [vista, setVista] = useState("entregas"); // entregas | seguimiento
      const [filtro, setFiltro] = useState("abiertas"); // abiertas | recontactar | todas | <estado>
      const [buscar, setBuscar] = useState("");

      // La lista se mantiene al día sola (también con lo que carga otro teléfono).
      useEffect(() => {
        let cortar = null, vivo = true;
        function escuchar() {
          const { db, collection, onSnapshot } = fb();
          cortar = onSnapshot(collection(db, "muestras"),
            snap => { if (!vivo) return; setError(null); setMuestras(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
            e => { console.error(e); if (vivo) setError(e && e.code === "permission-denied" ? "permiso" : "otro"); });
        }
        if (window.__fbReady) escuchar(); else document.addEventListener("fbReady", escuchar, { once: true });
        return () => { vivo = false; document.removeEventListener("fbReady", escuchar); if (cortar) cortar(); };
      }, [intento]);

      // Clientes del CRM para el selector (si no se pueden leer, igual se puede escribir el nombre).
      useEffect(() => {
        let vivo = true;
        async function cargar() {
          try {
            const { db, collection, getDocs } = fb();
            const snap = await getDocs(collection(db, "clientes"));
            if (vivo) setClientes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          } catch (e) { console.error("[Muestras] No se pudieron cargar los clientes:", e); }
        }
        if (window.__fbReady) cargar(); else document.addEventListener("fbReady", cargar, { once: true });
        return () => { vivo = false; document.removeEventListener("fbReady", cargar); };
      }, []);

      const [eliminar, eliminando] = SersaleBase.useAccion(async (m) => {
        const ok = await SersaleUI.confirmar({
          titulo: "Eliminar certificado " + mueNumero(m),
          cuerpo: m.cliente + " · " + mueItems(m).length + (mueItems(m).length === 1 ? " muestra" : " muestras") + "\nSe pierde también su seguimiento. No se puede deshacer.",
          aceptar: "Eliminar", peligro: true,
        });
        if (!ok) return;
        try {
          const { db, doc, deleteDoc } = fb();
          await deleteDoc(doc(db, "muestras", m.id));
          SersaleUI.toast("Certificado eliminado", { tipo: "ok" });
        } catch (e) {
          console.error(e);
          SersaleUI.toast("No se pudo eliminar. Probá de nuevo.", { tipo: "error" });
        }
      });

      // Gesto "atrás" del teléfono: mientras haya una pantalla abierta (formulario, certificado
      // o firma) hace lo que esa pantalla dejó anotado. Como el gesto consume la entrada del
      // historial, se vuelve a anotar (rearmar) si después de volver sigue habiendo una abierta.
      const atras = React.useRef(null);
      const [rearmar, setRearmar] = useState(0);
      useEffect(() => {
        if (!pantalla) return undefined;
        return SersaleBase.abrirAtras(() => { setRearmar(n => n + 1); if (atras.current) atras.current(); });
      }, [!!pantalla, rearmar]);

      const todas = muestras || [];
      const elegida = pantalla && pantalla.id ? todas.find(m => m.id === pantalla.id) : null;
      if (pantalla && pantalla.tipo === "form") {
        return <MuestraForm key={pantalla.id || "nueva"} muestra={elegida} clientes={clientes} atras={atras}
          onCerrar={()=>setPantalla(pantalla.id ? { tipo: "detalle", id: pantalla.id } : null)}
          onGuardada={id => setPantalla({ tipo: "detalle", id })} />;
      }
      if (pantalla && pantalla.tipo === "firma" && elegida) {
        return <MuestraFirma key={elegida.id} muestra={elegida} atras={atras} onCerrar={()=>setPantalla({ tipo: "detalle", id: elegida.id })} />;
      }
      if (pantalla && pantalla.tipo === "detalle") {
        // Recién guardado: puede tardar un instante en llegar a la lista.
        atras.current = () => setPantalla(null);
        if (!elegida) return <div className="crm-page"><p style={{textAlign:"center",color:"#79828B",padding:"60px 0"}}>{muestras === null ? "Cargando…" : "Abriendo el certificado…"}</p></div>;
        return <MuestraDetalle key={elegida.id} muestra={elegida} atras={atras} onCerrar={()=>setPantalla(null)}
          onEditar={m => setPantalla({ tipo: "form", id: m.id })} onFirmar={m => setPantalla({ tipo: "firma", id: m.id })} />;
      }

      const buscando = buscar.trim() !== "";
      const ordenadas = mueOrdenar(todas);
      const certificados = ordenadas.filter(m => !buscando || SersaleBase.coincide([mueNumero(m), m.cliente, m.contacto, m.obs, mueItems(m).map(it => it.producto).join(" ")].join(" "), buscar));
      // Seguimiento: una fila por muestra, agrupadas por cliente.
      const sueltas = [];
      ordenadas.forEach(m => mueItems(m).forEach(it => sueltas.push({ m, it })));
      const abiertas = sueltas.filter(x => !MUE_CERRADOS.includes(x.it.estado));
      const aRecontactar = sueltas.filter(x => muePideRecontacto(x.m, x.it));
      const deFiltro = filtro === "abiertas" ? abiertas : filtro === "recontactar" ? aRecontactar : filtro === "todas" ? sueltas : sueltas.filter(x => x.it.estado === filtro);
      const seguimiento = deFiltro.filter(x => !buscando || SersaleBase.coincide([x.m.cliente, x.it.producto, x.it.nota].join(" "), buscar));
      const porCliente = new Map();
      seguimiento.forEach(x => {
        const k = SersaleBase.norm(x.m.cliente || "");
        if (!porCliente.has(k)) porCliente.set(k, { cliente: x.m.cliente || "(sin cliente)", filas: [] });
        porCliente.get(k).filas.push(x);
      });
      const grupos = Array.from(porCliente.values()).sort((a, b) => String(a.cliente).localeCompare(String(b.cliente), "es", { sensitivity: "base" }));

      const chip = activo => ({ minHeight:44, padding:"0 14px", borderRadius:20, border:"1.5px solid " + (activo ? "#A4232A" : "#D8DCE0"), background:activo ? "#A4232A" : "#fff", color:activo ? "#fff" : "#3A424A", fontWeight:600, fontSize:13, cursor:"pointer", whiteSpace:"nowrap" });
      const pestana = activo => ({ flex:1, minHeight:46, border:"none", borderBottom:"3px solid " + (activo ? "#A4232A" : "transparent"), background:"transparent", color:activo ? "#A4232A" : "#5C666F", fontWeight:700, fontSize:14, cursor:"pointer" });

      return (
        <div className="crm-page">
          <div className="chapa" style={MUE_CHAPA}>
            <button onClick={onBack} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:"4px 8px 4px 0",minHeight:44,minWidth:44,textAlign:"left"}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Muestras</div>
            <button onClick={()=>setPantalla({ tipo: "form", id: null })} style={{minHeight:44,padding:"0 14px",borderRadius:10,border:"1px solid rgba(239,234,225,0.3)",background:"rgba(239,234,225,0.12)",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>+ Nueva</button>
          </div>

          <div style={{padding:"8px 16px 24px"}}>
            {error && (
              <div style={{textAlign:"center",padding:"30px 16px",marginTop:10,background:"#fff",borderRadius:14,border:"1px solid #D8DCE0"}}>
                <p style={{fontWeight:700,fontSize:15,marginBottom:6}}>No se pudieron cargar las muestras</p>
                <p style={{fontSize:13,color:"#5C666F",marginBottom:14}}>{error === "permiso" ? "La base de datos no permite ver las muestras. Avisá para que se habilite." : navigator.onLine === false ? "No hay conexión." : "Puede ser la señal."}</p>
                <button onClick={()=>{ setError(null); setMuestras(null); setIntento(n => n + 1); }} style={{minHeight:44,padding:"0 20px",borderRadius:12,border:"none",background:"#2A333B",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Reintentar</button>
              </div>
            )}
            {!error && muestras === null && <p style={{textAlign:"center",color:"#79828B",padding:"40px 0"}}>Cargando muestras…</p>}

            {!error && muestras !== null && todas.length === 0 && (
              <div style={{textAlign:"center",padding:"44px 16px",color:"#79828B"}}>
                <p style={{fontWeight:700,fontSize:15,color:"#3A424A",marginBottom:6}}>Todavía no hay muestras entregadas</p>
                <p style={{fontSize:13,marginBottom:16}}>Cargá acá cada entrega: queda el certificado para imprimir y el seguimiento de cada muestra.</p>
                <button onClick={()=>setPantalla({ tipo: "form", id: null })} style={{minHeight:48,padding:"0 22px",borderRadius:14,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>+ Nueva entrega de muestras</button>
              </div>
            )}

            {!error && muestras !== null && todas.length > 0 && (
              <>
                <div role="tablist" style={{display:"flex",borderBottom:"1px solid #D8DCE0",marginBottom:12}}>
                  <button role="tab" aria-selected={vista==="entregas"} onClick={()=>setVista("entregas")} style={pestana(vista==="entregas")}>Entregas ({todas.length})</button>
                  <button role="tab" aria-selected={vista==="seguimiento"} onClick={()=>setVista("seguimiento")} style={pestana(vista==="seguimiento")}>Seguimiento ({abiertas.length})</button>
                </div>
                {aRecontactar.length > 0 && (
                  <button onClick={()=>{ setVista("seguimiento"); setFiltro("recontactar"); }} style={{display:"block",width:"100%",textAlign:"left",background:"#F7EAEA",border:"1.5px solid #C33039",color:"#8E1F26",borderRadius:14,padding:"12px 14px",marginBottom:12,fontSize:13,fontWeight:600,lineHeight:1.4,cursor:"pointer",minHeight:44}}>
                    {aRecontactar.length === 1 ? "1 muestra lleva" : aRecontactar.length + " muestras llevan"} {MUE_DIAS_SIN_NOVEDAD} días o más sin novedad. Tocá para verlas.
                  </button>
                )}
                <div style={{position:"relative",marginBottom:12}}>
                  <input style={{...MUE_CAMPO, paddingRight:48}} placeholder="🔍 Buscar cliente o producto" aria-label="Buscar muestra" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
                    value={buscar} onChange={e=>setBuscar(e.target.value)} />
                  {buscando && <button onClick={()=>setBuscar("")} aria-label="Borrar la búsqueda" style={{position:"absolute",right:2,top:2,width:44,height:44,border:"none",background:"transparent",color:"#5C666F",fontSize:18,cursor:"pointer"}}>✕</button>}
                </div>

                {vista === "entregas" && (
                  <>
                    {certificados.length === 0 && <p style={{textAlign:"center",color:"#79828B",padding:"30px 0"}}>Ningún certificado coincide con la búsqueda.</p>}
                    {certificados.map(m => (
                      <div key={m.id} data-mue-certificado={mueNumero(m)} style={{background:"#fff",border:"1px solid #D8DCE0",borderRadius:14,padding:"12px 14px",marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:10}}>
                          <span style={{fontFamily:"'IBM Plex Mono',ui-monospace,monospace",fontWeight:700,fontSize:13,color:"#A4232A"}}>{mueNumero(m)}</span>
                          <span style={{fontSize:12,color:"#79828B"}}>{SersaleBase.fmtFecha(m.fecha)}{m.firma ? " · ✓ firmado" : ""}</span>
                        </div>
                        <div style={{fontWeight:700,fontSize:15,color:"#191E23",margin:"4px 0 8px",overflowWrap:"anywhere"}}>{m.cliente}</div>
                        {mueItems(m).map(it => (
                          <div key={it.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"3px 0",fontSize:13,color:"#3A424A"}}>
                            <span style={{overflowWrap:"anywhere"}}>{it.producto} <span style={{color:"#79828B"}}>· {mueCantidad(it)}</span></span>
                            <MueChip estado={it.estado} chico />
                          </div>
                        ))}
                        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginTop:10}}>
                          <button onClick={()=>setPantalla({ tipo: "detalle", id: m.id })} aria-label={"Abrir el certificado " + mueNumero(m)} style={{minHeight:44,borderRadius:10,border:"none",background:"#2A333B",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Abrir: PDF, firma y seguimiento</button>
                          <button disabled={eliminando} onClick={()=>eliminar(m)} aria-label={"Eliminar el certificado " + mueNumero(m)} style={{minHeight:44,minWidth:44,borderRadius:10,border:"1.5px solid #E4C7C9",background:"#fff",color:"#C33039",fontSize:16,cursor:"pointer"}}>🗑️</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {vista === "seguimiento" && (
                  <>
                    <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginBottom:10,WebkitOverflowScrolling:"touch"}}>
                      <button onClick={()=>setFiltro("abiertas")} style={chip(filtro==="abiertas")}>En curso ({abiertas.length})</button>
                      <button onClick={()=>setFiltro("recontactar")} style={chip(filtro==="recontactar")}>A recontactar ({aRecontactar.length})</button>
                      {MUE_ESTADOS.map(e => <button key={e.k} onClick={()=>setFiltro(e.k)} style={chip(filtro===e.k)}>{e.t} ({sueltas.filter(x => x.it.estado === e.k).length})</button>)}
                      <button onClick={()=>setFiltro("todas")} style={chip(filtro==="todas")}>Todas ({sueltas.length})</button>
                    </div>
                    {grupos.length === 0 && <p style={{textAlign:"center",color:"#79828B",padding:"30px 0"}}>{buscando ? "Ninguna muestra coincide con la búsqueda." : "No hay muestras en este estado."}</p>}
                    {grupos.map(g => (
                      <div key={g.cliente} data-mue-cliente={g.cliente} style={{background:"#fff",border:"1px solid #D8DCE0",borderRadius:14,padding:"12px 14px",marginBottom:10}}>
                        <div style={{fontWeight:800,fontSize:15,color:"#191E23",marginBottom:6,overflowWrap:"anywhere"}}>{g.cliente}</div>
                        {g.filas.map(({ m, it }) => {
                          const quieta = mueDiasQuieta(m, it);
                          return (
                            <button key={m.id + it.id} onClick={()=>setPantalla({ tipo: "detalle", id: m.id })} aria-label={"Ver " + it.producto + " de " + g.cliente}
                              style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,width:"100%",minHeight:48,padding:"6px 0",border:"none",borderTop:"1px solid #EDEEF0",background:"transparent",textAlign:"left",cursor:"pointer"}}>
                              <span style={{minWidth:0}}>
                                <span style={{display:"block",fontSize:14,color:"#191E23",overflowWrap:"anywhere"}}>{it.producto} <span style={{color:"#79828B"}}>· {mueCantidad(it)}</span></span>
                                <span style={{display:"block",fontSize:12,color:quieta != null && quieta >= MUE_DIAS_SIN_NOVEDAD ? "#C33039" : "#79828B",fontWeight:quieta != null && quieta >= MUE_DIAS_SIN_NOVEDAD ? 600 : 400}}>
                                  {mueNumero(m)} · entregada el {SersaleBase.fmtFecha(m.fecha)}{quieta != null && quieta >= MUE_DIAS_SIN_NOVEDAD ? " · " + quieta + " días sin novedad" : ""}
                                </span>
                              </span>
                              <MueChip estado={it.estado} chico />
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      );
    }

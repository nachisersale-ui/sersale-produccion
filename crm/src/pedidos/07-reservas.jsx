    // ── RESERVAS DE FIN DE AÑO ──────────────────────────────
    // Lo que los clientes dejan reservado para las fiestas: quién, qué, cuántos
    // kilos, a qué precio se acordó, cuánto dejó de seña y cuándo retira.
    //
    // Colección `reservas` (un documento por ítem reservado):
    //   fechaReserva  "AAAA-MM-DD"  día en que se tomó la reserva
    //   cliente       texto         nombre de quien reserva
    //   contacto      texto         teléfono, dirección o lo que haga falta para ubicarlo
    //   item          texto         "LECHÓN", un producto del catálogo o texto libre
    //   kg            número        kilos pedidos
    //   precioKg      número|null   precio acordado por kilo (null = a convenir)
    //   sena          número        seña que dejó (0 = no dejó nada)
    //   fechaRetiro   "AAAA-MM-DD"  día en que retira ("" = a confirmar)
    //   obs           texto
    //   estado        "pendiente" | "entregada"
    //   creadoEn / actualizadoEn (ISO), creadoPor (usuario)

    const RSV_ITEMS_FIESTAS = ["LECHÓN", "CORDERO", "COCHINILLO", "MEDIO LECHÓN", "MEDIO CORDERO"];
    const RSV_OTRO = "__otro__";

    /** Total estimado de la reserva (kg × precio), o null si falta alguno de los dos. */
    function rsvTotal(r) {
      const kg = Number(r.kg) || 0, precio = Number(r.precioKg) || 0;
      return kg > 0 && precio > 0 ? SersaleBase.redondear(kg * precio, 0) : null;
    }
    /** Lo que falta cobrar al retirar (total − seña), o null si no hay total. */
    function rsvResta(r) {
      const total = rsvTotal(r);
      return total == null ? null : SersaleBase.redondear(total - (Number(r.sena) || 0), 0);
    }
    /** Kilos para mostrar: "30,4 kg". */
    function rsvKg(n) {
      return SersaleBase.fmtNumero(Number(n) || 0, 3) + " kg";
    }
    /**
     * Orden de la lista. "reserva": por fecha de reserva y, en el mismo día, por
     * orden de carga. "retiro": por fecha de retiro (las que no tienen fecha, al
     * final) y después por orden de reserva.
     */
    function rsvOrdenar(lista, criterio) {
      const porReserva = (a, b) =>
        String(a.fechaReserva || "").localeCompare(String(b.fechaReserva || "")) ||
        String(a.creadoEn || "").localeCompare(String(b.creadoEn || ""));
      const copia = lista.slice();
      if (criterio === "retiro") {
        copia.sort((a, b) => {
          const ra = a.fechaRetiro || "9999-99-99", rb = b.fechaRetiro || "9999-99-99";
          return ra.localeCompare(rb) || porReserva(a, b);
        });
      } else copia.sort(porReserva);
      return copia;
    }
    /** Número para WhatsApp a partir de lo escrito en "contacto" (celular argentino de 10 dígitos), o "". */
    function rsvWhatsApp(contacto) {
      const m = String(contacto || "").match(/(?:\+?54\s*9?\s*)?(?:\(?0?\d{2,4}\)?[\s-]*)?(?:15[\s-]*)?\d{3,4}[\s-]*\d{4}/);
      if (!m) return "";
      let d = m[0].replace(/\D/g, "");
      if (d.indexOf("549") === 0) return d.length === 13 ? d : "";
      if (d.indexOf("54") === 0 && d.length === 12) return "549" + d.slice(2);
      d = d.replace(/^0/, "");
      return d.length === 10 ? "549" + d : "";
    }
    /** Primer teléfono escrito en "contacto", solo dígitos (para llamar), o "". */
    function rsvTelefono(contacto) {
      const m = String(contacto || "").match(/\+?\d[\d\s().-]{6,}\d/);
      return m ? m[0].replace(/[^\d+]/g, "") : "";
    }
    /** "en 3 días", "HOY", "MAÑANA", "hace 2 días"; "" si no hay fecha. */
    function rsvCuando(dia) {
      if (!dia) return "";
      const n = SersaleBase.diasEntre(SersaleBase.hoy(), dia);
      if (isNaN(n)) return "";
      if (n === 0) return "HOY";
      if (n === 1) return "MAÑANA";
      if (n > 1) return "en " + n + " días";
      return n === -1 ? "ayer" : "hace " + -n + " días";
    }
    /** Fechas de retiro típicas de las fiestas que vienen: [{ dia, texto }]. */
    function rsvFechasFiestas() {
      const hoy = SersaleBase.hoy();
      let anio = Number(hoy.slice(0, 4));
      if (hoy > anio + "-12-31") anio += 1;
      return ["12-23", "12-24", "12-30", "12-31"]
        .map(md => ({ dia: anio + "-" + md, texto: md.slice(3) + "/" + md.slice(0, 2) }))
        .filter(f => f.dia >= hoy);
    }

    const RSV_CAMPO = { width:"100%", padding:"12px 14px", borderRadius:12, border:"1.5px solid #D8DCE0", fontSize:16, background:"#fff", outline:"none", boxSizing:"border-box" };
    const RSV_ETIQUETA = { display:"block", fontWeight:600, fontSize:13, color:"#3A424A", margin:"14px 0 6px" };

    // ── Formulario (alta y edición) ──
    function ReservaForm({ reserva, clientes, onCerrar, onGuardada }) {
      const nueva = !reserva || !reserva.id;
      const catalogo = getProductos() || {};
      const enCatalogo = it => Object.keys(catalogo).some(cat => (catalogo[cat] || []).includes(it));
      const itemInicial = reserva && reserva.item ? reserva.item : "";
      const esConocido = it => RSV_ITEMS_FIESTAS.includes(it) || enCatalogo(it);

      const [fechaReserva, setFechaReserva] = useState((reserva && reserva.fechaReserva) || SersaleBase.hoy());
      const [cliente, setCliente] = useState((reserva && reserva.cliente) || "");
      const [contacto, setContacto] = useState((reserva && reserva.contacto) || "");
      const [itemSel, setItemSel] = useState(itemInicial === "" ? "" : esConocido(itemInicial) ? itemInicial : RSV_OTRO);
      const [itemLibre, setItemLibre] = useState(itemInicial !== "" && !esConocido(itemInicial) ? itemInicial : "");
      const [kg, setKg] = useState(reserva && reserva.kg != null ? String(reserva.kg) : "");
      const [precioKg, setPrecioKg] = useState(reserva && reserva.precioKg != null ? String(reserva.precioKg) : "");
      const [sena, setSena] = useState(reserva && Number(reserva.sena) > 0 ? String(reserva.sena) : "");
      const [fechaRetiro, setFechaRetiro] = useState((reserva && reserva.fechaRetiro) || "");
      const [obs, setObs] = useState((reserva && reserva.obs) || "");

      const item = itemSel === RSV_OTRO ? itemLibre.trim() : itemSel;
      const borrador = { kg: SersaleBase.numero(kg), precioKg: SersaleBase.numero(precioKg), sena: SersaleBase.numero(sena) };
      const total = rsvTotal(borrador), resta = rsvResta(borrador);

      function datos() {
        const falta = m => { SersaleUI.toast(m, { tipo: "error" }); return null; };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaReserva)) return falta("Poné la fecha del pedido.");
        if (!cliente.trim()) return falta("Escribí el nombre del cliente.");
        if (!item) return falta(itemSel === RSV_OTRO ? "Escribí qué reserva." : "Elegí qué reserva.");
        if (!(borrador.kg > 0)) return falta("Poné cuántos kilos necesita.");
        if (fechaRetiro && fechaRetiro < fechaReserva) return falta("La fecha de retiro no puede ser anterior a la del pedido.");
        if (total != null && borrador.sena > total) return falta("La seña es mayor que el total de la reserva. Revisá los importes.");
        return {
          fechaReserva,
          cliente: cliente.trim().replace(/\s+/g, " "),
          contacto: contacto.trim(),
          item,
          kg: SersaleBase.redondear(borrador.kg, 3),
          precioKg: borrador.precioKg > 0 ? SersaleBase.redondear(borrador.precioKg, 2) : null,
          sena: SersaleBase.redondear(borrador.sena, 2),
          fechaRetiro: fechaRetiro || "",
          obs: obs.trim(),
        };
      }

      const [guardar, guardando] = SersaleBase.useAccion(async (otroItem) => {
        const d = datos();
        if (!d) return;
        try {
          const { db, collection, addDoc, doc, updateDoc } = fb();
          const ahora = new Date().toISOString();
          if (nueva) {
            await addDoc(collection(db, "reservas"), { ...d, estado: "pendiente", creadoEn: ahora, creadoPor: sessionStorage.getItem("sersale_usuario") || "" });
          } else {
            await updateDoc(doc(db, "reservas", reserva.id), { ...d, actualizadoEn: ahora });
          }
          SersaleUI.toast(nueva ? "Reserva guardada: " + d.cliente + " · " + d.item : "Reserva actualizada", { tipo: "ok" });
          if (otroItem === true) {
            // Mismo cliente, otro ítem: queda el nombre, el contacto y las fechas.
            setItemSel(""); setItemLibre(""); setKg(""); setPrecioKg(""); setSena(""); setObs("");
            if (onGuardada) onGuardada(false);
          } else if (onGuardada) onGuardada(true);
        } catch (e) {
          console.error(e);
          SersaleUI.toast(e && e.code === "permission-denied"
            ? "La base de datos no permite guardar reservas. Avisá para que se habilite."
            : "No se pudo guardar la reserva. Probá de nuevo.", { tipo: "error" });
        }
      });

      const fiestas = rsvFechasFiestas();
      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={onCerrar} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:"4px 8px 4px 0",minHeight:44}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>{nueva ? "Nueva reserva" : "Editar reserva"}</div>
          </div>
          <div style={{padding:"6px 20px 24px"}}>
            <label style={RSV_ETIQUETA} htmlFor="rsv-fecha">Fecha del pedido</label>
            <input id="rsv-fecha" type="date" style={RSV_CAMPO} value={fechaReserva} onChange={e=>setFechaReserva(e.target.value)} />

            <label style={RSV_ETIQUETA} htmlFor="rsv-cliente">Nombre del cliente</label>
            <input id="rsv-cliente" style={RSV_CAMPO} list="rsv-clientes" placeholder="Nombre y apellido" autoComplete="off" autoCapitalize="words"
              value={cliente} onChange={e=>setCliente(e.target.value)} />
            <datalist id="rsv-clientes">{(clientes || []).map(n => <option key={n} value={n} />)}</datalist>

            <label style={RSV_ETIQUETA} htmlFor="rsv-contacto">Datos de contacto</label>
            <textarea id="rsv-contacto" style={{...RSV_CAMPO, minHeight:64, resize:"vertical", fontFamily:"inherit"}} placeholder="Teléfono, dirección, quién retira…"
              value={contacto} onChange={e=>setContacto(e.target.value)} />

            <label style={RSV_ETIQUETA} htmlFor="rsv-item">Qué reserva</label>
            <select id="rsv-item" style={RSV_CAMPO} value={itemSel} onChange={e=>setItemSel(e.target.value)}>
              <option value="">Elegir…</option>
              <optgroup label="Fiestas">
                {RSV_ITEMS_FIESTAS.map(it => <option key={it} value={it}>{it}</option>)}
              </optgroup>
              {Object.keys(catalogo).filter(cat => (catalogo[cat] || []).length > 0).map(cat => (
                <optgroup key={cat} label={cat}>
                  {catalogo[cat].map(it => <option key={cat + "|" + it} value={it}>{it}</option>)}
                </optgroup>
              ))}
              <option value={RSV_OTRO}>Otro (escribir)…</option>
            </select>
            {itemSel === RSV_OTRO && (
              <input style={{...RSV_CAMPO, marginTop:8}} placeholder="Escribí qué reserva" aria-label="Otro ítem" autoCapitalize="sentences"
                value={itemLibre} onChange={e=>setItemLibre(e.target.value)} />
            )}

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <label style={RSV_ETIQUETA}>Kilos</label>
                <SersaleBase.InputDecimal style={RSV_CAMPO} placeholder="Ej: 10,5" aria-label="Kilos" value={kg} onChange={e=>setKg(e.target.value)} />
              </div>
              <div>
                <label style={RSV_ETIQUETA}>Precio por kg</label>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#A3ABB3",fontSize:16}}>$</span>
                  <InputMonto style={{...RSV_CAMPO, paddingLeft:26}} placeholder="A convenir" aria-label="Precio por kg" value={precioKg} onChange={v=>setPrecioKg(v)} />
                </div>
              </div>
            </div>
            {total != null && (
              <div style={{marginTop:8,fontSize:13,color:"#5C666F"}}>Total estimado: <strong style={{color:"#191E23"}}>{SersaleBase.fmtMonto(total)}</strong></div>
            )}

            <label style={RSV_ETIQUETA}>Seña</label>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <div style={{position:"relative",flex:1}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#A3ABB3",fontSize:16}}>$</span>
                <InputMonto style={{...RSV_CAMPO, paddingLeft:26}} placeholder="0" aria-label="Seña" value={sena} onChange={v=>setSena(v)} />
              </div>
              <button type="button" onClick={()=>setSena("")} aria-pressed={!(borrador.sena > 0)}
                style={{minHeight:46,padding:"0 14px",borderRadius:12,border:"1.5px solid " + (borrador.sena > 0 ? "#D8DCE0" : "#A8702A"),background:borrador.sena > 0 ? "#fff" : "#F0E7D9",color:borrador.sena > 0 ? "#5C666F" : "#784212",fontWeight:600,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>
                Sin seña
              </button>
            </div>
            {resta != null && borrador.sena > 0 && (
              <div style={{marginTop:8,fontSize:13,color:"#5C666F"}}>Resta cobrar al retirar: <strong style={{color:"#191E23"}}>{SersaleBase.fmtMonto(resta)}</strong></div>
            )}

            <label style={RSV_ETIQUETA} htmlFor="rsv-retiro">Fecha de retiro</label>
            <input id="rsv-retiro" type="date" style={RSV_CAMPO} value={fechaRetiro} min={fechaReserva || undefined} onChange={e=>setFechaRetiro(e.target.value)} />
            {fiestas.length > 0 && (
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                {fiestas.map(f => (
                  <button key={f.dia} type="button" onClick={()=>setFechaRetiro(f.dia)}
                    style={{minHeight:40,padding:"0 14px",borderRadius:20,border:"1.5px solid " + (fechaRetiro === f.dia ? "#A4232A" : "#D8DCE0"),background:fechaRetiro === f.dia ? "#A4232A" : "#fff",color:fechaRetiro === f.dia ? "#fff" : "#3A424A",fontWeight:600,fontSize:13,cursor:"pointer"}}>
                    {f.texto}
                  </button>
                ))}
                {fechaRetiro && (
                  <button type="button" onClick={()=>setFechaRetiro("")}
                    style={{minHeight:40,padding:"0 12px",borderRadius:20,border:"none",background:"transparent",color:"#79828B",fontSize:13,cursor:"pointer",textDecoration:"underline"}}>
                    A confirmar
                  </button>
                )}
              </div>
            )}

            <label style={RSV_ETIQUETA} htmlFor="rsv-obs">Observaciones (opcional)</label>
            <input id="rsv-obs" style={RSV_CAMPO} placeholder="Ej: lo quiere deshuesado" value={obs} onChange={e=>setObs(e.target.value)} />

            <button disabled={guardando} onClick={()=>guardar(false)}
              style={{width:"100%",minHeight:52,marginTop:22,borderRadius:14,border:"none",background:guardando?"#A3ABB3":"#A4232A",color:"#fff",fontWeight:700,fontSize:16,cursor:"pointer"}}>
              {guardando ? "Guardando..." : nueva ? "✓ Guardar reserva" : "✓ Guardar cambios"}
            </button>
            {nueva && (
              <button disabled={guardando} onClick={()=>guardar(true)}
                style={{width:"100%",minHeight:48,marginTop:10,borderRadius:14,border:"1.5px solid #2A333B",background:"#fff",color:"#2A333B",fontWeight:600,fontSize:14,cursor:"pointer"}}>
                Guardar y cargar otro ítem de este cliente
              </button>
            )}
          </div>
        </div>
      );
    }

    // ── Tarjeta de una reserva ──
    function ReservaTarjeta({ r, orden, onEditar, onEstado, onEliminar, ocupado }) {
      const total = rsvTotal(r), resta = rsvResta(r);
      const sena = Number(r.sena) || 0;
      const entregada = r.estado === "entregada";
      const cuando = entregada ? "" : rsvCuando(r.fechaRetiro);
      const urgente = cuando === "HOY" || cuando === "MAÑANA";
      const vencida = !entregada && r.fechaRetiro && r.fechaRetiro < SersaleBase.hoy();
      const wa = rsvWhatsApp(r.contacto), tel = rsvTelefono(r.contacto);
      const dato = { fontFamily:"'IBM Plex Mono',ui-monospace,monospace", fontVariantNumeric:"tabular-nums" };
      const accion = { minHeight:44, padding:"0 12px", borderRadius:12, fontWeight:600, fontSize:13, cursor:"pointer" };
      return (
        <div data-reserva={r.id} style={{background:"#fff",borderRadius:14,border:"1px solid #D8DCE0",borderLeft:"4px solid " + (entregada ? "#2F6B4F" : vencida ? "#A8702A" : "#A4232A"),padding:"14px 14px 12px",marginBottom:12,opacity:entregada?0.82:1}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <span style={{...dato,flexShrink:0,minWidth:30,textAlign:"center",padding:"4px 6px",borderRadius:8,background:"#EDEEF0",color:"#3A424A",fontSize:12,fontWeight:600}}>{orden}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:800,fontSize:16,color:"#191E23",overflowWrap:"anywhere"}}>{r.cliente}</div>
              <div style={{fontSize:15,color:"#191E23",marginTop:3,overflowWrap:"anywhere"}}>
                <strong>{r.item}</strong> · <span style={dato}>{rsvKg(r.kg)}</span>
              </div>
            </div>
            {entregada && <span className="badge" style={{background:"#DDEBE3",color:"#2F6B4F",flexShrink:0}}>ENTREGADA</span>}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 12px",marginTop:10,fontSize:13,color:"#3A424A"}}>
            <div>Reservó: <strong style={dato}>{SersaleBase.fmtFecha(r.fechaReserva) || "—"}</strong></div>
            <div>
              Retira: {r.fechaRetiro ? <strong style={dato}>{SersaleBase.fmtFecha(r.fechaRetiro)}</strong> : <strong>a confirmar</strong>}
              {cuando && <span style={{display:"inline-block",whiteSpace:"nowrap",marginLeft:6,padding:"1px 7px",borderRadius:10,fontSize:11,fontWeight:700,background:urgente?"#A4232A":vencida?"#F0E7D9":"#EDEEF0",color:urgente?"#fff":vencida?"#784212":"#5C666F"}}>{cuando}</span>}
            </div>
            <div>Precio: {r.precioKg ? <strong style={dato}>{SersaleBase.fmtMonto(r.precioKg)}/kg</strong> : <strong>a convenir</strong>}</div>
            <div>Total: <strong style={dato}>{total != null ? SersaleBase.fmtMonto(total) : "—"}</strong></div>
            <div>
              {sena > 0
                ? <span>Seña: <strong style={{...dato,color:"#2F6B4F"}}>{SersaleBase.fmtMonto(sena)}</strong></span>
                : <span style={{padding:"1px 8px",borderRadius:10,background:"#F0E7D9",color:"#784212",fontWeight:700,fontSize:12}}>Sin seña</span>}
            </div>
            <div>{resta != null ? <span>Resta: <strong style={dato}>{SersaleBase.fmtMonto(resta)}</strong></span> : null}</div>
          </div>

          {(r.contacto || r.obs) && (
            <div style={{marginTop:10,padding:"8px 10px",background:"#F7F8F9",borderRadius:10,fontSize:13,color:"#3A424A",whiteSpace:"pre-line",overflowWrap:"anywhere"}}>
              {r.contacto && <div>📞 {r.contacto}</div>}
              {r.obs && <div style={{marginTop:r.contacto?4:0,color:"#5C666F"}}>📝 {r.obs}</div>}
            </div>
          )}

          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
            {entregada
              ? <button disabled={ocupado} onClick={()=>onEstado(r, "pendiente")} style={{...accion,border:"1.5px solid #D8DCE0",background:"#fff",color:"#3A424A"}}>↩ Volver a pendiente</button>
              : <button disabled={ocupado} onClick={()=>onEstado(r, "entregada")} style={{...accion,flex:1,border:"none",background:"#2F6B4F",color:"#fff"}}>✓ Entregada</button>}
            {wa && <a href={SersaleBase.waLink("", wa)} target="_blank" rel="noopener" aria-label={"WhatsApp a " + r.cliente} style={{...accion,display:"inline-flex",alignItems:"center",textDecoration:"none",border:"1.5px solid #2F6B4F",background:"#fff",color:"#2F6B4F"}}>WhatsApp</a>}
            {tel && <a href={"tel:" + tel} aria-label={"Llamar a " + r.cliente} style={{...accion,display:"inline-flex",alignItems:"center",textDecoration:"none",border:"1.5px solid #26536E",background:"#fff",color:"#26536E"}}>Llamar</a>}
            <button disabled={ocupado} onClick={()=>onEditar(r)} style={{...accion,border:"1.5px solid #2A333B",background:"#fff",color:"#2A333B"}}>Editar</button>
            <button disabled={ocupado} onClick={()=>onEliminar(r)} aria-label={"Eliminar la reserva de " + r.cliente} style={{...accion,border:"1.5px solid #C33039",background:"#fff",color:"#C33039"}}>🗑</button>
          </div>
        </div>
      );
    }

    // ── Pantalla de reservas ──
    function Reservas({ onBack }) {
      const [reservas, setReservas] = useState(null); // null = cargando
      const [error, setError] = useState(false);
      const [intento, setIntento] = useState(0);
      const [clientes, setClientes] = useState([]);
      const [form, setForm] = useState(null); // null | {} (nueva) | reserva (editar)
      const [ver, setVer] = useState("pendiente"); // pendiente | entregada | todas
      const [orden, setOrden] = useState(() => (sessionStorage.getItem("sersale_rsv_orden") === "retiro" ? "retiro" : "reserva"));
      const [buscar, setBuscar] = useState("");

      // La lista se mantiene al día sola (también con lo que carga otro teléfono).
      useEffect(() => {
        let cortar = null, vivo = true;
        function escuchar() {
          const { db, collection, onSnapshot } = fb();
          cortar = onSnapshot(collection(db, "reservas"),
            snap => { if (!vivo) return; setError(false); setReservas(snap.docs.map(d => ({ id: d.id, ...d.data() }))); },
            e => { console.error(e); if (vivo) setError(true); });
        }
        if (window.__fbReady) escuchar(); else document.addEventListener("fbReady", escuchar, { once: true });
        return () => { vivo = false; document.removeEventListener("fbReady", escuchar); if (cortar) cortar(); };
      }, [intento]);

      // Nombres de clientes ya cargados, para sugerirlos al escribir.
      useEffect(() => {
        let vivo = true;
        async function traer() {
          try {
            const { db, collection, getDocs } = fb();
            const snap = await getDocs(collection(db, "clientes"));
            if (vivo) setClientes([...new Set(snap.docs.map(d => (d.data().nombre || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")));
          } catch (e) { /* las sugerencias son opcionales */ }
        }
        if (window.__fbReady) traer(); else document.addEventListener("fbReady", traer, { once: true });
        return () => { vivo = false; document.removeEventListener("fbReady", traer); };
      }, []);

      // El gesto "atrás" del teléfono cierra el formulario en vez de salir de Reservas.
      SersaleBase.useAtras(!!form, () => setForm(null));

      function elegirOrden(o) { setOrden(o); try { sessionStorage.setItem("sersale_rsv_orden", o); } catch (e) {} }

      const [cambiarEstado, cambiando] = SersaleBase.useAccion(async (r, estado) => {
        if (estado === "entregada") {
          const resta = rsvResta(r);
          const ok = await SersaleUI.confirmar({
            titulo: "Marcar como entregada",
            cuerpo: r.cliente + " · " + r.item + " · " + rsvKg(r.kg) + (resta != null && resta > 0 ? "\nResta cobrar: " + SersaleBase.fmtMonto(resta) : ""),
            aceptar: "Entregada",
          });
          if (!ok) return;
        }
        try {
          const { db, doc, updateDoc } = fb();
          const ahora = new Date().toISOString();
          await updateDoc(doc(db, "reservas", r.id), estado === "entregada" ? { estado, entregadaEn: ahora, actualizadoEn: ahora } : { estado, actualizadoEn: ahora });
          SersaleUI.toast(estado === "entregada" ? "Entregada: " + r.cliente : "Vuelve a pendientes: " + r.cliente, { tipo: "ok" });
        } catch (e) {
          console.error(e);
          SersaleUI.toast("No se pudo guardar el cambio. Probá de nuevo.", { tipo: "error" });
        }
      });

      const [eliminar, eliminando] = SersaleBase.useAccion(async (r) => {
        const sena = Number(r.sena) || 0;
        const ok = await SersaleUI.confirmar({
          titulo: "Eliminar reserva",
          cuerpo: r.cliente + " · " + r.item + " · " + rsvKg(r.kg) + (sena > 0 ? "\nOjo: dejó una seña de " + SersaleBase.fmtMonto(sena) + "." : "") + "\nNo se puede deshacer.",
          aceptar: "Eliminar",
          peligro: true,
        });
        if (!ok) return;
        try {
          const { db, doc, deleteDoc } = fb();
          await deleteDoc(doc(db, "reservas", r.id));
          SersaleUI.toast("Reserva eliminada", { tipo: "ok" });
        } catch (e) {
          console.error(e);
          SersaleUI.toast("No se pudo eliminar. Probá de nuevo.", { tipo: "error" });
        }
      });

      if (form) {
        return <ReservaForm key={form.id || "nueva"} reserva={form} clientes={clientes} onCerrar={()=>setForm(null)} onGuardada={cerrar => { if (cerrar) setForm(null); }} />;
      }

      const todas = reservas || [];
      const pendientes = todas.filter(r => r.estado !== "entregada");
      const entregadas = todas.filter(r => r.estado === "entregada");
      // El número de cada reserva es su lugar en el orden de reserva entre las pendientes.
      const lugar = {};
      rsvOrdenar(pendientes, "reserva").forEach((r, i) => { lugar[r.id] = i + 1; });
      const base = ver === "pendiente" ? pendientes : ver === "entregada" ? entregadas : todas;
      const visibles = rsvOrdenar(base, orden).filter(r => !buscar.trim() || SersaleBase.coincide([r.cliente, r.item, r.contacto].join(" "), buscar));

      // Resumen de lo pendiente: cuánto hay que tener de cada cosa.
      const porItem = {};
      pendientes.forEach(r => {
        const k = r.item || "(sin ítem)";
        if (!porItem[k]) porItem[k] = { item: k, cantidad: 0, kg: 0 };
        porItem[k].cantidad += 1;
        porItem[k].kg += Number(r.kg) || 0;
      });
      const resumen = Object.values(porItem).sort((a, b) => b.kg - a.kg);
      const totalKg = pendientes.reduce((s, r) => s + (Number(r.kg) || 0), 0);
      const totalSenas = pendientes.reduce((s, r) => s + (Number(r.sena) || 0), 0);
      const totalResta = pendientes.reduce((s, r) => s + Math.max(0, rsvResta(r) || 0), 0);

      const chip = activo => ({ minHeight:40, padding:"0 14px", borderRadius:20, border:"1.5px solid " + (activo ? "#A4232A" : "#D8DCE0"), background:activo ? "#A4232A" : "#fff", color:activo ? "#fff" : "#3A424A", fontWeight:600, fontSize:13, cursor:"pointer", whiteSpace:"nowrap" });
      const dato = { fontFamily:"'IBM Plex Mono',ui-monospace,monospace", fontVariantNumeric:"tabular-nums" };

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"14px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={onBack} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:"4px 8px 4px 0",minHeight:44}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Reservas fin de año</div>
            <button onClick={()=>setForm({})} style={{minHeight:40,padding:"0 14px",borderRadius:10,border:"1px solid rgba(239,234,225,0.3)",background:"rgba(239,234,225,0.12)",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>+ Nueva</button>
          </div>

          <div style={{padding:"16px 16px 24px"}}>
            {error && (
              <div style={{textAlign:"center",padding:"30px 16px",background:"#fff",borderRadius:14,border:"1px solid #D8DCE0"}}>
                <p style={{fontWeight:700,fontSize:15,marginBottom:6}}>No se pudieron cargar las reservas</p>
                <p style={{fontSize:13,color:"#5C666F",marginBottom:14}}>{navigator.onLine === false ? "No hay conexión." : "Puede ser la señal."}</p>
                <button onClick={()=>{ setError(false); setReservas(null); setIntento(n => n + 1); }} style={{minHeight:44,padding:"0 20px",borderRadius:12,border:"none",background:"#2A333B",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Reintentar</button>
              </div>
            )}

            {!error && reservas === null && <p style={{textAlign:"center",color:"#79828B",padding:"40px 0"}}>Cargando reservas…</p>}

            {!error && reservas !== null && (
              <>
                {pendientes.length > 0 && (
                  <div style={{background:"#fff",borderRadius:14,border:"1px solid #D8DCE0",padding:"12px 14px",marginBottom:14}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:8,textAlign:"center"}}>
                      <div><div style={{...dato,fontWeight:700,fontSize:18,color:"#191E23"}}>{pendientes.length}</div><div style={{fontSize:11,color:"#79828B"}}>pendientes</div></div>
                      <div><div style={{...dato,fontWeight:700,fontSize:18,color:"#191E23"}}>{SersaleBase.fmtNumero(totalKg, 1)}</div><div style={{fontSize:11,color:"#79828B"}}>kg reservados</div></div>
                      <div><div style={{...dato,fontWeight:700,fontSize:18,color:"#2F6B4F"}}>{SersaleBase.fmtMonto(totalSenas)}</div><div style={{fontSize:11,color:"#79828B"}}>en señas</div></div>
                    </div>
                    <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #EDEEF0"}}>
                      <div style={{fontSize:11,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:"#79828B",marginBottom:6}}>Qué hay que tener</div>
                      {resumen.map(x => (
                        <div key={x.item} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:13,padding:"3px 0",color:"#191E23"}}>
                          <span style={{overflowWrap:"anywhere"}}>{x.item} <span style={{color:"#79828B"}}>× {x.cantidad}</span></span>
                          <strong style={{...dato,flexShrink:0}}>{rsvKg(x.kg)}</strong>
                        </div>
                      ))}
                      {totalResta > 0 && <div style={{marginTop:6,fontSize:12,color:"#5C666F"}}>Resta cobrar al entregar: <strong style={dato}>{SersaleBase.fmtMonto(totalResta)}</strong></div>}
                    </div>
                  </div>
                )}

                <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginBottom:8,WebkitOverflowScrolling:"touch"}}>
                  <button onClick={()=>setVer("pendiente")} style={chip(ver==="pendiente")}>Pendientes ({pendientes.length})</button>
                  <button onClick={()=>setVer("entregada")} style={chip(ver==="entregada")}>Entregadas ({entregadas.length})</button>
                  <button onClick={()=>setVer("todas")} style={chip(ver==="todas")}>Todas ({todas.length})</button>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                  <span style={{fontSize:12,color:"#79828B"}}>Ordenar por fecha de</span>
                  <button onClick={()=>elegirOrden("reserva")} aria-pressed={orden==="reserva"} style={{...chip(orden==="reserva"),minHeight:36,background:orden==="reserva"?"#2A333B":"#fff",borderColor:orden==="reserva"?"#2A333B":"#D8DCE0"}}>Reserva</button>
                  <button onClick={()=>elegirOrden("retiro")} aria-pressed={orden==="retiro"} style={{...chip(orden==="retiro"),minHeight:36,background:orden==="retiro"?"#2A333B":"#fff",borderColor:orden==="retiro"?"#2A333B":"#D8DCE0"}}>Retiro</button>
                </div>
                {todas.length > 6 && (
                  <input style={{...RSV_CAMPO, marginBottom:12}} placeholder="🔍 Buscar por cliente, ítem o contacto" aria-label="Buscar reserva" value={buscar} onChange={e=>setBuscar(e.target.value)} />
                )}

                {visibles.length === 0 && (
                  <div style={{textAlign:"center",padding:"36px 16px",color:"#79828B"}}>
                    {todas.length === 0 ? (
                      <>
                        <p style={{fontWeight:700,fontSize:15,color:"#3A424A",marginBottom:6}}>Todavía no hay reservas</p>
                        <p style={{fontSize:13,marginBottom:16}}>Anotá acá lo que los clientes dejan reservado para las fiestas.</p>
                        <button onClick={()=>setForm({})} style={{minHeight:48,padding:"0 22px",borderRadius:14,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>+ Nueva reserva</button>
                      </>
                    ) : buscar.trim() ? "Ninguna reserva coincide con la búsqueda." : ver === "pendiente" ? "No quedan reservas pendientes." : "Todavía no se entregó ninguna reserva."}
                  </div>
                )}

                {visibles.map(r => (
                  <ReservaTarjeta key={r.id} r={r} orden={r.estado === "entregada" ? "✓" : "#" + (lugar[r.id] || "")}
                    ocupado={cambiando || eliminando}
                    onEditar={x=>setForm(x)} onEstado={cambiarEstado} onEliminar={eliminar} />
                ))}
              </>
            )}
          </div>
        </div>
      );
    }

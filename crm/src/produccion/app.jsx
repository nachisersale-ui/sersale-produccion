    const { useState, useEffect, useCallback } = React;

    const AREAS = {
      cocidos: { label:"Cocidos", color:"#A4232A", light:"#EEDADB", icon:"🍖",
        productos:["Jamón Cocido Natural Sublime","Jamón Cocido Especial Bajo Sodio","Jamón Cocido de Pata","Fiambre Cocido de Paleta de Cerdo","Fiambre de Cerdo p/ Emparedados"] },
      crudos: { label:"Jamones Crudos y Bondiolas", color:"#7E1A20", light:"#E4C4C5", icon:"🦴",
        productos:["Jamón Crudo c/ Hueso 12 Meses","Jamón Crudo Entero Listo s/ Hueso","Jamón Crudo Listo por 1/2 Punta","Jamón Crudo Listo por 1/2 Garrón","Bondiola Seca al Papel","Bondiola Seca Serrana"] },
      secos: { label:"Secos", color:"#784212", light:"#E7D8BC", icon:"🥩",
        productos:["Salamín Picado Fino","Salamín Picado Grueso","Sopresatta de Cerdo","Chorizo Tipo Candelario","Chorizo Tipo Cantimpalo","Longaniza Tipo Española","Longaniza Tipo Calabresa","Longaniza T/ Calabresa Bastón","Salame Tipo Milán","Salame Tipo Español","Salame Chacarero de Campo"] },
      frescos: { label:"Frescos", color:"#1E4257", light:"#DCE5EB", icon:"🌿",
        productos:["Chorizo Puro Cerdo","Chorizo Especial Vacuno/Cerdo","Chorizo Bombón","Chorizo Bombón Puro Cerdo","Morcilla Criolla","Morcilla Criolla Rosca","Morcilla Criolla Bombón","Morcilla Vasca","Salchicha Fresca Parrillera"] },
      ahumados: { label:"Ahumados", color:"#24523D", light:"#DDE9E2", icon:"🔥",
        productos:["Panceta Ahumada","Panceta Salada","Lomo Ahumado","Lomo Tipo Suizo","Salchichas de Viena","Salchichas de Copetin"] },
      pastas: { label:"Pastas Finas", color:"#6C3483", light:"#E8DAEF", icon:"🍽️",
        productos:["Mortadela Bocha","Mortadela Bologna","Mortadela Familiar","Salchichón c/ Jamón","Salchichón Primavera","Salchichón c/ Jamón Familiar","Salchichón Primavera Familiar"] },
    };

    const UNIDADES = ["kg","piezas","ganchos","bolsas","unidades"];
    const CATEGORIAS_STOCK = ["Cocidos","Jamones Crudos","Secos","Frescos","Ahumados","Pastas","Materia Prima","Insumos","Otro"];
    // Fechas y horas siempre en hora de Buenos Aires (SersaleBase), no en UTC.
    const fmt  = iso => SersaleBase.fmtFecha(iso);
    const fmtH = iso => { const d = SersaleBase.aFecha(iso); return d ? d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit",timeZone:SersaleBase.ZONA}) : ""; };
    const fmtN = n => Math.round(n*100)/100;
    // Un reporte viejo o tocado a mano puede traer un área que ya no existe: se muestra igual.
    const areaDe = k => AREAS[k] || { label: k || "Sin área", color:"#5C666F", light:"#EDEEF0", icon:"📋", productos:[] };
    // Lo escrito en un campo numérico -> número (0 si está vacío o no es válido).
    const numCant = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
    const avisoError = (texto, e) => { if (e) console.error(e); SersaleUI.toast(texto, { tipo:"error" }); };
    const sinSenal = () => typeof navigator !== "undefined" && navigator.onLine === false;
    const msgNoGuardo = () => sinSenal() ? "Sin conexión: no se guardó. Probá de nuevo cuando vuelva la señal." : "No se pudo guardar. Probá de nuevo.";

    function getFirebase() { return { db: window.__db, ...window.__firebase }; }

    /* ── Stock: funciones compartidas por las dos vistas ── */
    async function leerStock() {
      const { db, collection, getDocs, query, orderBy } = getFirebase();
      const snap = await getDocs(query(collection(db,"stock_produccion"), orderBy("nombre")));
      return snap.docs.map(d=>({id:d.id,...d.data()}));
    }
    // Ítem de stock por nombre: primero idéntico; si no, sin mirar mayúsculas, acentos ni espacios de más.
    function buscarStock(lista, nombre) {
      return lista.find(s=>s.nombre===nombre) || lista.find(s=>SersaleBase.mismoNombre(s.nombre,nombre)) || null;
    }
    // Filas a medio completar de un formulario de productos: devuelve el mensaje, o "" si están bien.
    function filaIncompleta(filas, campo) {
      for (let i=0;i<filas.length;i++) {
        const nombre = String(filas[i][campo]||"").trim();
        const q = String(filas[i].cantidad==null?"":filas[i].cantidad).trim();
        if (!nombre && !q) continue;
        if (!nombre) return "Falta elegir el producto " + (i+1);
        if (!(parseFloat(q)>0)) return "Ingresá una cantidad mayor a 0 para " + nombre;
      }
      return "";
    }
    /* Cambia cantidades de stock dentro de una transacción: lee cada ítem en el
       servidor en ese momento, le suma su diferencia (sin bajar de 0) y, en la
       misma operación, deja que `escribir(tx, res)` agregue lo demás (reporte,
       movimientos). O se guarda todo o no se guarda nada.
       deltas: { idStock: diferencia }. Devuelve { idStock: { antes, despues, datos } | null si ya no existe }. */
    async function moverStock(deltas, escribir) {
      const { db, doc, runTransaction } = getFirebase();
      if (sinSenal()) throw new Error("sin conexión");
      const ids = Object.keys(deltas);
      return runTransaction(db, async tx => {
        const snaps = [];
        for (const id of ids) snaps.push(await tx.get(doc(db,"stock_produccion",id)));
        const res = {};
        snaps.forEach((s,i)=>{
          const id = ids[i];
          if (!s.exists()) { res[id] = null; return; }
          const antes = parseFloat(s.data().cantidad)||0;
          const despues = SersaleBase.redondear(Math.max(0, antes + deltas[id]), 3);
          res[id] = { antes, despues, datos: s.data() };
        });
        if (escribir) escribir(tx, res); // puede cortar todo con un throw antes de que se escriba nada
        ids.forEach(id=>{
          if (res[id] && deltas[id]) tx.update(doc(db,"stock_produccion",id), { cantidad: res[id].despues, updatedAt: new Date().toISOString() });
        });
        return res;
      });
    }
    // Ítems que con esta operación pasaron a estar en su mínimo o por debajo (no los que ya estaban).
    function cruzaronMinimo(res) {
      return Object.keys(res).filter(id=>res[id]).map(id=>({ ...res[id].datos, id, cantidad: res[id].despues, _antes: res[id].antes }))
        .filter(s=>{ const min = parseFloat(s.minimo)||0; return min>0 && s._antes>min && s.cantidad<=min; });
    }

    /* ── WHATSAPP NOTIFICACIONES ── */
    async function sendStockAlert(items) {
      try {
        const { db, doc, getDoc } = getFirebase();
        const cfgDoc = await getDoc(doc(db,"config","whatsapp"));
        if(!cfgDoc.exists()) return;
        const { phone, apikey } = cfgDoc.data();
        if(!phone||!apikey) return;
        const lista = items.map(s=>`⚠️ ${s.nombre}: ${fmtN(s.cantidad)} ${s.unidad} (mín. ${s.minimo})`).join("\n");
        const msg = `🔴 STOCK BAJO — Frigorífico Sersale\n${lista}\nFecha: ${SersaleBase.fmtFecha(SersaleBase.hoy())}`;
        // El texto se codifica una sola vez (antes los saltos de línea llegaban como "%0A" escrito).
        await fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(String(phone).trim())}&apikey=${encodeURIComponent(String(apikey).trim())}&text=${encodeURIComponent(msg)}`, { mode:"no-cors" });
      } catch(e){ console.error("Error WA notif:", e); }
    }

    /* ═══════════════════════════════════════════════════════
       VISTA ENCARGADO
    ═══════════════════════════════════════════════════════ */
    function VistaEncargado({ onSwitch }) {
      const [step, setStep] = useState("area");
      const [area, setArea] = useState(null);
      const [encargado, setEncargado] = useState("");
      const [items, setItems] = useState([{producto:"",cantidad:"",unidad:"kg",obs:""}]);
      const [obs, setObs] = useState("");
      const [enviado, setEnviado] = useState(false);
      const [enviadoData, setEnviadoData] = useState(null);

      const addItem = () => setItems([...items,{producto:"",cantidad:"",unidad:"kg",obs:""}]);
      const updItem = (i,f,v) => { const c=[...items]; c[i][f]=v; setItems(c); };
      const remItem = i => setItems(items.filter((_,idx)=>idx!==i));

      const [enviar, enviando] = SersaleBase.useAccion(async () => {
        if (!encargado.trim()) return avisoError("Ingresá tu nombre");
        const incompleta = filaIncompleta(items, "producto");
        if (incompleta) return avisoError(incompleta);
        const val = items.filter(it=>it.producto&&it.cantidad);
        if (!val.length) return avisoError("Agregá al menos un producto con cantidad");
        try {
          const { db, collection, doc, Timestamp } = getFirebase();
          const rep = { area, encargado: encargado.trim(), fecha: Timestamp.now(), fechaISO: new Date().toISOString(), items: val, obs: obs.trim() };
          const repRef = doc(collection(db,"reportes"));

          // Suman al stock las filas cargadas en "piezas" (regla de siempre). El reporte, el
          // stock y los movimientos se guardan juntos: si algo falla no queda nada a medias
          // y se puede volver a enviar sin duplicar.
          const piezasItems = val.filter(it=>it.unidad==="piezas"&&it.producto!=="Otro"&&numCant(it.cantidad)>0);
          const stock = piezasItems.length ? await leerStock() : [];
          const filas = [], deltas = {}, sinMatch = [];
          for (const it of piezasItems) {
            const s = buscarStock(stock, it.producto);
            if (!s) { console.warn("[Stock] Sin coincidencia en stock_produccion para:", it.producto); sinMatch.push(it.producto); continue; }
            deltas[s.id] = (deltas[s.id]||0) + numCant(it.cantidad);
            filas.push({ s, cant: numCant(it.cantidad) });
          }
          const hoy = SersaleBase.hoy(), ahora = new Date().toISOString();
          const res = await moverStock(deltas, (tx, res) => {
            tx.set(repRef, rep);
            filas.forEach(f=>{
              if (!res[f.s.id]) return; // lo borraron recién: se avisa abajo
              tx.set(doc(collection(db,"stock_movimientos")), {
                stockId: f.s.id, nombre: f.s.nombre,
                tipo: "entrada", subtipo: "produccion",
                cantidad: f.cant, unidad: "piezas",
                ref: repRef.id, encargado: encargado.trim(),
                fecha: hoy,
                createdAt: ahora
              });
            });
          });
          const sinStock = sinMatch.concat(filas.filter(f=>!res[f.s.id]).map(f=>f.s.nombre));
          setEnviadoData(rep); setEnviado(true);
          if (sinStock.length) SersaleUI.aviso("El reporte se guardó, pero NO se pudo impactar el stock de:\n\n• "+sinStock.join("\n• ")+"\n\nEsos productos no figuran en Stock de Producción. Cargalos o corregí el nombre y ajustá el stock a mano.", { titulo:"Stock sin actualizar" });
        } catch(e) { avisoError(sinSenal() ? "Sin conexión: el reporte no se envió. Probá de nuevo cuando vuelva la señal." : "No se pudo enviar el reporte. Probá de nuevo.", e); }
      });

      // Al cambiar de área, lo elegido en la otra no puede quedar escondido en el formulario.
      function elegirArea(key) {
        if (key !== area) setItems(items.map(it=>(it.producto && it.producto!=="Otro" && !AREAS[key].productos.includes(it.producto)) ? {...it, producto:""} : it));
        setArea(key); setStep("form");
      }

      function nuevo() {
        setStep("area"); setArea(null); setEncargado("");
        setItems([{producto:"",cantidad:"",unidad:"kg",obs:""}]);
        setObs(""); setEnviado(false); setEnviadoData(null);
      }

      const A = area ? areaDe(area) : null;

      if (enviado && enviadoData) {
        const a = areaDe(enviadoData.area);
        return (
          <div style={{minHeight:"100vh",background:"#F2F3F5",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
            <div style={{background:"#fff",borderRadius:20,padding:32,textAlign:"center",width:"100%",maxWidth:400,boxShadow:"0 4px 20px rgba(0,0,0,0.1)"}}>
              <div style={{fontSize:64,marginBottom:12}}>✅</div>
              <h2 style={{margin:"0 0 6px",fontSize:22}}>¡Reporte enviado!</h2>
              <p style={{color:"#79828B",fontSize:14,margin:"0 0 2px"}}>{fmtH(enviadoData.fechaISO)} · {a.label}</p>
              <p style={{fontWeight:700,fontSize:16,margin:"4px 0 20px"}}>{enviadoData.encargado}</p>
              <div style={{background:"#F7F8F9",borderRadius:12,padding:16,textAlign:"left",marginBottom:20}}>
                {enviadoData.items.map((it,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #E4E7EA",fontSize:14}}>
                    <span style={{flex:1,paddingRight:8}}>{it.producto}</span>
                    <span style={{fontWeight:700,color:a.color,whiteSpace:"nowrap"}}>{it.cantidad} {it.unidad}</span>
                  </div>
                ))}
              </div>
              <button style={{width:"100%",padding:16,borderRadius:12,border:"none",background:a.color,color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}} onClick={nuevo}>
                + Nueva tanda
              </button>
            </div>
          </div>
        );
      }

      if (step === "area") return (
        <div style={{minHeight:"100vh",background:"#F2F3F5",maxWidth:"var(--app-max-w)",margin:"0 auto"}}>
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            <img src="assets/logo.png" alt="Sersale" style={{height:44,width:"auto",filter:"drop-shadow(0 1px 4px rgba(0,0,0,0.4))"}} />
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:16}}>Frigorífico Sersale</div>
              <div style={{fontSize:12,opacity:0.85}}>Reporte de Producción · {fmt(new Date().toISOString())}</div>
            </div>
            <button style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12}} onClick={onSwitch}>Vista Director</button>
          </div>
          <div style={{padding:20}}>
            <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,margin:"8px 0 14px"}}>Seleccioná tu área</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {Object.entries(AREAS).map(([key,a])=>(
                <button key={key} onClick={()=>elegirArea(key)}
                  style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"22px 12px",borderRadius:16,border:`2px solid ${a.color}`,background:a.light,cursor:"pointer"}}>
                  <span style={{fontSize:36}}>{a.icon}</span>
                  <span style={{fontWeight:700,fontSize:13,color:a.color,textAlign:"center",lineHeight:1.3}}>{a.label}</span>
                  <span style={{fontSize:11,color:"#79828B"}}>{a.productos.length} productos</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      );

      return (
        <div style={{minHeight:"100vh",background:"#F2F3F5",maxWidth:"var(--app-max-w)",margin:"0 auto"}}>
          <div style={{background:A.color,color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            <button onClick={()=>setStep("area")} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:15}}>{A.icon} {A.label}</div>
              <div style={{fontSize:12,opacity:0.85}}>Nueva tanda · {fmt(new Date().toISOString())}</div>
            </div>
            <button style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12}} onClick={onSwitch}>Director</button>
          </div>
          <div style={{padding:20}}>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Tu nombre</label>
            <input style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:16}}
              placeholder="Ej: Roberto Gómez" value={encargado} onChange={e=>setEncargado(e.target.value)} />
            <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,margin:"0 0 10px"}}>Productos producidos</p>
            {items.map((item,i)=>(
              <div key={i} style={{background:"#fff",borderRadius:12,border:`1.5px solid ${A.color}`,padding:14,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontWeight:600,color:A.color,fontSize:13}}>Producto {i+1}</span>
                  {items.length>1 && <button onClick={()=>remItem(i)} style={{background:"#fee",color:"#A4232A",border:"1px solid #fcc",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:12}}>✕</button>}
                </div>
                <select style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  value={item.producto} onChange={e=>updItem(i,"producto",e.target.value)}>
                  <option value="">— Seleccioná un producto —</option>
                  {A.productos.map(p=><option key={p} value={p}>{p}</option>)}
                  <option value="Otro">Otro (especificar en observaciones)</option>
                </select>
                <div style={{display:"flex",gap:8,marginTop:8}}>
                  <input style={{flex:1,padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                    type="number" inputMode="decimal" min="0" step="any" placeholder="Cantidad" value={item.cantidad} onChange={e=>updItem(i,"cantidad",e.target.value)} />
                  <select style={{width:120,padding:"12px 10px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                    value={item.unidad} onChange={e=>updItem(i,"unidad",e.target.value)}>
                    {UNIDADES.map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <input style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff",marginTop:8}}
                  placeholder="Observación opcional" value={item.obs} onChange={e=>updItem(i,"obs",e.target.value)} />
              </div>
            ))}
            <button onClick={addItem} style={{width:"100%",padding:12,borderRadius:10,border:`2px dashed ${A.color}`,background:"transparent",cursor:"pointer",fontWeight:600,fontSize:14,color:A.color,marginBottom:16}}>
              + Agregar otro producto
            </button>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Observaciones generales</label>
            <textarea style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",height:80,resize:"none"}}
              placeholder="Temperatura, incidencias, materia prima usada..." value={obs} onChange={e=>setObs(e.target.value)} />
            <button onClick={enviar} disabled={enviando}
              style={{width:"100%",padding:16,borderRadius:12,border:"none",background:enviando?"#A3ABB3":A.color,color:"#fff",fontWeight:700,fontSize:16,cursor:"pointer",marginTop:8}}>
              {enviando ? "Enviando..." : "✓ Enviar reporte"}
            </button>
          </div>
        </div>
      );
    }

    // ── CONFIG WHATSAPP ─────────────────────────────────────
    // Va fuera de VistaDirector: declarado adentro, React lo desmontaba y lo volvía a
    // montar en cada cambio de la pantalla (se cerraba el panel, se perdía lo escrito y
    // hacía una lectura a la base por cada tecla o toque).
    function ConfigWhatsApp() {
      const [cfg, setCfg] = React.useState(null);
      const [phone, setPhone] = React.useState("");
      const [apikey, setApikey] = React.useState("");
      const [open, setOpen] = React.useState(false);

      React.useEffect(()=>{
        async function load(){
          try {
            const { db, doc, getDoc } = getFirebase();
            const d = await getDoc(doc(db,"config","whatsapp"));
            if(d.exists()){ const data=d.data(); setPhone(data.phone||""); setApikey(data.apikey||""); setCfg(data); }
            else setCfg({});
          } catch(e){ console.error(e); setCfg({}); }
        }
        if(window.__fbReady) load(); else document.addEventListener("fbReady",load);
      },[]);

      const [guardar, saving] = SersaleBase.useAccion(async () => {
        try {
          const { db, doc, setDoc } = getFirebase();
          await setDoc(doc(db,"config","whatsapp"), { phone: phone.trim(), apikey: apikey.trim() });
          setCfg({ phone: phone.trim(), apikey: apikey.trim() });
          setOpen(false);
          SersaleUI.toast("Configuración guardada", { tipo:"ok" });
        } catch(e){ avisoError(msgNoGuardo(), e); }
      });

      if(cfg===null) return null;
      const activo = cfg.phone && cfg.apikey;
      return (
        <div style={{background: activo?"#E9F0EC":"#F3EEE2", border:`1.5px solid ${activo?"#2F6B4F":"#B5872F"}`, borderRadius:12, padding:12, marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontWeight:700,fontSize:13,color:activo?"#2F6B4F":"#A8702A"}}>
                {activo?"✅ WhatsApp activo":"⚙️ Alertas WhatsApp"}
              </div>
              <div style={{fontSize:11,color:"#79828B",marginTop:2}}>
                {activo?`Notificaciones a ${cfg.phone}`:"Configurá para recibir alertas de stock bajo"}
              </div>
            </div>
            <button onClick={()=>setOpen(!open)} style={{padding:"6px 12px",borderRadius:8,border:`1.5px solid ${activo?"#2F6B4F":"#B5872F"}`,background:"transparent",color:activo?"#2F6B4F":"#A8702A",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              {open?"✕":"✏️ Config"}
            </button>
          </div>
          {open && (
            <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid rgba(0,0,0,0.08)"}}>
              <div style={{fontSize:12,color:"#555",marginBottom:10,lineHeight:1.6,background:"#F7F8F9",padding:"8px 10px",borderRadius:8}}>
                <strong>Para activar:</strong><br/>
                1. Agregá a WhatsApp: <strong>+34 644 44 74 12</strong><br/>
                2. Enviá: <em>I allow callmebot to send me messages</em><br/>
                3. Te responden con tu API Key
              </div>
              <input style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:14,marginBottom:8,background:"#fff"}}
                inputMode="tel" autoComplete="off"
                placeholder="Número WhatsApp (ej: 5491112345678)" value={phone} onChange={e=>setPhone(e.target.value)} />
              <input style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:14,marginBottom:10,background:"#fff"}}
                autoComplete="off" autoCapitalize="off" autoCorrect="off"
                placeholder="API Key de CallMeBot" value={apikey} onChange={e=>setApikey(e.target.value)} />
              <button onClick={guardar} disabled={saving}
                style={{width:"100%",padding:12,borderRadius:10,border:"none",background:saving?"#A3ABB3":"#2F6B4F",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                {saving?"Guardando...":"✓ Guardar"}
              </button>
            </div>
          )}
        </div>
      );
    }

    /* ═══════════════════════════════════════════════════════
       VISTA DIRECTOR
    ═══════════════════════════════════════════════════════ */
    function VistaDirector({ onSwitch }) {
      const [tab, setTab] = useState("reportes");
      const [showReportModal, setShowReportModal] = useState(false);
      const [reportes, setReportes] = useState(null);
      const [filtroArea, setFiltroArea] = useState("todos");
      const [filtroFecha, setFiltroFecha] = useState(() => SersaleBase.hoy());
      const [expanded, setExpanded] = useState(null);
      const [editando, setEditando] = useState(null); // reporte en edición
      const pedidoReportes = React.useRef(0);              // para descartar respuestas viejas de cargar()
      const colaAjustes = React.useRef(Promise.resolve()); // los toques de +/− se aplican de a uno, en orden

      // Stock state
      const [stockItems, setStockItems] = useState(null);
      const [modalStock, setModalStock] = useState(false);
      const [editStock, setEditStock] = useState(null);
      const [stockForm, setStockForm] = useState({nombre:"",categoria:"Cocidos",cantidad:"",unidad:"kg",minimo:"",obs:""});
      const [filtroCategoria, setFiltroCategoria] = useState("todas");
      const [stockSubTab, setStockSubTab] = useState("items"); // "items" | "movimientos"
      const [modalSalida, setModalSalida] = useState(false);
      const [salidaForm, setSalidaForm] = useState({destino:"PP",tipo:"despacho",fecha:"",items:[{nombre:"",cantidad:"",unidad:"piezas"}],obs:""});
      const [movimientos, setMovimientos] = useState(null);

      // Faena state
      const [faenas, setFaenas] = useState(null);
      const [modalFaena, setModalFaena] = useState(false);
      const [editFaena, setEditFaena] = useState(null);
      const [faenaForm, setFaenaForm] = useState({fecha:"",tipo:"Cerdo",cantidad:"",pesoTotal:"",pesoPromedio:"",obs:""});
      const [filtroFaenaMes, setFiltroFaenaMes] = useState(() => SersaleBase.hoy().slice(0,7));

      // Trazabilidad state
      const [lotes, setLotes] = useState(null);
      const [modalLote, setModalLote] = useState(false);
      const [loteDetalle, setLoteDetalle] = useState(null);
      const [filtroLoteMes, setFiltroLoteMes] = useState(() => SersaleBase.hoy().slice(0,7));
      const [loteForm, setLoteForm] = useState({
        fechaElab:"", fechaVenc:"", operario:"",
        materiasPrimas:[{tipo:"cerdo",corte:"",proveedor:"",kg:""}],
        productos:[{nombre:"",cantidad:"",unidad:"piezas"}],
        obs:""
      });

      /* ── REPORTES ── */
      async function cargar() {
        const n = ++pedidoReportes.current;
        try {
          const { db, collection, query, getDocs, where, orderBy, Timestamp } = getFirebase();
          let q;
          if (filtroFecha) {
            // El día elegido, de 00:00 a 23:59 de Buenos Aires.
            const inicio = new Date(filtroFecha + "T00:00:00-03:00");
            const fin    = new Date(filtroFecha + "T23:59:59.999-03:00");
            q = query(collection(db,"reportes"), where("fecha",">=",Timestamp.fromDate(inicio)), where("fecha","<=",Timestamp.fromDate(fin)), orderBy("fecha","desc"));
          } else {
            q = query(collection(db,"reportes"), orderBy("fecha","desc"));
          }
          const snap = await getDocs(q);
          if (n !== pedidoReportes.current) return; // ya se pidió otro filtro: esta respuesta es vieja
          const data = snap.docs.map(d=>{ const f = SersaleBase.aFecha(d.data().fecha); return {id:d.id,...d.data(),items:Array.isArray(d.data().items)?d.data().items:[],fechaISO:f?f.toISOString():d.data().fechaISO}; });
          setReportes(filtroArea==="todos" ? data : data.filter(r=>r.area===filtroArea));
        } catch(e) {
          if (n !== pedidoReportes.current) return;
          setReportes(prev=>prev||[]);
          avisoError("No se pudieron cargar los reportes. Tocá ↻ para probar de nuevo.", e);
        }
      }

      useEffect(()=>{ if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar); },[filtroFecha,filtroArea]);

      /* ── EDICIÓN DE REPORTE ── */
      function abrirEdit(r) {
        setEditando({
          id: r.id,
          encargado: r.encargado,
          obs: r.obs||"",
          items: r.items.map(it=>({...it}))
        });
      }
      function updEditItem(i,f,v) {
        const c = [...editando.items]; c[i][f]=v; setEditando({...editando, items:c});
      }
      function addEditItem() {
        setEditando({...editando, items:[...editando.items,{producto:"",cantidad:"",unidad:"kg",obs:""}]});
      }
      function remEditItem(i) {
        setEditando({...editando, items: editando.items.filter((_,idx)=>idx!==i)});
      }
      /* Qué hay que tocar en el stock cuando un reporte cambia (o se elimina: `nuevos` vacío).
         Se compara, producto por producto, lo cargado en "piezas" antes y ahora:
         - si la línea ya había sumado al stock (tiene su movimiento de entrada), se aplica la diferencia;
         - si la línea es nueva, suma como en un reporte nuevo;
         - si nunca había sumado (el producto no estaba en Stock cuando se envió), no se toca y se avisa. */
      function planDeReporte(viejos, nuevos, movs, stock, eliminando) {
        const clave = n => SersaleBase.norm(n);
        const piezas = lista => {
          const m = {};
          (lista||[]).forEach(it=>{
            if (!it || it.unidad!=="piezas" || !it.producto || it.producto==="Otro") return;
            const k = clave(it.producto);
            m[k] = { nombre: it.producto, cant: (m[k]?m[k].cant:0) + numCant(it.cantidad) };
          });
          return m;
        };
        const antes = piezas(viejos), ahora = piezas(nuevos);
        const movsDe = {};
        movs.forEach(m=>{ const k=clave(m.nombre); (movsDe[k]=movsDe[k]||[]).push(m); });
        const plan = { deltas:{}, actualizar:[], borrar:[], crear:[], sinStock:[], sinImpacto:[], cambios:[] };
        const sumar = (id, d) => { plan.deltas[id] = SersaleBase.redondear((plan.deltas[id]||0) + d, 3); };
        new Set([...Object.keys(antes), ...Object.keys(ahora), ...Object.keys(movsDe)]).forEach(k=>{
          const a = antes[k] ? antes[k].cant : 0, b = ahora[k] ? ahora[k].cant : 0;
          const ms = movsDe[k] || [];
          if (ms.length) {
            const id = ms[0].stockId || (buscarStock(stock, ms[0].nombre)||{}).id;
            if (id && b !== a) sumar(id, b - a);
            if (eliminando || (b === 0 && a !== 0)) ms.forEach(m=>plan.borrar.push(m.id));
            else if (b !== a) {
              // El movimiento queda con la cantidad nueva del reporte.
              plan.actualizar.push({ id: ms[0].id, cantidad: b });
              ms.slice(1).forEach(m=>plan.borrar.push(m.id));
            }
          } else if (b > 0 && a === 0) {
            const st = buscarStock(stock, ahora[k].nombre);
            if (!st) plan.sinStock.push(ahora[k].nombre);
            else { sumar(st.id, b); plan.crear.push({ stockId: st.id, nombre: st.nombre, cantidad: b }); }
          } else if (b > 0 && b !== a) plan.sinImpacto.push(ahora[k].nombre);
        });
        return plan;
      }
      /* Guarda el cambio de un reporte (o lo elimina si `nuevo` es null) junto con su efecto
         en el stock y en sus movimientos, todo en una sola transacción. */
      async function aplicarCambioDeReporte(id, nuevo) {
        const { db, collection, doc, getDocs, query, where, runTransaction } = getFirebase();
        if (sinSenal()) throw new Error("sin conexión");
        const movSnap = await getDocs(query(collection(db,"stock_movimientos"), where("ref","==",id)));
        const idsMov = movSnap.docs.filter(d=>d.data().tipo==="entrada").map(d=>d.id);
        const stock = await leerStock();
        const repRef = doc(db,"reportes",id);
        return runTransaction(db, async tx => {
          const repSnap = await tx.get(repRef);
          if (!repSnap.exists()) { const e = new Error("el reporte ya no existe"); e.yaNoExiste = true; throw e; }
          const movs = [];
          for (const mid of idsMov) { const m = await tx.get(doc(db,"stock_movimientos",mid)); if (m.exists()) movs.push({id:m.id,...m.data()}); }
          const plan = planDeReporte(repSnap.data().items, nuevo ? nuevo.items : [], movs, stock, !nuevo);
          const ids = Object.keys(plan.deltas).filter(sid=>plan.deltas[sid]);
          const snaps = [];
          for (const sid of ids) snaps.push(await tx.get(doc(db,"stock_produccion",sid)));
          const ahora = new Date().toISOString();
          snaps.forEach((st,i)=>{
            if (!st.exists()) return; // el ítem de stock ya no existe: no hay nada que corregir
            const antes = parseFloat(st.data().cantidad)||0;
            const despues = SersaleBase.redondear(Math.max(0, antes + plan.deltas[ids[i]]), 3);
            tx.update(st.ref, { cantidad: despues, updatedAt: ahora });
            plan.cambios.push({ nombre: st.data().nombre, delta: plan.deltas[ids[i]] });
          });
          plan.actualizar.forEach(m=>tx.update(doc(db,"stock_movimientos",m.id), { cantidad: m.cantidad }));
          plan.borrar.forEach(mid=>tx.delete(doc(db,"stock_movimientos",mid)));
          plan.crear.forEach(m=>tx.set(doc(collection(db,"stock_movimientos")), {
            stockId: m.stockId, nombre: m.nombre,
            tipo: "entrada", subtipo: "produccion",
            cantidad: m.cantidad, unidad: "piezas",
            ref: id, encargado: (nuevo ? nuevo.encargado : repSnap.data().encargado) || "",
            fecha: SersaleBase.hoy(),
            createdAt: ahora
          }));
          if (nuevo) tx.update(repRef, nuevo); else tx.delete(repRef);
          return plan;
        });
      }
      const resumenStock = plan => plan.cambios.map(c=>`${c.nombre} ${c.delta>0?"+":"−"}${fmtN(Math.abs(c.delta))}`).join(", ");

      const [guardarEdit, guardandoEdit] = SersaleBase.useAccion(async () => {
        const incompleta = filaIncompleta(editando.items, "producto");
        if (incompleta) return avisoError(incompleta);
        const val = editando.items.filter(it=>it.producto&&it.cantidad);
        if (!val.length) return avisoError("Al menos un producto con cantidad");
        try {
          const plan = await aplicarCambioDeReporte(editando.id, {
            encargado: editando.encargado,
            items: val,
            obs: editando.obs,
            editadoEn: new Date().toISOString()
          });
          setEditando(null);
          cargar();
          if (stockItems) cargarStock();
          SersaleUI.toast(plan.cambios.length ? "Reporte guardado. Stock corregido: " + resumenStock(plan) : "Reporte guardado", { tipo:"ok", ms: plan.cambios.length ? 6000 : undefined });
          const avisos = [];
          if (plan.sinStock.length) avisos.push("No figuran en Stock de Producción, así que no sumaron al stock:\n• " + plan.sinStock.join("\n• "));
          if (plan.sinImpacto.length) avisos.push("No habían sumado al stock cuando se envió el reporte, así que el stock no se tocó:\n• " + plan.sinImpacto.join("\n• "));
          if (avisos.length) SersaleUI.aviso(avisos.join("\n\n") + "\n\nSi corresponde, ajustá el stock a mano.", { titulo:"Stock sin actualizar" });
        } catch(e) {
          if (e && e.yaNoExiste) { setEditando(null); cargar(); return avisoError("Ese reporte ya no existe: lo eliminaron desde otro teléfono.", e); }
          avisoError(msgNoGuardo(), e);
        }
      });
      const [eliminarReporte] = SersaleBase.useAccion(async (id) => {
        const r = (reportes||[]).find(x=>x.id===id);
        const sumaStock = r && (r.items||[]).some(it=>it.unidad==="piezas");
        const ok = await SersaleUI.confirmar({
          titulo: "¿Eliminar este reporte?",
          cuerpo: (r ? `${areaDe(r.area).label} · ${r.encargado||""}` : "") + (sumaStock ? "\n\nLas piezas que este reporte había sumado al stock se descuentan." : ""),
          aceptar: "Eliminar", peligro: true
        });
        if (!ok) return;
        try {
          const plan = await aplicarCambioDeReporte(id, null);
          setReportes(prev=>(prev||[]).filter(x=>x.id!==id));
          setExpanded(null);
          if (stockItems) cargarStock();
          SersaleUI.toast(plan.cambios.length ? "Reporte eliminado. Stock corregido: " + resumenStock(plan) : "Reporte eliminado", { tipo:"ok", ms: plan.cambios.length ? 6000 : undefined });
        } catch(e) {
          if (e && e.yaNoExiste) { setReportes(prev=>(prev||[]).filter(x=>x.id!==id)); return; }
          avisoError(sinSenal() ? "Sin conexión: no se eliminó. Probá de nuevo cuando vuelva la señal." : "No se pudo eliminar. Probá de nuevo.", e);
        }
      });

      /* ── STOCK ── */
      async function cargarStock() {
        try {
          const lista = await leerStock();
          setStockItems(lista);
          return lista;
        } catch(e) {
          setStockItems(prev=>prev||[]);
          avisoError("No se pudo cargar el stock. Probá de nuevo.", e);
          return null;
        }
      }
      // El stock se trae al entrar al panel (para el aviso de stock bajo en la pestaña) y cada vez que se abre la pestaña.
      useEffect(()=>{ if(tab==="stock"||stockItems===null){ if(window.__fbReady) cargarStock(); else document.addEventListener("fbReady",cargarStock); } },[tab]);

      async function cargarMovimientos() {
        try {
          const { db, collection, getDocs, query, orderBy } = getFirebase();
          const snap = await getDocs(query(collection(db,"stock_movimientos"), orderBy("createdAt","desc")));
          setMovimientos(snap.docs.map(d=>({id:d.id,...d.data()})));
        } catch(e) { setMovimientos(prev=>prev||[]); avisoError("No se pudieron cargar los movimientos. Probá de nuevo.", e); }
      }
      useEffect(()=>{ if(tab==="stock"&&stockSubTab==="movimientos"){ if(window.__fbReady) cargarMovimientos(); else document.addEventListener("fbReady",cargarMovimientos); } },[tab,stockSubTab]);

      function abrirModalSalida() {
        const hoy = SersaleBase.hoy();
        setSalidaForm({destino:"PP",tipo:"despacho",fecha:hoy,items:[{nombre:"",cantidad:"",unidad:"piezas"}],obs:""});
        setModalSalida(true);
      }
      function updSalidaItem(i,f,v){
        const c=[...salidaForm.items]; c[i]={...c[i],[f]:v};
        // Al completar el nombre de un ítem de stock, la unidad pasa a ser la del ítem.
        if(f==="nombre"){ const s=buscarStock(stockItems||[], v.trim()); if(s&&s.unidad) c[i].unidad=s.unidad; }
        setSalidaForm({...salidaForm,items:c});
      }
      function addSalidaItem(){ setSalidaForm({...salidaForm,items:[...salidaForm.items,{nombre:"",cantidad:"",unidad:"piezas"}]}); }
      function remSalidaItem(i){ setSalidaForm({...salidaForm,items:salidaForm.items.filter((_,idx)=>idx!==i)}); }

      const [guardarSalida, guardandoSalida] = SersaleBase.useAccion(async () => {
        const incompleta = filaIncompleta(salidaForm.items, "nombre");
        if(incompleta) return avisoError(incompleta);
        const val = salidaForm.items.filter(it=>String(it.nombre||"").trim()&&it.cantidad);
        if(!val.length) return avisoError("Agregá al menos un producto con cantidad");
        if(!salidaForm.fecha) return avisoError("Seleccioná una fecha");
        try {
          const { db, collection, doc } = getFirebase();
          // 1. Se revisan todas las líneas antes de tocar nada: si una no se puede registrar, no se registra ninguna
          //    (antes se descontaban las que coincidían, se cerraba el formulario y al cargarlo de nuevo se descontaban dos veces).
          const stock = await leerStock();
          const filas = [], sinStock = [], otraUnidad = [];
          for (const it of val) {
            const nombre = String(it.nombre).trim();
            const s = buscarStock(stock, nombre);
            if(!s) sinStock.push(nombre);
            else if(s.unidad && it.unidad!==s.unidad) otraUnidad.push(`${s.nombre}: en Stock se lleva en ${s.unidad}, no en ${it.unidad}`);
            else filas.push({ s, unidad: it.unidad, cant: numCant(it.cantidad) });
          }
          if(sinStock.length || otraUnidad.length) {
            SersaleUI.aviso(
              (sinStock.length ? "No figuran en Stock de Producción:\n• "+sinStock.join("\n• ")+"\n\n" : "") +
              (otraUnidad.length ? "La unidad no coincide:\n• "+otraUnidad.join("\n• ")+"\n\n" : "") +
              "Todavía no se descontó nada. Corregí esas líneas y confirmá de nuevo.",
              { titulo:"No se registró la salida" });
            return;
          }
          const deltas = {};
          filas.forEach(f=>{ deltas[f.s.id] = (deltas[f.s.id]||0) - f.cant; });
          // 2. Si sale más de lo que figura, se pregunta (el stock no baja de 0).
          const cortos = stock.filter(s=>deltas[s.id] && (parseFloat(s.cantidad)||0) + deltas[s.id] < 0);
          if(cortos.length) {
            const ok = await SersaleUI.confirmar({
              titulo: "Sale más de lo que hay en stock",
              cuerpo: cortos.map(s=>`• ${s.nombre}: hay ${fmtN(parseFloat(s.cantidad)||0)} ${s.unidad||""} y salen ${fmtN(-deltas[s.id])}`).join("\n") + "\n\nSi seguís, el stock de esos productos queda en 0.",
              aceptar: "Registrar igual"
            });
            if(!ok) return;
          }
          // 3. Stock y movimientos se guardan juntos, leyendo la cantidad del servidor en ese momento.
          const ahora = new Date().toISOString();
          const res = await moverStock(deltas, (tx, res) => {
            const borrado = filas.find(f=>!res[f.s.id]);
            if(borrado) { const e = new Error("ítem de stock eliminado"); e.itemBorrado = borrado.s.nombre; throw e; }
            filas.forEach(f=>tx.set(doc(collection(db,"stock_movimientos")), {
              stockId: f.s.id,
              nombre: f.s.nombre, tipo:"salida",
              subtipo: salidaForm.tipo,
              destino: salidaForm.tipo==="despacho"?salidaForm.destino:salidaForm.tipo==="venta"?"Planta":"Cliente",
              cantidad: f.cant, unidad: f.unidad,
              fecha: salidaForm.fecha, obs: salidaForm.obs.trim(),
              createdAt: ahora
            }));
          });
          setModalSalida(false);
          SersaleUI.toast("Salida registrada", { tipo:"ok" });
          // Aviso por WhatsApp solo de lo que esta salida dejó en el mínimo o por debajo.
          const bajos = cruzaronMinimo(res);
          if(bajos.length) sendStockAlert(bajos);
          await cargarStock();
          if(stockSubTab==="movimientos") await cargarMovimientos();
        } catch(e){
          if(e && e.itemBorrado) { cargarStock(); return avisoError(`"${e.itemBorrado}" ya no está en Stock. No se registró nada.`, e); }
          avisoError(msgNoGuardo(), e);
        }
      });

      function abrirModalStock(item=null) {
        if(item) {
          setEditStock(item.id);
          setStockForm({_id:item.id,nombre:item.nombre,categoria:item.categoria||"Cocidos",cantidad:item.cantidad,cantidadAlAbrir:item.cantidad,unidad:item.unidad||"kg",minimo:item.minimo||"",obs:item.obs||""});
          refrescarCantidad(item.id);
        } else {
          setEditStock(null);
          setStockForm({nombre:"",categoria:"Cocidos",cantidad:"",unidad:"kg",minimo:"",obs:""});
        }
        setModalStock(true);
      }
      // La lista en pantalla puede estar vieja (otro teléfono cargó producción o una salida):
      // al abrir "Editar" se trae la cantidad al día y, si todavía no se tocó en el formulario, se muestra esa.
      async function refrescarCantidad(id) {
        try {
          const { db, doc, getDoc } = getFirebase();
          const d = await getDoc(doc(db,"stock_produccion",id));
          if(!d.exists()) return;
          const c = d.data().cantidad;
          setStockForm(f=>(f._id===id && String(f.cantidad)===String(f.cantidadAlAbrir)) ? {...f,cantidad:c,cantidadAlAbrir:c} : f);
          setStockItems(prev=>(prev||[]).map(s=>s.id===id?{...s,cantidad:c}:s));
        } catch(e) { console.error(e); }
      }
      const [guardarStock, guardandoStock] = SersaleBase.useAccion(async () => {
        if (!stockForm.nombre.trim()) return avisoError("Ingresá el nombre");
        if (stockForm.cantidad === "") return avisoError("Ingresá la cantidad");
        if (numCant(stockForm.cantidad) < 0 || numCant(stockForm.minimo) < 0) return avisoError("La cantidad y el mínimo no pueden ser negativos");
        // Dos ítems con el mismo nombre hacen que la producción y las salidas impacten en uno cualquiera.
        const actual = editStock ? (stockItems||[]).find(s=>s.id===editStock) : null;
        if (!actual || !SersaleBase.mismoNombre(actual.nombre, stockForm.nombre)) {
          const repetido = (stockItems||[]).find(s=>s.id!==editStock && SersaleBase.mismoNombre(s.nombre, stockForm.nombre));
          if (repetido) return avisoError(`Ya hay un ítem que se llama "${repetido.nombre}"`);
        }
        try {
          const { db, collection, addDoc, doc, updateDoc } = getFirebase();
          const data = {
            nombre: stockForm.nombre.trim(),
            categoria: stockForm.categoria,
            cantidad: parseFloat(stockForm.cantidad)||0,
            unidad: stockForm.unidad,
            minimo: parseFloat(stockForm.minimo)||0,
            obs: stockForm.obs.trim(),
            updatedAt: new Date().toISOString()
          };
          if (editStock) {
            // Si en el formulario no se tocó la cantidad, no se reescribe: así cambiar el mínimo o el
            // nombre no pisa la producción o las salidas que se cargaron mientras tanto.
            if (String(stockForm.cantidad) === String(stockForm.cantidadAlAbrir)) delete data.cantidad;
            await updateDoc(doc(db,"stock_produccion",editStock), data);
            setStockItems(prev=>(prev||[]).map(s=>s.id===editStock?{...s,...data}:s));
          } else {
            const ref = await addDoc(collection(db,"stock_produccion"), data);
            setStockItems(prev=>[...(prev||[]), {id:ref.id,...data}].sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre))));
          }
          setModalStock(false);
          SersaleUI.toast("Ítem guardado", { tipo:"ok" });
        } catch(e) { avisoError(msgNoGuardo(), e); }
      });
      const [eliminarStock] = SersaleBase.useAccion(async (id) => {
        const it = (stockItems||[]).find(s=>s.id===id);
        const ok = await SersaleUI.confirmar({ titulo:"¿Eliminar este ítem?", cuerpo: it ? `${it.nombre} · ${fmtN(it.cantidad)} ${it.unidad||""}` : "", aceptar:"Eliminar", peligro:true });
        if (!ok) return;
        try {
          const { db, doc, deleteDoc } = getFirebase();
          await deleteDoc(doc(db,"stock_produccion",id));
          setStockItems(prev=>(prev||[]).filter(s=>s.id!==id));
        } catch(e) { avisoError("No se pudo eliminar. Probá de nuevo.", e); }
      });
      /* Botones + y −: cada toque suma o resta 1 sobre lo que hay en el servidor en ese
         momento (transacción), no sobre el número que quedó dibujado en la pantalla.
         Los toques seguidos se aplican de a uno y en orden, así no se pierde ninguno. */
      function ajustarCantidad(item, delta) {
        colaAjustes.current = colaAjustes.current.then(async () => {
          try {
            const res = await moverStock({ [item.id]: delta });
            const r = res[item.id];
            if (!r) { cargarStock(); return avisoError("Ese ítem ya no está en Stock."); }
            setStockItems(prev=>(prev||[]).map(s=>s.id===item.id?{...s,cantidad:r.despues}:s));
            // Aviso por WhatsApp solo cuando este toque lo deja en el mínimo (no en cada toque siguiente).
            if (delta<0) { const bajos = cruzaronMinimo(res); if (bajos.length) sendStockAlert(bajos); }
          } catch(e) { avisoError(sinSenal() ? "Sin conexión: el stock no se cambió." : "No se pudo cambiar el stock. Probá de nuevo.", e); }
        });
      }

      /* ── FAENA ── */
      const ordenarFaenas = lista => [...lista].sort((a,b)=>String(b.fecha||"").localeCompare(String(a.fecha||"")));
      async function cargarFaenas() {
        try {
          const { db, collection, getDocs, query, orderBy } = getFirebase();
          const snap = await getDocs(query(collection(db,"faenas"), orderBy("fecha","desc")));
          const lista = snap.docs.map(d=>({id:d.id,...d.data()}));
          setFaenas(lista);
          return lista;
        } catch(e) { setFaenas(prev=>prev||[]); avisoError("No se pudo cargar la faena. Probá de nuevo.", e); return null; }
      }
      useEffect(()=>{ if(tab==="faena"){ if(window.__fbReady) cargarFaenas(); else document.addEventListener("fbReady",cargarFaenas); } },[tab]);

      function abrirModalFaena(item=null) {
        if(item) {
          setEditFaena(item.id);
          setFaenaForm({fecha:item.fecha,tipo:item.tipo,cantidad:item.cantidad,pesoTotal:item.pesoTotal||"",pesoPromedio:item.pesoPromedio||"",obs:item.obs||""});
        } else {
          setEditFaena(null);
          const hoy = SersaleBase.hoy();
          setFaenaForm({fecha:hoy,tipo:"Cerdo",cantidad:"",pesoTotal:"",pesoPromedio:"",obs:""});
        }
        setModalFaena(true);
      }
      // Peso promedio = peso total / cabezas. Se recalcula cuando cambia cualquiera de los dos.
      function promedioFaena(cabezas, pesoTotal) {
        const c = parseFloat(cabezas)||0, pt = parseFloat(pesoTotal)||0;
        return c>0 && pt>0 ? Math.round(pt/c*10)/10 : "";
      }
      const [guardarFaena, guardandoFaena] = SersaleBase.useAccion(async () => {
        if (!faenaForm.fecha) return avisoError("Seleccioná una fecha");
        if (!(parseInt(faenaForm.cantidad)>0)) return avisoError("Ingresá la cantidad de animales");
        try {
          const { db, collection, addDoc, doc, updateDoc } = getFirebase();
          const data = {
            fecha: faenaForm.fecha,
            tipo: faenaForm.tipo,
            cantidad: parseInt(faenaForm.cantidad)||0,
            pesoTotal: parseFloat(faenaForm.pesoTotal)||0,
            pesoPromedio: parseFloat(faenaForm.pesoPromedio)||0,
            obs: faenaForm.obs.trim()
          };
          const ahora = new Date().toISOString();
          if(editFaena) {
            // createdAt no se toca al editar: es cuándo se cargó el registro.
            await updateDoc(doc(db,"faenas",editFaena), {...data, updatedAt: ahora});
            setFaenas(prev=>ordenarFaenas((prev||[]).map(f=>f.id===editFaena?{...f,...data,updatedAt:ahora}:f)));
          } else {
            const nueva = {...data, createdAt: ahora};
            const ref = await addDoc(collection(db,"faenas"), nueva);
            setFaenas(prev=>ordenarFaenas([{id:ref.id,...nueva},...(prev||[])]));
          }
          setModalFaena(false);
          SersaleUI.toast("Faena guardada", { tipo:"ok" });
        } catch(e) { avisoError(msgNoGuardo(), e); }
      });
      const [eliminarFaena] = SersaleBase.useAccion(async (id) => {
        const f = (faenas||[]).find(x=>x.id===id);
        const ok = await SersaleUI.confirmar({ titulo:"¿Eliminar este registro de faena?", cuerpo: f ? `${fmt(f.fecha)} · ${f.cantidad} ${f.tipo||""}` : "", aceptar:"Eliminar", peligro:true });
        if(!ok) return;
        try {
          const { db, doc, deleteDoc } = getFirebase();
          await deleteDoc(doc(db,"faenas",id));
          setFaenas(prev=>(prev||[]).filter(x=>x.id!==id));
        } catch(e) { avisoError("No se pudo eliminar. Probá de nuevo.", e); }
      });

      /* ── TRAZABILIDAD ── */
      const loteVacio = () => ({fechaElab:"",fechaVenc:"",operario:"",materiasPrimas:[{tipo:"cerdo",corte:"",proveedor:"",kg:""}],productos:[{nombre:"",cantidad:"",unidad:"piezas"}],obs:""});
      function generarNumeroLote(fecha, seq) {
        const d = fecha || SersaleBase.hoy();
        const num = String(seq).padStart(3,"0");
        return d.replace(/-/g,"") + "-" + num;
      }
      async function cargarLotes() {
        try {
          const { db, collection, getDocs, query, orderBy } = getFirebase();
          const snap = await getDocs(query(collection(db,"trazabilidad_lotes"), orderBy("fechaElab","desc")));
          const lista = snap.docs.map(d=>({id:d.id,...d.data()}));
          setLotes(lista);
          return lista;
        } catch(e){ setLotes(prev=>prev||[]); avisoError("No se pudieron cargar los lotes. Probá de nuevo.", e); return null; }
      }
      useEffect(()=>{ if(tab==="trazabilidad"){ if(window.__fbReady) cargarLotes(); else document.addEventListener("fbReady",cargarLotes); } },[tab]);

      function abrirModalLote() {
        // Formulario sin fecha: se propone hoy, con vencimiento a 30 días (las dos se pueden cambiar).
        if (!loteForm.fechaElab) { const hoy = SersaleBase.hoy(); setLoteForm({...loteForm, fechaElab:hoy, fechaVenc:loteForm.fechaVenc||SersaleBase.sumarDias(hoy,30)}); }
        setModalLote(true);
      }
      // El vencimiento propuesto (elaboración + 30 días) acompaña a la fecha de elaboración
      // mientras no se haya escrito un vencimiento a mano.
      function cambiarFechaElab(d) {
        const propuesto = d ? SersaleBase.sumarDias(d,30) : "";
        setLoteForm({...loteForm, fechaElab:d, fechaVenc:(loteForm.vencManual&&loteForm.fechaVenc) ? loteForm.fechaVenc : propuesto});
      }
      function addMateriaPrima(){ setLoteForm({...loteForm,materiasPrimas:[...loteForm.materiasPrimas,{tipo:"cerdo",corte:"",proveedor:"",kg:""}]}); }
      function updMP(i,f,v){ const a=[...loteForm.materiasPrimas]; a[i][f]=v; setLoteForm({...loteForm,materiasPrimas:a}); }
      function remMP(i){ setLoteForm({...loteForm,materiasPrimas:loteForm.materiasPrimas.filter((_,idx)=>idx!==i)}); }
      function addProducto(){ setLoteForm({...loteForm,productos:[...loteForm.productos,{nombre:"",cantidad:"",unidad:"piezas"}]}); }
      function updProd(i,f,v){ const a=[...loteForm.productos]; a[i][f]=v; setLoteForm({...loteForm,productos:a}); }
      function remProd(i){ setLoteForm({...loteForm,productos:loteForm.productos.filter((_,idx)=>idx!==i)}); }

      const [guardarLote, guardandoLote] = SersaleBase.useAccion(async () => {
        if(!loteForm.fechaElab) return avisoError("Ingresá la fecha de elaboración");
        if(!loteForm.fechaVenc) return avisoError("Ingresá la fecha de vencimiento");
        if(loteForm.fechaVenc < loteForm.fechaElab) return avisoError("El vencimiento no puede ser anterior a la elaboración");
        if(!loteForm.operario.trim()) return avisoError("Ingresá el operario responsable");
        if(loteForm.materiasPrimas.some(m=>!m.proveedor||!m.kg)) return avisoError("Completá todas las materias primas");
        if(loteForm.productos.some(p=>!p.nombre||!p.cantidad)) return avisoError("Completá todos los productos");
        try {
          const { db, collection, addDoc, getDocs, query, orderBy } = getFirebase();
          // Generar número de lote automático
          const hoy = loteForm.fechaElab.replace(/-/g,"");
          const snap = await getDocs(query(collection(db,"trazabilidad_lotes"), orderBy("nroLote","desc")));
          const existing = snap.docs.map(d=>d.data().nroLote||"").filter(n=>n.startsWith(hoy));
          // Siguiente número del día: el más alto ya usado + 1 (contar los lotes repetía un número si faltaba alguno).
          const usados = existing.map(n=>parseInt(String(n).split("-")[1],10)||0);
          const seq = Math.max(existing.length, ...usados) + 1;
          const nroLote = generarNumeroLote(loteForm.fechaElab, seq);
          await addDoc(collection(db,"trazabilidad_lotes"), {
            nroLote, fechaElab: loteForm.fechaElab, fechaVenc: loteForm.fechaVenc,
            operario: loteForm.operario.trim(),
            materiasPrimas: loteForm.materiasPrimas.map(m=>({...m,kg:parseFloat(m.kg)||0})),
            productos: loteForm.productos.map(p=>({...p,cantidad:parseFloat(p.cantidad)||0})),
            obs: loteForm.obs.trim(),
            createdAt: new Date().toISOString()
          });
          setLotes(null); cargarLotes();
          setModalLote(false);
          setLoteForm(loteVacio());
          SersaleUI.toast("Lote " + nroLote + " registrado", { tipo:"ok" });
        } catch(e){ avisoError(msgNoGuardo(), e); }
      });

      /* ── EXPORTAR ── */
      // El PDF y el Excel se arman con lo que haya en la base, no con lo que se haya abierto en pantalla:
      // antes, sin entrar a Stock, Faena y Lotes, el archivo salía vacío.
      const [exportar, exportando] = SersaleBase.useAccion(async (tipo) => {
        try {
          const stock = getChk("rep-stock")||getChk("rep-stockalerta") ? ((await cargarStock()) || stockItems) : null;
          const fa = getChk("rep-faena") ? ((await cargarFaenas()) || faenas) : null;
          const lo = getChk("rep-lotes") ? ((await cargarLotes()) || lotes) : null;
          const datos = {
            stock: getChk("rep-stock") ? stock : null,
            alerta: getChk("rep-stockalerta") && stock ? stock.filter(s=>s.minimo>0&&s.cantidad<=s.minimo) : null,
            faenas: fa ? fa.filter(f=>f.fecha&&f.fecha.startsWith(filtroFaenaMes)) : null, // solo el mes elegido, como dice el título
            lotes: lo
          };
          if (!datos.stock && !datos.alerta && !datos.faenas && !datos.lotes) return avisoError("Elegí al menos una sección (o no se pudieron cargar los datos)");
          if (tipo==="pdf") generarPDFProd(datos); else generarExcelProd(datos);
          setShowReportModal(false);
        } catch(e) { avisoError("No se pudo generar el reporte. Probá de nuevo.", e); }
      });

      /* ── TOTALES DIA ── */
      const totalesDia = {};
      (reportes||[]).forEach(r=>{
        if(!totalesDia[r.area]) totalesDia[r.area]={tandas:0,items:[]};
        totalesDia[r.area].tandas++;
        r.items.forEach(it=>{
          const ex=totalesDia[r.area].items.find(x=>x.producto===it.producto&&x.unidad===it.unidad);
          if(ex) ex.cantidad+=parseFloat(it.cantidad)||0;
          else totalesDia[r.area].items.push({producto:it.producto,cantidad:parseFloat(it.cantidad)||0,unidad:it.unidad});
        });
      });

      /* ── STOCK FILTRADO ── */
      const stockFiltrado = (stockItems||[]).filter(s=>filtroCategoria==="todas"||s.categoria===filtroCategoria);
      const stockAlerta = (stockItems||[]).filter(s=>s.minimo>0&&s.cantidad<=s.minimo);

      /* ── MODAL EDIT REPORTE ── */
      if (editando) {
        const area = reportes?.find(r=>r.id===editando.id)?.area;
        const A = (area && AREAS[area]) || null;
        return (
          <div style={{minHeight:"100vh",background:"#F2F3F5",maxWidth:"var(--app-max-w)",margin:"0 auto"}}>
            <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
              <button onClick={()=>setEditando(null)} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
              <div style={{flex:1,fontWeight:700,fontSize:15}}>Editar Reporte</div>
            </div>
            <div style={{padding:20}}>
              <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Encargado</label>
              <input style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:16}}
                value={editando.encargado} onChange={e=>setEditando({...editando,encargado:e.target.value})} />
              <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,margin:"0 0 10px"}}>Productos</p>
              {editando.items.map((item,i)=>(
                <div key={i} style={{background:"#fff",borderRadius:12,border:`1.5px solid ${A?.color||"#D8DCE0"}`,padding:14,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <span style={{fontWeight:600,color:A?.color||"#5C666F",fontSize:13}}>Producto {i+1}</span>
                    {editando.items.length>1&&<button onClick={()=>remEditItem(i)} style={{background:"#fee",color:"#A4232A",border:"1px solid #fcc",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:12}}>✕</button>}
                  </div>
                  {A ? (
                    <select style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                      value={item.producto} onChange={e=>updEditItem(i,"producto",e.target.value)}>
                      <option value="">— Seleccioná —</option>
                      {A.productos.map(p=><option key={p} value={p}>{p}</option>)}
                      <option value="Otro">Otro</option>
                    </select>
                  ) : (
                    <input style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                      value={item.producto} onChange={e=>updEditItem(i,"producto",e.target.value)} placeholder="Producto" />
                  )}
                  <div style={{display:"flex",gap:8,marginTop:8}}>
                    <input style={{flex:1,padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                      type="number" inputMode="decimal" min="0" step="any" placeholder="Cantidad" value={item.cantidad} onChange={e=>updEditItem(i,"cantidad",e.target.value)} />
                    <select style={{width:120,padding:"12px 10px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                      value={item.unidad} onChange={e=>updEditItem(i,"unidad",e.target.value)}>
                      {UNIDADES.map(u=><option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <input style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff",marginTop:8}}
                    placeholder="Observación" value={item.obs||""} onChange={e=>updEditItem(i,"obs",e.target.value)} />
                </div>
              ))}
              <button onClick={addEditItem} style={{width:"100%",padding:12,borderRadius:10,border:`2px dashed ${A?.color||"#B9BFC5"}`,background:"transparent",cursor:"pointer",fontWeight:600,fontSize:14,color:A?.color||"#5C666F",marginBottom:16}}>
                + Agregar producto
              </button>
              <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Observaciones</label>
              <textarea style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",height:80,resize:"none",marginBottom:16}}
                value={editando.obs} onChange={e=>setEditando({...editando,obs:e.target.value})} />
              <button onClick={guardarEdit} disabled={guardandoEdit}
                style={{width:"100%",padding:16,borderRadius:12,border:"none",background:guardandoEdit?"#A3ABB3":"#2A333B",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>
                {guardandoEdit?"Guardando...":"✓ Guardar cambios"}
              </button>
            </div>
          </div>
        );
      }

      /* ── MODAL STOCK ── */
      const modalLoteEl = modalLote && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
          onClick={e=>{ if(e.target===e.currentTarget) setModalLote(false); }}>
          <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480,maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <span style={{fontWeight:700,fontSize:16}}>Nuevo Lote</span>
              <button onClick={()=>setModalLote(false)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
            </div>

            {/* Fechas y operario */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Fecha elaboración *</label>
                <input type="date" style={{width:"100%",padding:"10px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                  value={loteForm.fechaElab} onChange={e=>cambiarFechaElab(e.target.value)} />
              </div>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Fecha vencimiento *</label>
                <input type="date" style={{width:"100%",padding:"10px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                  value={loteForm.fechaVenc} onChange={e=>setLoteForm({...loteForm,fechaVenc:e.target.value,vencManual:!!e.target.value})} />
              </div>
            </div>
            <div style={{marginBottom:12}}>
              <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Operario responsable *</label>
              <input style={{width:"100%",padding:"10px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                placeholder="Nombre del operario" value={loteForm.operario} onChange={e=>setLoteForm({...loteForm,operario:e.target.value})} />
            </div>

            {/* Materias primas */}
            <p style={{fontWeight:700,fontSize:12,color:"#2A333B",textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>🥩 Materias Primas</p>
            {loteForm.materiasPrimas.map((mp,i)=>(
              <div key={i} style={{background:"#F7F8F9",borderRadius:10,padding:10,marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:12,fontWeight:600,color:"#555"}}>MP {i+1}</span>
                  {loteForm.materiasPrimas.length>1 && <button onClick={()=>remMP(i)} style={{background:"#fee",color:"#A4232A",border:"none",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:11}}>✕</button>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:6}}>
                  <select style={{padding:"8px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}
                    value={mp.tipo} onChange={e=>updMP(i,"tipo",e.target.value)}>
                    <option value="cerdo">🐖 Cerdo</option>
                    <option value="vacuno">🐄 Vacuno</option>
                  </select>
                  <input style={{padding:"8px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}
                    placeholder="Corte (ej: paleta)" value={mp.corte} onChange={e=>updMP(i,"corte",e.target.value)} />
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <input style={{padding:"8px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}
                    placeholder="Proveedor / tropa" value={mp.proveedor} onChange={e=>updMP(i,"proveedor",e.target.value)} />
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <input type="number" inputMode="decimal" style={{flex:1,padding:"8px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}
                      placeholder="Kg" value={mp.kg} onChange={e=>updMP(i,"kg",e.target.value)} />
                    <span style={{fontSize:11,color:"#79828B"}}>kg</span>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addMateriaPrima} style={{width:"100%",padding:8,borderRadius:8,border:"2px dashed #D8DCE0",background:"transparent",cursor:"pointer",fontSize:12,color:"#79828B",marginBottom:14}}>
              + Agregar materia prima
            </button>

            {/* Productos elaborados */}
            <p style={{fontWeight:700,fontSize:12,color:"#2A333B",textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>📦 Productos Elaborados</p>
            {loteForm.productos.map((p,i)=>(
              <div key={i} style={{background:"#F7F8F9",borderRadius:10,padding:10,marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:12,fontWeight:600,color:"#555"}}>Producto {i+1}</span>
                  {loteForm.productos.length>1 && <button onClick={()=>remProd(i)} style={{background:"#fee",color:"#A4232A",border:"none",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:11}}>✕</button>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:8}}>
                  <input style={{padding:"8px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}
                    placeholder="Nombre del producto" value={p.nombre} onChange={e=>updProd(i,"nombre",e.target.value)} />
                  <input type="number" inputMode="decimal" style={{padding:"8px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}
                    placeholder="Cant." value={p.cantidad} onChange={e=>updProd(i,"cantidad",e.target.value)} />
                  <select style={{padding:"8px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}
                    value={p.unidad} onChange={e=>updProd(i,"unidad",e.target.value)}>
                    {["piezas","kg","bolsas","unidades"].map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            ))}
            <button onClick={addProducto} style={{width:"100%",padding:8,borderRadius:8,border:"2px dashed #D8DCE0",background:"transparent",cursor:"pointer",fontSize:12,color:"#79828B",marginBottom:14}}>
              + Agregar producto
            </button>

            <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Observaciones</label>
            <input style={{width:"100%",padding:"10px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff",marginBottom:16}}
              placeholder="Notas del lote..." value={loteForm.obs} onChange={e=>setLoteForm({...loteForm,obs:e.target.value})} />

            <button onClick={guardarLote} disabled={guardandoLote}
              style={{width:"100%",padding:16,borderRadius:12,border:"none",background:guardandoLote?"#A3ABB3":"#2A333B",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>
              {guardandoLote?"Guardando...":"✓ Registrar Lote"}
            </button>
          </div>
        </div>
      );

      const modalSalidaEl = modalSalida && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
          onClick={e=>{ if(e.target===e.currentTarget) setModalSalida(false); }}>
          <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <span style={{fontWeight:700,fontSize:16}}>Registrar salida</span>
              <button onClick={()=>setModalSalida(false)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Tipo de salida *</label>
                <select style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  value={salidaForm.tipo} onChange={e=>setSalidaForm({...salidaForm,tipo:e.target.value})}>
                  <option value="despacho">🚚 Despacho a sucursal</option>
                  <option value="venta">🏭 Venta directa planta</option>
                  <option value="pedido">📦 Pedido de cliente</option>
                </select>
              </div>
              {salidaForm.tipo==="despacho" ? (
                <div>
                  <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Destino</label>
                  <select style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                    value={salidaForm.destino} onChange={e=>setSalidaForm({...salidaForm,destino:e.target.value})}>
                    <option value="PP">📍 Parque Patricios</option>
                    <option value="CAB">📍 Caballito</option>
                  </select>
                </div>
              ) : (
                <div>
                  <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Fecha *</label>
                  <input type="date" style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                    value={salidaForm.fecha} onChange={e=>setSalidaForm({...salidaForm,fecha:e.target.value})} />
                </div>
              )}
            </div>
            {salidaForm.tipo==="despacho" && (
              <div style={{marginBottom:12}}>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Fecha *</label>
                <input type="date" style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  value={salidaForm.fecha} onChange={e=>setSalidaForm({...salidaForm,fecha:e.target.value})} />
              </div>
            )}
            <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,margin:"0 0 10px"}}>Productos</p>
            {/* Sugerencias con los nombres de Stock, para no tener que escribirlos enteros */}
            <datalist id="stock-nombres">{(stockItems||[]).map(s=><option key={s.id} value={s.nombre} />)}</datalist>
            {salidaForm.items.map((it,i)=>(
              <div key={i} style={{background:"#F7F8F9",borderRadius:10,padding:12,marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontWeight:600,fontSize:13,color:"#3A424A"}}>Producto {i+1}</span>
                  {salidaForm.items.length>1&&<button onClick={()=>remSalidaItem(i)} style={{background:"#fee",color:"#A4232A",border:"1px solid #fcc",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:12}}>✕</button>}
                </div>
                <input style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:8}}
                  placeholder="Nombre del producto (como figura en Stock)" value={it.nombre} list="stock-nombres" autoComplete="off"
                  onChange={e=>updSalidaItem(i,"nombre",e.target.value)} />
                <div style={{display:"flex",gap:8}}>
                  <input type="number" inputMode="decimal" style={{flex:1,padding:"10px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                    placeholder="Cantidad" value={it.cantidad} onChange={e=>updSalidaItem(i,"cantidad",e.target.value)} />
                  <select style={{width:110,padding:"10px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                    value={it.unidad} onChange={e=>updSalidaItem(i,"unidad",e.target.value)}>
                    {["piezas","kg","bolsas","ganchos","unidades"].map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            ))}
            <button onClick={addSalidaItem} style={{width:"100%",padding:10,borderRadius:10,border:"2px dashed #D8DCE0",background:"transparent",cursor:"pointer",fontWeight:600,fontSize:13,color:"#79828B",marginBottom:12}}>
              + Agregar producto
            </button>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Observaciones</label>
            <input style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:16}}
              placeholder="Ej: remito N°, cliente, detalle..." value={salidaForm.obs}
              onChange={e=>setSalidaForm({...salidaForm,obs:e.target.value})} />
            <button onClick={guardarSalida} disabled={guardandoSalida}
              style={{width:"100%",padding:16,borderRadius:12,border:"none",background:guardandoSalida?"#A3ABB3":"#A4232A",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>
              {guardandoSalida?"Guardando...":"Confirmar salida"}
            </button>
          </div>
        </div>
      );

      const modalFaenaEl = modalFaena && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
          onClick={e=>{ if(e.target===e.currentTarget) setModalFaena(false); }}>
          <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <span style={{fontWeight:700,fontSize:16}}>{editFaena?"Editar faena":"Registrar faena"}</span>
              <button onClick={()=>setModalFaena(false)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Fecha *</label>
                <input type="date" style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  value={faenaForm.fecha} onChange={e=>setFaenaForm({...faenaForm,fecha:e.target.value})} />
              </div>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Tipo de animal *</label>
                <select style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  value={faenaForm.tipo} onChange={e=>setFaenaForm({...faenaForm,tipo:e.target.value})}>
                  {["Cerdo","Vaca","Ternero","Cordero","Otro"].map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Cabezas *</label>
                <input type="number" inputMode="numeric" style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  placeholder="0" value={faenaForm.cantidad} onChange={e=>{ const c=e.target.value; setFaenaForm({...faenaForm,cantidad:c,pesoPromedio:faenaForm.pesoTotal?promedioFaena(c,faenaForm.pesoTotal):faenaForm.pesoPromedio}); }} />
              </div>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Peso total (kg)</label>
                <input type="number" inputMode="decimal" style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  placeholder="0" value={faenaForm.pesoTotal} onChange={e=>{ const pt=e.target.value; setFaenaForm({...faenaForm,pesoTotal:pt,pesoPromedio:promedioFaena(faenaForm.cantidad,pt)}); }} />
              </div>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Peso prom. (kg)</label>
                <input type="number" inputMode="decimal" style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  placeholder="0" value={faenaForm.pesoPromedio} onChange={e=>setFaenaForm({...faenaForm,pesoPromedio:e.target.value})} />
              </div>
            </div>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Observaciones</label>
            <input style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:16}}
              placeholder="Ej: animales de primer calidad, frigorífico origen..." value={faenaForm.obs} onChange={e=>setFaenaForm({...faenaForm,obs:e.target.value})} />
            <button onClick={guardarFaena} disabled={guardandoFaena}
              style={{width:"100%",padding:16,borderRadius:12,border:"none",background:guardandoFaena?"#A3ABB3":"#2A333B",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>
              {guardandoFaena?"Guardando...":"Guardar"}
            </button>
          </div>
        </div>
      );

      const modalStockEl = modalStock && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
          onClick={e=>{ if(e.target===e.currentTarget) setModalStock(false); }}>
          <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <span style={{fontWeight:700,fontSize:16}}>{editStock?"Editar ítem":"Nuevo ítem de stock"}</span>
              <button onClick={()=>setModalStock(false)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
            </div>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Nombre *</label>
            <input style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:12}}
              placeholder="Ej: Jamón Cocido Natural Sublime" value={stockForm.nombre}
              onChange={e=>setStockForm({...stockForm,nombre:e.target.value})} />
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Categoría</label>
                <select style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  value={stockForm.categoria} onChange={e=>setStockForm({...stockForm,categoria:e.target.value})}>
                  {CATEGORIAS_STOCK.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Unidad</label>
                <select style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  value={stockForm.unidad} onChange={e=>setStockForm({...stockForm,unidad:e.target.value})}>
                  {UNIDADES.map(u=><option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Cantidad actual *</label>
                <input type="number" inputMode="decimal" style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  placeholder="0" value={stockForm.cantidad} onChange={e=>setStockForm({...stockForm,cantidad:e.target.value})} />
              </div>
              <div>
                <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Mínimo alerta</label>
                <input type="number" inputMode="decimal" style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  placeholder="0 = sin alerta" value={stockForm.minimo} onChange={e=>setStockForm({...stockForm,minimo:e.target.value})} />
              </div>
            </div>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Observaciones</label>
            <input style={{width:"100%",padding:"12px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:16}}
              placeholder="Opcional" value={stockForm.obs} onChange={e=>setStockForm({...stockForm,obs:e.target.value})} />
            <button onClick={guardarStock} disabled={guardandoStock}
              style={{width:"100%",padding:16,borderRadius:12,border:"none",background:guardandoStock?"#A3ABB3":"#2A333B",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>
              {guardandoStock?"Guardando...":"Guardar"}
            </button>
          </div>
        </div>
      );




      // ── REPORT MODAL ──
      const reportModalEl = showReportModal && React.createElement("div", {
        style:{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:10000,overflowY:"auto"},
        onClick:e=>{if(e.target===e.currentTarget)setShowReportModal(false)}
      },
        React.createElement("div", {style:{background:"#fff",margin:"40px auto",maxWidth:440,borderRadius:20,padding:28,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}},
          React.createElement("div", {style:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}},
            React.createElement("h3", {style:{fontSize:18,fontWeight:800,color:"#2A333B"}}, "📄 Reporte Producción"),
            React.createElement("button", {onClick:()=>setShowReportModal(false),style:{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#79828B"}}, "✕")
          ),
          React.createElement("p", {style:{fontSize:13,color:"#79828B",marginBottom:16}}, "Seleccioná las secciones a incluir"),
          ...["rep-stock|📦 Stock actual","rep-stockalerta|⚠️ Stock bajo mínimo","rep-faena|🐖 Faena del mes","rep-lotes|🏷️ Lotes activos"].map(s=>{
            const [id,lbl]=s.split("|");
            return React.createElement("label",{key:id,style:{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #EDEEF0",cursor:"pointer",fontSize:14}},
              React.createElement("input",{type:"checkbox",id:id,defaultChecked:true,style:{width:18,height:18,accentColor:"#A4232A"}}),
              lbl
            );
          }),
          React.createElement("div",{style:{display:"flex",gap:10,marginTop:20}},
            React.createElement("button",{onClick:()=>exportar("pdf"),disabled:exportando,style:{flex:1,padding:14,borderRadius:12,border:"none",background:exportando?"#A3ABB3":"#A4232A",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}},exportando?"Generando...":"📄 PDF"),
            React.createElement("button",{onClick:()=>exportar("excel"),disabled:exportando,style:{flex:1,padding:14,borderRadius:12,border:"none",background:exportando?"#A3ABB3":"#1E4257",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}},exportando?"Generando...":"📊 Excel")
          )
        )
      );

      function getChk(id){return document.getElementById(id)?.checked;}
      function fmt$(n){return "$"+Math.round(n).toLocaleString("es-AR");}
      function fmtF(d){return d?d.split("-").reverse().join("/"):"—";}
      const hoyTexto = () => SersaleBase.fmtFecha(SersaleBase.hoy());

      // datos: { stock, alerta, faenas, lotes } ya cargados por exportar(); null = sección no pedida.
      function generarPDFProd(datos){
        const {jsPDF}=window.jspdf;
        const pdf=new jsPDF({orientation:"portrait",unit:"pt",format:"a4"});
        const PW=595,M=40,CW=PW-2*M;
        let y=40;
        const num=n=>SersaleBase.fmtNumero(parseFloat(n)||0,3);
        // Header
        pdf.setFillColor(192,57,43);pdf.rect(0,0,PW,70,"F");
        pdf.setFontSize(18);pdf.setTextColor(255,255,255);
        pdf.text("FRIGORÍFICO SERSALE",M,30);
        pdf.setFontSize(10);
        pdf.text("Reporte de Producción - "+hoyTexto(),M,48);
        pdf.setFontSize(8);
        pdf.text("24 de Noviembre 1926, Parque Patricios · CUIT 30-70227633-7",M,62);
        y=90;
        function checkP(n){if(y+n>800){pdf.addPage();y=40;}}
        // Los títulos van sin emoji: la letra del PDF no los tiene y salían como símbolos sueltos.
        function secTitle(t){checkP(40);pdf.setFillColor(44,62,80);pdf.rect(M,y,CW,22,"F");pdf.setFontSize(11);pdf.setTextColor(255,255,255);pdf.text(t,M+8,y+15);y+=30;pdf.setTextColor(0,0,0);}
        // Cada celda se corta al ancho de su columna para que un nombre largo no se imprima encima de la columna siguiente.
        function celda(c,ancho){const t=String(c==null?"":c).replace(/—/g,"-");const l=pdf.splitTextToSize(t,Math.max(10,ancho-6));return l.length>1?String(l[0]).replace(/\s+$/,"")+"...":t;}
        function tRow(cols,widths,bold,bg){checkP(18);if(bg){pdf.setFillColor(bg[0],bg[1],bg[2]);pdf.rect(M,y,CW,16,"F");}pdf.setFontSize(9);if(bold)pdf.setFont(undefined,"bold");else pdf.setFont(undefined,"normal");let x=M+4;cols.forEach((c,i)=>{pdf.text(celda(c,widths[i]),x,y+11);x+=widths[i];});y+=16;}
        function vacio(){tRow(["Sin registros"],[CW],false,null);}

        if(datos.stock){
          secTitle("STOCK ACTUAL");
          tRow(["Producto","Categoría","Cantidad","Unidad"],[200,120,80,CW-400],true,[220,220,220]);
          datos.stock.forEach((s,i)=>tRow([s.nombre,s.categoria,num(s.cantidad),s.unidad],[200,120,80,CW-400],false,i%2?[248,248,248]:null));
          if(!datos.stock.length) vacio();
          y+=10;
        }
        if(datos.alerta){
          secTitle("STOCK BAJO MÍNIMO");
          tRow(["Producto","Actual","Mínimo","Unidad"],[200,80,80,CW-360],true,[220,220,220]);
          datos.alerta.forEach((s,i)=>tRow([s.nombre,num(s.cantidad),num(s.minimo),s.unidad],[200,80,80,CW-360],false,i%2?[248,248,248]:null));
          if(!datos.alerta.length) vacio();
          y+=10;
        }
        if(datos.faenas){
          secTitle("FAENA - "+filtroFaenaMes.split("-").reverse().join("/"));
          tRow(["Fecha","Tipo","Cabezas","Peso Total","Peso Prom."],[110,80,70,80,CW-340],true,[220,220,220]);
          datos.faenas.forEach((f,i)=>tRow([fmtF(f.fecha),f.tipo,num(f.cantidad),num(f.pesoTotal)+" kg",num(f.pesoPromedio)+" kg"],[110,80,70,80,CW-340],false,i%2?[248,248,248]:null));
          if(!datos.faenas.length) vacio();
          y+=10;
        }
        if(datos.lotes){
          secTitle("LOTES DE TRAZABILIDAD");
          // Mismo criterio que el CSV: una fila por producto del lote, repitiendo nro de lote, fechas y operario.
          const anchosLote=[68,52,52,72,CW-332,88];
          tRow(["Nro Lote","Elaborac.","Vencim.","Operario","Producto","Cantidad"],anchosLote,true,[220,220,220]);
          datos.lotes.flatMap(l=>((l.productos||[]).length?l.productos:[{nombre:"-",cantidad:"",unidad:""}]).map(p=>[
            l.nroLote||"",fmtF(l.fechaElab),fmtF(l.fechaVenc),l.operario||"",p.nombre||"",
            (p.cantidad===""||p.cantidad==null?"":num(p.cantidad)+" "+(p.unidad||""))
          ])).forEach((fila,i)=>tRow(fila,anchosLote,false,i%2?[248,248,248]:null));
          if(!datos.lotes.length) vacio();
        }
        const tp=pdf.internal.getNumberOfPages();
        for(let i=1;i<=tp;i++){pdf.setPage(i);pdf.setFontSize(8);pdf.setTextColor(150,150,150);pdf.text("Frigorífico Sersale · Producción · "+hoyTexto()+" · Pág "+i+"/"+tp,PW/2,830,{align:"center"});}
        pdf.save("Sersale_Produccion_"+SersaleBase.hoy()+".pdf");
      }

      function generarExcelProd(datos){
        // Texto: entre comillas si trae ; " o salto de línea (si no, corre las columnas) y con apóstrofo
        // adelante si empieza con = + - @ (Excel lo tomaría como fórmula).
        const txt=v=>{let t=String(v==null?"":v);if(/^[=+\-@\t\r]/.test(t))t="'"+t;return /[;"\n\r]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;};
        // Números con coma decimal y sin separador de miles, como los lee un Excel configurado en Argentina.
        const num=n=>(parseFloat(n)||0).toLocaleString("es-AR",{useGrouping:false,maximumFractionDigits:3});
        const fila=cols=>cols.join(";")+"\n";
        let csv="sep=;\n";
        if(datos.stock){
          csv+="\nSTOCK ACTUAL\n";
          csv+="Producto;Categoría;Cantidad;Unidad;Mínimo\n";
          datos.stock.forEach(s=>csv+=fila([txt(s.nombre),txt(s.categoria),num(s.cantidad),txt(s.unidad),s.minimo?num(s.minimo):""]));
          if(!datos.stock.length) csv+="Sin registros\n";
        }
        if(datos.alerta){
          csv+="\nSTOCK BAJO MÍNIMO\n";
          csv+="Producto;Actual;Mínimo;Unidad\n";
          datos.alerta.forEach(s=>csv+=fila([txt(s.nombre),num(s.cantidad),num(s.minimo),txt(s.unidad)]));
          if(!datos.alerta.length) csv+="Sin registros\n";
        }
        if(datos.faenas){
          csv+="\nFAENA — "+filtroFaenaMes+"\n";
          csv+="Fecha;Tipo;Cabezas;Peso Total;Peso Promedio;Observaciones\n";
          datos.faenas.forEach(f=>csv+=fila([fmtF(f.fecha),txt(f.tipo),num(f.cantidad),num(f.pesoTotal),num(f.pesoPromedio),txt(f.obs)]));
          if(!datos.faenas.length) csv+="Sin registros\n";
        }
        if(datos.lotes){
          // Criterio: una fila por producto del lote (repitiendo nroLote/fechas/operario) para poder filtrar y pivotear en Excel; las materias primas van concatenadas en una sola columna para no multiplicar filas.
          csv+="\nLOTES DE TRAZABILIDAD\n";
          csv+="Nro Lote;Elaboración;Vencimiento;Operario;Producto;Cantidad;Unidad;Materias primas;Observaciones\n";
          datos.lotes.forEach(l=>{
            const mp=(l.materiasPrimas||[]).map(m=>[m.tipo,m.corte,m.proveedor,num(m.kg)+" kg"].filter(Boolean).join(" ")).join(" | ");
            const prods=(l.productos||[]).length?l.productos:[{nombre:"—",cantidad:"",unidad:""}];
            prods.forEach(p=>{
              csv+=fila([txt(l.nroLote),fmtF(l.fechaElab),fmtF(l.fechaVenc),txt(l.operario),txt(p.nombre),(p.cantidad===""||p.cantidad==null?"":num(p.cantidad)),txt(p.unidad),txt(mp),txt(l.obs)]);
            });
          });
          if(!datos.lotes.length) csv+="Sin registros\n";
        }
        const BOM="﻿";
        const blob=new Blob([BOM+csv],{type:"text/csv;charset=utf-8;"});
        const url=URL.createObjectURL(blob);
        const a=document.createElement("a");a.href=url;a.download="Sersale_Produccion_"+SersaleBase.hoy()+".csv";
        document.body.appendChild(a);a.click();document.body.removeChild(a);
        // El iPhone empieza la descarga un instante después del toque: si el enlace se libera enseguida, no baja nada.
        setTimeout(()=>URL.revokeObjectURL(url),60000);
      }


      return (
        <div style={{minHeight:"100vh",background:"#F2F3F5",maxWidth:"var(--app-max-w)",margin:"0 auto"}}>
          {modalLoteEl}
          {modalSalidaEl}
          {modalFaenaEl}
          {modalStockEl}
          {reportModalEl}
          {/* Header */}
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            <img src="assets/logo.png" alt="Sersale" style={{height:44,width:"auto",filter:"drop-shadow(0 1px 4px rgba(0,0,0,0.4))"}} />
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:16}}>Panel Director</div>
              <div style={{fontSize:12,opacity:0.85}}>Frigorífico Sersale</div>
            </div>
            <button style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12}} onClick={onSwitch}>Vista Encargado</button>
            <button style={{background:"rgba(255,255,255,0.3)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,marginLeft:6}} onClick={()=>setShowReportModal(true)}>📄</button>
          </div>

          {/* Tabs */}
          <div style={{display:"flex",background:"#fff",borderBottom:"1.5px solid #E4E7EA"}}>
            {[["reportes","📋 Reportes"],["stock","📦 Stock"],["faena","🐖 Faena"],["trazabilidad","🏷️ Lotes"]].map(([k,lbl])=>(
              <button key={k} onClick={()=>setTab(k)}
                style={{flex:1,padding:"13px 6px",border:"none",borderBottom:`3px solid ${tab===k?"#A4232A":"transparent"}`,
                  background:"transparent",fontWeight:600,fontSize:13,color:tab===k?"#A4232A":"#79828B",cursor:"pointer"}}>
                {lbl}
                {k==="stock"&&stockAlerta.length>0&&<span style={{marginLeft:4,background:"#C33039",color:"#fff",borderRadius:9,padding:"1px 5px",fontSize:10,fontWeight:700}}>{stockAlerta.length}</span>}
              </button>
            ))}
          </div>

          <div style={{padding:20}}>

            {/* ─ TAB REPORTES ─ */}
            {tab==="reportes" && (<>
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                <input type="date" style={{flex:1,minWidth:0,padding:"10px 12px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  value={filtroFecha} onChange={e=>setFiltroFecha(e.target.value)} />
                <select style={{flex:1,minWidth:0,padding:"10px 12px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  value={filtroArea} onChange={e=>setFiltroArea(e.target.value)}>
                  <option value="todos">Todas las áreas</option>
                  {Object.entries(AREAS).map(([k,a])=><option key={k} value={k}>{a.icon} {a.label}</option>)}
                </select>
                <button onClick={cargar} style={{padding:"10px 14px",borderRadius:10,border:"none",background:"#2A333B",color:"#fff",cursor:"pointer",fontSize:16}}>↻</button>
              </div>
              {reportes===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
              : reportes.length===0 ? (
                <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
                  <div style={{fontSize:48}}>📋</div><p>No hay reportes para este filtro</p>
                </div>
              ) : (<>
                {Object.keys(totalesDia).length>0 && (<>
                  <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,margin:"0 0 10px"}}>{filtroFecha?"Resumen del día":"Resumen de todas las fechas"}</p>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
                    {Object.entries(totalesDia).map(([ak,data])=>{
                      const a=areaDe(ak);
                      return (
                        <div key={ak} style={{borderRadius:12,border:`1.5px solid ${a.color}`,background:a.light,padding:12}}>
                          <div style={{fontWeight:700,color:a.color,marginBottom:4,fontSize:13,lineHeight:1.3}}>{a.icon} {a.label}</div>
                          <div style={{fontSize:11,color:"#79828B",marginBottom:8}}>{data.tandas} tanda{data.tandas!==1?"s":""}</div>
                          {data.items.map((it,i)=>(
                            <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:11,paddingBottom:3}}>
                              <span style={{color:"#262C32",flex:1,paddingRight:4}}>{it.producto}</span>
                              <span style={{fontWeight:700,color:a.color,whiteSpace:"nowrap"}}>{fmtN(it.cantidad)} {it.unidad}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>)}
                <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,margin:"0 0 10px"}}>Reportes ({reportes.length})</p>
                {reportes.map(r=>{
                  const a=areaDe(r.area); const isOpen=expanded===r.id;
                  return (
                    <div key={r.id} style={{background:"#fff",borderRadius:12,border:`1.5px solid ${a.color}`,padding:14,marginBottom:10}}>
                      <div onClick={()=>setExpanded(isOpen?null:r.id)} style={{cursor:"pointer"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                          <span style={{background:a.color,color:"#fff",borderRadius:6,padding:"3px 8px",fontSize:12,fontWeight:700}}>{a.icon} {a.label}</span>
                          <span style={{fontSize:13,color:"#79828B",fontWeight:600}}>{!filtroFecha&&r.fechaISO?fmt(r.fechaISO)+" · ":""}{fmtH(r.fechaISO)}</span>
                        </div>
                        <div style={{fontWeight:700,fontSize:15,marginBottom:3}}>{r.encargado}</div>
                        <div style={{fontSize:12,color:"#5C666F",lineHeight:1.4}}>
                          {r.items.length} producto{r.items.length!==1?"s":""} · {r.items.map(i=>`${i.cantidad} ${i.unidad} de ${i.producto}`).join(" · ")}
                        </div>
                        {r.editadoEn && <div style={{fontSize:11,color:"#A8702A",marginTop:4}}>✏️ Editado</div>}
                      </div>
                      {isOpen && (
                        <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid #E4E7EA"}}>
                          {r.items.map((it,i)=>(
                            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:14,borderBottom:"1px solid #F2F3F5"}}>
                              <span style={{flex:1,paddingRight:8}}>{it.producto}</span>
                              <span style={{fontWeight:700,color:a.color,whiteSpace:"nowrap"}}>{it.cantidad} {it.unidad}</span>
                            </div>
                          ))}
                          {r.obs && <p style={{marginTop:10,fontSize:13,color:"#5C666F",fontStyle:"italic"}}>📝 {r.obs}</p>}
                          <div style={{display:"flex",gap:8,marginTop:12}}>
                            <button onClick={()=>abrirEdit(r)}
                              style={{flex:1,padding:"9px 0",borderRadius:8,border:"1.5px solid #2A333B",background:"transparent",color:"#2A333B",fontWeight:600,fontSize:13,cursor:"pointer"}}>
                              ✏️ Editar
                            </button>
                            <button onClick={()=>eliminarReporte(r.id)}
                              style={{flex:1,padding:"9px 0",borderRadius:8,border:"1.5px solid #C33039",background:"transparent",color:"#C33039",fontWeight:600,fontSize:13,cursor:"pointer"}}>
                              🗑️ Eliminar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>)}
            </>)}

            {/* ─ TAB STOCK ─ */}
            {tab==="stock" && (<>
              {/* Sub-tabs */}
              <div style={{display:"flex",gap:0,marginBottom:16,background:"#E4E7EA",borderRadius:10,padding:3}}>
                {[["items","📦 Stock"],["movimientos","📋 Movimientos"]].map(([k,lbl])=>(
                  <button key={k} onClick={()=>setStockSubTab(k)}
                    style={{flex:1,padding:"9px 10px",borderRadius:8,border:"none",background:stockSubTab===k?"#fff":"transparent",
                      fontWeight:600,fontSize:13,color:stockSubTab===k?"#2A333B":"#79828B",cursor:"pointer",
                      boxShadow:stockSubTab===k?"0 1px 4px rgba(0,0,0,0.1)":""}}>{lbl}</button>
                ))}
              </div>

              {stockSubTab==="items" && (<>
                <ConfigWhatsApp />
                {stockAlerta.length>0 && (
                  <div style={{background:"#F3EEE2",border:"1.5px solid #B5872F",borderRadius:12,padding:"12px 14px",marginBottom:16}}>
                    <div style={{fontWeight:700,color:"#A8702A",fontSize:13,marginBottom:6}}>⚠️ Stock bajo en {stockAlerta.length} ítem{stockAlerta.length!==1?"s":""}</div>
                    {stockAlerta.map(s=>(
                      <div key={s.id} style={{fontSize:12,color:"#5C666F",paddingBottom:3}}>
                        {s.nombre}: <strong style={{color:"#C33039"}}>{fmtN(s.cantidad)} {s.unidad}</strong> (mín. {s.minimo})
                      </div>
                    ))}
                  </div>
                )}
                <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                  <select style={{flex:1,padding:"10px 12px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",minWidth:120}}
                    value={filtroCategoria} onChange={e=>setFiltroCategoria(e.target.value)}>
                    <option value="todas">Todas las categorías</option>
                    {CATEGORIAS_STOCK.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <button onClick={()=>abrirModalSalida()}
                    style={{padding:"10px 14px",borderRadius:10,border:"none",background:"#C33039",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>
                    📤 Salida
                  </button>
                  <button onClick={()=>abrirModalStock()}
                    style={{padding:"10px 14px",borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>
                    + Nuevo
                  </button>
                </div>
                {stockItems===null ? (
                  <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
                ) : stockItems.length>0 && stockFiltrado.length===0 ? (
                  <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
                    <div style={{fontSize:48}}>📦</div>
                    <p>No hay ítems en la categoría {filtroCategoria}</p>
                  </div>
                ) : stockFiltrado.length===0 ? (
                  <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
                    <div style={{fontSize:48}}>📦</div>
                    <p style={{marginBottom:16}}>No hay ítems de stock</p>
                    <button onClick={()=>abrirModalStock()} style={{padding:"12px 24px",borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,cursor:"pointer"}}>
                      + Agregar primero
                    </button>
                  </div>
                ) : (
                  stockFiltrado.map(s=>{
                    const bajo = s.minimo>0 && s.cantidad<=s.minimo;
                    return (
                      <div key={s.id} style={{background:"#fff",borderRadius:12,border:`1.5px solid ${bajo?"#C33039":"#E4E7EA"}`,padding:14,marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700,fontSize:15,marginBottom:2}}>{s.nombre}</div>
                            <div style={{fontSize:11,color:"#79828B",marginBottom:8}}>{s.categoria}{s.obs?` · ${s.obs}`:""}</div>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <button onClick={()=>ajustarCantidad(s,-1)}
                                style={{width:32,height:32,borderRadius:8,border:"1.5px solid #D8DCE0",background:"#F7F8F9",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                              <span style={{fontWeight:700,fontSize:18,color:bajo?"#C33039":"#2A333B",minWidth:60,textAlign:"center"}}>
                                {fmtN(s.cantidad)} <span style={{fontSize:13,fontWeight:400,color:"#79828B"}}>{s.unidad}</span>
                              </span>
                              <button onClick={()=>ajustarCantidad(s,1)}
                                style={{width:32,height:32,borderRadius:8,border:"1.5px solid #D8DCE0",background:"#F7F8F9",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                              {bajo && <span style={{fontSize:11,background:"#F7EAEA",color:"#C33039",padding:"3px 8px",borderRadius:6,fontWeight:600}}>⚠️ Bajo</span>}
                            </div>
                          </div>
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            <button onClick={()=>abrirModalStock(s)}
                              style={{padding:"6px 12px",borderRadius:8,border:"1.5px solid #2A333B",background:"transparent",color:"#2A333B",fontWeight:600,fontSize:12,cursor:"pointer"}}>
                              ✏️ Editar
                            </button>
                            <button onClick={()=>eliminarStock(s.id)}
                              style={{padding:"6px 12px",borderRadius:8,border:"1.5px solid #C33039",background:"transparent",color:"#C33039",fontWeight:600,fontSize:12,cursor:"pointer"}}>
                              🗑️
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </>)}

              {stockSubTab==="movimientos" && (<>
                <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
                  <button onClick={cargarMovimientos} style={{padding:"8px 14px",borderRadius:8,border:"none",background:"#2A333B",color:"#fff",fontSize:13,cursor:"pointer"}}>↻ Actualizar</button>
                </div>
                {movimientos===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
                : movimientos.length===0 ? (
                  <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}><div style={{fontSize:48}}>📋</div><p>Sin movimientos registrados</p></div>
                ) : movimientos.map(m=>{
                  const esEntrada = m.tipo==="entrada";
                  return (
                    <div key={m.id} style={{background:"#fff",borderRadius:12,border:`1.5px solid ${esEntrada?"#DDE9E2":"#EEDADB"}`,padding:12,marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                            <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:20,
                              background:esEntrada?"#DDE9E2":"#EEDADB",
                              color:esEntrada?"#24523D":"#A4232A"}}>
                              {esEntrada?"▲ ENTRADA":"▼ SALIDA"}
                            </span>
                            <span style={{fontSize:11,color:"#79828B"}}>
                              {m.subtipo==="produccion"?"🏭 Producción":m.subtipo==="despacho"?`🚚 Despacho → ${m.destino}`:m.subtipo==="venta"?"💰 Venta planta":"📦 Pedido cliente"}
                            </span>
                          </div>
                          <div style={{fontWeight:600,fontSize:14}}>{m.nombre}</div>
                          <div style={{fontSize:13,color:esEntrada?"#24523D":"#A4232A",fontWeight:700,marginTop:2}}>
                            {esEntrada?"+":"-"}{m.cantidad} {m.unidad}
                          </div>
                          {m.encargado&&<div style={{fontSize:11,color:"#79828B",marginTop:2}}>👤 {m.encargado}</div>}
                          {m.obs&&<div style={{fontSize:11,color:"#79828B",marginTop:2}}>📝 {m.obs}</div>}
                        </div>
                        <div style={{fontSize:11,color:"#A3ABB3",whiteSpace:"nowrap",textAlign:"right"}}>
                          {m.fecha?m.fecha.split("-").reverse().join("/"):""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>)}
            </>)}

            {/* ─ TAB FAENA ─ */}
            {tab==="faena" && (<>
              {(() => {
                const faeanasMes = (faenas||[]).filter(f=>f.fecha&&f.fecha.startsWith(filtroFaenaMes));
                const totalCabezas = faeanasMes.reduce((s,f)=>s+(parseFloat(f.cantidad)||0),0);
                const totalPeso = faeanasMes.reduce((s,f)=>s+(parseFloat(f.pesoTotal)||0),0);
                const porTipo = {};
                faeanasMes.forEach(f=>{ porTipo[f.tipo]=(porTipo[f.tipo]||0)+(parseFloat(f.cantidad)||0); });
                return (<>
                  <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
                    <input type="month" style={{flex:1,padding:"10px 12px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                      value={filtroFaenaMes} onChange={e=>setFiltroFaenaMes(e.target.value)} />
                    <button onClick={()=>abrirModalFaena()}
                      style={{padding:"10px 16px",borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",whiteSpace:"nowrap"}}>
                      + Registrar
                    </button>
                  </div>
                  {faeanasMes.length>0 && (
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                      <div style={{background:"#fff",borderRadius:12,border:"1.5px solid #E4E7EA",padding:14,textAlign:"center"}}>
                        <div style={{fontSize:28,fontWeight:700,color:"#2A333B"}}>{totalCabezas}</div>
                        <div style={{fontSize:11,color:"#79828B",textTransform:"uppercase",letterSpacing:.5}}>Cabezas faenadas</div>
                        {Object.entries(porTipo).map(([t,c])=>(
                          <div key={t} style={{fontSize:11,color:"#5C666F",marginTop:4}}>{t}: {c}</div>
                        ))}
                      </div>
                      <div style={{background:"#fff",borderRadius:12,border:"1.5px solid #E4E7EA",padding:14,textAlign:"center"}}>
                        <div style={{fontSize:28,fontWeight:700,color:"#A4232A"}}>{totalPeso>0?Math.round(totalPeso).toLocaleString("es-AR"):"-"}</div>
                        <div style={{fontSize:11,color:"#79828B",textTransform:"uppercase",letterSpacing:.5}}>Kg totales</div>
                        <div style={{fontSize:11,color:"#5C666F",marginTop:4}}>{faeanasMes.length} faena{faeanasMes.length!==1?"s":""} en el mes</div>
                      </div>
                    </div>
                  )}
                  {faenas===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
                  : (faenas||[]).length===0 ? (
                    <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
                      <div style={{fontSize:48}}>🐖</div>
                      <p style={{marginBottom:16}}>Sin registros de faena</p>
                      <button onClick={()=>abrirModalFaena()} style={{padding:"12px 24px",borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,cursor:"pointer"}}>
                        + Registrar primera faena
                      </button>
                    </div>
                  ) : faeanasMes.length===0 ? (
                    <p style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}>Sin faenas en este mes</p>
                  ) : (
                    faeanasMes.map(f=>(
                      <div key={f.id} style={{background:"#fff",borderRadius:12,border:"1.5px solid #E4E7EA",padding:14,marginBottom:10}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                          <div style={{flex:1}}>
                            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                              <span style={{background:"#2A333B",color:"#fff",borderRadius:6,padding:"3px 8px",fontSize:12,fontWeight:700}}>
                                {f.tipo==="Cerdo"?"🐖":f.tipo==="Vaca"?"🐄":f.tipo==="Ternero"?"🐂":f.tipo==="Cordero"?"🐑":"🐾"} {f.tipo}
                              </span>
                              <span style={{fontSize:13,color:"#79828B"}}>{f.fecha?f.fecha.split("-").reverse().join("/"):"—"}</span>
                            </div>
                            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                              <div><span style={{fontSize:22,fontWeight:700,color:"#2A333B"}}>{f.cantidad}</span><span style={{fontSize:12,color:"#79828B",marginLeft:4}}>cabezas</span></div>
                              {f.pesoTotal>0&&<div><span style={{fontSize:16,fontWeight:700,color:"#A4232A"}}>{f.pesoTotal.toLocaleString("es-AR")} kg</span><span style={{fontSize:11,color:"#79828B",marginLeft:4}}>total</span></div>}
                              {f.pesoPromedio>0&&<div><span style={{fontSize:14,fontWeight:600,color:"#5C666F"}}>{f.pesoPromedio} kg</span><span style={{fontSize:11,color:"#79828B",marginLeft:4}}>prom.</span></div>}
                            </div>
                            {f.obs&&<div style={{fontSize:12,color:"#79828B",marginTop:6,fontStyle:"italic"}}>📝 {f.obs}</div>}
                          </div>
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            <button onClick={()=>abrirModalFaena(f)}
                              style={{padding:"6px 12px",borderRadius:8,border:"1.5px solid #2A333B",background:"transparent",color:"#2A333B",fontWeight:600,fontSize:12,cursor:"pointer"}}>✏️</button>
                            <button onClick={()=>eliminarFaena(f.id)}
                              style={{padding:"6px 12px",borderRadius:8,border:"1.5px solid #C33039",background:"transparent",color:"#C33039",fontWeight:600,fontSize:12,cursor:"pointer"}}>🗑️</button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </>);
              })()}
            </>)}

            {/* ─ TAB TRAZABILIDAD ─ */}
            {tab==="trazabilidad" && (<>
              <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
                <input type="month" style={{flex:1,padding:"10px 12px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
                  value={filtroLoteMes} onChange={e=>setFiltroLoteMes(e.target.value)} />
                <button onClick={abrirModalLote}
                  style={{padding:"10px 16px",borderRadius:10,border:"none",background:"#2A333B",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>
                  + Nuevo Lote
                </button>
              </div>

              {lotes===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
              : lotes.filter(l=>l.fechaElab&&l.fechaElab.startsWith(filtroLoteMes)).length===0 ? (
                <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
                  <div style={{fontSize:48}}>🏷️</div>
                  <p style={{marginBottom:16}}>Sin lotes registrados este mes</p>
                  <button onClick={abrirModalLote} style={{padding:"12px 24px",borderRadius:10,border:"none",background:"#2A333B",color:"#fff",fontWeight:700,cursor:"pointer"}}>
                    + Registrar primer lote
                  </button>
                </div>
              ) : lotes.filter(l=>l.fechaElab&&l.fechaElab.startsWith(filtroLoteMes)).map(l=>{
                const dv = l.fechaVenc ? SersaleBase.diasEntre(SersaleBase.hoy(), l.fechaVenc) : NaN; // días de calendario en Buenos Aires
                const diasVenc = isNaN(dv) ? null : dv;
                const vencColor = diasVenc===null?"#79828B":diasVenc<0?"#C33039":diasVenc<=7?"#A8702A":"#2F6B4F";
                const expanded = loteDetalle===l.id;
                return (
                  <div key={l.id} style={{background:"#fff",borderRadius:12,border:"1.5px solid #E4E7EA",marginBottom:10,overflow:"hidden"}}>
                    <div onClick={()=>setLoteDetalle(expanded?null:l.id)}
                      style={{padding:14,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <span style={{background:"#2A333B",color:"#fff",borderRadius:6,padding:"3px 10px",fontSize:12,fontWeight:700,fontFamily:"monospace"}}>
                            {l.nroLote}
                          </span>
                          <span style={{fontSize:11,color:"#79828B"}}>👤 {l.operario}</span>
                        </div>
                        <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:12,color:"#5C666F"}}>
                          <span>📅 Elab: {l.fechaElab?l.fechaElab.split("-").reverse().join("/"):"-"}</span>
                          <span style={{color:vencColor,fontWeight:600}}>
                            ⏳ Venc: {l.fechaVenc?l.fechaVenc.split("-").reverse().join("/"):"-"}
                            {diasVenc!==null&&<span style={{marginLeft:4}}>({diasVenc<0?`vencido hace ${-diasVenc}d`:diasVenc===0?"hoy":`${diasVenc}d`})</span>}
                          </span>
                        </div>
                        <div style={{fontSize:11,color:"#79828B",marginTop:4}}>
                          {(l.productos||[]).map(p=>`${p.cantidad} ${p.unidad} de ${p.nombre}`).join(" · ")}
                        </div>
                      </div>
                      <span style={{fontSize:18,color:"#B9BFC5"}}>{expanded?"▴":"▾"}</span>
                    </div>
                    {expanded && (
                      <div style={{borderTop:"1px solid #EDEEF0",padding:14}}>
                        <p style={{fontWeight:700,fontSize:11,color:"#79828B",textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Materias Primas</p>
                        {(l.materiasPrimas||[]).map((mp,i)=>(
                          <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #F2F3F5",fontSize:13}}>
                            <span>{mp.tipo==="cerdo"?"🐖":"🐄"} {mp.corte} — {mp.proveedor}</span>
                            <span style={{fontWeight:700,color:"#2A333B"}}>{mp.kg} kg</span>
                          </div>
                        ))}
                        <p style={{fontWeight:700,fontSize:11,color:"#79828B",textTransform:"uppercase",letterSpacing:.5,margin:"10px 0 8px"}}>Productos Elaborados</p>
                        {(l.productos||[]).map((p,i)=>(
                          <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #F2F3F5",fontSize:13}}>
                            <span>📦 {p.nombre}</span>
                            <span style={{fontWeight:700,color:"#2F6B4F"}}>{p.cantidad} {p.unidad}</span>
                          </div>
                        ))}
                        {l.obs&&<div style={{fontSize:12,color:"#79828B",marginTop:8,fontStyle:"italic"}}>📝 {l.obs}</div>}
                        <div style={{marginTop:10,padding:"8px 12px",borderRadius:8,background:"#F7F8F9",fontSize:11,color:"#5C666F",textAlign:"center"}}>
                          Lote registrado el {(l.createdAt&&fmt(l.createdAt))||"—"}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>)}

          </div>
        </div>
      );
    }

    /* ═══════════════════════════════════════════════════════
       APP ROOT (sin PIN - el rol se valida al inicio del archivo)
    ═══════════════════════════════════════════════════════ */
    function App() {
      const [vista, setVista] = useState("encargado");
      if (vista==="director") return <VistaDirector onSwitch={()=>setVista("encargado")} />;
      return <VistaEncargado onSwitch={()=>setVista("director")} />;
    }

    ReactDOM.createRoot(document.getElementById("root")).render(<App />);

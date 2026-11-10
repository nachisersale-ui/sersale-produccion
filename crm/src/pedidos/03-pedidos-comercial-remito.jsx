    // Kg que se facturan de un ítem: lo pesado (aunque sea 0) o, si no se pesó, lo pedido.
    // Es la única cuenta de kg del remito: pantalla, PDF, remito guardado y cuenta corriente.
    function kgFacturables(it) {
      if (it.kgReal != null && it.kgReal !== "") return Number(it.kgReal) || 0;
      return parseFloat(it.cantidad) || 0;
    }

    // Para saber si los ítems de un pedido cambiaron desde que se abrió una pantalla.
    function firmaItemsPedido(items) {
      return JSON.stringify((items || []).map(it => [it.producto || "", String(it.cantidad == null ? "" : it.cantidad), it.unidad || "", it.kgReal == null || it.kgReal === "" ? null : Number(it.kgReal)]));
    }

    // Cambio de estado (y de kg) de un pedido sin pisar lo que cargó otro teléfono.
    //   visto:        el pedido tal como lo muestra la tarjeta que se tocó.
    //   itemsConKg:   opcional, los ítems de esa tarjeta con los kg recién escritos.
    // Se hace en una transacción contra el documento actual: si el estado ya no es
    // el que mostraba la tarjeta, o los productos cambiaron, no se escribe nada.
    // De los kg solo se guardan los que la persona cambió; el resto queda como está
    // en la base. Devuelve { ok: true } o { ok: false, motivo }.
    async function pedidoCambiarEstado(visto, nuevoEstado, itemsConKg) {
      const { db, doc, runTransaction } = fb();
      const ref = doc(db, "pedidos", visto.id);
      const marca = new Date().toISOString();
      const res = await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return { ok: false, motivo: "Ese pedido ya no existe. Se actualizó la lista." };
        const actual = snap.data();
        // Si se cortó la señal justo al confirmar, Firestore vuelve a ejecutar esto con el cambio
        // YA guardado. Se lo reconoce por su marca en el historial: sin esto se avisaba "cambió
        // desde otro teléfono" (era este) y no se seguía con lo que viene después de guardar.
        if ((actual.historial || []).some(x => x && x.fecha === marca && x.estado === nuevoEstado)) return { ok: true };
        if ((actual.estado || "pendiente") !== (visto.estado || "pendiente")) {
          const etiqueta = (ESTADOS[actual.estado] || ESTADOS.pendiente).label.replace(" ✓", "");
          return { ok: false, motivo: "El pedido de " + (actual.cliente || visto.cliente) + " cambió desde otro teléfono: ahora está " + etiqueta + ". Se actualizó la lista." };
        }
        const upd = {
          estado: nuevoEstado,
          historial: [...(actual.historial || []), { estado: nuevoEstado, fecha: marca }]
        };
        if (itemsConKg) {
          const actuales = actual.items || [];
          const vistos = visto.items || [];
          const mismos = actuales.length === itemsConKg.length && actuales.every((it, i) =>
            it.producto === itemsConKg[i].producto && String(it.cantidad) === String(itemsConKg[i].cantidad) && (it.unidad || "") === (itemsConKg[i].unidad || ""));
          if (!mismos) return { ok: false, motivo: "Los productos del pedido de " + (actual.cliente || visto.cliente) + " cambiaron desde otro teléfono. Se actualizó la lista: cargá los kg de nuevo." };
          const igual = (a, b) => (a == null || a === "" ? null : Number(a)) === (b == null || b === "" ? null : Number(b));
          upd.items = actuales.map((it, i) => {
            const escrito = itemsConKg[i].kgReal;
            const antes = vistos[i] ? vistos[i].kgReal : undefined;
            return igual(escrito, antes) ? it : { ...it, kgReal: escrito };
          });
        }
        tx.update(ref, upd);
        return { ok: true };
      });
      // Que la lista que se recarga a continuación ya traiga el cambio
      if (res.ok) await esperarCopiaLocal(ref, d => !!d && (d.historial || []).some(x => x.fecha === marca));
      return res;
    }

    // Pedido cancelado: su "Pendiente de facturar" ($0) sale de la cuenta corriente (ya no
    // se va a facturar). Si el pedido tenía remito, el cargo queda como está: eso lo
    // decide una persona. La cancelación ya está guardada; si esto falla solo se anota.
    async function czAlCancelarPedido(pedido) {
      try { await czQuitarPendienteDePedido(pedido); }
      catch(e) { console.error("[Pedido] No se pudo quitar el pendiente de facturar del pedido cancelado:", e); }
    }

    // Lo que VistaComercial les pasa a las tarjetas aunque estén dentro de otra lista
    // (el historial no recibe onRemito): permite hacer el remito de un pedido ya despachado.
    const ComercialCtx = React.createContext(null);

    // ── TARJETA PEDIDO ──────────────────────────────────────
    function TarjetaPedido({ pedido, onCambiarEstado, showActions, isNew, onEditar, onRemito, onDetallePrep, modoOperario }) {
      const [expanded, setExpanded] = useState(false);
      const [kgModal, setKgModal] = useState(false);
      const [kgValues, setKgValues] = useState({});
      const [editKgModal, setEditKgModal] = useState(false);
      const [editKgValues, setEditKgValues] = useState({});
      const est = ESTADOS[pedido.estado] || ESTADOS.pendiente;
      const comercial = React.useContext(ComercialCtx);
      const abrirRemito = onRemito || (comercial && comercial.onRemito) || null;
      // Un cambio por vez: mientras se guarda, los botones quedan bloqueados.
      // Devuelve true si la hoja de kg se puede cerrar.
      const [cambiar, cambiando] = SersaleBase.useAccion(async (estado, items) => {
        const guardado = Promise.resolve().then(() => onCambiarEstado(pedido.id, estado, items));
        if (!comercial) {
          // Depósito: el cambio queda en el teléfono y se envía solo aunque no haya
          // señal (como siempre). Se espera un momento por si falla enseguida.
          let fallo = false;
          const fin = guardado.then(() => {}, e => {
            fallo = true;
            console.error(e);
            SersaleUI.toast("No se pudo guardar el cambio. Probá de nuevo.", { tipo: "error" });
          });
          await Promise.race([fin, new Promise(r => setTimeout(r, 1500))]);
          return !fallo;
        }
        // Comercial: se confirma contra el servidor; false = no se guardó (ya se avisó por qué).
        try {
          return (await guardado) !== false;
        } catch(e) {
          console.error(e);
          SersaleUI.toast("No se pudo guardar el cambio. Probá de nuevo.", { tipo: "error" });
          return false;
        }
      });
      async function cancelar() {
        const ok = await SersaleUI.confirmar({
          titulo: "¿Cancelar el pedido de " + pedido.cliente + "?",
          cuerpo: "El pedido sale de la lista de activos y del depósito. No se puede deshacer desde la app.",
          aceptar: "Cancelar pedido", cancelar: "Volver", peligro: true
        });
        if (ok) cambiar("cancelado");
      }
      return (
        <>
        <div style={{background:"#fff",borderRadius:14,borderLeft:`4px solid ${est.color}`,borderTop:"1px solid #EDEEF0",borderRight:"1px solid #EDEEF0",borderBottom:"1px solid #EDEEF0",marginBottom:10,overflow:"hidden",position:"relative",boxShadow:"0 2px 10px rgba(0,0,0,0.06)"}}>
          {isNew && <div style={{position:"absolute",top:0,right:0,background:"#C33039",color:"#fff",fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:"0 12px 0 8px"}}>NUEVO</div>}
          <div onClick={()=>setExpanded(!expanded)} style={{padding:14,cursor:"pointer"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{fontWeight:800,fontSize:15,color:"#111",letterSpacing:"-0.2px"}}>{pedido.cliente}</span>
              <span className="badge" style={{background:est.bg,color:est.color}}>{est.label}</span>
            </div>
            <div style={{display:"flex",gap:16,fontSize:12,color:"#79828B",flexWrap:"wrap"}}>
              <span>📅 Entrega: <strong style={{color:"#262C32"}}>{fmt(pedido.fechaEntrega+"T12:00:00")}</strong></span>
              {pedido.tipo==="envio"  && <span style={{color:"#26536E",fontWeight:600}}>🚚 Envío</span>}
              {pedido.tipo==="retiro" && <span style={{color:"#2F6B4F",fontWeight:600}}>🏪 Retiro</span>}
              {pedido.cuentaCorriente && <span style={{color:"#6B4E8E",fontWeight:600}}>💳 Cta Cte</span>}
            </div>
            <div style={{fontSize:12,color:"#79828B",marginTop:4}}>
              {pedido.items.length} producto{pedido.items.length!==1?"s":""} · {fmtH(pedido.fechaPedidoISO)}
            </div>
          </div>
          {expanded && (
            <div style={{borderTop:"1px solid #E4E7EA",padding:14}}>
              {pedido.items.map((it,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #F2F3F5",fontSize:13}}>
                  <span style={{flex:1,paddingRight:8,color:"#262C32"}}>{it.producto}</span>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2}}>
                    <span style={{fontWeight:700,color:est.color,whiteSpace:"nowrap"}}>{it.cantidad} {it.unidad}</span>
                    {it.kgReal!=null && it.kgReal!=="" && <span style={{fontSize:11,color:"#2F6B4F",fontWeight:600}}>⚖️ {it.kgReal} kg real</span>}
                  </div>
                </div>
              ))}
              {pedido.obs && <p style={{marginTop:10,fontSize:12,color:"#5C666F",fontStyle:"italic"}}>📝 {pedido.obs}</p>}
              {showActions && !["despachado","cancelado"].includes(pedido.estado) && (
                <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                  {pedido.estado==="pendiente"  && <button onClick={()=>{ setKgValues({}); setKgModal(true); }} style={{flex:1,padding:"10px 8px",borderRadius:12,border:"none",background:"#26536E",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>⚙️ En preparación</button>}
                  {pedido.estado==="preparando" && !modoOperario && <button disabled={cambiando} onClick={()=>cambiar("listo")}      style={{flex:1,padding:"10px 8px",borderRadius:12,border:"none",background:"#2F6B4F",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",opacity:cambiando?0.6:1}}>✅ Listo</button>}
                  {pedido.estado==="preparando" && onDetallePrep && <button onClick={onDetallePrep} style={{padding:"10px 12px",borderRadius:12,border:"1.5px solid #26536E",background:"transparent",color:"#26536E",fontWeight:700,fontSize:12,cursor:"pointer"}}>📋 Ítems</button>}
                  {pedido.estado==="listo" && !modoOperario && <button disabled={cambiando} onClick={()=>cambiar("despachado")} style={{flex:1,padding:"10px 8px",borderRadius:12,border:"none",background:"#79828B",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",opacity:cambiando?0.6:1}}>🚚 Despachado</button>}
                  {pedido.estado==="listo" && !modoOperario && onRemito && <button onClick={()=>onRemito(pedido)} style={{padding:"10px 12px",borderRadius:12,border:"none",background:"#6B4E8E",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>🧾 Remito</button>}
                  {pedido.estado==="listo" && <button onClick={()=>{ const vals={}; pedido.items.forEach((it,i)=>{ if(it.kgReal!=null) vals[i]=it.kgReal; }); setEditKgValues(vals); setEditKgModal(true); }} style={{padding:"10px 12px",borderRadius:12,border:"1.5px solid #2F6B4F",background:"transparent",color:"#2F6B4F",fontWeight:700,fontSize:12,cursor:"pointer"}}>⚖️ kg</button>}
                  {onEditar && !modoOperario && <button onClick={()=>onEditar(pedido)} style={{padding:"10px 14px",borderRadius:12,border:"1.5px solid #2A333B",background:"transparent",color:"#2A333B",fontWeight:700,fontSize:12,cursor:"pointer"}}>✏️</button>}
                  {!modoOperario && <button disabled={cambiando} onClick={cancelar} aria-label="Cancelar pedido" style={{padding:"10px 14px",borderRadius:12,border:"1.5px solid #C33039",background:"transparent",color:"#C33039",fontWeight:700,fontSize:12,cursor:"pointer"}}>❌</button>}
                </div>
              )}
              {/* Pedido despachado sin remito (o con un remito a corregir): solo desde Comercial */}
              {pedido.estado==="despachado" && !modoOperario && abrirRemito && pedido.origen!=="venta_rapida" && !String(pedido.id||"").startsWith("cc_") && (
                <div style={{display:"flex",gap:8,marginTop:12}}>
                  <button onClick={()=>abrirRemito(pedido)} style={{padding:"10px 12px",borderRadius:12,border:"none",background:"#6B4E8E",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>🧾 Remito</button>
                </div>
              )}
            </div>
          )}
        </div>
        {kgModal && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
            onClick={e=>{ if(e.target===e.currentTarget) setKgModal(false); }}>
            <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px calc(32px + env(safe-area-inset-bottom))",width:"100%",maxWidth:480,maxHeight:"80vh",overflowY:"auto",paddingBottom:"calc(80px + env(safe-area-inset-bottom))"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontWeight:800,fontSize:16}}>Anotar kg por ítem</span>
                <button onClick={()=>setKgModal(false)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
              </div>
              <p style={{fontSize:12,color:"#79828B",marginBottom:16}}>Opcional — dejá en blanco los que no apliquen</p>
              {pedido.items.map((it,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                  <span style={{flex:1,fontSize:13,color:"#262C32"}}>{it.producto}</span>
                  <input type="number" inputMode="decimal" step="any" min="0" placeholder="kg"
                    style={{width:90,padding:"10px 12px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:16,textAlign:"right"}}
                    value={kgValues[i]||""} onChange={e=>setKgValues({...kgValues,[i]:e.target.value})} />
                  <span style={{fontSize:12,color:"#79828B",width:24}}>kg</span>
                </div>
              ))}
              <button disabled={cambiando} onClick={async ()=>{
                const itemsConKg = pedido.items.map((it,i)=>({
                  ...it, kgReal: kgValues[i]!=null && kgValues[i]!=="" ? parseFloat(kgValues[i]) : null
                }));
                // La hoja se cierra recién cuando el cambio quedó guardado.
                if (await cambiar("preparando", itemsConKg)) setKgModal(false);
              }} style={{width:"100%",padding:16,borderRadius:14,border:"none",background:cambiando?"#A3ABB3":"#26536E",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer",marginTop:8}}>
                {cambiando ? "Guardando..." : "⚙️ Confirmar — En preparación"}
              </button>
            </div>
          </div>
        )}
        {editKgModal && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
            onClick={e=>{ if(e.target===e.currentTarget) setEditKgModal(false); }}>
            <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px calc(32px + env(safe-area-inset-bottom))",width:"100%",maxWidth:480,maxHeight:"80vh",overflowY:"auto",paddingBottom:"calc(80px + env(safe-area-inset-bottom))"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontWeight:800,fontSize:16}}>Editar kg — {pedido.cliente}</span>
                <button onClick={()=>setEditKgModal(false)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
              </div>
              <p style={{fontSize:12,color:"#79828B",marginBottom:16}}>Modificá los kg reales de cada ítem</p>
              {pedido.items.map((it,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                  <span style={{flex:1,fontSize:13,color:"#262C32"}}>{it.producto}</span>
                  <input type="number" inputMode="decimal" step="any" min="0" placeholder="kg"
                    style={{width:90,padding:"10px 12px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:16,textAlign:"right"}}
                    value={editKgValues[i]!=null ? editKgValues[i] : ""} onChange={e=>setEditKgValues({...editKgValues,[i]:e.target.value})} />
                  <span style={{fontSize:12,color:"#79828B",width:24}}>kg</span>
                </div>
              ))}
              <button disabled={cambiando} onClick={async ()=>{
                const itemsActualizados = pedido.items.map((it,i)=>({
                  ...it, kgReal: editKgValues[i]!=null && editKgValues[i]!=="" ? parseFloat(editKgValues[i]) : null
                }));
                if (await cambiar(pedido.estado, itemsActualizados)) setEditKgModal(false);
              }} style={{width:"100%",padding:16,borderRadius:14,border:"none",background:cambiando?"#A3ABB3":"#2F6B4F",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer",marginTop:8}}>
                {cambiando ? "Guardando..." : "✓ Guardar kg"}
              </button>
            </div>
          </div>
        )}
        </>
      );
    }

    // ── VISTA COMERCIAL ─────────────────────────────────────
    function VistaComercial({ onBack, onRefreshParent }) {
      const [tab, setTab] = useState("pedidos");
      const [pedidos, setPedidos] = useState(null);
      const [mostrarNuevo, setMostrarNuevo] = useState(false);
      const [mostrarClientes, setMostrarClientes] = useState(false);
      const [mostrarProductos, setMostrarProductos] = useState(false);
      const [saldoCC, setSaldoCC] = useState(null); // null=sin CC, number=saldo
      const [editandoPedido, setEditandoPedido] = useState(null);
      const [remitoPedido, setRemitoPedido] = useState(null);
      const lastSeen = getLastSeen();

      const [errorCarga, setErrorCarga] = useState(false);

      async function cargar() {
        try {
          const { db, collection, query, getDocs, orderBy } = fb();
          const snap = await getDocs(query(collection(db,"pedidos"), orderBy("fechaPedido","desc")));
          setPedidos(snap.docs.map(d=>({id:d.id,...d.data()})));
          setErrorCarga(false);
          if(onRefreshParent) setTimeout(()=>onRefreshParent(), 800);
        } catch(e) {
          console.error(e);
          setErrorCarga(true);
          SersaleUI.toast("No se pudieron cargar los pedidos.", { tipo: "error" });
        }
      }

      // Devuelve true si se guardó, false si no (ya se avisó por qué).
      async function cambiarEstado(id, nuevoEstado, itemsConKg=null) {
        const visto = (pedidos||[]).find(p=>p.id===id);
        if (!visto) return false;
        let r;
        try {
          r = await pedidoCambiarEstado(visto, nuevoEstado, itemsConKg);
        } catch(e) {
          console.error(e);
          SersaleUI.toast("No se pudo guardar el cambio. Revisá la conexión y probá de nuevo.", { tipo: "error" });
          return false;
        }
        if (!r.ok) SersaleUI.toast(r.motivo, { tipo: "info", ms: 7000 });
        if (r.ok && nuevoEstado === "cancelado") await czAlCancelarPedido(visto);
        await cargar();
        return r.ok;
      }

      useEffect(()=>{
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
      },[]);

      if (mostrarNuevo) return <NuevoPedido onBack={()=>setMostrarNuevo(false)} onSaved={()=>{ setMostrarNuevo(false); cargar(); }} />;
      if (mostrarClientes) return <GestionClientes onBack={()=>setMostrarClientes(false)} />;
      if (mostrarProductos) return <GestionProductos onBack={()=>setMostrarProductos(false)} />;
      if (editandoPedido) return <EditarPedido pedido={editandoPedido} onBack={()=>setEditandoPedido(null)} onSaved={()=>{ setEditandoPedido(null); cargar(); }} />;
      if (remitoPedido) return <RemitoPedido pedido={remitoPedido} onBack={()=>{ setRemitoPedido(null); cargar(); }} />;

      const activos   = (pedidos||[]).filter(p=>!["despachado","cancelado"].includes(p.estado));
      const historial = (pedidos||[]).filter(p=>["despachado","cancelado"].includes(p.estado));

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Comercial</div>
            <button onClick={()=>setMostrarClientes(true)} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:13,fontWeight:700}}>👥</button>
            <button onClick={()=>setMostrarProductos(true)} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:13,fontWeight:700}}>🥩</button>
            <button onClick={()=>setMostrarNuevo(true)} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:13,fontWeight:700}}>+ Nuevo</button>
          </div>
          <div style={{display:"flex",borderBottom:"2px solid #D8DCE0",background:"#fff",overflowX:"auto",scrollBehavior:"smooth",WebkitOverflowScrolling:"touch"}}>
            {[["pedidos",`Activos (${activos.length})`],["historial",`Historial (${historial.length})`]].map(([k,l])=>(
              <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"12px 0",border:"none",background:"none",fontWeight:700,fontSize:14,color:tab===k?"#A4232A":"#8A929A",borderBottom:tab===k?"3px solid #A4232A":"3px solid transparent",cursor:"pointer",fontWeight:tab===k?700:500}}>{l}</button>
            ))}
          </div>
          <div style={{padding:16}}>
            {errorCarga && (
              <div style={{background:"#F7EAEA",border:"1px solid #E3B9BC",borderRadius:12,padding:"12px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
                <span style={{flex:1,fontSize:13,color:"#7E1A20",fontWeight:600}}>No se pudieron cargar los pedidos.</span>
                <button onClick={cargar} style={{padding:"10px 14px",minHeight:44,borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>Reintentar</button>
              </div>
            )}
            {pedidos===null ? (errorCarga ? null : <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>)
            : <ComercialCtx.Provider value={{ onRemito: setRemitoPedido }}>
                {tab==="pedidos"
                  ? <ActivosFiltrados activos={activos} cambiarEstado={cambiarEstado} lastSeen={lastSeen} onEditar={setEditandoPedido} onRemito={setRemitoPedido} />
                  : <HistorialFiltrado historial={historial} cambiarEstado={cambiarEstado} />
                }
              </ComercialCtx.Provider>
            }
          </div>
        </div>
      );
    }

    // ── EDITAR PEDIDO ───────────────────────────────────────
    function EditarPedido({ pedido, onBack, onSaved }) {
      const [cliente, setCliente] = useState(pedido.cliente||"");
      const [clienteCustom, setClienteCustom] = useState("");
      const [cuentaCorriente, setCuentaCorriente] = useState(!!pedido.cuentaCorriente);
      const [tipo, setTipo] = useState(pedido.tipo||"");
      const [entrega, setEntrega] = useState(pedido.fechaEntrega||"");
      const [items, setItems] = useState(()=>pedido.items.map(it=>({...it})));
      const [obsGeneral, setObsGeneral] = useState(pedido.obs||"");
      const [clientesDB, setClientesDB] = useState([]);
      // Filas que siguen siendo el mismo producto que cuando se abrió la pantalla:
      // al guardar conservan los kg que haya cargado el depósito mientras tanto.
      const sinTocar = React.useRef(null);
      if (!sinTocar.current) sinTocar.current = new WeakSet(items);

      useEffect(()=>{
        async function cargarClientes() {
          const { db, collection, getDocs, query, orderBy } = fb();
          const snap = await getDocs(query(collection(db,"clientes"), orderBy("nombre","asc")));
          setClientesDB(snap.docs.map(d=>({id:d.id,...d.data()})));
        }
        if(window.__fbReady) cargarClientes(); else document.addEventListener("fbReady",cargarClientes);
      },[]);

      const addItem = () => setItems([...items,{categoria:"",producto:"",cantidad:"",unidad:"kg",obs:""}]);

      // Alta desde el buscador: reutiliza la última fila si quedó vacía
      function agregarDesdeBuscador(categoria, producto) {
        setItems(prev => {
          const ultimo = prev[prev.length-1];
          const filaVacia = ultimo && !ultimo.producto && !ultimo.cantidad;
          const nueva = {categoria, producto, cantidad:"", unidad:"kg", obs:""};
          return filaVacia ? [...prev.slice(0,-1), nueva] : [...prev, nueva];
        });
      }
      const updItem = (i,f,v) => {
        const c=[...items];
        // Otro producto en la misma fila: los kg pesados eran del producto anterior.
        if((f==="producto"||f==="categoria") && c[i][f]!==v) {
          sinTocar.current.delete(c[i]);
          if(c[i].kgReal!=null) c[i].kgReal=null;
        }
        c[i][f]=v; if(f==="categoria") c[i].producto=""; setItems(c);
      };
      const remItem = i => setItems(items.filter((_,idx)=>idx!==i));

      // Los clientes cargados en Clientes + "Otro" (sin los nombres de demostración que había en el código).
      const todosClientes = [
        ...clientesDB.map(c=>c.nombre),
        "Otro"
      ];
      // If current cliente isn't in list, treat as custom
      const clienteEnLista = todosClientes.includes(cliente);
      const [clienteSelect, setClienteSelect] = useState(clienteEnLista ? cliente : "Otro");
      useEffect(()=>{
        if(!clienteEnLista) setClienteCustom(cliente);
      },[]);
      // Los clientes llegan después del primer dibujo: si el del pedido está en la
      // lista y nadie tocó el campo, se lo muestra elegido (no como "Otro" editable).
      // Se lo reconoce aunque el pedido lo tenga escrito con otras mayúsculas o acentos.
      useEffect(()=>{
        if(clienteSelect==="Otro" && clienteCustom===(pedido.cliente||"")) {
          const enLista = clientesDB.find(c=>c.nombre===pedido.cliente) || clientesDB.find(c=>ccMismoCliente(c.nombre, pedido.cliente));
          if(enLista) setClienteSelect(enLista.nombre);
        }
      },[clientesDB]);

      const [guardar, guardando] = SersaleBase.useAccion(async () => {
        const aviso = t => { SersaleUI.toast(t, { tipo: "error" }); };
        let nombreCliente = clienteSelect==="Otro" ? clienteCustom.trim() : clienteSelect;
        if (!nombreCliente) return aviso("Seleccioná o ingresá el cliente");
        if (clienteSelect==="Otro") {
          // Igual que en Nuevo Pedido: si el nombre escrito a mano es el de un cliente que ya
          // está (con otra mayúscula o sin acento), el pedido queda a nombre de ese cliente.
          const existente = clientesDB.find(c=>SersaleBase.mismoNombre(c.nombre, nombreCliente));
          if (existente) nombreCliente = existente.nombre;
        }
        if (!tipo) return aviso("Seleccioná si es envío o retiro");
        if (!entrega) return aviso("Ingresá la fecha de entrega");
        // Una fila a medio cargar (producto sin cantidad o al revés) frena el guardado, como en
        // Nuevo Pedido: antes se descartaba sin avisar y el pedido quedaba sin ese producto.
        const val = [];
        for (let i=0; i<items.length; i++) {
          const it = items[i];
          const prod = String(it.producto||"").trim(), cant = String(it.cantidad==null?"":it.cantidad).trim();
          if (!prod && !cant) continue;
          if (!prod) return aviso(`Al ítem ${i+1} le falta el producto`);
          if (!cant) return aviso(`Al ítem ${i+1} (${prod}) le falta la cantidad`);
          if (!(parseFloat(cant) > 0)) return aviso(`La cantidad del ítem ${i+1} (${prod}) tiene que ser mayor a 0`);
          val.push(it);
        }
        if (!val.length) return aviso("Agregá al menos un producto");
        const cambiaCliente = !ccMismoCliente(pedido.cliente, nombreCliente);
        try {
          const { db, doc, runTransaction } = fb();
          if (cambiaCliente) {
            // Con remito emitido el cargo ya está en la cuenta del cliente anterior y no se pasa
            // solo a otra cuenta: cambiar el cliente dejaba el remito a un nombre y la deuda a otro.
            const remito = await remitoDePedido(pedido.id, { servidor: true });
            if (remito) return aviso(`Este pedido ya tiene el Remito N° ${String(remito.nro).padStart(4,"0")} a nombre de ${pedido.cliente}: no se puede pasar a otro cliente.`);
          }
          const ref = doc(db,"pedidos",pedido.id);
          const editadoEn = new Date().toISOString();
          const existe = await runTransaction(db, async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists()) return false;
            // Los kg los carga el depósito: se toman del pedido como está AHORA en
            // la base, no de la copia con la que se abrió esta pantalla.
            const frescos = snap.data().items || [];
            const usados = new Set();
            const finales = val.map(it => {
              if (!sinTocar.current.has(it)) return it;
              const j = frescos.findIndex((f,idx)=>!usados.has(idx) && f.producto===it.producto);
              if (j===-1) return it;
              usados.add(j);
              return frescos[j].kgReal===undefined ? it : { ...it, kgReal: frescos[j].kgReal };
            });
            tx.update(ref, {
              cliente: nombreCliente, cuentaCorriente, tipo,
              fechaEntrega: entrega, items: finales, obs: obsGeneral.trim(),
              editadoEn
            });
            return true;
          });
          if (!existe) return aviso("Ese pedido ya no existe.");
          await esperarCopiaLocal(ref, d => !!d && d.editadoEn === editadoEn);
          // El pedido pasó a otro cliente: su "Pendiente de facturar" ($0) sale de la cuenta
          // del anterior y, si el nuevo tiene cuenta, se anota en la suya (como en el alta).
          let sinPendiente = false;
          if (cambiaCliente) {
            try {
              await czQuitarPendienteDePedido(pedido);
              const cuenta = cuentaCorriente ? await ccBuscarCuenta(nombreCliente) : null;
              if (cuenta) {
                await ccAsentarMovimiento({
                  cliente: nombreCliente, cuenta,
                  ultimoMovimiento: cuenta.ultimoMovimiento, // un pendiente de $0 no cambia la fecha del último movimiento
                  datos: {
                    tipo:"pedido", monto:0, fecha:entrega,
                    detalle:val.map(it=>it.producto).join(", "), obs:"Pendiente de facturar",
                    origen:"pedido_app", pedidoId:pedido.id
                  }
                });
              }
            } catch(e) { console.error("[Pedido] No se pudo pasar el pendiente de facturar al cliente nuevo:", e); sinPendiente = true; }
          }
          if (sinPendiente) SersaleUI.toast("Pedido actualizado. No se pudo pasar el pendiente de facturar a la cuenta de "+nombreCliente+": el cargo se hace con el remito.", { tipo: "info", ms: 6000 });
          else SersaleUI.toast("Pedido actualizado", { tipo: "ok" });
          onSaved();
        } catch(e) {
          console.error(e);
          aviso("No se pudo guardar. Revisá la conexión y probá de nuevo.");
        }
      });

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Editar Pedido</div>
          </div>
          <div style={{padding:20}}>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Cliente</label>
            <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:8}}
              value={clienteSelect} onChange={e=>{ setClienteSelect(e.target.value); if(e.target.value!=="Otro") setCliente(e.target.value); }}>
              <option value="">— Seleccioná un cliente —</option>
              {todosClientes.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            {clienteSelect==="Otro" && (
              <input style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:8}}
                placeholder="Nombre del cliente" value={clienteCustom} onChange={e=>setClienteCustom(e.target.value)} />
            )}
            <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,cursor:"pointer"}}>
              <input type="checkbox" checked={cuentaCorriente} onChange={e=>setCuentaCorriente(e.target.checked)} style={{width:18,height:18}} />
              <span style={{fontSize:14,color:"#3A424A"}}>Cliente con cuenta corriente</span>
            </label>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:8}}>Tipo de pedido *</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              {[["envio","🚚 Envío / Reparto"],["retiro","🏪 Retira por local"]].map(([k,lbl])=>(
                <button key={k} onClick={()=>setTipo(k)}
                  style={{padding:"14px 10px",borderRadius:12,border:`2px solid ${tipo===k?"#A4232A":"#D8DCE0"}`,
                    background:tipo===k?"#F7EAEA":"#fff",color:tipo===k?"#A4232A":"#5C666F",
                    fontWeight:700,fontSize:13,cursor:"pointer",textAlign:"center"}}>
                  {lbl}
                </button>
              ))}
            </div>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Fecha de entrega</label>
            <input type="date" style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:16}}
              value={entrega} onChange={e=>setEntrega(e.target.value)} />
            <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,margin:"0 0 10px"}}>Productos</p>
            <BuscadorProductos onElegir={agregarDesdeBuscador} yaElegidos={items.map(it=>it.producto).filter(Boolean)} />
            {items.map((item,i)=>(
              <div key={i} style={{background:"#fff",borderRadius:14,border:"1.5px solid #2A333B",padding:14,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontWeight:600,color:"#2A333B",fontSize:13}}>Ítem {i+1}</span>
                  {items.length>1 && <button onClick={()=>remItem(i)} style={{background:"#fee",color:"#A4232A",border:"1px solid #fcc",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:12}}>✕</button>}
                </div>
                <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:8}}
                  value={item.categoria} onChange={e=>updItem(i,"categoria",e.target.value)}>
                  <option value="">— Categoría —</option>
                  {Object.keys(getProductos()).sort((a,b)=>a.localeCompare(b,"es")).map(cat=><option key={cat} value={cat}>{cat}</option>)}
                </select>
                {item.categoria && (
                  item.categoria === "Artículos Varios"
                    ? <input style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:8}}
                        placeholder="Descripción del artículo" value={item.producto} onChange={e=>updItem(i,"producto",e.target.value)} />
                    : <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:8}}
                        value={item.producto} onChange={e=>updItem(i,"producto",e.target.value)}>
                        <option value="">— Producto —</option>
                        {[...(getProductos()[item.categoria]||[])].sort((a,b)=>a.localeCompare(b,"es")).map(p=><option key={p} value={p}>{p}</option>)}
                      </select>
                )}
                <div style={{display:"flex",gap:8}}>
                  <input style={{flex:1,padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none"}}
                    type="number" inputMode="decimal" step="any" min="0" placeholder="Cantidad" value={item.cantidad} onChange={e=>updItem(i,"cantidad",e.target.value)} />
                  <select style={{width:110,padding:"12px 10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none"}}
                    value={item.unidad} onChange={e=>updItem(i,"unidad",e.target.value)}>
                    {UNIDADES.map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <input style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff",marginTop:8}}
                  placeholder="Observación (opcional)" value={item.obs||""} onChange={e=>updItem(i,"obs",e.target.value)} />
              </div>
            ))}
            <button onClick={addItem} style={{width:"100%",padding:12,borderRadius:12,border:"2px dashed #2A333B",background:"transparent",cursor:"pointer",fontWeight:600,fontSize:14,color:"#2A333B",marginBottom:16}}>
              + Agregar otro producto
            </button>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Observaciones generales</label>
            <textarea style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",height:70,resize:"none"}}
              placeholder="Notas sobre el pedido, horario de entrega, etc." value={obsGeneral} onChange={e=>setObsGeneral(e.target.value)} />
            <button onClick={guardar} disabled={guardando}
              style={{width:"100%",padding:16,borderRadius:14,border:"none",background:guardando?"#B9BFC5":"#2A333B",color:"#fff",fontWeight:800,fontSize:16,cursor:"pointer",marginTop:12}}>
              {guardando ? "Guardando..." : "✓ Guardar Cambios"}
            </button>
          </div>
        </div>
      );
    }

    // ── REMITO PEDIDO ───────────────────────────────────────
    // Remito ya emitido para un pedido (o null). Los remitos nuevos se guardan con
    // id "ped_<id del pedido>"; los anteriores se encuentran por el campo pedidoId.
    // Con { servidor: true } se le pregunta al servidor (falla si no contesta): es para cuando la
    // respuesta decide qué se escribe. La copia del teléfono puede no tener todavía el remito que
    // se hizo desde otro teléfono.
    async function remitoDePedido(pedidoId, opciones) {
      const { db, collection, getDocs, getDocsFromServer, query, where } = fb();
      const leer = opciones && opciones.servidor ? getDocsFromServer : getDocs;
      const snap = await leer(query(collection(db,"remitos"), where("pedidoId","==",pedidoId)));
      const lista = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(Number(a.nro)||0)-(Number(b.nro)||0));
      return lista[0] || null;
    }

    function RemitoPedido({ pedido: pedidoInicial, onBack }) {
      const { useState, useEffect } = React;
      // El pedido se vuelve a leer al abrir: la lista de Comercial puede ser de hace horas.
      const [pedido, setPedido] = useState(pedidoInicial);
      // Lo que se escribe en pantalla (y los precios de un remito ya emitido).
      const [precios, setPrecios] = useState({});
      // Último precio guardado del cliente para cada producto: es lo que se propone.
      const [czGuardados, czSetGuardados] = useState({});
      // Lo escrito en pantalla manda sobre lo propuesto, llegue antes o después.
      const preciosVista = { ...czGuardados, ...precios };
      const [nroRemito, setNroRemito] = useState("");
      const [guardado, setGuardado] = useState(false);
      // Remito que ya tiene este pedido (emitido antes o recién guardado): { id, nro, fecha }
      const [emitido, setEmitido] = useState(null);
      const [resultadoCC, setResultadoCC] = useState(null);
      const nro4 = n => String(n).padStart(4,"0");

      // Load saved prices for this client
      useEffect(()=>{
        async function cargar() {
          const { db, collection, getDocs, query, where } = fb();
          // De cada producto, el precio más reciente (la fecha puede estar como texto o como Timestamp).
          const ultimos = docs => {
            const out = {};
            p5UltimosPrecios(docs.filter(d => p5Precio(d.precio) > 0)).forEach(d=>{ out[d.producto] = d.precio; });
            return out;
          };
          // 1) Enseguida: los guardados con el nombre tal cual figura en el pedido.
          try {
            const snap = await getDocs(query(collection(db,"precios_cliente"), where("cliente","==",pedidoInicial.cliente)));
            czSetGuardados(ultimos(snap.docs.map(d=>d.data())));
          } catch(e){ console.error("Error cargando precios:", e); }
          // 2) Completo: todos los del cliente sin mirar mayúsculas ni acentos, la misma regla que
          // la pestaña Precios. Antes esto se hacía solo si el paso 1 no traía nada: un precio más
          // nuevo guardado con otra forma del nombre no se veía y el remito proponía el viejo.
          try {
            const snapAll = await getDocs(collection(db,"precios_cliente"));
            czSetGuardados(ultimos(snapAll.docs.map(d=>d.data()).filter(d => SersaleBase.mismoNombre(d.cliente, pedidoInicial.cliente))));
          } catch(e){ console.error("Error cargando precios:", e); }
        }
        // Próximo número (solo para mostrar: el definitivo se toma al guardar)
        async function cargarNro() {
          try {
            const { db, doc, getDoc, setDoc, collection, getDocs } = fb();
            // Read counter doc
            const counterRef = doc(db, "config", "contador_remitos");
            const counterSnap = await getDoc(counterRef);
            if(counterSnap.exists()) {
              setNroRemito(nro4((counterSnap.data().ultimo||0)+1));
            } else {
              // First time: scan existing remitos to initialize counter
              const snap = await getDocs(collection(db,"remitos"));
              let maxNro = 0;
              snap.docs.forEach(d=>{ const n = d.data().nro||0; if(n>maxNro) maxNro=n; });
              await setDoc(counterRef, { ultimo: maxNro, updatedAt: new Date().toISOString() });
              setNroRemito(nro4(maxNro+1));
            }
          } catch(e){ console.error("Error cargarNro:", e); }
        }
        // Pedido al día y remito ya emitido (si lo hay)
        async function cargarPedidoYRemito() {
          const { db, doc, getDoc } = fb();
          try {
            const snap = await getDoc(doc(db,"pedidos",pedidoInicial.id));
            if(snap.exists()) setPedido({id:snap.id,...snap.data()});
          } catch(e){ console.error("Error releyendo el pedido:", e); }
          let previo = null;
          try { previo = await remitoDePedido(pedidoInicial.id); } catch(e){ console.error("Error buscando remito:", e); }
          if(previo) {
            setEmitido({ id: previo.id, nro: previo.nro, fecha: previo.fecha });
            setNroRemito(nro4(previo.nro));
            // Se muestran los precios con los que se emitió
            const usados = {};
            (previo.items||[]).forEach(it=>{ if(it.precio>0) usados[it.producto] = it.precio; });
            setPrecios(prev=>({...prev, ...usados}));
          } else {
            await cargarNro();
          }
        }
        function iniciar(){ cargar(); cargarPedidoYRemito(); }
        if(window.__fbReady) iniciar();
        else document.addEventListener("fbReady", iniciar, { once: true });
      },[]);

      // Filas del remito: la MISMA cuenta para la pantalla, el PDF, el remito guardado y la cuenta corriente.
      const filas = pedido.items.map(it=>{
        const kg = kgFacturables(it);
        const precio = parseFloat(preciosVista[it.producto])||0;
        return { producto: it.producto, unidad: it.unidad, kg, precio, total: SersaleBase.redondear(kg*precio, 2), pesado: it.kgReal!=null && it.kgReal!=="", cantidad: it.cantidad };
      });
      const totalRemito = SersaleBase.redondear(filas.reduce((s,f)=>s+f.total,0), 2);

      const [guardarRemito, guardando] = SersaleBase.useAccion(async () => {
        try {
          const { db, collection, doc, getDoc, getDocs, runTransaction } = fb();
          const hoyStr = SersaleBase.hoy();
          const ahora = new Date().toISOString();
          const montoFinal = Math.round(totalRemito);
          const productos = pedido.items.map(it=>it.producto).join(", ");

          // ── Lecturas previas ──
          // Lo que decide qué se escribe (¿ya hay remito?, ¿el cliente tiene cuenta?, ¿cuál es el
          // cargo de este pedido?) se le pregunta al servidor, no a la copia del teléfono: con la
          // señal entrecortada esa copia puede no tener lo que hizo otro teléfono, y se emitía un
          // segundo remito y se cobraba dos veces. Si el servidor no contesta, no se guarda nada.
          const previo = await remitoDePedido(pedido.id, { servidor: true });
          if(previo && !(emitido && emitido.id === previo.id)) {
            // El remito lo hicieron desde otro teléfono y esta pantalla no lo sabía: se muestra y no se pisa sin avisar.
            setEmitido({ id: previo.id, nro: previo.nro, fecha: previo.fecha });
            setNroRemito(nro4(previo.nro));
            const usados = {};
            (previo.items||[]).forEach(it=>{ if(it.precio>0) usados[it.producto] = it.precio; });
            setPrecios(prev=>({...usados, ...prev}));
            SersaleUI.toast("Este pedido ya tiene el Remito N° "+nro4(previo.nro)+", hecho desde otro teléfono. Revisá los importes: si tocás Guardar de nuevo se cambia ese remito y su cargo.", { tipo: "info", ms: 9000 });
            return;
          }
          const remitoRef = doc(db,"remitos", previo ? previo.id : "ped_"+pedido.id);
          const pedidoRef = doc(db,"pedidos",pedido.id);
          const counterRef = doc(db,"config","contador_remitos");
          // Sin contador (primera vez o no se pudo leer): se parte del mayor número emitido.
          let maxNro = 0;
          if(!previo && !(await getDoc(counterRef)).exists()) {
            const todos = await getDocs(collection(db,"remitos"));
            todos.docs.forEach(d=>{ const n = Number(d.data().nro)||0; if(n>maxNro) maxNro=n; });
          }
          // Cuenta corriente: si el pedido está marcado o el cliente tiene cuenta.
          const cuenta = await ccBuscarCuenta(pedido.cliente, { servidor: true });
          let asiento = null, movPrevio = null;
          if(pedido.cuentaCorriente || cuenta) {
            const movs = await rvccMovimientosDePedido(pedido, previo ? previo.nro : null, cuenta);
            movPrevio = ccMovimientoDePedido(movs, pedido, previo ? previo.nro : null);
            // Sin importe y sin cargo anterior que corregir: el "Pendiente de facturar" queda como está.
            const hayCargoPrevio = !!(movPrevio && (Number(movPrevio.monto)||0) > 0);
            if(montoFinal > 0 || hayCargoPrevio) {
              asiento = await ccPrepararAsiento({
                cliente: pedido.cliente, cuenta,
                movId: movPrevio ? movPrevio.id : "remito_"+pedido.id,
                abrirCuenta: true, ultimoMovimiento: hoyStr
              });
            }
          }

          // ── Todo junto: número, remito, precios, movimiento y saldo (o nada) ──
          const res = await runTransaction(db, async tx => {
            const pedSnap = await tx.get(pedidoRef);
            const remSnap = await tx.get(remitoRef);
            const cntSnap = await tx.get(counterRef);
            if(asiento) { asiento.marca = null; await ccLeerAsiento(tx, asiento); }

            // Si el depósito cambió kg o productos después de abrir esta pantalla, no se factura lo viejo.
            if(pedSnap.exists() && firmaItemsPedido(pedSnap.data().items) !== firmaItemsPedido(pedido.items)) {
              return { cambio: { id: pedSnap.id, ...pedSnap.data() } };
            }

            const yaEmitido = remSnap.exists();
            const anterior = yaEmitido ? remSnap.data() : null;
            const nro = yaEmitido ? anterior.nro
              : cntSnap.exists() ? (Number(cntSnap.data().ultimo)||0) + 1
              : maxNro + 1;
            const items = filas.map((f,i)=>({
              producto: f.producto,
              kg: f.pesado ? f.kg : (pedido.items[i].cantidad||0),
              unidad: f.unidad,
              precio: f.precio,
              total: f.total
            }));
            const datos = {
              nro, pedidoId: pedido.id, cliente: pedido.cliente,
              fecha: yaEmitido && anterior.fecha ? anterior.fecha : hoyStr,
              fechaEntrega: pedido.fechaEntrega||"", tipo: pedido.tipo||"",
              items, total: totalRemito
            };
            if(yaEmitido) tx.update(remitoRef, { ...datos, updatedAt: ahora });
            else {
              tx.set(remitoRef, { ...datos, createdAt: ahora });
              if(cntSnap.exists()) tx.update(counterRef, { ultimo: nro, updatedAt: ahora });
              else tx.set(counterRef, { ultimo: nro, updatedAt: ahora });
            }
            // Precios del cliente (al corregir un remito, solo los que cambiaron)
            const antes = {};
            if(anterior) (anterior.items||[]).forEach(it=>{ antes[it.producto] = it.precio; });
            const vistos = new Set();
            filas.forEach(f=>{
              if(!(f.precio>0) || vistos.has(f.producto) || antes[f.producto]===f.precio) return;
              vistos.add(f.producto);
              tx.set(doc(collection(db,"precios_cliente")), { cliente: pedido.cliente, producto: f.producto, precio: f.precio, fecha: ahora });
            });
            // Cuenta corriente: el cargo de este pedido queda en el total del remito
            let cc = null;
            if(asiento) {
              const datosMov = {
                tipo: "pedido", monto: montoFinal, detalle: productos,
                obs: "Remito N° "+nro4(nro), remitoNro: nro, pedidoId: pedido.id
              };
              if(!movPrevio) { datosMov.fecha = pedido.fechaEntrega || hoyStr; datosMov.origen = "remito"; }
              // Un "Pendiente de facturar" que pasa a ser el cargo toma la fecha de entrega que el
              // pedido tiene AHORA (si se la cambiaron después del alta, quedaba con la anterior).
              else if(czEsPendiente(movPrevio) && pedido.fechaEntrega) datosMov.fecha = pedido.fechaEntrega;
              cc = ccEscribirAsiento(tx, asiento, datosMov);
            }
            // Si Firestore repite la transacción porque se perdió la respuesta, el remito que se ve
            // guardado es el de esta misma operación (misma hora de alta): es un alta, no una corrección.
            return { nro, fecha: datos.fecha, cc, corregido: yaEmitido && anterior.createdAt !== ahora };
          });

          // Que lo que se lea después (lista, cuenta corriente) ya traiga el remito
          if(!res.cambio) {
            await esperarCopiaLocal(remitoRef, d => !!d && (d.createdAt === ahora || d.updatedAt === ahora));
            await ccEsperarAsiento(asiento);
          }
          if(res.cambio) {
            setPedido(res.cambio);
            SersaleUI.toast("El pedido cambió desde otro teléfono (kg o productos). Revisá los importes y guardá de nuevo.", { tipo: "info", ms: 8000 });
            return;
          }
          setEmitido({ id: remitoRef.id, nro: res.nro, fecha: res.fecha });
          setNroRemito(nro4(res.nro));
          setResultadoCC(res.cc && res.cc.asentado ? res.cc : null);
          setGuardado(true);
          SersaleUI.toast((res.corregido ? "Remito N° "+nro4(res.nro)+" corregido" : "Remito N° "+nro4(res.nro)+" guardado"), { tipo: "ok" });
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo guardar el remito. Revisá la conexión y probá de nuevo.", { tipo: "error" });
        }
      });

      const fmt$ = n => n.toLocaleString("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:2});
      // Fecha del remito: la de emisión si ya está guardado; si no, hoy.
      const fechaRemito = SersaleBase.fmtFecha(emitido && emitido.fecha ? emitido.fecha : SersaleBase.hoy());

      function imprimir() {
        if(!nroRemito) { SersaleUI.toast("Todavía no se pudo obtener el número de remito. Guardá primero.", { tipo: "error" }); return; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const W = doc.internal.pageSize.getWidth();
        const margin = 14;
        const pw = W - margin * 2;
        let y = 16;
        
        // Logo
        try {
          var logoB64 = window.__sersaleLogo;
          doc.addImage(logoB64, 'PNG', margin, y - 4, 18, 18);
        } catch(e){ console.error('Logo error:', e); }
        
        // Header text
        doc.setFontSize(14); doc.setTextColor(192,34,43); doc.setFont(undefined,'bold');
        doc.text('FRIGORIFICO SERSALE', margin + 22, y + 2);
        doc.setFontSize(7); doc.setTextColor(100); doc.setFont(undefined,'normal');
        doc.text('24 de Noviembre 1926, Parque Patricios - CABA', margin + 22, y + 7);
        doc.text('Tel: (011) 6763-7860 - @sersalefrigorifico', margin + 22, y + 11);
        
        // Remito number
        doc.setFontSize(9); doc.setTextColor(130); doc.setFont(undefined,'normal');
        doc.text('REMITO', W - margin, y, { align: 'right' });
        doc.setFontSize(20); doc.setTextColor(192,34,43); doc.setFont(undefined,'bold');
        doc.text('N\u00B0 ' + nroRemito, W - margin, y + 8, { align: 'right' });
        
        y += 18;
        doc.setDrawColor(192,34,43); doc.setLineWidth(0.8);
        doc.line(margin, y, W - margin, y);
        y += 6;
        
        // Info grid
        doc.setFontSize(7); doc.setTextColor(150); doc.setFont(undefined,'normal');
        doc.text('CLIENTE', margin, y);
        doc.text('FECHA', margin + pw/2, y);
        y += 4;
        doc.setFontSize(10); doc.setTextColor(30); doc.setFont(undefined,'bold');
        doc.text(pedido.cliente || '-', margin, y);
        doc.text(fechaRemito, margin + pw/2, y);
        y += 5;
        doc.setFontSize(7); doc.setTextColor(150); doc.setFont(undefined,'normal');
        doc.text('FECHA DE ENTREGA', margin, y);
        doc.text('TIPO', margin + pw/2, y);
        y += 4;
        doc.setFontSize(10); doc.setTextColor(30); doc.setFont(undefined,'bold');
        var fechaEnt = pedido.fechaEntrega ? pedido.fechaEntrega.split('-').reverse().join('/') : '-';
        doc.text(fechaEnt, margin, y);
        doc.text(pedido.tipo === 'envio' ? 'Envio / Reparto' : 'Retiro por local', margin + pw/2, y);
        y += 8;
        
        // Table header
        var colX = [margin, margin + pw*0.45, margin + pw*0.62, margin + pw*0.80];
        var colW2 = [pw*0.45, pw*0.17, pw*0.18, pw*0.20];
        doc.setFillColor(44,62,80);
        doc.rect(margin, y, pw, 7, 'F');
        doc.setFontSize(7); doc.setTextColor(255); doc.setFont(undefined,'bold');
        doc.text('PRODUCTO', colX[0] + 2, y + 5);
        doc.text('KG', colX[1] + colW2[1]/2, y + 5, { align: 'center' });
        doc.text('PRECIO / KG', colX[2] + colW2[2]/2, y + 5, { align: 'center' });
        doc.text('TOTAL', colX[3] + colW2[3] - 2, y + 5, { align: 'right' });
        y += 9;
        
        // Table rows
        doc.setFont(undefined,'normal'); doc.setTextColor(50);
        filas.forEach(function(it) {
          var kg = it.kg;
          var p = it.precio;
          var tot = it.total;
          // Remito largo: sigue en otra hoja en vez de salirse del papel
          if (y > 272) { doc.addPage(); y = 20; }
          doc.setTextColor(50);
          doc.setFontSize(9); doc.setFont(undefined,'normal');
          doc.text(it.producto || '', colX[0] + 2, y + 4);
          doc.text(String(kg), colX[1] + colW2[1]/2, y + 4, { align: 'center' });
          doc.text(p > 0 ? fmt$(p) : '-', colX[2] + colW2[2]/2, y + 4, { align: 'center' });
          doc.setFont(undefined,'bold');
          doc.text(p > 0 ? fmt$(tot) : '-', colX[3] + colW2[3] - 2, y + 4, { align: 'right' });
          doc.setDrawColor(230); doc.setLineWidth(0.2);
          doc.line(margin, y + 6, W - margin, y + 6);
          y += 8;
        });
        
        // Total
        if (y > 280) { doc.addPage(); y = 20; }
        doc.setDrawColor(192,34,43); doc.setLineWidth(0.5);
        doc.line(margin, y, W - margin, y);
        y += 2;
        doc.setFontSize(11); doc.setTextColor(192,34,43); doc.setFont(undefined,'bold');
        doc.text('TOTAL', colX[2] + colW2[2]/2, y + 5, { align: 'center' });
        doc.text(fmt$(totalRemito), colX[3] + colW2[3] - 2, y + 5, { align: 'right' });
        
        // Save as blob for sharing
        var fileName ='Remito ' + nroRemito + ' - ' + String(pedido.cliente||'Cliente').replace(/[\\/:*?"<>|]/g,' ') + ' - ' + fechaRemito.replace(/\//g,'-') + '.pdf';
        window.compartirOdescargarPDF(doc, fileName);
      }


      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Remito — {pedido.cliente}</div>
          </div>
          <div style={{padding:20}}>
            {/* Nro remito */}
            <div style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:16,marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontWeight:600,fontSize:13,color:"#3A424A"}}>N° Remito</span>
              <input readOnly aria-label="Número de remito" style={{flex:1,padding:"10px 14px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:18,fontWeight:700,textAlign:"center",background:"#F7F8F9",color:"#262C32"}}
                value={nroRemito} />
            </div>
            {emitido && !guardado && (
              <div data-aviso="remito-emitido" style={{background:"#F5EEF8",border:"1px solid #D9C7E6",borderRadius:12,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#4A3566",fontWeight:600}}>
                Este pedido ya tiene el Remito N° {nro4(emitido.nro)}. Si guardás, se corrige ese remito y su cargo en la cuenta corriente: no se crea otro.
              </div>
            )}

            {/* Info cliente */}
            <div style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:14,marginBottom:16}}>
              <div style={{fontSize:11,color:"#79828B",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Cliente</div>
              <div style={{fontWeight:800,fontSize:16}}>{pedido.cliente}</div>
              <div style={{fontSize:12,color:"#79828B",marginTop:4}}>
                {pedido.tipo==="envio"?"🚚 Envío":"🏪 Retiro"} · Entrega: {pedido.fechaEntrega?pedido.fechaEntrega.split("-").reverse().join("/"):"-"}
              </div>
            </div>

            {/* Items con precio */}
            <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Ítems del pedido</p>
            {filas.map((it,i)=>{
              const kg = it.kg;
              const p = it.precio;
              const tot = it.total;
              return (
                <div key={i} style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:14,marginBottom:10}}>
                  <div style={{fontWeight:600,fontSize:14,marginBottom:10}}>{it.producto}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div>
                      <div style={{fontSize:11,color:"#79828B",marginBottom:4}}>Kg reales</div>
                      <div style={{fontWeight:800,fontSize:16,color:"#2A333B"}}>{kg} kg</div>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"#79828B",marginBottom:4}}>Precio / kg</div>
                      <InputMonto placeholder="$ / kg"
                        style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:15,fontWeight:700,textAlign:"right"}}
                        value={preciosVista[it.producto]||""} onChange={v=>{ setPrecios({...precios,[it.producto]:v}); setGuardado(false); }} />
                    </div>
                  </div>
                  {p>0 && (
                    <div style={{marginTop:8,textAlign:"right",fontWeight:700,fontSize:15,color:"#6B4E8E"}}>
                      Subtotal: {fmt$(tot)}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Total */}
            <div style={{background:"#2A333B",borderRadius:14,padding:16,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:"#fff",fontWeight:700,fontSize:15}}>TOTAL</span>
              <span style={{color:"#fff",fontWeight:900,fontSize:22}}>{fmt$(totalRemito)}</span>
            </div>

            {/* Actions */}
            <div style={{display:"flex",gap:10,marginBottom:16}}>
              <button onClick={imprimir}
                style={{flex:1,padding:14,borderRadius:14,border:"none",background:"#25D366",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                📤 Compartir PDF
              </button>
              <button onClick={guardarRemito} disabled={guardando||guardado}
                style={{flex:1,padding:14,borderRadius:14,border:"none",background:guardado?"#2F6B4F":guardando?"#A3ABB3":"#2A333B",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                {guardado?"✓ Guardado":guardando?"Guardando...":"💾 Guardar"}
              </button>
            </div>
            {guardado && <p style={{textAlign:"center",fontSize:12,color:"#2F6B4F",fontWeight:600}}>✓ Remito guardado y precios actualizados para {pedido.cliente}</p>}
            {guardado && resultadoCC && (
              <p data-aviso="remito-cc" style={{textAlign:"center",fontSize:12,color:"#6B4E8E",fontWeight:600,marginTop:6}}>
                💳 {resultadoCC.cuentaAbierta ? "Se abrió la cuenta corriente y se cargó el remito. " : "Cargado en cuenta corriente. "}Saldo: {ccFmtSaldo(resultadoCC.saldo)}
              </p>
            )}
          </div>
        </div>
      );
    }


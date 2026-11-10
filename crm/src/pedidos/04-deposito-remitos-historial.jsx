    // ── ACTIVOS FILTRADOS (Comercial) ──────────────────────
    function ActivosFiltrados({ activos, cambiarEstado, lastSeen, onEditar, onRemito }) {
      const [subtipo, setSubtipo] = useState("todos");
      const envios  = activos.filter(p=>p.tipo==="envio");
      const retiros = activos.filter(p=>p.tipo==="retiro");
      const otros   = activos.filter(p=>!p.tipo);
      const mostrar = subtipo==="todos" ? activos 
        : subtipo==="envio" ? envios 
        : subtipo==="retiro" ? retiros 
        : subtipo==="pendiente" ? activos.filter(p=>p.estado==="pendiente")
        : subtipo==="preparando" ? activos.filter(p=>p.estado==="preparando")
        : subtipo==="listo" ? activos.filter(p=>p.estado==="listo")
        : otros;

      // Group by fechaEntrega
      const now = new Date();
      const hoy = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
      const porDia = {};
      mostrar.forEach(p => { const f=p.fechaEntrega||"Sin fecha"; if(!porDia[f])porDia[f]=[]; porDia[f].push(p); });
      const diasOrdenados = Object.keys(porDia).sort((a,b)=>{
        if(a==="Sin fecha") return 1; if(b==="Sin fecha") return -1;
        return a.localeCompare(b);
      });
      function fmtDia(f) {
        if(f==="Sin fecha") return "Sin fecha asignada";
        const fP=f.split("-").map(Number), hP=hoy.split("-").map(Number);
        const fD=new Date(fP[0],fP[1]-1,fP[2]), hD=new Date(hP[0],hP[1]-1,hP[2]);
        const diff=Math.round((fD-hD)/86400000);
        const lbl=diff===0?"HOY":diff===1?"MAÑANA":diff===-1?"AYER":diff<0?"Hace "+(-diff)+"d":"En "+diff+"d";
        return fD.toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"2-digit"})+" — "+lbl;
      }

      return (
        <div>
          {(() => {
            const pendientes = activos.filter(p=>p.estado==="pendiente").length;
            const preparando = activos.filter(p=>p.estado==="preparando").length;
            const listos = activos.filter(p=>p.estado==="listo").length;
            return (<div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",scrollBehavior:"smooth",WebkitOverflowScrolling:"touch",paddingBottom:2,flexWrap:"nowrap"}}>
            {[
              ["todos",`Todos (${activos.length})`],
              ["pendiente",`🔴 Pendientes (${pendientes})`],
              ["preparando",`🟡 Preparando (${preparando})`],
              ["listo",`🟢 Listos (${listos})`],
              ["envio",`🚚 Envíos (${envios.length})`],
              ["retiro",`🏪 Retiros (${retiros.length})`],
            ].map(([k,lbl])=>(
              <button key={k} onClick={()=>setSubtipo(k)}
                style={{whiteSpace:"nowrap",padding:"8px 14px",borderRadius:20,border:`1.5px solid ${subtipo===k?"#A4232A":"#D8DCE0"}`,
                  background:subtipo===k?"#A4232A":"#fff",color:subtipo===k?"#fff":"#5C666F",
                  fontWeight:600,fontSize:12,cursor:"pointer",flexShrink:0}}>
                {lbl}
              </button>
            ))}
          </div>);})()}
          {mostrar.length===0
            ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}><div style={{fontSize:48}}>📭</div><p>No hay pedidos en esta categoría</p></div>
            : (() => {
                const getDayColor = (fecha) => {
                  if(fecha==="Sin fecha") return "#79828B";
                  const fP=fecha.split("-").map(Number), hP=hoy.split("-").map(Number);
                  const diff=Math.round((new Date(fP[0],fP[1]-1,fP[2])-new Date(hP[0],hP[1]-1,hP[2]))/86400000);
                  return diff<0?"#C33039":diff===0?"#2F6B4F":diff===1?"#A8702A":"#26536E";
                };
                const renderDateGroup = (peds) => {
                  const pd = {};
                  peds.forEach(p => { const f=p.fechaEntrega||"Sin fecha"; if(!pd[f])pd[f]=[]; pd[f].push(p); });
                  const dias = Object.keys(pd).sort((a,b)=>{
                    if(a==="Sin fecha") return 1; if(b==="Sin fecha") return -1;
                    return a.localeCompare(b);
                  });
                  return dias.map(fecha => {
                    const dp = pd[fecha];
                    const env2 = dp.filter(p=>p.tipo==="envio").length;
                    const ret2 = dp.filter(p=>p.tipo==="retiro").length;
                    return (
                      <div key={fecha} style={{marginBottom:12}}>
                        <div style={{background:getDayColor(fecha),borderRadius:10,padding:"6px 12px",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:4}}>
                          <span style={{fontWeight:700,fontSize:12,color:"#fff",textTransform:"capitalize"}}>{fmtDia(fecha)}</span>
                          <div style={{display:"flex",gap:4,alignItems:"center"}}>
                            {env2>0&&<span style={{fontSize:10,background:"rgba(255,255,255,0.2)",color:"#fff",borderRadius:99,padding:"2px 6px"}}>{"🚚 "+env2}</span>}
                            {ret2>0&&<span style={{fontSize:10,background:"rgba(255,255,255,0.2)",color:"#fff",borderRadius:99,padding:"2px 6px"}}>{"🏪 "+ret2}</span>}
                            <span style={{fontSize:10,background:"rgba(255,255,255,0.25)",color:"#fff",borderRadius:99,padding:"2px 6px",fontWeight:700}}>{dp.length}</span>
                          </div>
                        </div>
                        {dp.map(p=><TarjetaPedido key={p.id} pedido={p} onCambiarEstado={cambiarEstado} showActions={true} isNew={p.fechaPedidoISO>lastSeen} onEditar={onEditar} onRemito={onRemito} />)}
                      </div>
                    );
                  });
                };
                const statusGroups = [
                  {key:"pendiente", label:"🔴 Pendientes", color:"#C33039", bg:"#F7EAEA"},
                  {key:"preparando", label:"🟡 En preparación", color:"#A8702A", bg:"#F3EEE2"},
                  {key:"listo", label:"🟢 Listos para despachar", color:"#2F6B4F", bg:"#E9F0EC"}
                ];
                return statusGroups.map(sg => {
                  const pedsStatus = mostrar.filter(p=>p.estado===sg.key);
                  if(pedsStatus.length === 0) return null;
                  return (
                    <div key={sg.key} style={{marginBottom:20}}>
                      <div style={{background:sg.bg,border:"1.5px solid "+sg.color,borderRadius:12,padding:"10px 14px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontWeight:800,fontSize:13,color:sg.color}}>{sg.label}</span>
                        <span style={{fontSize:12,fontWeight:700,color:sg.color,background:"rgba(0,0,0,0.05)",borderRadius:99,padding:"2px 10px"}}>{pedsStatus.length}</span>
                      </div>
                      {renderDateGroup(pedsStatus)}
                    </div>
                  );
                });
              })()
          }
        </div>
      );
    }

    // ── HISTORIAL FILTRADO (Comercial) ─────────────────────
    function HistorialFiltrado({ historial, cambiarEstado }) {
      const [busqCliente, setBusqCliente] = useState("");
      const [fechaDesde, setFechaDesde] = useState("");
      const [fechaHasta, setFechaHasta] = useState("");

      const clientesUnicos = [...new Set(historial.map(p=>p.cliente))].sort();

      const filtrados = historial.filter(p => {
        const matchCliente = !busqCliente || p.cliente===busqCliente;
        const matchDesde   = !fechaDesde  || p.fechaEntrega >= fechaDesde;
        const matchHasta   = !fechaHasta  || p.fechaEntrega <= fechaHasta;
        return matchCliente && matchDesde && matchHasta;
      });

      const hayFiltros = busqCliente || fechaDesde || fechaHasta;

      return (
        <div>
          {/* Filtros */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:14,marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:12,color:"#79828B",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Filtrar historial</div>
            <div style={{marginBottom:10}}>
              <label style={{display:"block",fontSize:12,color:"#5C666F",fontWeight:600,marginBottom:4}}>Cliente</label>
              <select style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none"}}
                value={busqCliente} onChange={e=>setBusqCliente(e.target.value)}>
                <option value="">Todos los clientes</option>
                {clientesUnicos.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div>
                <label style={{display:"block",fontSize:12,color:"#5C666F",fontWeight:600,marginBottom:4}}>Entrega desde</label>
                <input type="date" style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                  value={fechaDesde} onChange={e=>setFechaDesde(e.target.value)} />
              </div>
              <div>
                <label style={{display:"block",fontSize:12,color:"#5C666F",fontWeight:600,marginBottom:4}}>Entrega hasta</label>
                <input type="date" style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                  value={fechaHasta} onChange={e=>setFechaHasta(e.target.value)} />
              </div>
            </div>
            {hayFiltros && (
              <button onClick={()=>{ setBusqCliente(""); setFechaDesde(""); setFechaHasta(""); }}
                style={{fontSize:12,color:"#A4232A",background:"none",border:"none",cursor:"pointer",fontWeight:600,padding:0}}>
                ✕ Limpiar filtros
              </button>
            )}
          </div>
          {/* Resultado */}
          <div style={{fontSize:12,color:"#79828B",marginBottom:10,fontWeight:600}}>
            {filtrados.length} pedido{filtrados.length!==1?"s":""}{hayFiltros?" encontrados":" en total"}
          </div>
          {filtrados.length===0
            ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><div style={{fontSize:48}}>🔍</div><p>Sin resultados para este filtro</p></div>
            : filtrados.map(p=><TarjetaPedido key={p.id} pedido={p} onCambiarEstado={cambiarEstado} showActions={false} isNew={false} />)
          }
        </div>
      );
    }

    // ── VISTA DEPÓSITO ──────────────────────────────────────
    // ── DETALLE PREPARACIÓN ÍTEM POR ÍTEM ──────────────────
    function DetallePreparacion({ pedido, onBack, onCambiarEstado }) {
      const [itemsDone, setItemsDone] = useState({}); // {i: true/false}
      const todosDone = pedido.items.every((_,i)=>itemsDone[i]);
      const cantDone = Object.values(itemsDone).filter(Boolean).length;

      function toggleItem(i) {
        setItemsDone(prev=>({...prev,[i]:!prev[i]}));
      }

      const pct = pedido.items.length>0 ? Math.round(cantDone/pedido.items.length*100) : 0;
      const est = ESTADOS[pedido.estado]||ESTADOS.pendiente;

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px",position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
              <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:16}}>Preparando — {pedido.cliente}</div>
                <div style={{fontSize:12,opacity:.85}}>{cantDone} de {pedido.items.length} ítems listos</div>
              </div>
            </div>
            {/* Progress bar */}
            <div style={{background:"rgba(255,255,255,0.25)",borderRadius:999,height:6,overflow:"hidden"}}>
              <div style={{background:"#fff",height:"100%",width:`${pct}%`,borderRadius:999,transition:"width .3s"}}></div>
            </div>
          </div>
          <div style={{padding:16}}>
            {/* Info pedido */}
            <div style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:12,marginBottom:16,display:"flex",gap:12,flexWrap:"wrap"}}>
              <span style={{fontSize:12,color:"#79828B"}}>📅 Entrega: <strong style={{color:"#262C32"}}>{pedido.fechaEntrega?pedido.fechaEntrega.split("-").reverse().join("/"):"-"}</strong></span>
              {pedido.tipo==="envio"&&<span style={{fontSize:12,color:"#26536E",fontWeight:600}}>🚚 Envío</span>}
              {pedido.tipo==="retiro"&&<span style={{fontSize:12,color:"#2F6B4F",fontWeight:600}}>🏪 Retiro</span>}
              {pedido.obs&&<span style={{fontSize:12,color:"#79828B",width:"100%"}}>📝 {pedido.obs}</span>}
            </div>

            {/* Items */}
            {pedido.items.map((it,i)=>{
              const done = !!itemsDone[i];
              return (
                <button key={i} onClick={()=>toggleItem(i)}
                  style={{width:"100%",background:done?"#E9F0EC":"#fff",borderRadius:14,
                    border:`2px solid ${done?"#2F6B4F":"#D8DCE0"}`,padding:"14px 16px",marginBottom:10,
                    display:"flex",alignItems:"center",gap:14,cursor:"pointer",textAlign:"left",transition:"all .2s"}}>
                  <div style={{width:28,height:28,borderRadius:"50%",border:`2px solid ${done?"#2F6B4F":"#D8DCE0"}`,
                    background:done?"#2F6B4F":"transparent",display:"flex",alignItems:"center",justifyContent:"center",
                    flexShrink:0,transition:"all .2s"}}>
                    {done&&<span style={{color:"#fff",fontSize:16,fontWeight:700}}>✓</span>}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:15,color:done?"#2F6B4F":"#191E23",textDecoration:done?"line-through":"none"}}>
                      {it.producto}
                    </div>
                    <div style={{fontSize:13,color:"#79828B",marginTop:2}}>
                      {it.cantidad} {it.unidad}
                      {it.kgReal!=null&&it.kgReal!==""&&<span style={{color:"#2F6B4F",marginLeft:8}}>⚖️ {it.kgReal} kg real</span>}
                    </div>
                    {it.obs&&<div style={{fontSize:11,color:"#A3ABB3",marginTop:2}}>📝 {it.obs}</div>}
                  </div>
                </button>
              );
            })}

            {/* Confirm button */}
            {todosDone && (
              <div style={{marginTop:8}}>
                <div style={{background:"#E9F0EC",border:"1.5px solid #2F6B4F",borderRadius:14,padding:12,textAlign:"center",marginBottom:12}}>
                  <span style={{fontSize:14,color:"#2F6B4F",fontWeight:700}}>🎉 ¡Todos los ítems preparados!</span>
                </div>
                <button onClick={()=>onCambiarEstado(pedido.id,"listo",null)}
                  style={{width:"100%",padding:16,borderRadius:14,border:"none",background:"#2F6B4F",color:"#fff",fontWeight:800,fontSize:16,cursor:"pointer"}}>
                  ✅ Marcar como Listo
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    function VistaDeposito({ onBack, modoOperario }) {
      const [pedidos, setPedidos] = useState(null);
      const [filtro, setFiltro] = useState("todos");
      const [prepDetalle, setPrepDetalle] = useState(null);
      const lastSeen = getLastSeen();

      function cerrarSesionOperario() {
        if (!confirm("¿Cerrar sesión y volver a la pantalla de inicio?")) return;
        sessionStorage.removeItem("sersale_role");
        sessionStorage.removeItem("sersale_usuario");
        sessionStorage.removeItem("sersale_nombre");
        sessionStorage.removeItem("sersale_auth");
        sessionStorage.removeItem("sersale_vista");
        window.location.href = "index.html";
      }

      async function cargar() {
        const { db, collection, query, getDocs, orderBy } = fb();
        const snap = await getDocs(query(collection(db,"pedidos"), orderBy("fechaEntrega","asc")));
        setPedidos(snap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>!["despachado","cancelado"].includes(p.estado)));
      }

      async function cambiarEstado(id, nuevoEstado, itemsConKg=null) {
        const { db, doc, updateDoc } = fb();
        const pedido = pedidos.find(p=>p.id===id);
        const upd = {
          estado: nuevoEstado,
          historial:[...(pedido.historial||[]),{estado:nuevoEstado,fecha:new Date().toISOString()}]
        };
        if(itemsConKg) upd.items = itemsConKg;
        await updateDoc(doc(db,"pedidos",id), upd);
        cargar();
      }

      useEffect(()=>{
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
      },[]);

      const filtrados = filtro==="todos" ? (pedidos||[]) : (pedidos||[]).filter(p=>p.estado===filtro);

      if(prepDetalle) return <DetallePreparacion pedido={prepDetalle} onBack={()=>setPrepDetalle(null)} onCambiarEstado={(id,est,items)=>{ cambiarEstado(id,est,items); setPrepDetalle(null); }} />;

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            {!modoOperario && onBack && <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>}
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Depósito{modoOperario ? " · Vista Operario" : ""}</div>
            <button onClick={cargar} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:16}}>↻</button>
            {modoOperario && <button onClick={cerrarSesionOperario} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:600,marginLeft:6}}>Salir ⏻</button>}
          </div>
          <div style={{padding:"12px 16px 0",display:"flex",gap:8,overflowX:"auto",scrollBehavior:"smooth",WebkitOverflowScrolling:"touch"}}>
            {[["todos","Todos"],["pendiente","Pendientes"],["preparando","Preparando"],["listo","Listos"]].map(([k,l])=>(
              <button key={k} onClick={()=>setFiltro(k)}
                style={{whiteSpace:"nowrap",padding:"8px 14px",borderRadius:20,border:`1.5px solid ${filtro===k?"#26536E":"#D8DCE0"}`,background:filtro===k?"#26536E":"#fff",color:filtro===k?"#fff":"#5C666F",fontWeight:600,fontSize:13,cursor:"pointer"}}>
                {l}
              </button>
            ))}
          </div>
          <div style={{padding:16}}>
            {pedidos===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
            : filtrados.length===0 ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}><div style={{fontSize:48}}>✅</div><p>No hay pedidos en este estado</p></div>
            : (() => {
                const now = new Date();
                const hoyStr = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
                const fmtDia = (f) => {
                  if(f==="Sin fecha") return "Sin fecha asignada";
                  const fP2=f.split("-").map(Number), hP2=hoyStr.split("-").map(Number);
                  const fD=new Date(fP2[0],fP2[1]-1,fP2[2]), hD=new Date(hP2[0],hP2[1]-1,hP2[2]);
                  const d2=Math.round((fD-hD)/86400000);
                  const lbl=d2===0?"HOY":d2===1?"MAÑANA":d2===-1?"AYER":d2<0?"Hace "+(-d2)+"d":"En "+d2+"d";
                  return fD.toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"2-digit"})+" — "+lbl;
                };
                const getDayColor = (fecha) => {
                  if(fecha==="Sin fecha") return "#79828B";
                  const fP=fecha.split("-").map(Number), hP=hoyStr.split("-").map(Number);
                  const diff=Math.round((new Date(fP[0],fP[1]-1,fP[2])-new Date(hP[0],hP[1]-1,hP[2]))/86400000);
                  return diff<0?"#C33039":diff===0?"#2F6B4F":diff===1?"#A8702A":"#26536E";
                };
                const renderGroup = (peds) => {
                  const porDia = {};
                  peds.forEach(p => { const f=p.fechaEntrega||"Sin fecha"; if(!porDia[f])porDia[f]=[]; porDia[f].push(p); });
                  const diasOrd = Object.keys(porDia).sort((a,b)=>{
                    if(a==="Sin fecha") return 1; if(b==="Sin fecha") return -1;
                    return a.localeCompare(b);
                  });
                  return diasOrd.map(fecha => {
                    const dp = porDia[fecha];
                    const env = dp.filter(p=>p.tipo==="envio").length;
                    const ret = dp.filter(p=>p.tipo==="retiro").length;
                    return (
                      <div key={fecha} style={{marginBottom:12}}>
                        <div style={{background:getDayColor(fecha),borderRadius:10,padding:"6px 12px",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:4}}>
                          <span style={{fontWeight:700,fontSize:12,color:"#fff",textTransform:"capitalize"}}>{fmtDia(fecha)}</span>
                          <div style={{display:"flex",gap:4,alignItems:"center"}}>
                            {env>0&&<span style={{fontSize:10,background:"rgba(255,255,255,0.2)",color:"#fff",borderRadius:99,padding:"2px 6px"}}>{"🚚 "+env}</span>}
                            {ret>0&&<span style={{fontSize:10,background:"rgba(255,255,255,0.2)",color:"#fff",borderRadius:99,padding:"2px 6px"}}>{"🏪 "+ret}</span>}
                            <span style={{fontSize:10,background:"rgba(255,255,255,0.25)",color:"#fff",borderRadius:99,padding:"2px 6px",fontWeight:700}}>{dp.length}</span>
                          </div>
                        </div>
                        {dp.map(p=><TarjetaPedido key={p.id} pedido={p} onCambiarEstado={cambiarEstado} showActions={true} isNew={p.fechaPedidoISO>lastSeen} onDetallePrep={p.estado==="preparando"?()=>setPrepDetalle(p):null} modoOperario={modoOperario} />)}
                      </div>
                    );
                  });
                };
                // Group by status sections
                const statusGroups = [
                  {key:"pendiente", label:"🔴 Pendientes de preparar", color:"#C33039", bg:"#F7EAEA"},
                  {key:"preparando", label:"🟡 En preparación", color:"#A8702A", bg:"#F3EEE2"},
                  {key:"listo", label:"🟢 Listos para despachar", color:"#2F6B4F", bg:"#E9F0EC"}
                ];
                return statusGroups.map(sg => {
                  const pedsStatus = filtrados.filter(p=>p.estado===sg.key);
                  if(pedsStatus.length === 0) return null;
                  return (
                    <div key={sg.key} style={{marginBottom:20}}>
                      <div style={{background:sg.bg,border:"1.5px solid "+sg.color,borderRadius:12,padding:"10px 14px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontWeight:800,fontSize:13,color:sg.color}}>{sg.label}</span>
                        <span style={{fontSize:12,fontWeight:700,color:sg.color,background:"rgba(0,0,0,0.05)",borderRadius:99,padding:"2px 10px"}}>{pedsStatus.length}</span>
                      </div>
                      {renderGroup(pedsStatus)}
                    </div>
                  );
                });
              })()
            }
          </div>
        </div>
      );
    }

    // ── VISTA DIRECTOR ──────────────────────────────────────
    // ── HISTORIAL CLIENTE ───────────────────────────────────
    // ── FUNCION GLOBAL: GENERAR PDF DE REMITO (reutilizable) ──
    // Acepta un objeto con: { nroRemito, cliente, fechaISO, fechaEntrega, tipo, items:[{producto,kg,precio,total}], total }
    // modoCompartir: true → intenta navigator.share; false → doc.save directo
    // ── HELPER: compartir en mobile, descargar en desktop ──
    // En desktop navigator.share suele no funcionar bien con archivos PDF,
    // entonces directamente descargamos. En mobile intentamos share nativo
    // (WhatsApp/Mail/etc) con fallback automático a descarga si falla.
    window.compartirOdescargarPDF = function(doc, fileName) {
      var ua = (navigator.userAgent||"");
      var esMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
                  || (/Mac/i.test(ua) && navigator.maxTouchPoints > 1);
      if(esMobile && navigator.share && navigator.canShare) {
        try {
          var blob = doc.output('blob');
          var file = new File([blob], fileName, { type:'application/pdf' });
          if(navigator.canShare({ files:[file] })) {
            navigator.share({ files:[file], title:fileName })
              .catch(function(){ doc.save(fileName); });
            return;
          }
        } catch(e) { /* fall through to save */ }
      }
      doc.save(fileName);
    };

    function generarPDFRemito(data, modoCompartir) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit:'mm', format:'a4' });
      const W = doc.internal.pageSize.getWidth();
      const margin = 14;
      const pw = W - margin*2;
      let y = 16;
      const fmt$ = n => n.toLocaleString("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:2});

      // Logo
      try { doc.addImage(window.__sersaleLogo, 'PNG', margin, y-4, 18, 18); } catch(e){ console.error('Logo error:',e); }

      // Header text
      doc.setFontSize(14); doc.setTextColor(192,34,43); doc.setFont(undefined,'bold');
      doc.text('FRIGORIFICO SERSALE', margin+22, y+2);
      doc.setFontSize(7); doc.setTextColor(100); doc.setFont(undefined,'normal');
      doc.text('24 de Noviembre 1926, Parque Patricios - CABA', margin+22, y+7);
      doc.text('Tel: (011) 6763-7860 - @sersalefrigorifico', margin+22, y+11);

      // Remito number
      doc.setFontSize(9); doc.setTextColor(130); doc.setFont(undefined,'normal');
      doc.text('REMITO', W-margin, y, { align:'right' });
      doc.setFontSize(20); doc.setTextColor(192,34,43); doc.setFont(undefined,'bold');
      doc.text('N\u00B0 '+data.nroRemito, W-margin, y+8, { align:'right' });

      y += 18;
      doc.setDrawColor(192,34,43); doc.setLineWidth(0.8);
      doc.line(margin, y, W-margin, y);
      y += 6;

      // Info grid
      doc.setFontSize(7); doc.setTextColor(150); doc.setFont(undefined,'normal');
      doc.text('CLIENTE', margin, y);
      doc.text('FECHA', margin+pw/2, y);
      y += 4;
      doc.setFontSize(10); doc.setTextColor(30); doc.setFont(undefined,'bold');
      doc.text(data.cliente||'-', margin, y);
      const fechaMostrar = data.fechaISO ? new Date(data.fechaISO+'T00:00:00').toLocaleDateString('es-AR') : new Date().toLocaleDateString('es-AR');
      doc.text(fechaMostrar, margin+pw/2, y);
      y += 5;
      doc.setFontSize(7); doc.setTextColor(150); doc.setFont(undefined,'normal');
      doc.text('FECHA DE ENTREGA', margin, y);
      doc.text('TIPO', margin+pw/2, y);
      y += 4;
      doc.setFontSize(10); doc.setTextColor(30); doc.setFont(undefined,'bold');
      const fechaEnt = data.fechaEntrega ? data.fechaEntrega.split('-').reverse().join('/') : '-';
      doc.text(fechaEnt, margin, y);
      doc.text(data.tipo==='envio' ? 'Envio / Reparto' : 'Retiro por local', margin+pw/2, y);
      y += 8;

      // Table header
      const colX = [margin, margin+pw*0.45, margin+pw*0.62, margin+pw*0.80];
      const colW2 = [pw*0.45, pw*0.17, pw*0.18, pw*0.20];
      doc.setFillColor(44,62,80);
      doc.rect(margin, y, pw, 7, 'F');
      doc.setFontSize(7); doc.setTextColor(255); doc.setFont(undefined,'bold');
      doc.text('PRODUCTO', colX[0]+2, y+5);
      doc.text('KG', colX[1]+colW2[1]/2, y+5, { align:'center' });
      doc.text('PRECIO / KG', colX[2]+colW2[2]/2, y+5, { align:'center' });
      doc.text('TOTAL', colX[3]+colW2[3]-2, y+5, { align:'right' });
      y += 9;

      // Table rows
      doc.setFont(undefined,'normal'); doc.setTextColor(50);
      let totalCalc = 0;
      (data.items||[]).forEach(function(it){
        const kg = parseFloat(it.kg)||0;
        const p = parseFloat(it.precio)||0;
        const tot = (it.total!=null) ? parseFloat(it.total) : kg*p;
        totalCalc += tot;
        doc.setFontSize(9); doc.setFont(undefined,'normal');
        doc.text(it.producto||'', colX[0]+2, y+4);
        doc.text(String(kg), colX[1]+colW2[1]/2, y+4, { align:'center' });
        doc.text(p>0 ? fmt$(p) : '-', colX[2]+colW2[2]/2, y+4, { align:'center' });
        doc.setFont(undefined,'bold');
        doc.text(p>0 ? fmt$(tot) : '-', colX[3]+colW2[3]-2, y+4, { align:'right' });
        doc.setDrawColor(230); doc.setLineWidth(0.2);
        doc.line(margin, y+6, W-margin, y+6);
        y += 8;
      });

      // Total
      doc.setDrawColor(192,34,43); doc.setLineWidth(0.5);
      doc.line(margin, y, W-margin, y);
      y += 2;
      doc.setFontSize(11); doc.setTextColor(192,34,43); doc.setFont(undefined,'bold');
      doc.text('TOTAL', colX[2]+colW2[2]/2, y+5, { align:'center' });
      const totalFinal = (data.total!=null) ? data.total : totalCalc;
      doc.text(fmt$(totalFinal), colX[3]+colW2[3]-2, y+5, { align:'right' });

      const fileName = 'Remito '+data.nroRemito+' - '+(data.cliente||'Cliente')+' - '+fechaMostrar.replace(/\//g,'-')+'.pdf';
      if(modoCompartir) {
        window.compartirOdescargarPDF(doc, fileName);
      } else {
        doc.save(fileName);
      }
    }
    window.generarPDFRemito = generarPDFRemito;

    // ── REMITOS GUARDADOS DE UN CLIENTE ─────────────────────
    function RemitosCliente({ cliente }) {
      const [remitos, setRemitos] = useState(null);
      const [verRemito, setVerRemito] = useState(null);
      useEffect(()=>{
        async function cargar() {
          try {
            const { db, collection, getDocs, query, where, orderBy } = fb();
            const q = query(collection(db,"remitos"), where("cliente","==",cliente));
            const snap = await getDocs(q);
            const arr = [];
            snap.forEach(d=>arr.push({ id:d.id, ...d.data() }));
            arr.sort((a,b)=> (b.createdAt||"").localeCompare(a.createdAt||""));
            setRemitos(arr);
          } catch(e){ console.error("Error cargando remitos:",e); setRemitos([]); }
        }
        cargar();
      },[cliente]);

      if (verRemito) return <VerRemitoGuardado remito={verRemito} onBack={()=>setVerRemito(null)} />;
      if (remitos===null) return <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><p>Cargando remitos...</p></div>;
      if (remitos.length===0) return <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><div style={{fontSize:40}}>🧾</div><p>Sin remitos emitidos</p></div>;

      const fmt$ = n => Number(n||0).toLocaleString("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0});
      return (
        <div>
          {remitos.map(r=>(
            <div key={r.id} onClick={()=>setVerRemito(r)}
              style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:14,marginBottom:10,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontWeight:800,fontSize:15,color:"#6B4E8E"}}>N° {String(r.nro||"").padStart(4,"0")}</div>
                <div style={{fontSize:12,color:"#79828B"}}>{r.fecha ? r.fecha.split("-").reverse().join("/") : "-"}</div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:12,color:"#5C666F"}}>{(r.items||[]).length} ítem{(r.items||[]).length!==1?"s":""}</div>
                <div style={{fontWeight:700,fontSize:15,color:"#2A333B"}}>{fmt$(r.total||0)}</div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── VER REMITO GUARDADO (preview + acciones) ────────────
    function VerRemitoGuardado({ remito, onBack }) {
      const fmt$ = n => Number(n||0).toLocaleString("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:2});
      const items = remito.items || [];
      const nroStr = String(remito.nro||"").padStart(4,"0");
      function armarData() {
        return {
          nroRemito: nroStr,
          cliente: remito.cliente,
          fechaISO: remito.fecha,
          fechaEntrega: remito.fechaEntrega || "",
          tipo: remito.tipo || "",
          items: items,
          total: remito.total
        };
      }
      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Remito N° {nroStr}</div>
          </div>
          <div style={{padding:20}}>
            {/* Info cliente */}
            <div style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:14,marginBottom:16}}>
              <div style={{fontSize:11,color:"#79828B",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Cliente</div>
              <div style={{fontWeight:800,fontSize:16}}>{remito.cliente}</div>
              <div style={{fontSize:12,color:"#79828B",marginTop:4}}>
                Fecha: {remito.fecha ? remito.fecha.split("-").reverse().join("/") : "-"}
              </div>
            </div>

            {/* Items */}
            <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Ítems</p>
            {items.map((it,i)=>(
              <div key={i} style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:14,marginBottom:10}}>
                <div style={{fontWeight:600,fontSize:14,marginBottom:8}}>{it.producto}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:12}}>
                  <div><div style={{color:"#79828B",marginBottom:2}}>Kg</div><div style={{fontWeight:700}}>{it.kg}</div></div>
                  <div><div style={{color:"#79828B",marginBottom:2}}>$ / kg</div><div style={{fontWeight:700}}>{fmt$(it.precio||0)}</div></div>
                  <div style={{textAlign:"right"}}><div style={{color:"#79828B",marginBottom:2}}>Subtotal</div><div style={{fontWeight:800,color:"#6B4E8E"}}>{fmt$(it.total||0)}</div></div>
                </div>
              </div>
            ))}

            {/* Total */}
            <div style={{background:"#2A333B",borderRadius:14,padding:16,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{color:"#fff",fontWeight:700,fontSize:15}}>TOTAL</span>
              <span style={{color:"#fff",fontWeight:900,fontSize:22}}>{fmt$(remito.total||0)}</span>
            </div>

            {/* Actions */}
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>generarPDFRemito(armarData(),true)}
                style={{flex:1,padding:14,borderRadius:14,border:"none",background:"#25D366",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                📱 Compartir por WhatsApp
              </button>
              <button onClick={()=>generarPDFRemito(armarData(),false)}
                style={{flex:1,padding:14,borderRadius:14,border:"none",background:"#6B4E8E",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                📄 Ver / Descargar PDF
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ── HISTORIAL CLIENTE (con tabs Pedidos / Remitos) ──────
    function HistorialCliente({ cliente, pedidos, onBack }) {
      const [tab, setTab] = useState("pedidos");
      const pedidosCliente = pedidos.filter(p=>p.cliente===cliente).sort((a,b)=>b.fechaPedidoISO.localeCompare(a.fechaPedidoISO));
      const total = pedidosCliente.length;
      const despachados = pedidosCliente.filter(p=>p.estado==="despachado").length;
      const activos = pedidosCliente.filter(p=>!["despachado","cancelado"].includes(p.estado)).length;
      const tabStyle = active => ({
        flex:1, padding:"10px 8px", border:"none", cursor:"pointer", fontSize:13, fontWeight:700,
        background: active?"#fff":"transparent", color: active?"#6B4E8E":"rgba(255,255,255,0.8)",
        borderRadius: active?"10px 10px 0 0":"0"
      });
      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px 0",position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:16}}>{cliente}</div>
                <div style={{fontSize:12,opacity:0.85}}>{total} pedido{total!==1?"s":""} en total</div>
              </div>
            </div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>setTab("pedidos")} style={tabStyle(tab==="pedidos")}>📦 Pedidos</button>
              <button onClick={()=>setTab("remitos")} style={tabStyle(tab==="remitos")}>🧾 Remitos</button>
            </div>
          </div>
          <div style={{padding:16}}>
            {tab==="pedidos" && (
              <>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
                  {[["Total",total,"#6B4E8E"],["Activos",activos,"#A8702A"],["Despachados",despachados,"#2F6B4F"]].map(([l,v,c])=>(
                    <div key={l} style={{background:"#fff",borderRadius:12,padding:"12px 8px",border:`1.5px solid ${c}`,textAlign:"center"}}>
                      <div style={{fontSize:22,fontWeight:700,color:c}}>{v}</div>
                      <div style={{fontSize:11,color:"#79828B",marginTop:2}}>{l}</div>
                    </div>
                  ))}
                </div>
                {pedidosCliente.length===0
                  ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><p>Sin pedidos</p></div>
                  : pedidosCliente.map(p=><TarjetaPedido key={p.id} pedido={p} onCambiarEstado={async()=>{}} showActions={false} isNew={false} />)
                }
              </>
            )}
            {tab==="remitos" && <RemitosCliente cliente={cliente} />}
          </div>
        </div>
      );
    }

    // ── COMPONENTE TAB DIA ──────────────────────────────────
    function TabDia({ activos, lastSeen, setHojaRutaFecha }) {
      // Use local date to avoid UTC timezone issues (Argentina is UTC-3)
      const now = new Date();
      const hoy = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
      const porDia = {};
      activos.forEach(p => { const f=p.fechaEntrega||"Sin fecha"; if(!porDia[f])porDia[f]=[]; porDia[f].push(p); });
      const diasOrdenados = Object.keys(porDia).sort();
      function fmtDia(f) {
        if (f==="Sin fecha") return "Sin fecha asignada";
        // Compare dates as strings (both YYYY-MM-DD local format)
        const fParts = f.split("-").map(Number);
        const hParts = hoy.split("-").map(Number);
        const fDate = new Date(fParts[0], fParts[1]-1, fParts[2]);
        const hDate = new Date(hParts[0], hParts[1]-1, hParts[2]);
        const diff = Math.round((fDate - hDate) / 86400000);
        const lbl = diff===0?"HOY":diff===1?"MA\xd1ANA":diff===-1?"AYER":diff<0?"Hace "+(-diff)+"d":"En "+diff+"d";
        return fDate.toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"2-digit"})+" \u2014 "+lbl;
      }
      if (diasOrdenados.length===0) return (
        <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
          <div style={{fontSize:48}}>📭</div><p>Sin pedidos activos</p>
        </div>
      );
      return (
        <div>
          {diasOrdenados.map(fecha => {
            const peds = porDia[fecha];
            let diff = null;
            if(fecha!=="Sin fecha") {
              const fP = fecha.split("-").map(Number);
              const hP = hoy.split("-").map(Number);
              diff = Math.round((new Date(fP[0],fP[1]-1,fP[2]) - new Date(hP[0],hP[1]-1,hP[2])) / 86400000);
            }
            const hcolor = diff===null?"#79828B":diff<0?"#C33039":diff===0?"#2F6B4F":diff===1?"#A8702A":"#26536E";
            const envios = peds.filter(p=>p.tipo==="envio").length;
            const retiros = peds.filter(p=>p.tipo==="retiro").length;
            return (
              <div key={fecha} style={{marginBottom:20}}>
                <div style={{background:hcolor,borderRadius:12,padding:"8px 14px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:4}}>
                  <span style={{fontWeight:700,fontSize:13,color:"#fff",textTransform:"capitalize"}}>{fmtDia(fecha)}</span>
                  <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                    {envios>0&&<span style={{fontSize:11,background:"rgba(255,255,255,0.2)",color:"#fff",borderRadius:99,padding:"2px 8px"}}>{"🚚 "+envios}</span>}
                    {retiros>0&&<span style={{fontSize:11,background:"rgba(255,255,255,0.2)",color:"#fff",borderRadius:99,padding:"2px 8px"}}>{"🏪 "+retiros}</span>}
                    <span style={{fontSize:11,background:"rgba(255,255,255,0.25)",color:"#fff",borderRadius:99,padding:"2px 8px",fontWeight:700}}>{peds.length+" pedido"+(peds.length!==1?"s":"")}</span>
                    {envios>0&&fecha!=="Sin fecha"&&(
                      <button onClick={e=>{e.stopPropagation();setHojaRutaFecha(fecha);}}
                        style={{fontSize:11,background:"#fff",color:hcolor,border:"none",borderRadius:99,padding:"2px 8px",fontWeight:700,cursor:"pointer"}}>
                        Ruta
                      </button>
                    )}
                  </div>
                </div>
                {peds.map(p=><TarjetaPedido key={p.id} pedido={p} onCambiarEstado={async()=>{}} showActions={false} isNew={p.fechaPedidoISO>lastSeen} />)}
              </div>
            );
          })}
        </div>
      );
    }


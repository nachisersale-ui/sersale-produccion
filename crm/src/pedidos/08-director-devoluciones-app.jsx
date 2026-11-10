        function VistaDirector({ onBack }) {
      const [pedidos, setPedidos] = useState(null);
      const [tab, setTab] = useState("resumen");
      const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
      const [hojaRutaFecha, setHojaRutaFecha] = useState(null);
      const [alertasData, setAlertasData] = useState(null);
      const [alertaEnviando, setAlertaEnviando] = useState(null);
      // Recontactos: un solo estado para el Resumen y la pestaña Alertas
      const [contactados, setContactados] = useState([]);
      // Señal de refresco para Cuentas Corrientes: una venta rápida mueve los saldos
      const [ccRefresh, setCcRefresh] = useState(0);
      const [busqueda, setBusqueda] = useState("");
      const [busquedaCliente, setBusquedaCliente] = useState("");
      const [ventaRapidaOpen, setVentaRapidaOpen] = useState(()=>new URLSearchParams(window.location.search).get('vr')==='1');

      // Botón flotante ⚡ via DOM (evita conflicto JSX con IIFEs en tabs)
      useEffect(()=>{
        const btn = document.createElement('button');
        btn.id = 'btn-venta-rapida';
        btn.textContent = '⚡';
        Object.assign(btn.style, {
          position:'fixed',bottom:'90px',right:'24px',zIndex:'9990',
          width:'56px',height:'56px',borderRadius:'50%',border:'none',
          background:'#A4232A',
          color:'#fff',fontSize:'22px',cursor:'pointer',
          boxShadow:'0 4px 20px rgba(192,57,43,0.5)',
          display:'flex',alignItems:'center',justifyContent:'center',
          fontFamily:'inherit'
        });
        btn.onclick = () => setVentaRapidaOpen(true);
        document.body.appendChild(btn);
        return () => { const b=document.getElementById('btn-venta-rapida'); if(b) b.remove(); };
      },[]);
      const lastSeen = getLastSeen();

      async function cargar() {
        const { db, collection, getDocs } = fb();
        const snap = await getDocs(collection(db,"pedidos"));
        const todos = snap.docs.map(d=>({id:d.id,...d.data()}));
        // Don't setPedidos here - calcularAlertas will do it with combined data
        await calcularAlertas(todos);
      }

      async function calcularAlertas(todosPedidosCached) {
        try {
          const { db, collection, getDocs, query, orderBy } = fb();
          // Use the already-fetched pedidos from cargar()
          const todosPedidos = [...(todosPedidosCached || [])];
          console.log("[Alertas] Pedidos received:", todosPedidos.length);
          // Build case-insensitive client name map
          const clienteNormalizado = {}; // lowercase -> canonical name
          function normCliente(nombre) {
            if(!nombre) return nombre;
            const lower = nombre.toLowerCase().trim();
            if(!clienteNormalizado[lower]) clienteNormalizado[lower] = nombre;
            return clienteNormalizado[lower];
          }
          // Also check ALL cc_movimientos as evidence of client activity
          // Use a separate map to collect additional dates per client from CC
          const ccFechasPorCliente = {};
          try {
            const snapCC = await getDocs(collection(db,"cc_movimientos"));
            console.log("[Alertas] CC movimientos:", snapCC.docs.length);
            snapCC.docs.forEach(d => {
              const m = d.data();
              if(!m.cliente) return;
              m.cliente = normCliente(m.cliente); // normalize name
              // Handle fecha as string, Timestamp, or object with .seconds
              let fechaCorta = null;
              try {
                if(m.fecha && typeof m.fecha === "string") {
                  fechaCorta = m.fecha.substring(0,10);
                } else if(m.fecha && typeof m.fecha === "object" && m.fecha.toDate) {
                  fechaCorta = m.fecha.toDate().toISOString().substring(0,10);
                } else if(m.fecha && typeof m.fecha === "object" && m.fecha.seconds) {
                  fechaCorta = new Date(m.fecha.seconds*1000).toISOString().substring(0,10);
                } else if(m.createdAt && typeof m.createdAt === "string") {
                  fechaCorta = m.createdAt.substring(0,10);
                } else if(m.createdAt && typeof m.createdAt === "object" && m.createdAt.toDate) {
                  fechaCorta = m.createdAt.toDate().toISOString().substring(0,10);
                } else if(m.createdAt && typeof m.createdAt === "object" && m.createdAt.seconds) {
                  fechaCorta = new Date(m.createdAt.seconds*1000).toISOString().substring(0,10);
                }
              } catch(e) { /* skip this record */ }
              if(!fechaCorta) return;
              // Track ALL CC activity dates per client (pedidos AND pagos = client is active)
              if(!ccFechasPorCliente[m.cliente]) ccFechasPorCliente[m.cliente] = new Set();
              ccFechasPorCliente[m.cliente].add(fechaCorta);
              // Only create virtual pedido entries for tipo="pedido" (actual sales)
              if(m.tipo === "pedido") {
                const yaExiste = todosPedidos.some(p => 
                  p.cliente === m.cliente && p.fechaEntrega === fechaCorta
                );
                if(!yaExiste) {
                  todosPedidos.push({
                    id: "cc_"+d.id, cliente: m.cliente, tipo: "retiro",
                    fechaEntrega: fechaCorta,
                    fechaPedidoISO: m.createdAt || fechaCorta+"T12:00:00.000Z",
                    items: m.items || [{producto: m.detalle||"Movimiento CC", cantidad:0}],
                    estado: "despachado", origen: m.origen || "cc_movimiento",
                    obs: m.detalle || ""
                  });
                }
              }
            });
          } catch(e) { console.error("Error reading cc_movimientos:", e); }
          console.log("[Alertas] Total pedidos+CC:", todosPedidos.length);
          console.log("[Alertas] Clients with CC activity:", Object.keys(ccFechasPorCliente).length);
          // Update local state with combined data
          setPedidos(todosPedidos);
          const snapCli = await getDocs(collection(db,"clientes"));
          const configCli = {};
          snapCli.docs.forEach(d => {
            const data = d.data();
            const nombre = normCliente(data.nombre);
            if(!configCli[nombre]) {
              configCli[nombre] = { 
                diasAlerta: data.diasAlerta || 14, 
                telefono: data.telefono || "", 
                id: d.id,
                ultimoContacto: data.ultimoContacto || null,
                ultimoPedidoRegistrado: data.ultimoPedidoRegistrado || null
              };
            }
          });
          // Ensure all clients with pedidos exist in configCli
          // (some may have pedidos but no entry in clientes collection)
          const allClientsFromPedidos = [...new Set(todosPedidos.filter(p=>p.cliente && p.estado!=="cancelado").map(p=>p.cliente))];
          const missingClients = [];
          allClientsFromPedidos.forEach(nombre => {
            if(!configCli[nombre]) {
              configCli[nombre] = { diasAlerta: 14, telefono: "", id: null };
              missingClients.push(nombre);
            }
          });
          if(missingClients.length > 0) console.log("[Alertas] Clients with pedidos but no clientes doc:", missingClients.length);
          // Build per-client history: find ultimo pedido using ALL date sources
          const ultimoPedido = {};
          const historialClientes = {};
          let skippedNoDates = 0;
          todosPedidos.filter(p=>p.estado!=="cancelado" && p.cliente).forEach(p => {
            p.cliente = normCliente(p.cliente); // normalize name
            // Normalize: try every possible date source (most reliable first)
            let fp = "";
            try {
              // 1. fechaEntrega is most reliable (always YYYY-MM-DD string)
              if(p.fechaEntrega && typeof p.fechaEntrega === "string" && p.fechaEntrega.length >= 10) {
                fp = p.fechaEntrega.substring(0,10) + "T12:00:00.000Z";
              }
              // 2. fechaPedidoISO (ISO string from new Date().toISOString())
              else if(p.fechaPedidoISO && typeof p.fechaPedidoISO === "string") {
                fp = p.fechaPedidoISO;
              }
              // 3. fechaPedido as Firestore Timestamp with toDate()
              else if(p.fechaPedido && typeof p.fechaPedido === "object" && p.fechaPedido.toDate) {
                fp = p.fechaPedido.toDate().toISOString();
              }
              // 4. fechaPedido as object with .seconds (serialized Timestamp)
              else if(p.fechaPedido && typeof p.fechaPedido === "object" && p.fechaPedido.seconds) {
                fp = new Date(p.fechaPedido.seconds * 1000).toISOString();
              }
              // 5. fechaPedido as string
              else if(p.fechaPedido && typeof p.fechaPedido === "string") {
                fp = p.fechaPedido.length === 10 ? p.fechaPedido + "T12:00:00.000Z" : p.fechaPedido;
              }
              // 6. fecha field (from CC movements)
              else if(p.fecha && typeof p.fecha === "string") {
                fp = p.fecha.length === 10 ? p.fecha + "T12:00:00.000Z" : p.fecha;
              }
              // 7. createdAt as last resort
              else if(p.createdAt && typeof p.createdAt === "string") {
                fp = p.createdAt;
              }
            } catch(e) { fp = ""; }
            if(!fp) { skippedNoDates++; return; }
            // Track history
            if(!historialClientes[p.cliente]) historialClientes[p.cliente] = [];
            historialClientes[p.cliente].push({...p, _fechaNorm: fp, _fechaDisplay: fp.substring(0,10)});
            // Keep latest
            const fpExisting = ultimoPedido[p.cliente] ? (ultimoPedido[p.cliente]._fechaNorm || "") : "";
            if (!ultimoPedido[p.cliente] || fp > fpExisting) {
              ultimoPedido[p.cliente] = {...p, _fechaNorm: fp, _fechaDisplay: fp.substring(0,10)};
            }
          });
          if(skippedNoDates > 0) console.log("[Alertas] Pedidos skipped (no date):", skippedNoDates);
          console.log("[Alertas] Clients in historial:", Object.keys(historialClientes).length);
          // Log clients with only 1 pedido for debugging
          const singlePedido = Object.entries(historialClientes).filter(([c,p])=>p.length===1);
          if(singlePedido.length > 0) console.log("[Alertas] Clients with only 1 pedido:", singlePedido.length, singlePedido.slice(0,5).map(([c])=>c));
          // ── Auto-recalcular frecuencia (diasAlerta) por cliente ──
          const hoy = new Date(); hoy.setHours(0,0,0,0);
          const updatesBatch = [];
          Object.entries(historialClientes).forEach(([cliente, pedArr]) => {
            const fechasUnicas = [...new Set(pedArr.map(p=>p._fechaDisplay).filter(Boolean))].sort();
            if(fechasUnicas.length < 2) return;
            const diffs = [];
            for(let i=1; i<fechasUnicas.length; i++) {
              const d = Math.round((new Date(fechasUnicas[i]+"T12:00:00")-new Date(fechasUnicas[i-1]+"T12:00:00"))/86400000);
              if(d > 0 && d < 120) diffs.push(d);
            }
            if(diffs.length === 0) return;
            const freqCalc = Math.round(diffs.reduce((a,b)=>a+b,0)/diffs.length);
            // Add 3 days buffer to avoid false positives
            const diasAlertaCalc = freqCalc + 3;
            const cfg = configCli[cliente];
            if(cfg && cfg.id) {
              // Always update frequency based on real history
              const current = cfg.diasAlerta || 14;
              if(true) { // Always recalculate from actual data
                configCli[cliente].diasAlerta = diasAlertaCalc;
                configCli[cliente]._freqCalc = freqCalc;
                configCli[cliente]._totalPedidos = fechasUnicas.length;
                updatesBatch.push({ id: cfg.id, diasAlerta: diasAlertaCalc, freqCalculada: freqCalc });
              }
            }
          });
          // Write updates to Firestore (batch)
          if(updatesBatch.length > 0) {
            console.log("[Alertas] Auto-updating diasAlerta for", updatesBatch.length, "clients");
            const { doc, updateDoc } = fb();
            for(const upd of updatesBatch) {
              try {
                await updateDoc(doc(db,"clientes",upd.id), { 
                  diasAlerta: upd.diasAlerta, 
                  freqCalculada: upd.freqCalculada,
                  freqActualizado: new Date().toISOString()
                });
              } catch(e) { console.error("Error updating",upd.id,e); }
            }
          }
          // Only track REGISTERED clients (from clientes collection)
          // Deleted clients won't appear even if they have historical pedidos/CC
          const todosClientes = new Set(Object.keys(configCli));
          console.log("[Alertas] Registered clients:", todosClientes.size);
          const alertas = [];
          todosClientes.forEach(cliente => {
            const cfg = configCli[cliente];
            if(!cfg || !cfg.id) return; // Skip clients without a real doc in clientes collection
            const pedido = ultimoPedido[cliente] || null;
            // Find most recent activity date from ALL sources
            let fechaStr = pedido ? (pedido._fechaDisplay || "") : "";
            // Check CC activity dates
            if(ccFechasPorCliente[cliente]) {
              const ccDates = [...ccFechasPorCliente[cliente]].sort();
              const ultimaCC = ccDates[ccDates.length - 1];
              if(ultimaCC > fechaStr) fechaStr = ultimaCC;
            }
            // Check ultimoContacto from clientes collection (set when pedido is created)
            if(cfg.ultimoContacto) {
              const contactoStr = cfg.ultimoContacto.substring(0,10);
              if(contactoStr > fechaStr) fechaStr = contactoStr;
            }
            if(cfg.ultimoPedidoRegistrado && cfg.ultimoPedidoRegistrado > fechaStr) {
              fechaStr = cfg.ultimoPedidoRegistrado;
            }
            const totalPedidos = historialClientes[cliente] ? historialClientes[cliente].length : 0;
            const totalCC = ccFechasPorCliente[cliente] ? ccFechasPorCliente[cliente].size : 0;
            const sinActividad = !fechaStr;
            // Skip clients with NO activity at all (only in clientes collection)
            if(sinActividad) return;
            const fechaUlt = new Date(fechaStr+"T00:00:00");
            if(isNaN(fechaUlt.getTime())) return; // invalid date, skip
            const diasSinPedir = Math.floor((hoy - fechaUlt) / 86400000);
            // Skip clients with very recent activity (not in alert zone)
            if(diasSinPedir < cfg.diasAlerta - 3) return;
            const enAlerta = diasSinPedir >= cfg.diasAlerta;
            alertas.push({ cliente, diasSinPedir, enAlerta, diasAlerta: cfg.diasAlerta,
              freqCalc: cfg._freqCalc || null,
              telefono: cfg.telefono, clienteId: cfg.id,
              ultimoPedido: pedido || { items:[], _fechaDisplay: fechaStr },
              diasRestantes: cfg.diasAlerta - diasSinPedir,
              totalPedidos, totalCC, sinActividad: false });
          });
          alertas.sort((a,b) => {
            if (a.enAlerta && !b.enAlerta) return -1;
            if (!a.enAlerta && b.enAlerta) return 1;
            return b.diasSinPedir - a.diasSinPedir;
          });
          setAlertasData({ alertas, configCli, historialClientes, ccFechasPorCliente });
          verificarYEnviarAlertas(alertas);
        } catch(e) { console.error(e); }
      }

      // Marca el contacto, lo saca de las dos vistas y recalcula con datos frescos
      async function marcarComoContactado(cliente) {
        setContactados(prev => prev.includes(cliente) ? prev : [...prev, cliente]);
        try { await marcarContacto(cliente); } catch(e) { console.error(e); }
        try { await cargar(); } catch(e) { console.error(e); }
      }

      async function actualizarDiasAlerta(clienteId, dias) {
        if (!clienteId) return;
        try {
          const { db, doc, updateDoc } = fb();
          await updateDoc(doc(db,"clientes",clienteId), { diasAlerta: parseInt(dias) });
          if (pedidos) await calcularAlertas(pedidos);
        } catch(e) { console.error(e); }
      }

      useEffect(()=>{
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
      },[]);

      if (clienteSeleccionado) return <HistorialCliente cliente={clienteSeleccionado} pedidos={pedidos||[]} onBack={()=>setClienteSeleccionado(null)} />;
      if (hojaRutaFecha) return <HojaRuta fecha={hojaRutaFecha} pedidos={(pedidos||[]).filter(p=>p.fechaEntrega===hojaRutaFecha&&p.tipo==="envio"&&!["cancelado","despachado"].includes(p.estado))} onBack={()=>setHojaRutaFecha(null)} />;

      const activos = (pedidos||[]).filter(p=>!["despachado","cancelado"].includes(p.estado));

      // Agrupar todos los clientes con al menos un pedido
      const clientesMap = {};
      (pedidos||[]).filter(p=>p.estado!=="cancelado").forEach(p=>{
        if(!clientesMap[p.cliente]) clientesMap[p.cliente]={total:0,activos:0,despachados:0,cuentaCorriente:p.cuentaCorriente};
        clientesMap[p.cliente].total++;
        if(p.estado==="despachado") clientesMap[p.cliente].despachados++;
        else clientesMap[p.cliente].activos++;
      });

      return (
        <>
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Director <span style={{fontSize:9,opacity:0.5}}>v2.4</span></div>
            <button onClick={cargar} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:16}}>↻</button>
          </div>
          <div style={{display:"flex",borderBottom:"2px solid #D8DCE0",background:"#fff",overflowX:"auto",scrollBehavior:"smooth",WebkitOverflowScrolling:"touch"}}>
            {[["resumen","Resumen"],["dia","Por Día"],["stats","📊 Stats"],["alertas","🔔 Alertas"],["cc","💳 CC"],["precios","💲 Precios"],["devoluciones","↩️ Devol."],["clientes","Clientes"],["todos","Todos"]].map(([k,l])=>(
              <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"10px 4px",border:"none",background:"none",fontWeight:700,fontSize:11,color:tab===k?"#A4232A":"#79828B",borderBottom:tab===k?"3px solid #A4232A":"3px solid transparent",cursor:"pointer",whiteSpace:"nowrap",position:"relative"}}>{l}{k==="alertas"&&alertasData&&alertasData.alertas.filter(a=>a.enAlerta&&!contactados.includes(a.cliente)).length>0&&<span style={{position:"absolute",top:4,right:1,background:"#C33039",color:"#fff",borderRadius:99,padding:"1px 4px",fontSize:9,fontWeight:700}}>{alertasData.alertas.filter(a=>a.enAlerta&&!contactados.includes(a.cliente)).length}</span>}</button>
            ))}
          </div>
          <div style={{padding:16}}>
            {pedidos===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
            : tab==="resumen" ? (
              <div>
                {/* Estado de recontactos — detalle y acciones en la pestaña Alertas */}
                <ResumenRecontactos alertasData={alertasData} contactados={contactados} onVerTodos={()=>setTab("alertas")} />
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                  {[
                    ["Activos",activos.length,"#A4232A"],
                    ["Pendientes",(pedidos||[]).filter(p=>p.estado==="pendiente").length,"#A4232A"],
                    ["Preparando",(pedidos||[]).filter(p=>p.estado==="preparando").length,"#26536E"],
                    ["Listos",(pedidos||[]).filter(p=>p.estado==="listo").length,"#24523D"],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{background:"#fff",borderRadius:14,padding:"16px 12px",border:`1.5px solid ${c}`,textAlign:"center"}}>
                      <div style={{fontSize:28,fontWeight:700,color:c}}>{v}</div>
                      <div style={{fontSize:12,color:"#79828B",marginTop:4}}>{l}</div>
                    </div>
                  ))}
                </div>
                {activos.length===0
                  ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><div style={{fontSize:48}}>📭</div><p>Sin pedidos activos</p></div>
                  : (() => {
                    // Lista consolidada del día
                    const hoy = new Date().toISOString().split("T")[0];
                    const pedidosHoy = activos.filter(p=>p.fechaEntrega===hoy);
                    const consolidado = {};
                    pedidosHoy.forEach(p=>{
                      (p.items||[]).forEach(it=>{
                        const key = it.producto+"|||"+it.unidad;
                        if(!consolidado[key]) consolidado[key]={producto:it.producto,unidad:it.unidad,cantidad:0,clientes:[]};
                        consolidado[key].cantidad += it.kgReal!=null?it.kgReal:parseFloat(it.cantidad)||0;
                        if(!consolidado[key].clientes.includes(p.cliente)) consolidado[key].clientes.push(p.cliente);
                      });
                    });
                    const items = Object.values(consolidado).sort((a,b)=>b.cantidad-a.cantidad);
                    return (<>
                      {items.length>0&&(
                        <div style={{background:"#fff",borderRadius:14,border:"1.5px solid #2A333B",padding:14,marginBottom:16}}>
                          <div style={{fontWeight:700,fontSize:12,color:"#2A333B",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>
                            📋 Preparar hoy ({pedidosHoy.length} pedido{pedidosHoy.length!==1?"s":""})
                          </div>
                          {items.map((it,i)=>(
                            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:i<items.length-1?"1px solid #F2F3F5":"none"}}>
                              <div>
                                <span style={{fontWeight:600,fontSize:13,color:"#191E23"}}>{it.producto}</span>
                                <span style={{fontSize:11,color:"#79828B",marginLeft:8}}>{it.clientes.join(", ")}</span>
                              </div>
                              <span style={{fontWeight:700,fontSize:14,color:"#2A333B",whiteSpace:"nowrap",marginLeft:8}}>{Number.isInteger(it.cantidad)?it.cantidad:it.cantidad.toFixed(1)} {it.unidad}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {activos.map(p=><TarjetaPedido key={p.id} pedido={p} onCambiarEstado={async()=>{}} showActions={false} isNew={p.fechaPedidoISO>lastSeen} />)}
                    </>);
                  })()
                }
              </div>
            ) : tab==="dia" ? (
              <TabDia activos={activos} lastSeen={lastSeen} setHojaRutaFecha={setHojaRutaFecha} />
            ) : tab==="alertas" ? (
              <TabAlertas alertasData={alertasData} alertaEnviando={alertaEnviando} setAlertaEnviando={setAlertaEnviando} actualizarDiasAlerta={actualizarDiasAlerta} contactados={contactados} onContactado={marcarComoContactado} />
            ) : tab==="clientes" ? (
              Object.keys(clientesMap).length===0
                ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}><div style={{fontSize:48}}>👥</div><p>Sin pedidos aún</p></div>
                : (() => {
                    const qc = busquedaCliente.toLowerCase().trim();
                    const lista = Object.entries(clientesMap)
                      .filter(([cliente]) => !qc || cliente.toLowerCase().includes(qc))
                      .sort((a,b)=>a[0].localeCompare(b[0], "es", {sensitivity:"base"}));
                    return (
                      <div>
                        <div style={{position:"relative",marginBottom:12}}>
                          <input
                            style={{width:"100%",padding:"10px 14px 10px 36px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",boxSizing:"border-box"}}
                            placeholder="Buscar cliente por nombre..."
                            value={busquedaCliente} onChange={e=>setBusquedaCliente(e.target.value)} />
                          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:16,color:"#A3ABB3"}}>🔍</span>
                          {busquedaCliente&&<button onClick={()=>setBusquedaCliente("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#A3ABB3"}}>✕</button>}
                        </div>
                        {qc && <p style={{fontSize:12,color:"#79828B",marginBottom:10}}>{lista.length} resultado{lista.length!==1?"s":""}</p>}
                        {lista.length===0
                          ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><div style={{fontSize:48}}>🔍</div><p>Sin resultados</p></div>
                          : lista.map(([cliente,data])=>(
                            <button key={cliente} onClick={()=>setClienteSeleccionado(cliente)}
                              style={{width:"100%",background:"#fff",borderRadius:14,border:"1.5px solid #6B4E8E",padding:16,marginBottom:10,textAlign:"left",cursor:"pointer"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                                <span style={{fontWeight:700,fontSize:15,color:"#6B4E8E"}}>{cliente}</span>
                                <span style={{fontSize:12,color:"#79828B"}}>Ver historial →</span>
                              </div>
                              <div style={{display:"flex",gap:12,fontSize:12,color:"#5C666F",flexWrap:"wrap"}}>
                                <span>Total: <strong>{data.total}</strong></span>
                                <span>Activos: <strong style={{color:"#A8702A"}}>{data.activos}</strong></span>
                                <span>Despachados: <strong style={{color:"#2F6B4F"}}>{data.despachados}</strong></span>
                                {data.cuentaCorriente && <span style={{color:"#6B4E8E",fontWeight:600}}>💳 Cta Cte</span>}
                              </div>
                            </button>
                          ))
                        }
                      </div>
                    );
                  })()
            ) : tab==="stats" ? (
              <TabStats pedidos={pedidos||[]} />
            ) : tab==="cc" ? (
              <TabCuentasCorrientes refresh={ccRefresh} />
            ) : tab==="precios" ? (
              <TabPrecios clientes={Object.keys(clientesMap).concat(Object.keys(clientesMap).length===0?[]:[])} />
            ) : tab==="devoluciones" ? (
              <TabDevoluciones clientes={Object.keys(clientesMap)} />
            ) : (() => {
                const q = busqueda.toLowerCase().trim();
                const filtrados = q
                  ? (pedidos||[]).filter(p=>
                      p.cliente?.toLowerCase().includes(q) ||
                      (p.items||[]).some(it=>it.producto?.toLowerCase().includes(q)) ||
                      p.estado?.toLowerCase().includes(q) ||
                      p.fechaEntrega?.includes(q)
                    )
                  : (pedidos||[]);
                return (
                  <div>
                    <div style={{position:"relative",marginBottom:12}}>
                      <input
                        style={{width:"100%",padding:"10px 14px 10px 36px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",boxSizing:"border-box"}}
                        placeholder="Buscar por cliente, producto, estado..."
                        value={busqueda} onChange={e=>setBusqueda(e.target.value)} />
                      <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:16,color:"#A3ABB3"}}>🔍</span>
                      {busqueda&&<button onClick={()=>setBusqueda("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#A3ABB3"}}>✕</button>}
                    </div>
                    {q&&<p style={{fontSize:12,color:"#79828B",marginBottom:10}}>{filtrados.length} resultado{filtrados.length!==1?"s":""} para "{busqueda}"</p>}
                    {filtrados.length===0
                      ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><div style={{fontSize:48}}>🔍</div><p>Sin resultados</p></div>
                      : filtrados.map(p=><TarjetaPedido key={p.id} pedido={p} onCambiarEstado={async()=>{}} showActions={false} isNew={false} />)
                    }
                  </div>
                );
              })()
            }
          </div>
        </div>
        {ventaRapidaOpen && <ModalVentaRapida
          clienteInicial={null}
          clientes={Object.keys(clientesMap)}
          onClose={()=>setVentaRapidaOpen(false)}
          onGuardado={()=>{ cargar(); setCcRefresh(v=>v+1); }}
        />}
      </>
      );
    }

    // ── DEVOLUCIONES ─────────────────────────────────────────
    function TabDevoluciones({ clientes }) {
      const [devoluciones, setDevoluciones] = useState(null);
      const [filtro, setFiltro] = useState("todos"); // todos | pendiente | resuelta
      const [filtroCliente, setFiltroCliente] = useState("");
      const [modalOpen, setModalOpen] = useState(false);
      const [detalle, setDetalle] = useState(null);
      const [guardando, setGuardando] = useState(false);
      const [form, setForm] = useState({
        cliente:"", producto:"", cantidad:"", unidad:"kg",
        motivo:"", descripcion:"", fechaPedidoOrig:"",
        monto:"", estado:"pendiente"
      });

      async function cargar() {
        try {
          const { db, collection, getDocs, query, orderBy } = fb();
          const snap = await getDocs(query(collection(db,"devoluciones"), orderBy("createdAt","desc")));
          setDevoluciones(snap.docs.map(d=>({id:d.id,...d.data()})));
        } catch(e){ console.error(e); setDevoluciones([]); }
      }

      useEffect(()=>{
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
      },[]);

      async function guardar() {
        if(!form.cliente) return alert("Seleccioná el cliente");
        if(!form.producto.trim()) return alert("Ingresá el producto");
        if(!form.motivo.trim()) return alert("Ingresá el motivo");
        setGuardando(true);
        try {
          const { db, collection, addDoc } = fb();
          await addDoc(collection(db,"devoluciones"), {
            ...form,
            cantidad: parseFloat(form.cantidad)||0,
            monto: parseFloat(form.monto)||0,
            createdAt: new Date().toISOString(),
            fecha: new Date().toISOString().split("T")[0]
          });
          // Si hay monto, generar crédito en cuenta corriente
          if(parseFloat(form.monto)>0 && form.cliente) {
            try {
              const { getDocs, query, where, updateDoc, doc, addDoc: addDoc2 } = fb();
              const snap = await getDocs(query(collection(db,"cuentas_corrientes"), where("nombre","==",form.cliente)));
              const monto = parseFloat(form.monto);
              if(!snap.empty) {
                const ccDoc = snap.docs[0];
                const saldoActual = ccDoc.data().saldo || 0;
                await updateDoc(doc(db,"cuentas_corrientes",ccDoc.id), {
                  saldo: saldoActual - monto,
                  ultimoMovimiento: new Date().toISOString().split("T")[0]
                });
                await addDoc2(collection(db,"cc_movimientos"), {
                  cliente: form.cliente, tipo:"pago",
                  monto, movimiento:-monto, saldo: saldoActual - monto,
                  fecha: new Date().toISOString().split("T")[0],
                  detalle:"Crédito por devolución: "+form.producto,
                  obs:"Devolución registrada automáticamente",
                  origen:"devolucion", createdAt: new Date().toISOString()
                });
              }
            } catch(e){ console.error("Error cc:",e); }
          }
          setForm({cliente:"",producto:"",cantidad:"",unidad:"kg",motivo:"",descripcion:"",fechaPedidoOrig:"",monto:"",estado:"pendiente"});
          setModalOpen(false);
          cargar();
        } catch(e){ alert("Error al guardar"); console.error(e); }
        setGuardando(false);
      }

      async function cambiarEstado(id, nuevoEstado) {
        try {
          const { db, doc, updateDoc } = fb();
          await updateDoc(doc(db,"devoluciones",id), { estado: nuevoEstado });
          cargar();
        } catch(e){ console.error(e); }
      }

      function compartirWA(d) {
        const nl="%0A";
        let msg="Devolución registrada"+nl+nl;
        msg+="Cliente: "+d.cliente+nl;
        msg+="Producto: "+d.producto+" ("+d.cantidad+" "+d.unidad+")"+nl;
        msg+="Motivo: "+d.motivo+nl;
        if(d.descripcion) msg+="Detalle: "+d.descripcion+nl;
        if(d.monto>0) msg+="Crédito a favor: $"+Math.round(d.monto).toLocaleString("es-AR")+nl;
        msg+="Estado: "+(d.estado==="resuelta"?"Resuelta":"Pendiente")+nl;
        msg+=nl+"Frigorífico Sersale";
        window.open("https://wa.me/?text="+msg,"_blank");
      }

      const fmtFecha = f => f ? f.split("-").reverse().join("/") : "-";
      const fmt$ = n => n ? "$"+Math.round(n).toLocaleString("es-AR") : "";

      const lista = (devoluciones||[])
        .filter(d => filtro==="todos" || d.estado===filtro)
        .filter(d => !filtroCliente || d.cliente===filtroCliente);

      const pendientes = (devoluciones||[]).filter(d=>d.estado==="pendiente").length;

      return (
        <div>
          {/* KPIs */}
          {devoluciones && devoluciones.length>0 && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
              <div style={{background:"#F7EAEA",borderRadius:12,padding:"10px 8px",border:"1.5px solid #C33039",textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:900,color:"#C33039"}}>{pendientes}</div>
                <div style={{fontSize:10,color:"#79828B",marginTop:1}}>Pendientes</div>
              </div>
              <div style={{background:"#E9F0EC",borderRadius:12,padding:"10px 8px",border:"1.5px solid #2F6B4F",textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:900,color:"#2F6B4F"}}>{devoluciones.filter(d=>d.estado==="resuelta").length}</div>
                <div style={{fontSize:10,color:"#79828B",marginTop:1}}>Resueltas</div>
              </div>
              <div style={{background:"#E7EDF1",borderRadius:12,padding:"10px 8px",border:"1.5px solid #26536E",textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:900,color:"#26536E"}}>{devoluciones.length}</div>
                <div style={{fontSize:10,color:"#79828B",marginTop:1}}>Total</div>
              </div>
            </div>
          )}

          {/* Botón nueva + filtros */}
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button onClick={()=>setModalOpen(true)}
              style={{padding:"9px 14px",borderRadius:12,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
              + Nueva
            </button>
            <select value={filtroCliente} onChange={e=>setFiltroCliente(e.target.value)}
              style={{flex:1,padding:"9px 10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}>
              <option value="">Todos los clientes</option>
              {(clientes||[]).sort().map(cl=><option key={cl} value={cl}>{cl}</option>)}
            </select>
            <select value={filtro} onChange={e=>setFiltro(e.target.value)}
              style={{padding:"9px 10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}>
              <option value="todos">Todos</option>
              <option value="pendiente">Pendientes</option>
              <option value="resuelta">Resueltas</option>
            </select>
          </div>

          {/* Lista */}
          {devoluciones===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
          : lista.length===0 ? (
            <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
              <div style={{fontSize:48}}>↩️</div>
              <p style={{marginBottom:16}}>{devoluciones.length===0?"Sin devoluciones registradas":"Sin resultados para este filtro"}</p>
              {devoluciones.length===0&&<button onClick={()=>setModalOpen(true)} style={{padding:"12px 24px",borderRadius:12,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,cursor:"pointer"}}>+ Registrar primera devolución</button>}
            </div>
          ) : lista.map(d => {
            const resuelta = d.estado==="resuelta";
            const expanded = detalle===d.id;
            return (
              <div key={d.id} style={{background:"#fff",borderRadius:14,border:`1.5px solid ${resuelta?"#DDE9E2":"#EEDADB"}`,marginBottom:10,overflow:"hidden"}}>
                {/* Header tarjeta */}
                <div onClick={()=>setDetalle(expanded?null:d.id)}
                  style={{padding:14,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                      <span style={{fontWeight:700,fontSize:14,color:"#191E23"}}>{d.cliente}</span>
                      <span style={{fontSize:11,padding:"2px 8px",borderRadius:20,background:resuelta?"#DDE9E2":"#EEDADB",color:resuelta?"#24523D":"#A4232A",fontWeight:700}}>
                        {resuelta?"✓ Resuelta":"⏳ Pendiente"}
                      </span>
                    </div>
                    <div style={{fontSize:13,color:"#555",marginBottom:2}}>
                      <strong>{d.producto}</strong> — {d.cantidad} {d.unidad}
                    </div>
                    <div style={{fontSize:12,color:"#79828B"}}>{d.motivo}</div>
                    {d.monto>0&&<div style={{fontSize:12,color:"#2F6B4F",fontWeight:600,marginTop:2}}>Crédito: {fmt$(d.monto)}</div>}
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:11,color:"#A3ABB3"}}>{fmtFecha(d.fecha)}</div>
                    <div style={{fontSize:16,color:"#B9BFC5",marginTop:4}}>{expanded?"▴":"▾"}</div>
                  </div>
                </div>

                {/* Detalle expandido */}
                {expanded && (
                  <div style={{borderTop:"1px solid #EDEEF0",padding:14}}>
                    {d.fechaPedidoOrig&&<div style={{fontSize:12,color:"#79828B",marginBottom:6}}>Pedido original: {fmtFecha(d.fechaPedidoOrig)}</div>}
                    {d.descripcion&&<div style={{fontSize:12,color:"#555",background:"#F7F8F9",borderRadius:8,padding:"8px 10px",marginBottom:10}}>{d.descripcion}</div>}
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {/* Cambiar estado */}
                      <button onClick={()=>cambiarEstado(d.id, resuelta?"pendiente":"resuelta")}
                        style={{flex:1,padding:"9px 0",borderRadius:8,border:"none",background:resuelta?"#C33039":"#2F6B4F",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                        {resuelta?"Marcar pendiente":"✓ Marcar resuelta"}
                      </button>
                      <button onClick={()=>compartirWA(d)}
                        style={{padding:"9px 14px",borderRadius:8,border:"none",background:"#25D366",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                        WA
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Modal nueva devolución */}
          {modalOpen && (
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setModalOpen(false);}}>
              <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480,maxHeight:"92vh",overflowY:"auto"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <span style={{fontWeight:800,fontSize:16}}>Nueva Devolución</span>
                  <button onClick={()=>setModalOpen(false)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
                </div>

                {/* Cliente */}
                <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Cliente *</label>
                <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:12}}
                  value={form.cliente} onChange={e=>setForm({...form,cliente:e.target.value})}>
                  <option value="">Seleccionar cliente...</option>
                  {(clientes||[]).sort().map(cl=><option key={cl} value={cl}>{cl}</option>)}
                </select>

                {/* Producto y cantidad */}
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:8,marginBottom:12}}>
                  <div>
                    <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Producto *</label>
                    <input style={{width:"100%",padding:"10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                      placeholder="Ej: Jamón cocido" value={form.producto} onChange={e=>setForm({...form,producto:e.target.value})} />
                  </div>
                  <div>
                    <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Cantidad</label>
                    <input type="number" style={{width:"100%",padding:"10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                      placeholder="0" value={form.cantidad} onChange={e=>setForm({...form,cantidad:e.target.value})} />
                  </div>
                  <div>
                    <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Unidad</label>
                    <select style={{width:"100%",padding:"10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                      value={form.unidad} onChange={e=>setForm({...form,unidad:e.target.value})}>
                      {["kg","piezas","bolsas","unidades"].map(u=><option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>

                {/* Motivo */}
                <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Motivo *</label>
                <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:12}}
                  value={form.motivo} onChange={e=>setForm({...form,motivo:e.target.value})}>
                  <option value="">Seleccionar motivo...</option>
                  {["Producto en mal estado","Error en el pedido","Producto vencido","Daño en el transporte","Cantidad incorrecta","Calidad no conforme","Otro"].map(m=><option key={m} value={m}>{m}</option>)}
                </select>

                {/* Descripción */}
                <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Descripción del problema</label>
                <textarea style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff",marginBottom:12,resize:"vertical",minHeight:70}}
                  placeholder="Detallá el problema..." value={form.descripcion} onChange={e=>setForm({...form,descripcion:e.target.value})} />

                {/* Fecha pedido original y monto */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                  <div>
                    <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Fecha pedido original</label>
                    <input type="date" style={{width:"100%",padding:"10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                      value={form.fechaPedidoOrig} onChange={e=>setForm({...form,fechaPedidoOrig:e.target.value})} />
                  </div>
                  <div>
                    <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Crédito a favor ($)</label>
                    <InputMonto style={{width:"100%",padding:"10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                      placeholder="0" value={form.monto} onChange={v=>setForm({...form,monto:v})} />
                  </div>
                </div>

                {form.monto>0 && form.cliente && (
                  <div style={{background:"#E7EDF1",border:"1px solid #AED6F1",borderRadius:8,padding:"8px 12px",marginBottom:16,fontSize:12,color:"#26536E"}}>
                    Se generará un crédito de {fmt$(parseFloat(form.monto)||0)} en la cuenta corriente de {form.cliente}
                  </div>
                )}

                <button onClick={guardar} disabled={guardando}
                  style={{width:"100%",padding:16,borderRadius:14,border:"none",background:guardando?"#B9BFC5":"#A4232A",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>
                  {guardando?"Guardando...":"Registrar devolución"}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

        // ── BANNER TIEMPO REAL ──────────────────────────────────
    function BannerNuevoPedido({ pedido, onClose }) {
      useEffect(()=>{ const t=setTimeout(onClose,6000); return()=>clearTimeout(t); },[]);
      return (
        <div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",zIndex:9999,width:"100%",maxWidth:480,padding:"0",pointerEvents:"none"}}>
          <div style={{background:"#2F6B4F",color:"#fff",padding:"14px 20px",boxShadow:"0 4px 20px rgba(0,0,0,0.3)",display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:24}}>🛒</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:14}}>Nuevo pedido cargado</div>
              <div style={{fontSize:13,opacity:0.9}}>{pedido.cliente} · {pedido.items.length} producto{pedido.items.length!==1?"s":""}</div>
            </div>
          </div>
        </div>
      );
    }

    // ── APP ─────────────────────────────────────────────────
    function App() {
      const esOperario = sessionStorage.getItem("sersale_role") === "operario";
      const [vista, _setVista] = useState(()=> esOperario ? "deposito" : (sessionStorage.getItem("sersale_vista")||"home"));
      function setVista(v) {
        if (esOperario) { _setVista("deposito"); return; } // bloquear cambio de vista
        sessionStorage.setItem("sersale_vista",v); _setVista(v);
      }
      const [nuevosPedidos, setNuevosPedidos] = useState(0);
      const [bannerPedido, setBannerPedido] = useState(null);
      const inicioSesion = React.useRef(new Date().toISOString());

      // Si es operario, ocultar la nav inferior global
      useEffect(()=>{
        if (esOperario) {
          const n1 = document.getElementById("sersale_nav");
          const n2 = document.getElementById("__crm_nav");
          if (n1) n1.style.display = "none";
          if (n2) n2.style.display = "none";
          document.body.style.paddingBottom = "0";
        }
      }, []);

      useEffect(()=>{
        function init() {
          const { db, collection, query, orderBy, onSnapshot } = fb();
          const lastSeen = getLastSeen();
          // Badge: pedidos pendientes desde última visita
          const q = query(collection(db,"pedidos"), orderBy("fechaPedido","desc"));
          const unsub = onSnapshot(q, (snap) => {
            const nuevos = snap.docs.filter(d => {
              const data = d.data();
              return data.fechaPedidoISO > lastSeen && data.estado==="pendiente";
            }).length;
            setNuevosPedidos(nuevos);
            // Banner en tiempo real: pedidos nuevos DESPUÉS de abrir la app
            snap.docChanges().forEach(change => {
              if (change.type === "added") {
                const data = change.doc.data();
                if (data.fechaPedidoISO > inicioSesion.current) {
                  setBannerPedido(data);
                }
              }
            });
          });
          return unsub;
        }
        let unsub;
        if (window.__fbReady) { unsub = init(); }
        else { document.addEventListener("fbReady", ()=>{ unsub = init(); }); }
        return ()=> unsub && unsub();
      },[]);

      function seleccionar(key) {
        setLastSeen();
        // Director ya está autenticado al entrar - sin PINs intermedios
        setVista(key);
      }

      return (
        <>
          {bannerPedido && <BannerNuevoPedido pedido={bannerPedido} onClose={()=>setBannerPedido(null)} />}
          {vista==="home"          && <Home onSelect={seleccionar} nuevosPedidos={nuevosPedidos} />}
          {vista==="productos"    && <GestionProductos onBack={()=>setVista("home")} />}
          {vista==="comercial"     && <VistaComercial onBack={()=>setVista("home")} onRefreshParent={()=>{}} />}
          {vista==="deposito"      && <VistaDeposito  onBack={esOperario ? null : ()=>setVista("home")} modoOperario={esOperario} />}
          {vista==="director"      && <VistaDirector  onBack={()=>setVista("home")} />}
          {vista==="clientes"      && <GestionClientes onBack={()=>setVista("home")} />}
        </>
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(<App />);

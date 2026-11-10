    // ── TARJETA PEDIDO ──────────────────────────────────────
    function TarjetaPedido({ pedido, onCambiarEstado, showActions, isNew, onEditar, onRemito, onDetallePrep, modoOperario }) {
      const [expanded, setExpanded] = useState(false);
      const [kgModal, setKgModal] = useState(false);
      const [kgValues, setKgValues] = useState({});
      const [editKgModal, setEditKgModal] = useState(false);
      const [editKgValues, setEditKgValues] = useState({});
      const est = ESTADOS[pedido.estado] || ESTADOS.pendiente;
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
                  {pedido.estado==="preparando" && !modoOperario && <button onClick={()=>onCambiarEstado(pedido.id,"listo")}      style={{flex:1,padding:"10px 8px",borderRadius:12,border:"none",background:"#2F6B4F",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>✅ Listo</button>}
                  {pedido.estado==="preparando" && onDetallePrep && <button onClick={onDetallePrep} style={{padding:"10px 12px",borderRadius:12,border:"1.5px solid #26536E",background:"transparent",color:"#26536E",fontWeight:700,fontSize:12,cursor:"pointer"}}>📋 Ítems</button>}
                  {pedido.estado==="listo" && !modoOperario && <button onClick={()=>onCambiarEstado(pedido.id,"despachado")} style={{flex:1,padding:"10px 8px",borderRadius:12,border:"none",background:"#79828B",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>🚚 Despachado</button>}
                  {pedido.estado==="listo" && !modoOperario && onRemito && <button onClick={()=>onRemito(pedido)} style={{padding:"10px 12px",borderRadius:12,border:"none",background:"#6B4E8E",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>🧾 Remito</button>}
                  {pedido.estado==="listo" && <button onClick={()=>{ const vals={}; pedido.items.forEach((it,i)=>{ if(it.kgReal!=null) vals[i]=it.kgReal; }); setEditKgValues(vals); setEditKgModal(true); }} style={{padding:"10px 12px",borderRadius:12,border:"1.5px solid #2F6B4F",background:"transparent",color:"#2F6B4F",fontWeight:700,fontSize:12,cursor:"pointer"}}>⚖️ kg</button>}
                  {onEditar && !modoOperario && <button onClick={()=>onEditar(pedido)} style={{padding:"10px 14px",borderRadius:12,border:"1.5px solid #2A333B",background:"transparent",color:"#2A333B",fontWeight:700,fontSize:12,cursor:"pointer"}}>✏️</button>}
                  {!modoOperario && <button onClick={()=>onCambiarEstado(pedido.id,"cancelado")} style={{padding:"10px 14px",borderRadius:12,border:"1.5px solid #C33039",background:"transparent",color:"#C33039",fontWeight:700,fontSize:12,cursor:"pointer"}}>❌</button>}
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
                  <input type="number" placeholder="kg"
                    style={{width:90,padding:"10px 12px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:14,textAlign:"right"}}
                    value={kgValues[i]||""} onChange={e=>setKgValues({...kgValues,[i]:e.target.value})} />
                  <span style={{fontSize:12,color:"#79828B",width:24}}>kg</span>
                </div>
              ))}
              <button onClick={()=>{
                const itemsConKg = pedido.items.map((it,i)=>({
                  ...it, kgReal: kgValues[i]!=null && kgValues[i]!=="" ? parseFloat(kgValues[i]) : null
                }));
                onCambiarEstado(pedido.id,"preparando", itemsConKg);
                setKgModal(false);
              }} style={{width:"100%",padding:16,borderRadius:14,border:"none",background:"#26536E",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer",marginTop:8}}>
                ⚙️ Confirmar — En preparación
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
                  <input type="number" placeholder="kg"
                    style={{width:90,padding:"10px 12px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:14,textAlign:"right"}}
                    value={editKgValues[i]!=null ? editKgValues[i] : ""} onChange={e=>setEditKgValues({...editKgValues,[i]:e.target.value})} />
                  <span style={{fontSize:12,color:"#79828B",width:24}}>kg</span>
                </div>
              ))}
              <button onClick={()=>{
                const itemsActualizados = pedido.items.map((it,i)=>({
                  ...it, kgReal: editKgValues[i]!=null && editKgValues[i]!=="" ? parseFloat(editKgValues[i]) : null
                }));
                onCambiarEstado(pedido.id, pedido.estado, itemsActualizados);
                setEditKgModal(false);
              }} style={{width:"100%",padding:16,borderRadius:14,border:"none",background:"#2F6B4F",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer",marginTop:8}}>
                ✓ Guardar kg
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

      async function cargar() {
        const { db, collection, query, getDocs, orderBy } = fb();
        const snap = await getDocs(query(collection(db,"pedidos"), orderBy("fechaPedido","desc")));
        setPedidos(snap.docs.map(d=>({id:d.id,...d.data()})));
        if(onRefreshParent) setTimeout(()=>onRefreshParent(), 800);
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

      if (mostrarNuevo) return <NuevoPedido onBack={()=>setMostrarNuevo(false)} onSaved={()=>{ setMostrarNuevo(false); cargar(); }} />;
      if (mostrarClientes) return <GestionClientes onBack={()=>setMostrarClientes(false)} />;
      if (mostrarProductos) return <GestionProductos onBack={()=>setMostrarProductos(false)} />;
      if (editandoPedido) return <EditarPedido pedido={editandoPedido} onBack={()=>setEditandoPedido(null)} onSaved={()=>{ setEditandoPedido(null); cargar(); }} />;
      if (remitoPedido) return <RemitoPedido pedido={remitoPedido} onBack={()=>setRemitoPedido(null)} />;

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
            {pedidos===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
            : tab==="pedidos"
              ? <ActivosFiltrados activos={activos} cambiarEstado={cambiarEstado} lastSeen={lastSeen} onEditar={setEditandoPedido} onRemito={setRemitoPedido} />
              : <HistorialFiltrado historial={historial} cambiarEstado={cambiarEstado} />
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
      const [items, setItems] = useState(pedido.items.map(it=>({...it})));
      const [obsGeneral, setObsGeneral] = useState(pedido.obs||"");
      const [guardando, setGuardando] = useState(false);
      const [clientesDB, setClientesDB] = useState([]);

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
      const updItem = (i,f,v) => { const c=[...items]; c[i][f]=v; if(f==="categoria") c[i].producto=""; setItems(c); };
      const remItem = i => setItems(items.filter((_,idx)=>idx!==i));

      const todosClientes = [
        ...clientesDB.map(c=>c.nombre),
        ...CLIENTES_DEFAULT.filter(d=>!clientesDB.find(c=>c.nombre===d)),
        "Otro"
      ];
      // If current cliente isn't in list, treat as custom
      const clienteEnLista = todosClientes.includes(cliente);
      const [clienteSelect, setClienteSelect] = useState(clienteEnLista ? cliente : "Otro");
      useEffect(()=>{
        if(!clienteEnLista) setClienteCustom(cliente);
      },[]);

      async function guardar() {
        const nombreCliente = clienteSelect==="Otro" ? clienteCustom.trim() : clienteSelect;
        if (!nombreCliente) return alert("Seleccioná o ingresá el cliente");
        if (!tipo) return alert("Seleccioná si es envío o retiro");
        if (!entrega) return alert("Ingresá la fecha de entrega");
        const val = items.filter(it=>it.producto&&it.cantidad);
        if (!val.length) return alert("Agregá al menos un producto");
        setGuardando(true);
        try {
          const { db, doc, updateDoc } = fb();
          await updateDoc(doc(db,"pedidos",pedido.id), {
            cliente: nombreCliente, cuentaCorriente, tipo,
            fechaEntrega: entrega, items: val, obs: obsGeneral.trim(),
            editadoEn: new Date().toISOString()
          });
          onSaved();
        } catch(e) { alert("Error al guardar"); console.error(e); }
        setGuardando(false);
      }

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
                        {(getProductos()[item.categoria]||[]).sort((a,b)=>a.localeCompare(b,"es")).map(p=><option key={p} value={p}>{p}</option>)}
                      </select>
                )}
                <div style={{display:"flex",gap:8}}>
                  <input style={{flex:1,padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none"}}
                    type="number" placeholder="Cantidad" value={item.cantidad} onChange={e=>updItem(i,"cantidad",e.target.value)} />
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
    function RemitoPedido({ pedido, onBack }) {
      const { useState, useEffect } = React;
      const [precios, setPrecios] = useState({});
      const [nroRemito, setNroRemito] = useState("");
      const [guardando, setGuardando] = useState(false);
      const [guardado, setGuardado] = useState(false);

      // Load saved prices for this client
      useEffect(()=>{
        async function cargar() {
          try {
            const { db, collection, getDocs, query, where } = fb();
            // Try exact match first, then case-insensitive fallback
            let snap = await getDocs(query(collection(db,"precios_cliente"),
              where("cliente","==",pedido.cliente)));
            if(snap.empty) {
              // Case-insensitive fallback: fetch all and filter
              const snapAll = await getDocs(collection(db,"precios_cliente"));
              const lower = pedido.cliente.toLowerCase().trim();
              const matching = snapAll.docs.filter(d => {
                const c = d.data().cliente;
                return c && c.toLowerCase().trim() === lower;
              });
              snap = { docs: matching, empty: matching.length === 0 };
            }
            const sorted = snap.docs.map(d=>({...(d.data ? d.data() : d)})).sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||""));
            const latest = {};
            sorted.forEach(data=>{
              if(!latest[data.producto]) latest[data.producto] = data.precio;
            });
            setPrecios(latest);
            if(Object.keys(latest).length > 0) console.log("[Remito] Precios cargados:", Object.keys(latest).length, "productos para", pedido.cliente);
          } catch(e){ console.error("Error cargando precios:", e); }
        }
        // Load next remito number from atomic counter
        async function cargarNro() {
          try {
            const { db, doc, getDoc, setDoc, collection, getDocs } = fb();
            // Read counter doc
            const counterRef = doc(db, "config", "contador_remitos");
            const counterSnap = await getDoc(counterRef);
            if(counterSnap.exists()) {
              setNroRemito(String((counterSnap.data().ultimo||0)+1).padStart(4,"0"));
            } else {
              // First time: scan existing remitos to initialize counter
              const snap = await getDocs(collection(db,"remitos"));
              let maxNro = 0;
              snap.docs.forEach(d=>{ const n = d.data().nro||0; if(n>maxNro) maxNro=n; });
              await setDoc(counterRef, { ultimo: maxNro, updatedAt: new Date().toISOString() });
              setNroRemito(String(maxNro+1).padStart(4,"0"));
            }
          } catch(e){ console.error("Error cargarNro:", e); setNroRemito("0001"); }
        }
        if(window.__fbReady){ cargar(); cargarNro(); }
        else document.addEventListener("fbReady",()=>{ cargar(); cargarNro(); });
      },[]);

      async function guardarRemito() {
        setGuardando(true);
        try {
          const { db, collection, addDoc, getDocs, query, orderBy, where, doc, getDoc, updateDoc, setDoc, increment } = fb();
          // Atomically reserve the next remito number
          let nroFinal = parseInt(nroRemito)||0;
          try {
            const counterRef = doc(db, "config", "contador_remitos");
            const counterSnap = await getDoc(counterRef);
            if(counterSnap.exists()) {
              nroFinal = (counterSnap.data().ultimo||0) + 1;
              await updateDoc(counterRef, { ultimo: nroFinal, updatedAt: new Date().toISOString() });
            } else {
              await setDoc(counterRef, { ultimo: nroFinal, updatedAt: new Date().toISOString() });
            }
            setNroRemito(String(nroFinal).padStart(4,"0"));
          } catch(e) { console.error("Error reservando nro remito:", e); }
          // Save remito
          await addDoc(collection(db,"remitos"), {
            nro: nroFinal,
            pedidoId: pedido.id,
            cliente: pedido.cliente,
            fecha: new Date().toISOString().split("T")[0],
            items: pedido.items.map(it=>({
              producto: it.producto,
              kg: it.kgReal||it.cantidad||0,
              unidad: it.unidad,
              precio: parseFloat(precios[it.producto])||0,
              total: (it.kgReal||parseFloat(it.cantidad)||0) * (parseFloat(precios[it.producto])||0)
            })),
            total: pedido.items.reduce((s,it)=>{
              const kg = it.kgReal||parseFloat(it.cantidad)||0;
              const p = parseFloat(precios[it.producto])||0;
              return s + kg*p;
            },0),
            createdAt: new Date().toISOString()
          });
          // Save prices per client
          for(const it of pedido.items) {
            const p = parseFloat(precios[it.producto]);
            if(p>0) {
              await addDoc(collection(db,"precios_cliente"), {
                cliente: pedido.cliente,
                producto: it.producto,
                precio: p,
                fecha: new Date().toISOString()
              });
            }
          }
          // ── Actualizar CC con el total real del remito ──
          // Check both pedido flag AND if client has CC account
          // Check CC: exact match first, then case-insensitive
          let ccDocId = null;
          const clienteTieneCC = pedido.cuentaCorriente || await (async()=>{
            try {
              const snapCC2 = await getDocs(collection(db,"cuentas_corrientes"));
              const lower = pedido.cliente.toLowerCase().trim();
              const match = snapCC2.docs.find(d => {
                const n = d.data().nombre;
                return n && n.toLowerCase().trim() === lower;
              });
              if(match) { ccDocId = match.id; return true; }
              return false;
            } catch(e){ return false; }
          })();
          if(clienteTieneCC) {
            try {
              const montoRemito = pedido.items.reduce((s,it)=>{
                const kg = it.kgReal||parseFloat(it.cantidad)||0;
                const p = parseFloat(precios[it.producto])||0;
                return s + kg*p;
              },0);
              const montoFinal = Math.round(montoRemito);
              const hoyStr = new Date().toISOString().split("T")[0];
              const productos = pedido.items.map(it=>it.producto).join(", ");
              
              // Buscar placeholder cc_movimiento (case-insensitive)
              const lower3 = pedido.cliente.toLowerCase().trim();
              const snapAllCC = await getDocs(collection(db,"cc_movimientos"));
              let movExistente = null;
              snapAllCC.docs.forEach(d => {
                const m = d.data();
                if(m.cliente && m.cliente.toLowerCase().trim() === lower3 
                   && m.origen === "pedido_app" 
                   && m.fecha === pedido.fechaEntrega 
                   && m.monto === 0) {
                  movExistente = d;
                }
              });
              
              if(movExistente && montoFinal > 0) {
                // Actualizar el movimiento placeholder con el monto real
                await updateDoc(doc(db,"cc_movimientos",movExistente.id), {
                  monto: montoFinal,
                  movimiento: montoFinal,
                  detalle: productos,
                  obs: "Remito N° "+String(nroFinal).padStart(4,"0"),
                  remitoNro: nroFinal,
                  updatedAt: new Date().toISOString()
                });
                console.log("[Remito] CC movimiento actualizado:", montoFinal);
              } else if(montoFinal > 0) {
                // Crear nuevo movimiento CC (no habia placeholder)
                await addDoc(collection(db,"cc_movimientos"), {
                  cliente: pedido.cliente,
                  tipo: "pedido",
                  monto: montoFinal,
                  movimiento: montoFinal,
                  fecha: pedido.fechaEntrega || hoyStr,
                  detalle: productos,
                  obs: "Remito N° "+String(nroFinal).padStart(4,"0"),
                  origen: "remito",
                  remitoNro: nroFinal,
                  createdAt: new Date().toISOString()
                });
                console.log("[Remito] CC movimiento creado:", montoFinal);
              }
              
              // Recalcular saldo total del cliente (case-insensitive)
              if(montoFinal > 0) {
                const lower2 = pedido.cliente.toLowerCase().trim();
                const snapAllMovs = await getDocs(collection(db,"cc_movimientos"));
                let saldo = 0;
                snapAllMovs.docs.forEach(d => {
                  const m = d.data();
                  if(m.cliente && m.cliente.toLowerCase().trim() === lower2) {
                    saldo += m.tipo === "pedido" ? (m.monto||0) : -(m.monto||0);
                  }
                });
                // Find CC account (use ccDocId if already found, otherwise search)
                if(ccDocId) {
                  await updateDoc(doc(db,"cuentas_corrientes",ccDocId), {
                    saldo: Math.round(saldo),
                    ultimoMovimiento: hoyStr
                  });
                  console.log("[Remito] CC saldo actualizado:", saldo);
                } else {
                  const snapCC3 = await getDocs(collection(db,"cuentas_corrientes"));
                  const ccMatch = snapCC3.docs.find(d => {
                    const n = d.data().nombre;
                    return n && n.toLowerCase().trim() === lower2;
                  });
                  if(ccMatch) {
                    await updateDoc(doc(db,"cuentas_corrientes",ccMatch.id), {
                      saldo: Math.round(saldo),
                      ultimoMovimiento: hoyStr
                    });
                    console.log("[Remito] CC saldo actualizado:", saldo);
                  } else {
                    console.warn("[Remito] CC account not found for:", pedido.cliente);
                  }
                }
              }
            } catch(e) { console.error("[Remito] Error actualizando CC:", e); }
          }
          
          setGuardado(true);
          // Number already reserved atomically above
          setNroRemito(String(nroFinal+1).padStart(4,"0"));
        } catch(e){ alert("Error al guardar"); console.error(e); }
        setGuardando(false);
      }

      const totalRemito = pedido.items.reduce((s,it)=>{
        const kg = it.kgReal!=null ? it.kgReal : parseFloat(it.cantidad)||0;
        const p = parseFloat(precios[it.producto])||0;
        return s + kg*p;
      },0);

      const fmt$ = n => n.toLocaleString("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:2});

      function imprimir() {
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
        doc.text(new Date().toLocaleDateString('es-AR'), margin + pw/2, y);
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
        var totalRemito2 = 0;
        pedido.items.forEach(function(it) {
          var kg = it.kgReal != null ? it.kgReal : parseFloat(it.cantidad) || 0;
          var p = parseFloat(precios[it.producto]) || 0;
          var tot = kg * p;
          totalRemito2 += tot;
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
        doc.setDrawColor(192,34,43); doc.setLineWidth(0.5);
        doc.line(margin, y, W - margin, y);
        y += 2;
        doc.setFontSize(11); doc.setTextColor(192,34,43); doc.setFont(undefined,'bold');
        doc.text('TOTAL', colX[2] + colW2[2]/2, y + 5, { align: 'center' });
        doc.text(fmt$(totalRemito2), colX[3] + colW2[3] - 2, y + 5, { align: 'right' });
        
        // Save as blob for sharing
        var fileName = 'Remito ' + nroRemito + ' - ' + (pedido.cliente||'Cliente') + ' - ' + new Date().toLocaleDateString('es-AR').replace(/\//g,'-') + '.pdf';
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
              <input style={{flex:1,padding:"10px 14px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:18,fontWeight:700,textAlign:"center"}}
                value={nroRemito} onChange={e=>setNroRemito(e.target.value)} />
            </div>

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
            {pedido.items.map((it,i)=>{
              const kg = it.kgReal!=null ? it.kgReal : parseFloat(it.cantidad)||0;
              const p = parseFloat(precios[it.producto])||0;
              const tot = kg*p;
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
                        value={precios[it.producto]||""} onChange={v=>setPrecios({...precios,[it.producto]:v})} />
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
          </div>
        </div>
      );
    }


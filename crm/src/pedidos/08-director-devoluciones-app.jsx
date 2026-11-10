    // ── AYUDAS DEL PANEL DEL DIRECTOR ───────────────────────
    // Día (AAAA-MM-DD, Buenos Aires) de un pedido: el de entrega; si falta, el de carga.
    function p8DiaDePedido(p) {
      if (!p) return "";
      return ccDia(p.fechaEntrega) || SersaleBase.diaDe(p.fechaPedidoISO) || SersaleBase.diaDe(p.fechaPedido)
        || ccDia(p.fecha) || SersaleBase.diaDe(p.createdAt) || "";
    }
    // Momento de carga de un pedido (ms), para ordenar listas; si falta, su día de entrega.
    function p8MomentoPedido(p) {
      const f = SersaleBase.aFecha(p.fechaPedidoISO) || SersaleBase.aFecha(p.fechaPedido) || SersaleBase.aFecha(p.fechaEntrega);
      return f ? f.getTime() : 0;
    }
    const p8OrdenNombres = (a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" });

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
      const [ventaRapidaOpen, setVentaRapidaOpen] = useState(()=>{
        const pedida = new URLSearchParams(window.location.search).get('vr')==='1';
        // El pedido de abrirla vale una sola vez: si quedaba en la dirección, la venta
        // rápida se abría sola cada vez que se volvía a entrar al panel o se recargaba.
        if (pedida) { try { window.history.replaceState(window.history.state, "", window.location.pathname); } catch(e) {} }
        return pedida;
      });
      const [errorCarga, setErrorCarga] = useState(false);
      // Cada carga lleva su número: la respuesta de una carga vieja (o de una pantalla
      // que ya se cerró) no pisa a la más nueva.
      const tandaCarga = React.useRef(0);

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
        const tanda = ++tandaCarga.current;
        let todos;
        try {
          const { db, collection, getDocs } = fb();
          const snap = await getDocs(collection(db,"pedidos"));
          todos = snap.docs.map(d=>({id:d.id,...d.data()}));
        } catch(e) {
          // Antes el error se perdía y la pantalla quedaba en "Cargando..." para siempre
          console.error(e);
          if (tanda === tandaCarga.current) {
            setErrorCarga(true);
            SersaleUI.toast("No se pudieron cargar los pedidos. Revisá la conexión y probá de nuevo.", { tipo: "error" });
          }
          return;
        }
        if (tanda !== tandaCarga.current) return;
        setErrorCarga(false);
        // Don't setPedidos here - calcularAlertas will do it with combined data
        await calcularAlertas(todos, tanda);
      }

      async function calcularAlertas(todosPedidosCached, tanda) {
        const vigente = () => tanda === tandaCarga.current;
        try {
          const { db, collection, getDocs } = fb();
          // Un cliente es el mismo aunque cambien mayúsculas, acentos o espacios de más
          // (la misma regla que cuentas corrientes). Se muestra con el nombre de su
          // ficha; si no tiene ficha, con el primero que aparezca.
          const clienteNormalizado = {}; // nombre normalizado -> nombre a mostrar
          function normCliente(nombre) {
            if(!nombre) return nombre;
            const clave = SersaleBase.norm(nombre);
            if(!clave) return nombre;
            if(!clienteNormalizado[clave]) clienteNormalizado[clave] = nombre;
            return clienteNormalizado[clave];
          }
          // Fichas primero: sus nombres son los que mandan.
          let fichas = [], errorFichas = null;
          try {
            const snapCli = await getDocs(collection(db,"clientes"));
            fichas = snapCli.docs.map(d => ({ id: d.id, data: d.data() }));
          } catch(e) { errorFichas = e; }
          const configCli = {};
          fichas.forEach(({ id, data }) => {
            if(!data.nombre) return;
            const nombre = normCliente(data.nombre);
            if(!configCli[nombre]) {
              configCli[nombre] = {
                diasAlerta: data.diasAlerta || 14,
                telefono: data.telefono || "",
                id,
                ultimoContacto: data.ultimoContacto || null,
                ultimoPedidoRegistrado: data.ultimoPedidoRegistrado || null,
                // Lo que ya está guardado, para no volver a escribirlo si no cambió
                _diasGuardado: data.diasAlerta,
                _freqGuardada: data.freqCalculada
              };
            } else {
              // Cliente cargado dos veces (por ejemplo, una ficha con acentos y otra sin): "✓ Contactado"
              // y el alta de un pedido anotan el contacto en UNA de las fichas, que puede no ser la que
              // se tomó acá. Vale el contacto más reciente de cualquiera; si no, el cliente marcado
              // volvía a figurar vencido cada vez que se abría el panel.
              const cfg = configCli[nombre];
              if(SersaleBase.diaDe(data.ultimoContacto) > SersaleBase.diaDe(cfg.ultimoContacto)) cfg.ultimoContacto = data.ultimoContacto;
              if(SersaleBase.diaDe(data.ultimoPedidoRegistrado) > SersaleBase.diaDe(cfg.ultimoPedidoRegistrado)) cfg.ultimoPedidoRegistrado = data.ultimoPedidoRegistrado;
            }
          });
          // Pedidos con el nombre ya unificado (copias: no se toca lo que vino de la base)
          const todosPedidos = (todosPedidosCached || []).map(p => p.cliente ? { ...p, cliente: normCliente(p.cliente) } : p);
          const idsPedidos = new Set(todosPedidos.map(p => p.id));
          const diasConPedido = new Set(todosPedidos.map(p => p.cliente + "|" + p.fechaEntrega));
          // Also check ALL cc_movimientos as evidence of client activity
          // Use a separate map to collect additional dates per client from CC
          const ccFechasPorCliente = {};
          try {
            const snapCC = await getDocs(collection(db,"cc_movimientos"));
            snapCC.docs.forEach(d => {
              const m = d.data();
              if(!m.cliente) return;
              const cliente = normCliente(m.cliente);
              // Día del movimiento en Buenos Aires: su `fecha` (texto o Timestamp) o, si falta, cuándo se cargó
              const fechaCorta = ccDia(m.fecha) || SersaleBase.diaDe(m.createdAt);
              if(!fechaCorta) return;
              // Track ALL CC activity dates per client (pedidos AND pagos = client is active)
              if(!ccFechasPorCliente[cliente]) ccFechasPorCliente[cliente] = new Set();
              ccFechasPorCliente[cliente].add(fechaCorta);
              // Only create virtual pedido entries for tipo="pedido" (actual sales)
              if(m.tipo === "pedido") {
                // ¿Ya está el pedido de este cargo? Primero por su id (el remito y la venta
                // rápida lo guardan en el movimiento); si no lo trae, por cliente y día.
                const yaExiste = (!!m.pedidoId && idsPedidos.has(m.pedidoId)) || diasConPedido.has(cliente + "|" + fechaCorta);
                if(!yaExiste) {
                  diasConPedido.add(cliente + "|" + fechaCorta);
                  todosPedidos.push({
                    id: "cc_"+d.id, cliente, tipo: "retiro",
                    fechaEntrega: fechaCorta,
                    // siempre texto: un Timestamp acá rompía la marca NUEVO y la hora de la tarjeta
                    fechaPedidoISO: ccTextoISO(m.createdAt) || fechaCorta+"T12:00:00.000Z",
                    items: m.items || [{producto: m.detalle||"Movimiento CC", cantidad:0}],
                    estado: "despachado", origen: m.origen || "cc_movimiento",
                    obs: m.detalle || ""
                  });
                }
              }
            });
          } catch(e) { console.error("Error reading cc_movimientos:", e); }
          if(!vigente()) return;
          // Update local state with combined data
          setPedidos(todosPedidos);
          if(errorFichas) throw errorFichas;
          // Ensure all clients with pedidos exist in configCli
          // (some may have pedidos but no entry in clientes collection)
          todosPedidos.forEach(p => {
            if(p.cliente && p.estado!=="cancelado" && !configCli[p.cliente]) configCli[p.cliente] = { diasAlerta: 14, telefono: "", id: null };
          });
          // Build per-client history: find ultimo pedido using ALL date sources
          const ultimoPedido = {};
          const historialClientes = {};
          todosPedidos.filter(p=>p.estado!=="cancelado" && p.cliente).forEach(p => {
            const dia = p8DiaDePedido(p);
            if(!dia) return;
            const conFecha = {...p, _fechaNorm: dia+"T12:00:00.000Z", _fechaDisplay: dia};
            // Track history
            if(!historialClientes[p.cliente]) historialClientes[p.cliente] = [];
            historialClientes[p.cliente].push(conFecha);
            // Keep latest
            if (!ultimoPedido[p.cliente] || dia > ultimoPedido[p.cliente]._fechaDisplay) ultimoPedido[p.cliente] = conFecha;
          });
          // ── Auto-recalcular frecuencia (diasAlerta) por cliente ──
          const updatesBatch = [];
          Object.entries(historialClientes).forEach(([cliente, pedArr]) => {
            const fechasUnicas = [...new Set(pedArr.map(p=>p._fechaDisplay).filter(Boolean))].sort();
            if(fechasUnicas.length < 2) return;
            const diffs = [];
            for(let i=1; i<fechasUnicas.length; i++) {
              const d = SersaleBase.diasEntre(fechasUnicas[i-1], fechasUnicas[i]);
              if(d > 0 && d < 120) diffs.push(d);
            }
            if(diffs.length === 0) return;
            const freqCalc = Math.round(diffs.reduce((a,b)=>a+b,0)/diffs.length);
            // Add 3 days buffer to avoid false positives
            const diasAlertaCalc = freqCalc + 3;
            const cfg = configCli[cliente];
            if(cfg && cfg.id) {
              // Always recalculate from actual data
              cfg.diasAlerta = diasAlertaCalc;
              cfg._freqCalc = freqCalc;
              cfg._totalPedidos = fechasUnicas.length;
              // ...pero se escribe solo si cambió (antes: una escritura por cliente en cada carga)
              if(cfg._diasGuardado !== diasAlertaCalc || cfg._freqGuardada !== freqCalc) {
                updatesBatch.push({ id: cfg.id, diasAlerta: diasAlertaCalc, freqCalculada: freqCalc });
              }
            }
          });
          // Se guardan sin frenar la pantalla: sin señal la escritura queda en cola y,
          // si se la esperaba, las alertas no aparecían nunca.
          if(updatesBatch.length > 0) {
            const { doc, updateDoc } = fb();
            const ahora = new Date().toISOString();
            updatesBatch.forEach(upd => {
              updateDoc(doc(db,"clientes",upd.id), {
                diasAlerta: upd.diasAlerta,
                freqCalculada: upd.freqCalculada,
                freqActualizado: ahora
              }).catch(e => console.error("Error updating",upd.id,e));
            });
          }
          // Only track REGISTERED clients (from clientes collection)
          // Deleted clients won't appear even if they have historical pedidos/CC
          const hoy = SersaleBase.hoy();
          const alertas = [];
          Object.keys(configCli).forEach(cliente => {
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
            // Check ultimoContacto from clientes collection (set when pedido is created).
            // Es una fecha con hora: se toma su día de Buenos Aires (el de UTC corría un día
            // los contactos marcados después de las 21).
            const contactoStr = SersaleBase.diaDe(cfg.ultimoContacto);
            if(contactoStr > fechaStr) fechaStr = contactoStr;
            const registradoStr = SersaleBase.diaDe(cfg.ultimoPedidoRegistrado);
            if(registradoStr > fechaStr) fechaStr = registradoStr;
            const totalPedidos = historialClientes[cliente] ? historialClientes[cliente].length : 0;
            const totalCC = ccFechasPorCliente[cliente] ? ccFechasPorCliente[cliente].size : 0;
            // Skip clients with NO activity at all (only in clientes collection)
            if(!fechaStr) return;
            const diasSinPedir = SersaleBase.diasEntre(fechaStr, hoy);
            if(isNaN(diasSinPedir)) return; // invalid date, skip
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
          if(!vigente()) return;
          setAlertasData({ alertas, configCli, historialClientes, ccFechasPorCliente });
          verificarYEnviarAlertas(alertas);
        } catch(e) {
          console.error(e);
          if(vigente()) {
            // Que un problema con las alertas no deje el panel entero en "Cargando..."
            setPedidos(prev => prev === null ? (todosPedidosCached || []) : prev);
            SersaleUI.toast("No se pudieron calcular los recontactos. Tocá ↻ para probar de nuevo.", { tipo: "error" });
          }
        }
      }

      // Marca el contacto, lo saca de las dos vistas y recalcula con datos frescos
      async function marcarComoContactado(cliente) {
        setContactados(prev => prev.includes(cliente) ? prev : [...prev, cliente]);
        let guardado = false;
        try { guardado = (await marcarContacto(cliente)) !== false; } catch(e) { console.error(e); }
        if (!guardado) {
          // No quedó guardado: el cliente vuelve a la lista y se avisa (antes desaparecía igual,
          // sin aviso, y reaparecía vencido la próxima vez que se abría el panel).
          setContactados(prev => prev.filter(c => c !== cliente));
          SersaleUI.toast("No se pudo marcar a " + cliente + " como contactado. Probá de nuevo.", { tipo: "error" });
          return;
        }
        try { await cargar(); } catch(e) { console.error(e); }
      }

      async function actualizarDiasAlerta(clienteId, dias) {
        if (!clienteId) return;
        const n = parseInt(dias, 10);
        // Campo vacío o fuera de rango: antes se guardaba NaN (o 0) en la ficha
        if (!(n >= 1 && n <= 365)) {
          SersaleUI.toast("Los días de alerta tienen que ser un número entre 1 y 365.", { tipo: "error" });
          return;
        }
        const actual = alertasData ? alertasData.alertas.find(a => a.clienteId === clienteId) : null;
        if (actual && Number(actual.diasAlerta) === n) return; // se tocó el campo sin cambiarlo: nada que guardar
        if (actual && actual.freqCalc) {
          // Con historial, el límite se recalcula solo en cada carga (frecuencia + 3) y pisa lo
          // que se escriba a mano: se avisa en vez de aparentar que quedó guardado.
          SersaleUI.toast(actual.cliente+" suele pedir cada "+actual.freqCalc+" días: su límite se calcula solo ("+(actual.freqCalc+3)+" días) y no se puede fijar a mano.", { tipo: "info", ms: 7000 });
          return;
        }
        try {
          const { db, doc, updateDoc } = fb();
          // No se espera al servidor (sin señal queda en cola); si falla, se avisa.
          updateDoc(doc(db,"clientes",clienteId), { diasAlerta: n }).catch(e => {
            console.error(e);
            SersaleUI.toast("No se pudo guardar el límite de días. Probá de nuevo.", { tipo: "error" });
          });
          await cargar();
        } catch(e) {
          console.error(e);
          SersaleUI.toast("No se pudo guardar el límite de días. Probá de nuevo.", { tipo: "error" });
        }
      }

      useEffect(()=>{
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
        return () => { document.removeEventListener("fbReady",cargar); tandaCarga.current++; };
      },[]);

      if (clienteSeleccionado) return <HistorialCliente cliente={clienteSeleccionado} pedidos={pedidos||[]} onBack={()=>setClienteSeleccionado(null)} />;
      if (hojaRutaFecha) return <HojaRuta fecha={hojaRutaFecha} pedidos={(pedidos||[]).filter(p=>p.fechaEntrega===hojaRutaFecha&&p.tipo==="envio"&&!["cancelado","despachado"].includes(p.estado))} onBack={()=>setHojaRutaFecha(null)} />;

      // Los pedidos llegan en el orden de su id (al azar): primero lo que se entrega antes
      // y, dentro del día, lo que se cargó antes.
      const activos = (pedidos||[]).filter(p=>!["despachado","cancelado"].includes(p.estado))
        .sort((a,b)=>String(a.fechaEntrega||"9999").localeCompare(String(b.fechaEntrega||"9999")) || p8MomentoPedido(a)-p8MomentoPedido(b));

      // Agrupar todos los clientes con al menos un pedido
      const clientesMap = {};
      (pedidos||[]).filter(p=>p.estado!=="cancelado" && p.cliente).forEach(p=>{
        if(!clientesMap[p.cliente]) clientesMap[p.cliente]={total:0,activos:0,despachados:0,cuentaCorriente:false};
        // "Cta Cte" si algún pedido la tiene marcada (antes dependía de cuál venía primero)
        if(p.cuentaCorriente) clientesMap[p.cliente].cuentaCorriente = true;
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
            {pedidos===null ? (errorCarga
              ? <div style={{textAlign:"center",marginTop:40}}>
                  <p style={{color:"#7E1A20",fontWeight:600,fontSize:14,marginBottom:14}}>No se pudieron cargar los pedidos.</p>
                  <button onClick={cargar} style={{padding:"12px 20px",minHeight:44,borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Reintentar</button>
                </div>
              : <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>)
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
                    // Día de Buenos Aires (con el de UTC, después de las 21 "hoy" ya era mañana)
                    const hoy = SersaleBase.hoy();
                    const pedidosHoy = activos.filter(p=>p.fechaEntrega===hoy);
                    const consolidado = {};
                    pedidosHoy.forEach(p=>{
                      (p.items||[]).forEach(it=>{
                        // Lo que ya se pesó son kilos, se haya pedido por pieza, bolsa o gancho
                        // (antes salía "31.6 piezas"); lo que no, va en la unidad del pedido.
                        const pesado = it.kgReal!=null && it.kgReal!=="";
                        const unidad = pesado ? "kg" : it.unidad;
                        const key = it.producto+"|||"+unidad;
                        if(!consolidado[key]) consolidado[key]={producto:it.producto,unidad,cantidad:0,clientes:[]};
                        consolidado[key].cantidad += kgFacturables(it);
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
                              <span style={{fontWeight:700,fontSize:14,color:"#2A333B",whiteSpace:"nowrap",marginLeft:8}}>{SersaleBase.fmtNumero(it.cantidad, 2)} {it.unidad}</span>
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
                    // Sin mirar acentos ni mayúsculas: "angel" encuentra "Ángel"
                    const qc = busquedaCliente.trim();
                    const lista = Object.entries(clientesMap)
                      .filter(([cliente]) => !qc || SersaleBase.coincide(cliente, qc))
                      .sort((a,b)=>p8OrdenNombres(a[0], b[0]));
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
                // Búsqueda sin acentos ni mayúsculas; la fecha se puede escribir 2026-11-10 o 10/11
                const q = busqueda.trim();
                const filtrados = (q
                  ? (pedidos||[]).filter(p=>
                      SersaleBase.coincide(p.cliente, q) ||
                      (p.items||[]).some(it=>SersaleBase.coincide(it.producto, q)) ||
                      SersaleBase.coincide(p.estado, q) ||
                      String(p.fechaEntrega||"").includes(q) ||
                      SersaleBase.fmtFecha(p.fechaEntrega).includes(q)
                    )
                  : [...(pedidos||[])]
                ).sort((a,b)=>p8MomentoPedido(b)-p8MomentoPedido(a)); // lo último cargado, arriba (venían en orden de id, al azar)
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
      const FORM_VACIO = {
        cliente:"", producto:"", cantidad:"", unidad:"kg",
        motivo:"", descripcion:"", fechaPedidoOrig:"",
        monto:"", estado:"pendiente"
      };
      const [devoluciones, setDevoluciones] = useState(null);
      const [errorCarga, setErrorCarga] = useState(false);
      const [filtro, setFiltro] = useState("todos"); // todos | pendiente | resuelta
      const [filtroCliente, setFiltroCliente] = useState("");
      const [modalOpen, setModalOpen] = useState(false);
      const [detalle, setDetalle] = useState(null);
      const [form, setForm] = useState(FORM_VACIO);
      // Cuenta corriente del cliente elegido: undefined = todavía no se sabe, null = no tiene
      const [cuentaForm, setCuentaForm] = useState(undefined);
      // Id de esta devolución (y de su crédito): si hay que reintentar después de un
      // error, se corrige lo mismo en vez de cargar la devolución y el crédito dos veces.
      const idDevolucion = React.useRef(null);

      async function cargar() {
        try {
          const { db, collection, getDocs, query, orderBy } = fb();
          const snap = await getDocs(query(collection(db,"devoluciones"), orderBy("createdAt","desc")));
          setDevoluciones(snap.docs.map(d=>({id:d.id,...d.data()})));
          setErrorCarga(false);
        } catch(e){
          // Antes se mostraba "Sin devoluciones registradas", como si no hubiera ninguna
          console.error(e);
          setErrorCarga(true);
          SersaleUI.toast("No se pudieron cargar las devoluciones. Revisá la conexión.", { tipo: "error" });
        }
      }

      useEffect(()=>{
        if(window.__fbReady) { cargar(); return; }
        document.addEventListener("fbReady",cargar);
        return () => document.removeEventListener("fbReady",cargar);
      },[]);

      // ¿El cliente elegido tiene cuenta corriente? (para avisar antes de guardar si el crédito se puede asentar)
      useEffect(()=>{
        setCuentaForm(undefined);
        if(!modalOpen || !form.cliente) return;
        let vigente = true;
        ccBuscarCuenta(form.cliente).then(c => { if(vigente) setCuentaForm(c || null); }).catch(e => console.error(e));
        return () => { vigente = false; };
      },[modalOpen, form.cliente]);

      // Cambiar el cliente es otra operación (otra cuenta): no se reusa el id de un intento anterior.
      // Corregir el importe NO: si el intento anterior dio error pero el servidor lo había guardado
      // (señal cortada justo al confirmar), con otro id quedaban dos devoluciones y dos créditos.
      // Con el mismo id se corrige la misma devolución y el saldo se ajusta solo por la diferencia.
      const cambiarCliente = v => { idDevolucion.current = null; setForm(f=>({...f,cliente:v})); };
      const cambiarMonto = v => { setForm(f=>({...f,monto:v})); };

      const [guardar, guardando] = SersaleBase.useAccion(async () => {
        const falta = t => { SersaleUI.toast(t, { tipo: "error" }); };
        const cliente = form.cliente;
        const producto = form.producto.trim();
        if(!cliente) return falta("Seleccioná el cliente");
        if(!producto) return falta("Ingresá el producto");
        if(!form.motivo.trim()) return falta("Ingresá el motivo");
        const cantidad = parseFloat(form.cantidad)||0;
        const monto = SersaleBase.redondear(parseFloat(form.monto)||0, 2);
        if(cantidad<0) return falta("La cantidad no puede ser negativa");
        if(monto<0) return falta("El crédito no puede ser negativo");
        if(navigator.onLine === false) return falta("Sin conexión: la devolución no se registró. Probá de nuevo cuando vuelva la señal.");
        try {
          const { db, collection, doc, runTransaction } = fb();
          const hoy = SersaleBase.hoy(); // día de Buenos Aires (con el de UTC, después de las 21 quedaba con fecha de mañana)
          const ahora = new Date().toISOString();
          // El crédito va a la cuenta del cliente aunque el nombre esté escrito con otra
          // mayúscula o acento (antes se buscaba por nombre idéntico y, si no aparecía,
          // la devolución quedaba con "Crédito" pero la cuenta sin tocar y sin aviso).
          let cuenta = null;
          if(monto>0) {
            cuenta = await ccBuscarCuenta(cliente);
            if(!cuenta) {
              // "No tiene cuenta" sale de la copia guardada en el teléfono, que con la señal entrecortada
              // puede estar vieja o vacía. Antes de ofrecer registrarla sin crédito se confirma con el
              // servidor; si no contesta, no se registra nada (se avisa y el formulario queda como está).
              const { getDocsFromServer } = fb();
              const snapCtas = await getDocsFromServer(collection(db,"cuentas_corrientes"));
              cuenta = ccElegirCuenta(snapCtas.docs.map(d => ({ id: d.id, ...d.data() })), cliente);
            }
            if(!cuenta) {
              const ok = await SersaleUI.confirmar({
                titulo: cliente+" no tiene cuenta corriente",
                cuerpo: "La devolución se registra, pero el crédito de "+SersaleBase.fmtMonto(monto)+" no se asienta en ninguna cuenta. Si corresponde, abrile antes la cuenta en la pestaña CC.",
                aceptar: "Registrar sin crédito", cancelar: "Volver"
              });
              if(!ok) return;
            }
          }
          if(!idDevolucion.current) idDevolucion.current = doc(collection(db,"devoluciones")).id;
          const devRef = doc(db,"devoluciones",idDevolucion.current);
          const datos = { ...form, producto, cantidad, monto, createdAt: ahora, fecha: hoy };
          // Campo nuevo y opcional: dice si el crédito quedó asentado en la cuenta corriente
          if(monto>0) datos.creditoAsentado = !!cuenta;
          const asiento = cuenta
            ? await ccPrepararAsiento({ cliente, cuenta, movId: "dev_"+devRef.id, conSaldo: true, ultimoMovimiento: hoy })
            : null;
          // Devolución, movimiento y saldo se guardan juntos (o no se guarda nada). El saldo
          // nuevo sale del saldo guardado en ese momento, no del que tenía este teléfono.
          const res = await runTransaction(db, async tx => {
            if(asiento) { asiento.marca = null; await ccLeerAsiento(tx, asiento); }
            tx.set(devRef, datos);
            if(!asiento) return null;
            const r = ccEscribirAsiento(tx, asiento, {
              tipo:"pago", monto, fecha: hoy,
              detalle:"Crédito por devolución: "+producto,
              obs:"Devolución registrada automáticamente",
              origen:"devolucion", devolucionId: devRef.id
            });
            if(!r.asentado) throw new Error("La cuenta corriente de "+cliente+" ya no existe");
            return r;
          });
          // Que la lista (y la cuenta corriente) ya traigan lo guardado
          await esperarCopiaLocal(devRef, d => !!d && d.createdAt === ahora);
          if(asiento) await ccEsperarAsiento(asiento);
          idDevolucion.current = null;
          SersaleUI.toast(res
            ? "Devolución registrada. Crédito de "+SersaleBase.fmtMonto(monto)+" en la cuenta: saldo "+ccFmtSaldo(res.saldo)
            : (monto>0 ? "Devolución registrada sin crédito en cuenta" : "Devolución registrada"), { tipo: "ok", ms: 4500 });
          setForm(FORM_VACIO);
          setModalOpen(false);
          cargar();
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo registrar la devolución. Revisá la conexión y probá de nuevo.", { tipo: "error" });
        }
      });
      // Mientras se guarda no se cierra: parecería cancelada y se cargaría de nuevo
      const cerrarModal = () => { if(!guardando) setModalOpen(false); };

      const [cambiarEstado, cambiando] = SersaleBase.useAccion(async (id, nuevoEstado) => {
        const aviso = e => {
          console.error(e);
          SersaleUI.toast("No se pudo cambiar el estado de la devolución. Probá de nuevo.", { tipo: "error" });
        };
        try {
          const { db, doc, updateDoc } = fb();
          // No se espera al servidor (sin señal el cambio queda en cola y se envía solo);
          // si falla, se avisa y se vuelve a leer lo que quedó guardado.
          updateDoc(doc(db,"devoluciones",id), { estado: nuevoEstado }).catch(e => { aviso(e); cargar(); });
          await cargar();
        } catch(e){ aviso(e); }
      });

      function compartirWA(d) {
        // El texto va codificado entero: con "%0A" a mano, un "&" o un "#" en el nombre
        // del cliente cortaba el mensaje ("Pérez & Hijos" llegaba hasta "Pérez").
        const lineas = [
          "Devolución registrada", "",
          "Cliente: "+d.cliente,
          "Producto: "+d.producto+" ("+SersaleBase.fmtNumero(d.cantidad)+" "+d.unidad+")",
          "Motivo: "+d.motivo
        ];
        if(d.descripcion) lineas.push("Detalle: "+d.descripcion);
        if(d.monto>0) lineas.push("Crédito a favor: "+SersaleBase.fmtMonto(d.monto));
        lineas.push("Estado: "+(d.estado==="resuelta"?"Resuelta":"Pendiente"), "", "Frigorífico Sersale");
        window.open(SersaleBase.waLink(lineas.join("\n")),"_blank");
      }

      const fmtFecha = f => SersaleBase.fmtFecha(f) || "-";
      const fmt$ = n => n ? SersaleBase.fmtMonto(n) : "";
      const clientesOrdenados = [...(clientes||[])].sort(p8OrdenNombres);

      const lista = (devoluciones||[])
        .filter(d => filtro==="todos" || d.estado===filtro)
        .filter(d => !filtroCliente || ccMismoCliente(d.cliente, filtroCliente));

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
            {/* minWidth:0 → el selector se achica en vez de estirar la página hasta el nombre más largo */}
            <select value={filtroCliente} onChange={e=>setFiltroCliente(e.target.value)} aria-label="Filtrar por cliente"
              style={{flex:1,minWidth:0,padding:"9px 10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}>
              <option value="">Todos los clientes</option>
              {clientesOrdenados.map(cl=><option key={cl} value={cl}>{cl}</option>)}
            </select>
            <select value={filtro} onChange={e=>setFiltro(e.target.value)}
              style={{padding:"9px 10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}>
              <option value="todos">Todos</option>
              <option value="pendiente">Pendientes</option>
              <option value="resuelta">Resueltas</option>
            </select>
          </div>

          {/* Lista */}
          {devoluciones===null ? (errorCarga
            ? <div style={{textAlign:"center",marginTop:40}}>
                <p style={{color:"#7E1A20",fontWeight:600,fontSize:14,marginBottom:14}}>No se pudieron cargar las devoluciones.</p>
                <button onClick={cargar} style={{padding:"12px 20px",minHeight:44,borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Reintentar</button>
              </div>
            : <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>)
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
                      <strong>{d.producto}</strong> — {SersaleBase.fmtNumero(d.cantidad)} {d.unidad}
                    </div>
                    <div style={{fontSize:12,color:"#79828B"}}>{d.motivo}</div>
                    {d.monto>0&&(d.creditoAsentado===false
                      ? <div style={{fontSize:12,color:"#A8702A",fontWeight:600,marginTop:2}}>Crédito: {fmt$(d.monto)} · sin asentar (sin cuenta corriente)</div>
                      : <div style={{fontSize:12,color:"#2F6B4F",fontWeight:600,marginTop:2}}>Crédito: {fmt$(d.monto)}</div>)}
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
                      <button onClick={()=>cambiarEstado(d.id, resuelta?"pendiente":"resuelta")} disabled={cambiando}
                        style={{flex:1,padding:"9px 0",borderRadius:8,border:"none",background:resuelta?"#C33039":"#2F6B4F",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",opacity:cambiando?0.6:1}}>
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
              onClick={e=>{if(e.target===e.currentTarget)cerrarModal();}}>
              <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480,maxHeight:"92vh",overflowY:"auto"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <span style={{fontWeight:800,fontSize:16}}>Nueva Devolución</span>
                  <button onClick={cerrarModal} aria-label="Cerrar" style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
                </div>

                {/* Cliente */}
                <label style={{display:"block",fontWeight:600,fontSize:12,color:"#3A424A",marginBottom:5}}>Cliente *</label>
                <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:12}}
                  aria-label="Cliente de la devolución" value={form.cliente} onChange={e=>cambiarCliente(e.target.value)}>
                  <option value="">Seleccionar cliente...</option>
                  {clientesOrdenados.map(cl=><option key={cl} value={cl}>{cl}</option>)}
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
                    <input type="number" inputMode="decimal" min="0" step="any" aria-label="Cantidad devuelta" style={{width:"100%",padding:"10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
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
                  aria-label="Motivo de la devolución" value={form.motivo} onChange={e=>setForm({...form,motivo:e.target.value})}>
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
                      aria-label="Crédito a favor" placeholder="0" value={form.monto} onChange={cambiarMonto} />
                  </div>
                </div>

                {form.monto>0 && form.cliente && (cuentaForm===null
                  ? <div style={{background:"#F3EEE2",border:"1px solid #B5872F",borderRadius:8,padding:"8px 12px",marginBottom:16,fontSize:12,color:"#784212"}}>
                      {form.cliente} no tiene cuenta corriente: el crédito de {fmt$(parseFloat(form.monto)||0)} no se va a asentar en ninguna cuenta
                    </div>
                  : <div style={{background:"#E7EDF1",border:"1px solid #AED6F1",borderRadius:8,padding:"8px 12px",marginBottom:16,fontSize:12,color:"#26536E"}}>
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
      // El reloj arranca de nuevo con cada pedido: si entraban dos seguidos, el aviso del
      // segundo se iba cuando vencía el reloj del primero.
      useEffect(()=>{ const t=setTimeout(onClose,6000); return()=>clearTimeout(t); },[pedido]);
      const cantidad = (pedido.items||[]).length;
      return (
        <div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",zIndex:9999,width:"100%",maxWidth:480,padding:"0",pointerEvents:"none"}}>
          <div style={{background:"#2F6B4F",color:"#fff",padding:"14px 20px",boxShadow:"0 4px 20px rgba(0,0,0,0.3)",display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:24}}>🛒</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:14}}>Nuevo pedido cargado</div>
              <div style={{fontSize:13,opacity:0.9}}>{pedido.cliente} · {cantidad} producto{cantidad!==1?"s":""}</div>
            </div>
          </div>
        </div>
      );
    }

    // ── SI UNA PANTALLA FALLA ────────────────────────────────
    // Sin esto, un error al dibujar (un pedido con datos rotos, por ejemplo) dejaba la
    // página en blanco y, como la vista queda recordada, seguía en blanco al recargar.
    class P8Barrera extends React.Component {
      constructor(props) { super(props); this.state = { fallo: false }; }
      static getDerivedStateFromError() { return { fallo: true }; }
      componentDidCatch(error, info) { console.error("Error al mostrar la pantalla:", error, info && info.componentStack); }
      render() {
        if (!this.state.fallo) return this.props.children;
        const esOperario = sessionStorage.getItem("sersale_role") === "operario";
        const salir = () => { try { sessionStorage.setItem("sersale_vista","home"); } catch(e) {} window.location.reload(); };
        return (
          <div className="crm-page" style={{padding:"60px 24px",textAlign:"center"}}>
            <div style={{fontSize:44,marginBottom:12}}>⚠️</div>
            <p style={{fontWeight:800,fontSize:17,color:"#191E23",marginBottom:8}}>Esta pantalla no se pudo mostrar</p>
            <p style={{fontSize:14,color:"#5C666F",marginBottom:20}}>Probá de nuevo. Si se repite, avisá qué estabas haciendo.</p>
            <button onClick={salir} style={{padding:"14px 24px",minHeight:44,borderRadius:12,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>{esOperario ? "Recargar" : "Volver al inicio"}</button>
          </div>
        );
      }
    }

    // ── APP ─────────────────────────────────────────────────
    function App() {
      const esOperario = sessionStorage.getItem("sersale_role") === "operario";
      const [vista, _setVista] = useState(()=> {
        if (esOperario) return "deposito";
        // Acceso rápido "Registrar una venta rápida" del panel (pedidos.html?vr=1): la venta
        // rápida está en el panel del director. Antes solo se abría si justo se había
        // quedado en esa vista; si no, caía en el inicio y no pasaba nada.
        if (new URLSearchParams(window.location.search).get("vr") === "1") {
          try { sessionStorage.setItem("sersale_vista","director"); } catch(e) {}
          return "director";
        }
        // Una vista recordada que no existe dejaba la página en blanco
        const v = sessionStorage.getItem("sersale_vista");
        return ["home","productos","comercial","deposito","director","clientes"].includes(v) ? v : "home";
      });
      const [nuevosPedidos, setNuevosPedidos] = useState(0);
      const [bannerPedido, setBannerPedido] = useState(null);
      const inicioSesion = React.useRef(new Date().toISOString());
      // Fechas de carga de los pedidos pendientes (las trae la escucha de más abajo)
      const pendientesISO = React.useRef([]);
      // "Pedidos nuevos": los pendientes cargados después de la última visita. Se cuenta
      // con la marca del momento (antes quedaba la de cuando se abrió la página).
      function contarNuevos() {
        const visto = getLastSeen();
        setNuevosPedidos(pendientesISO.current.filter(f => f > visto).length);
      }
      // "Visto" se anota al SALIR de una vista con pedidos (volver al inicio, cerrar o dejar
      // la app en segundo plano), no al entrar: Comercial y Director leen esa marca para la
      // cinta NUEVO y, como se pisaba justo antes de abrirlos, NUEVO no aparecía nunca.
      const conPedidos = v => ["comercial","deposito","director"].includes(v);
      function marcarVisto() { setLastSeen(); contarNuevos(); }
      function setVista(v) {
        if (esOperario) { _setVista("deposito"); return; } // bloquear cambio de vista
        if (v === "home" && conPedidos(vista)) marcarVisto();
        sessionStorage.setItem("sersale_vista",v); _setVista(v);
      }
      // El gesto "atrás" del teléfono vuelve al inicio de Pedidos en vez de salir de la página.
      SersaleBase.useAtras(!esOperario && vista !== "home", () => {
        if (conPedidos(vista)) marcarVisto();
        sessionStorage.setItem("sersale_vista", "home");
        _setVista("home");
      });
      useEffect(()=>{
        if (esOperario || !conPedidos(vista)) return;
        const alOcultar = () => { if (document.visibilityState === "hidden") marcarVisto(); };
        document.addEventListener("visibilitychange", alOcultar);
        window.addEventListener("pagehide", marcarVisto);
        return () => {
          document.removeEventListener("visibilitychange", alOcultar);
          window.removeEventListener("pagehide", marcarVisto);
        };
      },[vista]);

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
        let unsub = null, cortado = false;
        function init() {
          if (cortado) return;
          const { db, collection, query, orderBy, onSnapshot } = fb();
          // Badge: pedidos pendientes desde última visita
          const q = query(collection(db,"pedidos"), orderBy("fechaPedido","desc"));
          unsub = onSnapshot(q, (snap) => {
            pendientesISO.current = snap.docs.map(d => d.data())
              .filter(data => data.estado==="pendiente" && typeof data.fechaPedidoISO === "string")
              .map(data => data.fechaPedidoISO);
            contarNuevos();
            // Banner en tiempo real: pedidos nuevos DESPUÉS de abrir la app
            snap.docChanges().forEach(change => {
              if (change.type === "added") {
                const data = change.doc.data();
                if (data.fechaPedidoISO > inicioSesion.current) {
                  setBannerPedido(data);
                }
              }
            });
          }, (e) => { console.error("Escucha de pedidos nuevos:", e); });
        }
        if (window.__fbReady) init(); else document.addEventListener("fbReady", init);
        return ()=>{ cortado = true; document.removeEventListener("fbReady", init); if (unsub) unsub(); };
      },[]);

      function seleccionar(key) {
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

    ReactDOM.createRoot(document.getElementById("root")).render(<P8Barrera><App /></P8Barrera>);

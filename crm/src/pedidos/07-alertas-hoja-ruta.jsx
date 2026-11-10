    // ── COMPONENTE TAB ALERTAS ──────────────────────────────
    // ── RECONTACTOS ─────────────────────────────────────────
    // Fuente única: alertasData.alertas (calculado en calcularAlertas,
    // que ya deriva la frecuencia de cada cliente de su historial real).
    // Acá va el estado; el detalle y las acciones viven en la pestaña Alertas.
    function ResumenRecontactos({ alertasData, contactados, onVerTodos }) {
      if(!alertasData) return (
        <div style={{background:"#fff",border:"1px solid #D8DCE0",borderRadius:12,padding:14,marginBottom:16,
          textAlign:"center",color:"#A3ABB3",fontSize:12}}>Calculando recontactos...</div>
      );
      const pendientes = alertasData.alertas.filter(a=>!contactados.includes(a.cliente));
      const vencidos  = pendientes.filter(a=>a.enAlerta);
      const proximos  = pendientes.filter(a=>!a.enAlerta);
      if(pendientes.length === 0) return (
        <div style={{background:"#E9F0EC",border:"1px solid #C3D6CB",borderLeft:"3px solid #2F6B4F",borderRadius:12,
          padding:"13px 14px",marginBottom:16,fontSize:13,fontWeight:600,color:"#24523D"}}>
          Todos los clientes al día
        </div>
      );
      const acento = vencidos.length ? "#A4232A" : "#A8702A";
      const top = (vencidos.length ? vencidos : proximos).slice(0,3);
      const resto = pendientes.length - top.length;
      return (
        <div style={{background:"#fff",border:"1px solid #D8DCE0",borderLeft:"3px solid "+acento,
          borderRadius:12,padding:14,marginBottom:16}}>
          <div style={{fontFamily:"'IBM Plex Mono',ui-monospace,monospace",fontSize:10,fontWeight:600,
            letterSpacing:"0.17em",textTransform:"uppercase",color:"#79828B",marginBottom:11}}>Recontactos</div>
          <div style={{display:"flex",gap:22,marginBottom:13}}>
            <div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:32,fontWeight:700,lineHeight:1,color:"#A4232A"}}>{vencidos.length}</div>
              <div style={{fontSize:11,color:"#79828B",marginTop:2}}>vencidos</div>
            </div>
            <div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:32,fontWeight:700,lineHeight:1,color:"#A8702A"}}>{proximos.length}</div>
              <div style={{fontSize:11,color:"#79828B",marginTop:2}}>próximos</div>
            </div>
          </div>
          {top.map(a=>(
            <div key={a.cliente} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              gap:8,padding:"7px 0",borderTop:"1px solid #EDEEF0"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:13,color:"#191E23",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.cliente}</div>
                <div style={{fontSize:11,color:"#79828B",marginTop:1}}>
                  {a.diasSinPedir}d sin pedir{a.freqCalc?" · suele pedir cada "+a.freqCalc+"d":" · límite "+a.diasAlerta+"d"}
                </div>
              </div>
              <span style={{flexShrink:0,fontSize:10,fontWeight:700,borderRadius:99,padding:"3px 9px",
                background:a.enAlerta?"#F7EAEA":"#F3EEE2",color:a.enAlerta?"#A4232A":"#A8702A"}}>
                {a.enAlerta?"+"+(a.diasSinPedir-a.diasAlerta)+"d":"faltan "+a.diasRestantes+"d"}
              </span>
            </div>
          ))}
          <button onClick={onVerTodos}
            style={{width:"100%",marginTop:12,padding:"10px 0",borderRadius:9,border:"1px solid "+acento,
              background:"#fff",color:acento,fontWeight:700,fontSize:12.5,cursor:"pointer",fontFamily:"inherit"}}>
            {resto>0 ? "Ver los "+pendientes.length+" en Alertas" : "Abrir Alertas"}
          </button>
        </div>
      );
    }

    function TabAlertas({ alertasData, alertaEnviando, setAlertaEnviando, actualizarDiasAlerta, contactados, onContactado }) {
      const [ultimoEmail, setUltimoEmail] = useState(null);
      useEffect(()=>{
        (async()=>{
          try {
            const { db, doc, getDoc } = fb();
            const snap = await getDoc(doc(db,"config","ultima_alerta_email"));
            if (snap.exists()) setUltimoEmail(snap.data());
          } catch(e){}
        })();
      },[]);
      const fmtF = f => f ? new Date(f+"T00:00:00").toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric"}) : "-";
      function avisarWA(a) {
        setAlertaEnviando(a.cliente);
        const up=a.ultimoPedido;
        const prods=(up.items||[]).map(it=>it.producto+((it.kgReal||it.cantidad)?" ("+(it.kgReal||it.cantidad)+" "+it.unidad+")":"")).join(", ");
        const total=(up.items||[]).reduce((s,it)=>{ const kg=it.kgReal!=null?it.kgReal:parseFloat(it.cantidad)||0; return s+kg*(parseFloat(it.precio)||0); },0);
        const nl="%0A";
        let msg="Recontacto cliente"+nl+nl+"Cliente: "+a.cliente+nl+"Dias sin pedir: "+a.diasSinPedir+"d"+nl+"Ultimo pedido ("+fmtF(up.fechaPedido)+"): "+prods+nl+(total>0?"Monto: $"+Math.round(total).toLocaleString("es-AR")+nl:"")+"Frigorifico Sersale";
        window.open("https://wa.me/5491167637860?text="+msg,"_blank");
        setTimeout(()=>setAlertaEnviando(null),2000);
      }
      if (!alertasData) return <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>;
      const enAlerta=alertasData.alertas.filter(a=>a.enAlerta && !contactados.includes(a.cliente));
      const proximas=alertasData.alertas.filter(a=>!a.enAlerta && !contactados.includes(a.cliente));
      // Count clients with auto-calculated frequency
      const clientesConFreq = Object.values(alertasData.configCli||{}).filter(c=>c._freqCalc).length;
      return (
        <div>
          {ultimoEmail&&(
            <div style={{background:"#EAF4FB",border:"1px solid #AED6F1",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#26536E",display:"flex",alignItems:"center",gap:6}}>
              <span>Email</span><span>Ultimo: <strong>{new Date(ultimoEmail.updatedAt).toLocaleDateString("es-AR")}</strong> · {ultimoEmail.cantidad} alerta{ultimoEmail.cantidad!==1?"s":""}</span>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            <div style={{background:"#F7EAEA",borderRadius:14,padding:"14px 12px",border:"1.5px solid #C33039",textAlign:"center"}}>
              <div style={{fontSize:28,fontWeight:900,color:"#C33039"}}>{enAlerta.length}</div>
              <div style={{fontSize:11,color:"#79828B",marginTop:2}}>Requieren recontacto</div>
            </div>
            <div style={{background:"#F3EEE2",borderRadius:14,padding:"14px 12px",border:"1.5px solid #B5872F",textAlign:"center"}}>
              <div style={{fontSize:28,fontWeight:900,color:"#A8702A"}}>{proximas.length}</div>
              <div style={{fontSize:11,color:"#79828B",marginTop:2}}>Proximos</div>
            </div>
          </div>
          {clientesConFreq > 0 && (
            <div style={{background:"#E8F8F5",border:"1px solid #1ABC9C",borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:11,color:"#148F77",display:"flex",alignItems:"center",gap:6}}>
              <span>🔄</span> Frecuencia auto-calculada para <strong>{clientesConFreq}</strong> cliente{clientesConFreq!==1?"s":""} según historial de pedidos
            </div>
          )}
          {alertasData.alertas.length===0 ? (
            <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}><div style={{fontSize:48}}>✅</div><p>Todos al dia</p></div>
          ) : (<>
            {enAlerta.length>0&&(<>
              <p style={{fontWeight:700,fontSize:12,color:"#C33039",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Requieren recontacto ({enAlerta.length})</p>
              {enAlerta.map(a=>(
                <div key={a.cliente} style={{background:"#fff",borderRadius:14,border:"2px solid #C33039",padding:14,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:800,fontSize:15,color:"#111",letterSpacing:"-0.2px"}}>{a.cliente}</div>
                      <div style={{fontSize:12,color:"#C33039",fontWeight:600,marginTop:2}}>
                        {a.diasSinPedir}d sin pedir (límite: {a.diasAlerta}d)
                        {a.freqCalc ? <span style={{color:"#79828B",fontWeight:500}}> · suele pedir cada {a.freqCalc}d</span> : null}
                      </div>
                    </div>
                    <div style={{background:"#C33039",borderRadius:20,padding:"4px 10px",fontSize:11,color:"#fff",fontWeight:700}}>+{a.diasSinPedir-a.diasAlerta}d</div>
                  </div>
                  <div style={{background:"#F7F8F9",borderRadius:8,padding:"8px 10px",marginBottom:10,fontSize:12,color:"#555"}}>
                    <span style={{fontWeight:600}}>Ultimo pedido:</span> {fmtF(a.ultimoPedido._fechaDisplay||a.ultimoPedido.fechaEntrega||"")}<br/>
                    <span style={{color:"#79828B"}}>{(a.ultimoPedido.items||[]).map(it=>it.producto).join(", ")}</span>
                    {a.totalPedidos>0&&<span style={{color:"#A3ABB3",fontSize:11}}> · {a.totalPedidos} pedido{a.totalPedidos!==1?"s":""} en historial</span>}
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <button onClick={()=>avisarWA(a)} disabled={alertaEnviando===a.cliente}
                      style={{flex:1,padding:"9px 0",borderRadius:8,border:"none",background:alertaEnviando===a.cliente?"#A3ABB3":"#25D366",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                      {alertaEnviando===a.cliente?"Enviando...":"Avisar por WA"}
                    </button>
                    <button onClick={()=>onContactado(a.cliente)}
                      style={{padding:"9px 12px",borderRadius:8,border:"none",background:"#2F6B4F",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                      ✓ Contactado
                    </button>
                    <div style={{display:"flex",alignItems:"center",gap:4,background:"#EDEEF0",borderRadius:8,padding:"4px 8px"}}>
                      <span style={{fontSize:11,color:"#5C666F"}}>Dias:</span>
                      <input type="number" min="1" max="365" defaultValue={a.diasAlerta}
                        onBlur={e=>actualizarDiasAlerta(a.clienteId,e.target.value)}
                        style={{width:44,padding:"4px",borderRadius:6,border:"1.5px solid #D8DCE0",fontSize:12,textAlign:"center",background:"#fff"}}/>
                    </div>
                  </div>
                </div>
              ))}
            </>)}
            {proximas.length>0&&(<>
              <p style={{fontWeight:700,fontSize:12,color:"#A8702A",textTransform:"uppercase",letterSpacing:1,marginBottom:8,marginTop:enAlerta.length>0?16:0}}>Proximos ({proximas.length})</p>
              {proximas.map(a=>(
                <div key={a.cliente} style={{background:"#fff",borderRadius:14,border:"1.5px solid #B5872F",padding:14,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div style={{flex:1}}><div style={{fontWeight:700,fontSize:14,color:"#191E23"}}>{a.cliente}</div><div style={{fontSize:12,color:"#A8702A",marginTop:2}}>{a.diasSinPedir}d sin pedir (límite: {a.diasAlerta}d) — faltan <strong>{a.diasRestantes}d</strong></div></div>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                      <button onClick={()=>onContactado(a.cliente)}
                        style={{padding:"6px 10px",borderRadius:8,border:"none",background:"#2F6B4F",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
                        ✓ Contactado
                      </button>
                      <div style={{display:"flex",alignItems:"center",gap:4,background:"#EDEEF0",borderRadius:8,padding:"4px 8px"}}>
                        <span style={{fontSize:11,color:"#5C666F"}}>Dias:</span>
                        <input type="number" min="1" max="365" defaultValue={a.diasAlerta}
                          onBlur={e=>actualizarDiasAlerta(a.clienteId,e.target.value)}
                          style={{width:44,padding:"4px",borderRadius:6,border:"1.5px solid #D8DCE0",fontSize:12,textAlign:"center",background:"#fff"}}/>
                      </div>
                    </div>
                  </div>
                  <div style={{fontSize:12,color:"#79828B"}}>Ultimo: {fmtF(a.ultimoPedido._fechaDisplay||a.ultimoPedido.fechaEntrega||"")} — {(a.ultimoPedido.items||[]).map(it=>it.producto).join(", ")} {a.totalPedidos>0&&<span style={{color:"#A3ABB3"}}> · {a.totalPedidos} ped.</span>}</div>
                </div>
              ))}
            </>)}
          </>)}
        </div>
      );
    }

    // ── HOJA DE RUTA ─────────────────────────────────────────
    function HojaRuta({ fecha, pedidos, onBack }) {
      const [clientesDB, setClientesDB] = useState({});
      const [clientesIDs, setClientesIDs] = useState({});
      const [estado, setEstado] = useState("idle");
      const [rutaOptimizada, setRutaOptimizada] = useState(null);
      const [errores, setErrores] = useState([]);
      const [modoEdicion, setModoEdicion] = useState(false);
      const [editandoDir, setEditandoDir] = useState(null);
      const [nuevaDir, setNuevaDir] = useState("");

      const FRIGORIFICO = { nombre:"Frigorífico Sersale", direccion:"24 de Noviembre 1926, Parque Patricios, Buenos Aires", lat:-34.6262, lon:-58.4058 };

      useEffect(()=>{
        (async()=>{
          try {
            const{db,collection,getDocs}=fb();
            const snap=await getDocs(collection(db,"clientes"));
            const map={};
            snap.docs.forEach(d=>{ const data=d.data(); map[data.nombre]=data.direccion||""; });
            setClientesDB(map);
          } catch(e){}
        })();
      },[]);

      const pConDir = pedidos.map(p=>({...p, direccion:clientesDB[p.cliente]||""}));
      const sinDir  = pConDir.filter(p=>!p.direccion);
      const conDir  = pConDir.filter(p=>p.direccion);

      // Mover parada arriba o abajo
      function moverParada(idx, direccion) {
        const arr = [...rutaOptimizada];
        const newIdx = idx + direccion;
        if (newIdx < 0 || newIdx >= arr.length) return;
        [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
        setRutaOptimizada(arr);
      }

      // Sacar parada de la ruta
      function quitarParada(idx) {
        const arr = [...rutaOptimizada];
        arr.splice(idx, 1);
        setRutaOptimizada(arr);
      }

      async function optimizarRuta() {
        if (conDir.length===0) { alert("Ningun cliente tiene direccion cargada."); return; }
        setEstado("geocodificando");
        setRutaOptimizada(null);
        setErrores([]);
        setModoEdicion(false);

        function limpiarDireccion(dir) {
          return dir
            .replace(/,?\s*C\d{4}[A-Z]{2,4}\s*/gi, "")
            .replace(/,?\s*Cdad\.\s*Aut[oó]noma\s*de\s*Buenos\s*Aires/gi, "")
            .replace(/,?\s*Ciudad\s*Aut[oó]noma\s*de\s*Buenos\s*Aires/gi, "")
            .replace(/,?\s*CABA/gi, "")
            .replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim().replace(/,\s*$/, "");
        }

        const paradas = [];
        const fallidas = [];
        for (const p of conDir) {
          try {
            const dirLimpia = limpiarDireccion(p.direccion);
            const query = encodeURIComponent(dirLimpia + ", Buenos Aires, Argentina");
            const res = await fetch("https://nominatim.openstreetmap.org/search?q="+query+"&format=json&limit=1&countrycodes=ar", { headers:{"Accept-Language":"es","User-Agent":"SersaleApp/1.0"} });
            const data = await res.json();
            if (data && data.length > 0) {
              paradas.push({ ...p, lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), ok: true });
            } else {
              const partes = dirLimpia.split(",")[0].trim();
              const res2 = await fetch("https://nominatim.openstreetmap.org/search?q="+encodeURIComponent(partes+", Buenos Aires, Argentina")+"&format=json&limit=1&countrycodes=ar", { headers:{"Accept-Language":"es","User-Agent":"SersaleApp/1.0"} });
              const data2 = await res2.json();
              if (data2 && data2.length > 0) {
                paradas.push({ ...p, lat: parseFloat(data2[0].lat), lon: parseFloat(data2[0].lon), ok: true });
              } else {
                fallidas.push(p.cliente);
              }
            }
          } catch(e) { fallidas.push(p.cliente); }
          await new Promise(r=>setTimeout(r,1100));
        }

        setErrores(fallidas);
        if (paradas.length === 0) { setEstado("error"); return; }

        function distancia(a, b) { const dl=a.lat-b.lat, dn=a.lon-b.lon; return Math.sqrt(dl*dl+dn*dn); }
        function tsp(puntos, inicio) {
          const rest=[...puntos], ruta=[];
          let actual=inicio;
          while(rest.length>0){
            let minD=Infinity,minI=0;
            rest.forEach((p,i)=>{ const d=distancia(actual,p); if(d<minD){minD=d;minI=i;} });
            ruta.push(rest[minI]); actual=rest[minI]; rest.splice(minI,1);
          }
          return ruta;
        }
        setRutaOptimizada(tsp(paradas, FRIGORIFICO));
        setEstado("listo");
      }

      async function guardarDireccion(nombreCliente) {
        if (!nuevaDir.trim()) return;
        try {
          const { db, doc, updateDoc } = fb();
          const id = clientesIDs[nombreCliente];
          if (id) {
            await updateDoc(doc(db,"clientes",id), { direccion: nuevaDir.trim() });
            setClientesDB(prev=>({...prev,[nombreCliente]:nuevaDir.trim()}));
            // Si la ruta ya estaba optimizada, actualizar también ahí
            if(rutaOptimizada) {
              setRutaOptimizada(prev=>prev.map(p=>p.cliente===nombreCliente?{...p,direccion:nuevaDir.trim()}:p));
            }
          }
        } catch(e){ alert("Error al guardar"); }
        setEditandoDir(null); setNuevaDir("");
      }

      function abrirMaps() {
        const lista = rutaOptimizada || conDir;
        if (lista.length===0) { alert("No hay paradas con direccion."); return; }
        const frig = encodeURIComponent(FRIGORIFICO.direccion);
        const wps = lista.map(p=>encodeURIComponent(p.direccion+", Buenos Aires")).join("|");
        window.open("https://www.google.com/maps/dir/?api=1&origin="+frig+"&destination="+frig+"&waypoints="+wps+"&travelmode=driving","_blank");
      }

      function enviarWA() {
        const lista = rutaOptimizada || conDir;
        const fmtF=f=>f?new Date(f+"T12:00:00").toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"long"}):"";
        const nl="%0A";
        let txt="Hoja de Ruta "+fmtF(fecha).toUpperCase()+nl+nl;
        txt+="Salida: Frigorifico Sersale"+nl+nl;
        lista.forEach((p,i)=>{
          txt+=(i+1)+". "+p.cliente+nl+(p.direccion||"Sin direccion")+nl;
          p.items.forEach(it=>{txt+="  - "+it.producto+": "+(it.kgReal||it.cantidad)+" "+it.unidad+nl;});
          txt+=nl;
        });
        if(sinDir.length>0){ txt+="Sin direccion: "+sinDir.map(p=>p.cliente).join(", ")+nl; }
        txt+=nl+"Frigorifico Sersale - (011) 6763-7860";
        window.open("https://wa.me/?text="+txt,"_blank");
      }

      const fmtFecha=f=>f?new Date(f+"T12:00:00").toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"long"}):"";
      const listaVisible = rutaOptimizada || conDir;

      return (
        <div className="crm-page">
          {/* Header */}
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:16}}>Hoja de Ruta</div>
              <div style={{fontSize:11,opacity:.85,textTransform:"capitalize"}}>{fmtFecha(fecha)} · {pedidos.length} envio{pedidos.length!==1?"s":""}</div>
            </div>
            {/* Botón editar (solo cuando hay ruta optimizada) */}
            {estado==="listo" && rutaOptimizada && (
              <button onClick={()=>setModoEdicion(!modoEdicion)}
                style={{background:modoEdicion?"#A8702A":"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700}}>
                {modoEdicion?"✓ Listo":"✏️ Editar"}
              </button>
            )}
          </div>

          <div style={{padding:16}}>

            {/* Botón optimizar */}
            {estado==="idle" && (
              <button onClick={optimizarRuta} disabled={conDir.length===0}
                style={{width:"100%",padding:14,borderRadius:14,border:"none",background:"#2A333B",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",marginBottom:12}}>
                Optimizar ruta ({conDir.length} parada{conDir.length!==1?"s":""})
              </button>
            )}

            {/* Geocodificando */}
            {estado==="geocodificando" && (
              <div style={{background:"#EAF4FB",border:"1px solid #AED6F1",borderRadius:14,padding:16,textAlign:"center",marginBottom:12}}>
                <div style={{fontSize:24,marginBottom:8}}>🔍</div>
                <div style={{fontWeight:700,fontSize:14,color:"#26536E",marginBottom:4}}>Calculando ruta óptima...</div>
                <div style={{fontSize:12,color:"#79828B"}}>Geocodificando {conDir.length} direcciones, un momento...</div>
              </div>
            )}

            {/* Error total */}
            {estado==="error" && (
              <div style={{background:"#F7EAEA",border:"1.5px solid #C33039",borderRadius:14,padding:14,marginBottom:12,textAlign:"center"}}>
                <div style={{fontWeight:700,color:"#C33039",marginBottom:4}}>No se pudo geocodificar ninguna dirección</div>
                <div style={{fontSize:12,color:"#79828B",marginBottom:10}}>Verificá que las direcciones estén completas</div>
                <button onClick={()=>setEstado("idle")} style={{padding:"8px 16px",borderRadius:8,border:"none",background:"#C33039",color:"#fff",fontWeight:700,cursor:"pointer"}}>Reintentar</button>
              </div>
            )}

            {/* Errores parciales */}
            {errores.length>0 && (
              <div style={{background:"#F3EEE2",border:"1.5px solid #B5872F",borderRadius:12,padding:10,marginBottom:12,fontSize:12,color:"#A8702A"}}>
                ⚠️ No se pudo ubicar: {errores.join(", ")}
              </div>
            )}

            {/* Sin dirección */}
            {sinDir.length>0 && (
              <div style={{background:"#F7F8F9",border:"1px solid #D8DCE0",borderRadius:12,padding:10,marginBottom:12,fontSize:12,color:"#79828B"}}>
                Sin dirección: {sinDir.map(p=>p.cliente).join(", ")}
              </div>
            )}

            {/* Ruta lista */}
            {estado==="listo" && (
              <div style={{background:"#E9F0EC",border:"1.5px solid #2F6B4F",borderRadius:14,padding:12,marginBottom:14}}>
                {modoEdicion ? (
                  <div style={{textAlign:"center",fontSize:13,color:"#2F6B4F",fontWeight:700,marginBottom:8}}>
                    ✏️ Modo edición — reorganizá las paradas
                  </div>
                ) : (
                  <div style={{fontWeight:700,color:"#2F6B4F",fontSize:13,textAlign:"center",marginBottom:10}}>
                    ✅ Ruta optimizada — {listaVisible.length} paradas
                  </div>
                )}
                {!modoEdicion && (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <button onClick={abrirMaps} style={{padding:12,borderRadius:12,border:"none",background:"#4285F4",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                      Abrir en Maps
                    </button>
                    <button onClick={enviarWA} style={{padding:12,borderRadius:12,border:"none",background:"#25D366",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                      Enviar por WA
                    </button>
                  </div>
                )}
                <button onClick={()=>{setEstado("idle");setRutaOptimizada(null);setErrores([]);setModoEdicion(false);}}
                  style={{display:"block",margin:"8px auto 0",fontSize:11,color:"#79828B",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>
                  Recalcular desde cero
                </button>
              </div>
            )}

            {/* Lista de paradas */}
            {listaVisible.length > 0 && (
              <>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <p style={{fontWeight:700,fontSize:12,color:"#79828B",textTransform:"uppercase",letterSpacing:1,margin:0}}>
                    Paradas {rutaOptimizada?"(orden optimizado)":""}
                  </p>
                  {modoEdicion && (
                    <span style={{fontSize:11,color:"#A8702A",fontWeight:600}}>↕ Usá las flechas para reordenar</span>
                  )}
                </div>

                {listaVisible.map((p,i)=>(
                  <div key={p.id||i} style={{background:"#fff",borderRadius:14,border:`1.5px solid ${modoEdicion?"#A8702A":rutaOptimizada?"#2F6B4F":"#E4E7EA"}`,padding:12,marginBottom:8,transition:"border 0.2s"}}>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>

                      {/* Número de orden */}
                      <div style={{background:modoEdicion?"#A8702A":rutaOptimizada?"#2F6B4F":"#2A333B",color:"#fff",borderRadius:"50%",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:13,flexShrink:0}}>
                        {i+1}
                      </div>

                      {/* Info parada */}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:14,color:"#191E23",marginBottom:2}}>{p.cliente}</div>
                        <div style={{fontSize:12,color:"#26536E",marginBottom:4,wordBreak:"break-word"}}>{p.direccion}</div>
                        <div style={{fontSize:12,color:"#5C666F",display:"flex",flexWrap:"wrap",gap:6}}>
                          {p.items.map((it,j)=><span key={j}>{it.producto}: <strong>{it.kgReal||it.cantidad} {it.unidad}</strong></span>)}
                        </div>
                        {p.obs&&<div style={{fontSize:11,color:"#A3ABB3",marginTop:3}}>📝 {p.obs}</div>}
                      </div>

                      {/* Controles edición ó botón Ver */}
                      {modoEdicion ? (
                        <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                          <button onClick={()=>moverParada(i,-1)} disabled={i===0}
                            style={{width:30,height:30,borderRadius:8,border:"1.5px solid #D8DCE0",background:i===0?"#F2F3F5":"#fff",cursor:i===0?"default":"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>
                            ▲
                          </button>
                          <button onClick={()=>moverParada(i,1)} disabled={i===listaVisible.length-1}
                            style={{width:30,height:30,borderRadius:8,border:"1.5px solid #D8DCE0",background:i===listaVisible.length-1?"#F2F3F5":"#fff",cursor:i===listaVisible.length-1?"default":"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>
                            ▼
                          </button>
                          <button onClick={()=>quitarParada(i)}
                            style={{width:30,height:30,borderRadius:8,border:"1.5px solid #FFCDD2",background:"#F7EAEA",cursor:"pointer",fontSize:13,color:"#C33039",display:"flex",alignItems:"center",justifyContent:"center"}}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <a href={"https://maps.google.com/?q="+encodeURIComponent(p.direccion+", Buenos Aires")}
                          target="_blank"
                          style={{background:"#4285F4",color:"#fff",borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:700,textDecoration:"none",flexShrink:0,alignSelf:"flex-start"}}>
                          Ver
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Modal editar dirección */}
            {editandoDir && (
              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
                onClick={e=>{if(e.target===e.currentTarget){setEditandoDir(null);setNuevaDir("");}}}>
                <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480}}>
                  <div style={{fontWeight:700,fontSize:15,marginBottom:6}}>✏️ Editar dirección</div>
                  <div style={{fontSize:13,color:"#79828B",marginBottom:14}}>{editandoDir}</div>
                  <input
                    style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:14,boxSizing:"border-box"}}
                    placeholder="Calle y número, barrio"
                    value={nuevaDir} onChange={e=>setNuevaDir(e.target.value)}
                    autoFocus />
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <button onClick={()=>{setEditandoDir(null);setNuevaDir("");}}
                      style={{padding:13,borderRadius:12,border:"1.5px solid #D8DCE0",background:"#fff",fontSize:14,cursor:"pointer",fontWeight:600,color:"#5C666F"}}>
                      Cancelar
                    </button>
                    <button onClick={()=>guardarDireccion(editandoDir)}
                      style={{padding:13,borderRadius:12,border:"none",background:"#2A333B",color:"#fff",fontSize:14,cursor:"pointer",fontWeight:700}}>
                      Guardar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Footer frigorífico */}
            <div style={{background:"#2A333B",borderRadius:12,padding:"10px 14px",marginTop:8,fontSize:12,color:"rgba(255,255,255,0.7)",textAlign:"center"}}>
              Salida y regreso: Frigorífico Sersale · Parque Patricios
            </div>
          </div>
        </div>
      );
    }



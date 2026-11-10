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

    // Cantidad de un ítem para la hoja de ruta y el aviso de recontacto.
    // kgReal son siempre kilos pesados (aunque sea 0), también cuando el pedido se
    // tomó en piezas, ganchos, bolsas o unidades: "4 piezas · 31,6 kg", no "31.6 piezas".
    function p7CantidadTexto(it) {
      if (!it) return "";
      const num = v => { const n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) ? SersaleBase.fmtNumero(n, 3) : ""; };
      const unidad = it.unidad || "kg";
      const pesado = it.kgReal != null && it.kgReal !== "";
      if (unidad === "kg") { const n = num(pesado ? it.kgReal : it.cantidad); return n ? n + " kg" : ""; }
      const pedido = num(it.cantidad);
      const kg = pesado ? num(it.kgReal) : "";
      return [pedido ? pedido + " " + unidad : "", kg ? kg + " kg" : ""].filter(Boolean).join(" · ");
    }

    // Campo "Días" de una alerta (cuántos días sin pedir antes de avisar).
    // - Guarda solo un número entero de 1 a 365, y solo si cambió.
    // - Sin tocar, el límite es automático: lo que el cliente suele tardar entre pedidos,
    //   más 3 días. Si se escribe un número queda fijo (ya no se recalcula) y aparece
    //   "↺" para volver al automático.
    function P7CampoDias({ alerta, onGuardar }) {
      const [valor, setValor] = useState(String(alerta.diasAlerta));
      useEffect(()=>{ setValor(String(alerta.diasAlerta)); }, [alerta.diasAlerta]);
      const auto = !!alerta.freqCalc && !alerta.manual;
      const [guardar, guardando] = SersaleBase.useAccion(async () => {
        const txt = String(valor).trim();
        const n = /^\d{1,3}$/.test(txt) ? parseInt(txt, 10) : NaN;
        if (!(n >= 1 && n <= 365)) {
          setValor(String(alerta.diasAlerta));
          SersaleUI.toast("No se cambió: los días tienen que ser un número entre 1 y 365.", { tipo: "error" });
          return;
        }
        if (n === alerta.diasAlerta) { setValor(String(n)); return; }
        await onGuardar(alerta.clienteId, n);
        if (alerta.freqCalc) SersaleUI.toast("Límite fijado en "+n+" días (suele pedir cada "+alerta.freqCalc+").", { tipo: "ok" });
      });
      const [volverAuto, volviendo] = SersaleBase.useAccion(async () => {
        await onGuardar(alerta.clienteId, null);
        SersaleUI.toast("Límite automático: "+(alerta.freqCalc+3)+" días.", { tipo: "ok" });
      });
      return (
        <div style={{display:"flex",alignItems:"center",gap:4,background:"#EDEEF0",borderRadius:8,padding:"4px 8px"}}>
          <span style={{fontSize:11,color:"#5C666F"}}>{auto?"Auto:":"Días:"}</span>
          <input type="number" inputMode="numeric" pattern="[0-9]*" min="1" max="365" value={valor}
            disabled={guardando||volviendo} aria-label={"Días de alerta de "+alerta.cliente}
            onChange={e=>setValor(e.target.value)}
            onBlur={guardar}
            onKeyDown={e=>{ if(e.key==="Enter") e.target.blur(); }}
            enterKeyHint="done"
            style={{width:48,padding:"4px",borderRadius:6,border:"1.5px solid #D8DCE0",fontSize:16,textAlign:"center",background:"#fff",color:auto?"#5C666F":"#191E23"}}/>
          {alerta.manual && !!alerta.freqCalc && (
            <button type="button" onClick={volverAuto} disabled={guardando||volviendo}
              aria-label={"Volver al límite automático de "+alerta.cliente} title="Volver al automático"
              style={{border:"none",background:"transparent",fontSize:16,lineHeight:1,padding:"6px 4px",cursor:"pointer",color:"#26536E"}}>↺</button>
          )}
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
      const fmtF = f => SersaleBase.fmtFecha(f) || "-";
      function avisarWA(a) {
        setAlertaEnviando(a.cliente);
        const up=a.ultimoPedido||{};
        const prods=(up.items||[]).map(it=>{
          const hay=(it.kgReal!=null&&it.kgReal!=="")||parseFloat(it.cantidad)>0;
          const cant=hay?p7CantidadTexto(it):"";
          return it.producto+(cant?" ("+cant+")":"");
        }).join(", ");
        const total=(up.items||[]).reduce((s,it)=>{ const kg=(it.kgReal!=null&&it.kgReal!=="")?(Number(it.kgReal)||0):(parseFloat(it.cantidad)||0); return s+kg*(parseFloat(it.precio)||0); },0);
        const nl="\n";
        // La fecha sale de donde la saca la tarjeta: fechaPedido es un Timestamp y daba "Invalid Date".
        let msg="Recontacto cliente"+nl+nl+"Cliente: "+a.cliente+nl+"Dias sin pedir: "+a.diasSinPedir+"d"+nl+"Ultimo pedido ("+fmtF(up._fechaDisplay||up.fechaEntrega||"")+"): "+prods+nl+(total>0?"Monto: "+SersaleBase.fmtMonto(total)+nl:"")+"Frigorifico Sersale";
        // waLink codifica el texto: un "&" o un "#" en el nombre cortaba el mensaje.
        window.open(SersaleBase.waLink(msg,"5491167637860"),"_blank");
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
              <span>Email</span><span>Ultimo: <strong>{fmtF(ultimoEmail.updatedAt||ultimoEmail.fecha)}</strong> · {ultimoEmail.cantidad} alerta{ultimoEmail.cantidad!==1?"s":""}</span>
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
          {enAlerta.length+proximas.length===0 ? (
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
                    <P7CampoDias alerta={a} onGuardar={actualizarDiasAlerta} />
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
                      <P7CampoDias alerta={a} onGuardar={actualizarDiasAlerta} />
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
    // Google Maps acepta hasta 9 paradas intermedias por link (las demás las descarta).
    const P7_MAX_PARADAS_MAPS = 9;

    // Saca de una dirección lo que confunde al buscador de mapas (código postal,
    // "CABA", "Ciudad Autónoma de Buenos Aires"). "CABA" se saca solo si es una
    // palabra suelta: antes también se comía el "Caba" de Caballito o Cabañas.
    function p7LimpiarDireccion(dir) {
      return String(dir||"")
        .replace(/(^|[,\s])C\d{4}[A-Z]{2,4}(?![A-Za-z0-9])/gi, "$1")
        .replace(/,?\s*Cdad\.\s*Aut[oó]noma\s*de\s*Buenos\s*Aires/gi, "")
        .replace(/,?\s*Ciudad\s*Aut[oó]noma\s*de\s*Buenos\s*Aires/gi, "")
        .replace(/(^|[,\s])C\.?A\.?B\.?A\.?(?=\s*(?:,|$))/gi, "$1")
        .replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim().replace(/,\s*$/, "").replace(/^,\s*/, "");
    }

    // Links de Google Maps para recorrer las paradas saliendo de `base` y volviendo.
    // Con más de 9 paradas la ruta se parte en tramos encadenados (cada tramo
    // arranca donde terminó el anterior) para que Maps no descarte ninguna.
    function p7TramosMaps(paradas, base) {
      const dirs = (paradas||[]).filter(p=>p.direccion).map(p=>p.direccion+", Buenos Aires");
      const grupos = [];
      for (let i=0; i<dirs.length; i+=P7_MAX_PARADAS_MAPS) grupos.push(dirs.slice(i, i+P7_MAX_PARADAS_MAPS));
      return grupos.map((g,k)=>{
        const ultimo = k===grupos.length-1;
        const origen = k===0 ? base : grupos[k-1][grupos[k-1].length-1];
        const destino = ultimo ? base : g[g.length-1];
        const wps = ultimo ? g : g.slice(0,-1);
        const desde = k*P7_MAX_PARADAS_MAPS+1, hasta = k*P7_MAX_PARADAS_MAPS+g.length;
        return {
          desde, hasta,
          etiqueta: desde===hasta ? "Maps: parada "+desde : "Maps: paradas "+desde+" a "+hasta,
          url:"https://www.google.com/maps/dir/?api=1&origin="+encodeURIComponent(origen)+"&destination="+encodeURIComponent(destino)
            +(wps.length?"&waypoints="+wps.map(encodeURIComponent).join("|"):"")+"&travelmode=driving"
        };
      });
    }

    function HojaRuta({ fecha, pedidos, onBack }) {
      // Direcciones e ids de clientes, por nombre normalizado (sin mayúsculas, acentos ni espacios de más)
      const [clientesDB, setClientesDB] = useState({});
      const [clientesIDs, setClientesIDs] = useState({});
      const [cargaClientes, setCargaClientes] = useState("cargando"); // "cargando" | "ok" | "error"
      const [estado, setEstado] = useState("idle");
      const [rutaOptimizada, setRutaOptimizada] = useState(null);
      const [errores, setErrores] = useState([]);
      const [modoEdicion, setModoEdicion] = useState(false);
      const [editandoDir, setEditandoDir] = useState(null);
      const [nuevaDir, setNuevaDir] = useState("");

      const FRIGORIFICO = { nombre:"Frigorífico Sersale", direccion:"24 de Noviembre 1926, Parque Patricios, Buenos Aires", lat:-34.6262, lon:-58.4058 };

      async function cargarClientes() {
        setCargaClientes("cargando");
        try {
          const{db,collection,getDocs}=fb();
          const snap=await getDocs(collection(db,"clientes"));
          const map={}, ids={};
          snap.docs.forEach(d=>{
            const data=d.data();
            const clave=SersaleBase.norm(data.nombre);
            if(!clave) return;
            const dir=String(data.direccion||"").trim();
            // Si el cliente está cargado dos veces, vale la ficha que tiene dirección
            if(ids[clave] && (map[clave] || !dir)) return;
            map[clave]=dir; ids[clave]=d.id;
          });
          setClientesDB(map); setClientesIDs(ids);
          setCargaClientes("ok");
        } catch(e){ console.error(e); setCargaClientes("error"); }
      }
      useEffect(()=>{ cargarClientes(); },[]);

      // El nombre del pedido puede venir escrito distinto que en Clientes (mayúsculas, acentos, espacios)
      const pConDir = pedidos.map(p=>({...p, direccion:clientesDB[SersaleBase.norm(p.cliente)]||""}));
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
        if (conDir.length===0) { SersaleUI.toast("Ningún cliente tiene dirección cargada.", { tipo: "info" }); return; }
        setEstado("geocodificando");
        setRutaOptimizada(null);
        setErrores([]);
        setModoEdicion(false);

        const paradas = [];
        const fallidas = []; // paradas que el buscador no ubicó: NO se sacan de la ruta
        for (const p of conDir) {
          try {
            const dirLimpia = p7LimpiarDireccion(p.direccion);
            const query = encodeURIComponent(dirLimpia + ", Buenos Aires, Argentina");
            const res = await fetch("https://nominatim.openstreetmap.org/search?q="+query+"&format=json&limit=1&countrycodes=ar", { headers:{"Accept-Language":"es","User-Agent":"SersaleApp/1.0"} });
            const data = await res.json();
            if (data && data.length > 0) {
              paradas.push({ ...p, lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), ok: true });
            } else {
              const partes = dirLimpia.split(",")[0].trim();
              await new Promise(r=>setTimeout(r,1100)); // el buscador admite una consulta por segundo
              const res2 = await fetch("https://nominatim.openstreetmap.org/search?q="+encodeURIComponent(partes+", Buenos Aires, Argentina")+"&format=json&limit=1&countrycodes=ar", { headers:{"Accept-Language":"es","User-Agent":"SersaleApp/1.0"} });
              const data2 = await res2.json();
              if (data2 && data2.length > 0) {
                paradas.push({ ...p, lat: parseFloat(data2[0].lat), lon: parseFloat(data2[0].lon), ok: true });
              } else {
                fallidas.push(p);
              }
            }
          } catch(e) { console.warn("No se pudo ubicar la dirección de "+p.cliente, e); fallidas.push(p); }
          await new Promise(r=>setTimeout(r,1100));
        }

        setErrores(fallidas.map(p=>p.cliente));
        // Si no se ubicó ninguna, la hoja se puede mandar igual en el orden cargado (ver estado "error")
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
        // Las que no se ubicaron quedan al final de la ruta, marcadas, para acomodarlas a mano:
        // antes desaparecían de la lista, de Maps y de la hoja que se manda por WhatsApp.
        setRutaOptimizada([...tsp(paradas, FRIGORIFICO), ...fallidas.map(p=>({...p, sinUbicar:true}))]);
        setEstado("listo");
      }

      const [guardarDireccion, guardandoDir] = SersaleBase.useAccion(async (nombreCliente) => {
        const dir = nuevaDir.trim();
        if (!dir) return;
        const clave = SersaleBase.norm(nombreCliente);
        const id = clientesIDs[clave];
        if (!id) { SersaleUI.toast("Ese cliente no está en Clientes: cargalo ahí con su dirección.", { tipo: "error" }); return; }
        try {
          const { db, doc, updateDoc } = fb();
          await updateDoc(doc(db,"clientes",id), { direccion: dir });
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo guardar. Probá de nuevo.", { tipo: "error" });
          return; // la hoja queda abierta con lo que se escribió
        }
        setClientesDB(prev=>({...prev,[clave]:dir}));
        // Si la ruta ya estaba armada: actualizar la dirección ahí y sumar al final
        // los envíos de ese cliente que no estaban (no tenían dirección).
        setRutaOptimizada(prev=>{
          if(!prev) return prev;
          const act = prev.map(p=>SersaleBase.norm(p.cliente)===clave?{...p,direccion:dir}:p);
          const nuevas = pedidos.filter(p=>SersaleBase.norm(p.cliente)===clave && !act.some(x=>x.id===p.id))
            .map(p=>({...p,direccion:dir,sinUbicar:true}));
          return [...act, ...nuevas];
        });
        setEditandoDir(null); setNuevaDir("");
        SersaleUI.toast("Dirección guardada", { tipo: "ok" });
      });

      const tramosMaps = p7TramosMaps(rutaOptimizada || conDir, FRIGORIFICO.direccion);
      function abrirMaps(tramo) {
        if (!tramo) { SersaleUI.toast("No hay paradas con dirección.", { tipo: "info" }); return; }
        window.open(tramo.url,"_blank");
      }

      function enviarWA() {
        const lista = rutaOptimizada || conDir;
        const fmtF=f=>f?new Date(f+"T12:00:00").toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"long"}):"";
        const nl="\n";
        let txt="Hoja de Ruta "+fmtF(fecha).toUpperCase()+nl+nl;
        txt+="Salida: Frigorifico Sersale"+nl+nl;
        // Los envíos sin dirección cargada van al final, con sus productos (antes solo el nombre)
        [...lista, ...sinDir].forEach((p,i)=>{
          txt+=(i+1)+". "+p.cliente+nl+(p.direccion||"Sin direccion cargada")+nl;
          (p.items||[]).forEach(it=>{txt+="  - "+it.producto+": "+p7CantidadTexto(it)+nl;});
          txt+=nl;
        });
        txt+="Frigorifico Sersale - (011) 6763-7860";
        // waLink codifica el texto: un "&", "#" o "%" en un nombre, dirección o producto cortaba la hoja
        window.open(SersaleBase.waLink(txt),"_blank");
      }

      const fmtFecha=f=>f?new Date(f+"T12:00:00").toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"long"}):"";
      const listaVisible = rutaOptimizada || conDir;
      const sinDirNombres = sinDir.map(p=>p.cliente).filter((n,i,arr)=>arr.findIndex(x=>SersaleBase.mismoNombre(x,n))===i);

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

            {/* Direcciones de clientes: mientras cargan (o si fallan) no se puede decir "sin dirección" */}
            {cargaClientes==="cargando" && (
              <p style={{textAlign:"center",color:"#79828B",fontSize:13,margin:"8px 0 12px"}}>Cargando direcciones...</p>
            )}
            {cargaClientes==="error" && (
              <div style={{background:"#F7EAEA",border:"1.5px solid #C33039",borderRadius:14,padding:14,marginBottom:12,textAlign:"center"}}>
                <div style={{fontWeight:700,color:"#C33039",marginBottom:10}}>No se pudieron cargar las direcciones de los clientes</div>
                <button onClick={cargarClientes} style={{padding:"12px 18px",borderRadius:8,border:"none",background:"#C33039",color:"#fff",fontWeight:700,cursor:"pointer"}}>Reintentar</button>
              </div>
            )}

            {/* Botón optimizar */}
            {estado==="idle" && cargaClientes==="ok" && (
              <button onClick={optimizarRuta} disabled={conDir.length===0}
                style={{width:"100%",padding:14,borderRadius:14,border:"none",background:"#2A333B",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",marginBottom:12,opacity:conDir.length===0?0.5:1}}>
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
                <div style={{fontSize:12,color:"#79828B",marginBottom:10}}>Verificá que las direcciones estén completas. La hoja se puede mandar igual, en el orden cargado.</div>
                <button onClick={()=>setEstado("idle")} style={{padding:"8px 16px",borderRadius:8,border:"none",background:"#C33039",color:"#fff",fontWeight:700,cursor:"pointer"}}>Reintentar</button>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}>
                  {tramosMaps.map((t,k)=>(
                    <button key={k} onClick={()=>abrirMaps(t)} style={{padding:12,borderRadius:12,border:"none",background:"#4285F4",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                      {tramosMaps.length>1 ? t.etiqueta : "Abrir en Maps"}
                    </button>
                  ))}
                  <button onClick={enviarWA} style={{padding:12,borderRadius:12,border:"none",background:"#25D366",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    Enviar por WA
                  </button>
                </div>
              </div>
            )}

            {/* Errores parciales */}
            {errores.length>0 && (
              <div style={{background:"#F3EEE2",border:"1.5px solid #B5872F",borderRadius:12,padding:10,marginBottom:12,fontSize:12,color:"#A8702A"}}>
                ⚠️ No se pudo ubicar: {errores.join(", ")}
                {estado==="listo" && <div style={{marginTop:4}}>Siguen en la ruta, al final: acomodalas con Editar.</div>}
              </div>
            )}

            {/* Sin dirección: tocando el nombre se le carga */}
            {cargaClientes==="ok" && sinDir.length>0 && (
              <div style={{background:"#F7F8F9",border:"1px solid #D8DCE0",borderRadius:12,padding:10,marginBottom:12,fontSize:12,color:"#79828B"}}>
                Sin dirección:{" "}
                {sinDirNombres.map((n,i)=>(
                  <button key={n} onClick={()=>{setEditandoDir(n);setNuevaDir("");}}
                    style={{background:"none",border:"none",padding:"8px 4px",font:"inherit",fontWeight:700,color:"#26536E",textDecoration:"underline",cursor:"pointer"}}>
                    {n}{i<sinDirNombres.length-1?",":""}
                  </button>
                ))}
                <div style={{marginTop:2}}>Tocá el nombre para cargarle la dirección. En la hoja por WhatsApp van al final.</div>
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
                {!modoEdicion && tramosMaps.length>1 && (
                  <div style={{fontSize:12,color:"#5C666F",textAlign:"center",marginBottom:8}}>
                    Maps acepta hasta {P7_MAX_PARADAS_MAPS} paradas por vez: la ruta va en {tramosMaps.length} tramos seguidos.
                  </div>
                )}
                {!modoEdicion && (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {tramosMaps.length<=1 ? (
                      <button onClick={()=>abrirMaps(tramosMaps[0])} style={{padding:12,borderRadius:12,border:"none",background:"#4285F4",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                        Abrir en Maps
                      </button>
                    ) : tramosMaps.map((t,k)=>(
                      <button key={k} onClick={()=>abrirMaps(t)} style={{padding:12,borderRadius:12,border:"none",background:"#4285F4",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                        {t.etiqueta}
                      </button>
                    ))}
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
                        {p.sinUbicar && <div style={{fontSize:11,fontWeight:700,color:"#A8702A",marginBottom:4}}>⚠️ Sin ubicar en el mapa: acomodala a mano</div>}
                        <div style={{fontSize:12,color:"#5C666F",display:"flex",flexWrap:"wrap",gap:6}}>
                          {(p.items||[]).map((it,j)=><span key={j}>{it.producto}: <strong>{p7CantidadTexto(it)}</strong></span>)}
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
                          target="_blank" rel="noopener noreferrer"
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
                onClick={e=>{if(e.target===e.currentTarget&&!guardandoDir){setEditandoDir(null);setNuevaDir("");}}}>
                <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480}}>
                  <div style={{fontWeight:700,fontSize:15,marginBottom:6}}>✏️ Editar dirección</div>
                  <div style={{fontSize:13,color:"#79828B",marginBottom:14}}>{editandoDir}</div>
                  <input
                    style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:16,background:"#fff",outline:"none",marginBottom:14,boxSizing:"border-box"}}
                    placeholder="Calle y número, barrio" aria-label="Dirección"
                    value={nuevaDir} onChange={e=>setNuevaDir(e.target.value)}
                    autoFocus />
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <button onClick={()=>{setEditandoDir(null);setNuevaDir("");}}
                      style={{padding:13,borderRadius:12,border:"1.5px solid #D8DCE0",background:"#fff",fontSize:14,cursor:"pointer",fontWeight:600,color:"#5C666F"}}>
                      Cancelar
                    </button>
                    <button onClick={()=>guardarDireccion(editandoDir)} disabled={guardandoDir||!nuevaDir.trim()}
                      style={{padding:13,borderRadius:12,border:"none",background:"#2A333B",color:"#fff",fontSize:14,cursor:"pointer",fontWeight:700,opacity:(guardandoDir||!nuevaDir.trim())?0.5:1}}>
                      {guardandoDir?"Guardando...":"Guardar"}
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



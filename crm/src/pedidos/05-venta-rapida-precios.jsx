    // ── AYUDAS DE VENTA RÁPIDA Y PRECIOS (este archivo) ─────
    /** Fecha de un precio como texto que se puede comparar (texto ISO, Timestamp o {seconds}). */
    function p5FechaPrecio(v) {
      if (typeof v === "string") return v;
      const d = SersaleBase.aFecha(v);
      return d ? d.toISOString() : "";
    }

    /**
     * Último precio de cada producto, a partir de los documentos de
     * precios_cliente de UN cliente ({ id, cliente, producto, precio, fecha }):
     * si un producto tiene varios (historial), queda el de fecha más reciente.
     */
    function p5UltimosPrecios(docs) {
      const porProducto = new Map();
      (docs || []).forEach(data => {
        if (!data || !data.producto) return;
        const previo = porProducto.get(data.producto);
        if (!previo || p5FechaPrecio(data.fecha) > p5FechaPrecio(previo.fecha)) porProducto.set(data.producto, data);
      });
      return Array.from(porProducto.values()).sort((a, b) => String(a.producto).localeCompare(String(b.producto), "es"));
    }

    /** Agrupa documentos de precios_cliente por cliente (nombre sin mayúsculas, acentos ni espacios de más). */
    function p5PreciosPorCliente(docs) {
      const grupos = new Map();
      (docs || []).forEach(data => {
        const k = data && data.cliente ? SersaleBase.norm(data.cliente) : "";
        if (!k) return;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(data);
      });
      return grupos;
    }

    /** Precio guardado -> número (tolera texto o faltante). */
    function p5Precio(v) {
      const n = typeof v === "number" ? v : parseFloat(v);
      return isFinite(n) ? n : 0;
    }

    /**
     * Espera una escritura simple (un precio). Sin señal, Firestore no confirma
     * nunca pero deja el cambio guardado en el teléfono y lo envía solo al volver
     * la conexión: en ese caso no se deja el botón trabado. Devuelve true si el
     * servidor confirmó, false si quedó pendiente de envío.
     */
    function p5EsperarEscritura(promesa) {
      let vencida = false;
      const ok = promesa.then(() => true);
      ok.catch(e => {
        if (!vencida) return; // lo informa quien espera
        console.error(e);
        SersaleUI.toast("Un precio cargado sin señal no se pudo guardar. Revisalo.", { tipo: "error" });
      });
      const ms = navigator.onLine === false ? 400 : 6000;
      return Promise.race([ok, new Promise(r => setTimeout(() => { vencida = true; r(false); }, ms))]);
    }

    /**
     * Filas de la venta rápida tal como se van a guardar. Una fila sin nada
     * escrito se ignora. Una fila a medias (sin producto, sin cantidad mayor a
     * cero o con precio negativo) va a `incompletas` (número de fila, desde 1).
     * El total sale de las mismas filas que se guardan, cada renglón redondeado
     * a centavos.
     */
    function p5FilasVenta(items) {
      const filas = [], incompletas = [];
      (items || []).forEach((it, i) => {
        const producto = String(it.producto || "").trim();
        const cantTxt = String(it.cantidad == null ? "" : it.cantidad).trim();
        const precioTxt = String(it.precio == null ? "" : it.precio).trim();
        if (!producto && !cantTxt && !precioTxt) return;
        // Los dos campos entregan texto plano con punto decimal (type="number" e InputMonto).
        const cantidad = parseFloat(cantTxt);
        const precio = precioTxt === "" ? 0 : parseFloat(precioTxt);
        if (!producto || !isFinite(cantidad) || cantidad <= 0 || !isFinite(precio) || precio < 0) { incompletas.push(i + 1); return; }
        filas.push({ producto, cantidad, unidad: it.unidad, precio, total: SersaleBase.redondear(cantidad * precio, 2) });
      });
      return { filas, incompletas, total: SersaleBase.redondear(filas.reduce((s, f) => s + f.total, 0), 2) };
    }

    // ── MODAL VENTA RAPIDA ──────────────────────────────────
    function ModalVentaRapida({ clienteInicial, clientes, onClose, onGuardado }) {
      const [cliente, setCliente] = useState(clienteInicial||"");
      const [items, setItems] = useState([{producto:"",cantidad:"",unidad:"kg",precio:""}]);
      const [obs, setObs] = useState("");
      const [clientesLista, setClientesLista] = useState(clientes||[]);
      // Ids del pedido y del movimiento de esta venta: si hay que reintentar
      // después de un error, se corrige lo mismo en vez de cargar la venta dos veces.
      const idsVenta = React.useRef(null);

      // Cargar clientes desde Firebase si no vienen como prop
      useEffect(()=>{
        if(clienteInicial) return; // ya viene preseleccionado
        (async()=>{
          try {
            const {db,collection,getDocs,query,orderBy} = fb();
            const snap = await getDocs(query(collection(db,"clientes"),orderBy("nombre","asc")));
            const nombres = snap.docs.map(d=>d.data().nombre).filter(Boolean);
            setClientesLista(nombres);
          } catch(e){ console.error(e); }
        })();
      },[]);

      const addItem = () => setItems(prev=>[...prev,{producto:"",cantidad:"",unidad:"kg",precio:""}]);
      const updItem = (i,f,v) => setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[f]:v}:it));
      const remItem = i => setItems(prev=>prev.length>1?prev.filter((_,idx)=>idx!==i):prev);
      const elegirCliente = v => { idsVenta.current = null; setCliente(v); };

      // El total que se muestra es el de las filas que se van a guardar
      const total = p5FilasVenta(items).total;

      const fmt$ = n => SersaleBase.fmtMonto(Math.round(n));

      const [guardar, guardando] = SersaleBase.useAccion(async () => {
        const falta = t => { SersaleUI.toast(t, { tipo: "error" }); };
        if(!cliente) return falta("Seleccioná el cliente");
        const { filas, incompletas, total: totalVenta } = p5FilasVenta(items);
        if(incompletas.length) return falta("Completá producto y cantidad en la fila "+incompletas.join(", ")+", o borrala");
        if(!filas.length) return falta("Agregá al menos un producto con cantidad");
        const montoFinal = Math.round(totalVenta);
        if(montoFinal<=0) return falta("Ingresá los precios para calcular el total");
        const sinPrecio = filas.filter(f=>!(f.precio>0));
        if(sinPrecio.length) {
          const uno = sinPrecio.length===1;
          const ok = await SersaleUI.confirmar({
            titulo: uno ? "Hay un producto sin precio" : "Hay productos sin precio",
            cuerpo: sinPrecio.map(f=>f.producto).join(", ")+": "+(uno?"queda":"quedan")+" en $0 y no se "+(uno?"cobra":"cobran")+". Total de la venta: "+fmt$(montoFinal)+".",
            aceptar: "Registrar igual", cancelar: "Volver"
          });
          if(!ok) return;
        }
        if(navigator.onLine === false) return falta("Sin conexión: la venta no se registró. Probá de nuevo cuando vuelva la señal.");
        try {
          const {db,collection,doc,runTransaction,Timestamp} = fb();
          const hoy = SersaleBase.hoy();
          const ahora = new Date().toISOString();
          const cuenta = await ccBuscarCuenta(cliente);
          if(!cuenta) {
            const ok = await SersaleUI.confirmar({
              titulo: cliente+" no tiene cuenta corriente",
              cuerpo: "Para registrar la venta se le abre una cuenta corriente y el importe queda cargado ahí.",
              aceptar: "Abrir cuenta y registrar", cancelar: "Cancelar"
            });
            if(!ok) return;
          }
          if(!idsVenta.current) idsVenta.current = { pedido: doc(collection(db,"pedidos")).id, mov: doc(collection(db,"cc_movimientos")).id };
          const pedidoRef = doc(db,"pedidos",idsVenta.current.pedido);
          const detalle = filas.map(f=>`${f.producto} ${f.cantidad}${f.unidad}`).join(", ");
          // Pedido (para el panel, alertas y sugerencias)
          const pedidoDatos = {
            cliente, tipo:"retiro",
            fechaPedido: Timestamp ? Timestamp.now() : new Date(),
            fechaPedidoISO: ahora,
            fechaEntrega: hoy,
            items: filas.map(f=>({ producto:f.producto, cantidad:f.cantidad, unidad:f.unidad, precio:f.precio, kgReal:f.cantidad })),
            obs: obs.trim() ? "VR: "+obs.trim() : "Venta rapida",
            estado: "despachado",
            origen: "venta_rapida",
            cuentaCorriente: true,
            historial: [{estado:"despachado", fecha:ahora, nota:"Venta rapida"}]
          };
          // Movimiento de cuenta corriente. Lleva el mismo nombre de cliente que el
          // pedido (como siempre): el panel del director los empareja por nombre y fecha.
          const movDatos = {
            cliente, tipo:"pedido", monto:montoFinal,
            fecha:hoy, detalle, obs:obs.trim(),
            origen:"venta_rapida", pedidoId:pedidoRef.id,
            items: filas.map(f=>({ producto:f.producto, cantidad:f.cantidad, unidad:f.unidad, precio:f.precio }))
          };
          const asiento = await ccPrepararAsiento({ cliente, cuenta, movId: idsVenta.current.mov, abrirCuenta: true, ultimoMovimiento: hoy });
          // Pedido, movimiento y saldo se guardan juntos (o no se guarda nada)
          const res = await runTransaction(db, async tx => {
            asiento.marca = null;
            const pedSnap = await tx.get(pedidoRef);
            await ccLeerAsiento(tx, asiento);
            if(pedSnap.exists()) tx.update(pedidoRef, pedidoDatos); else tx.set(pedidoRef, pedidoDatos);
            return ccEscribirAsiento(tx, asiento, movDatos);
          });
          if(!res || !res.asentado) throw new Error("No se pudo asentar la venta en la cuenta de "+cliente);
          // Que lo que se lea después (panel, cuenta corriente) ya traiga la venta
          await esperarCopiaLocal(pedidoRef, d => !!d && d.fechaPedidoISO === ahora);
          await ccEsperarAsiento(asiento);
          idsVenta.current = null;
          SersaleUI.toast("Venta de "+fmt$(montoFinal)+" registrada"+(res.cuentaAbierta?" (cuenta nueva)":"")+". Saldo de "+cliente+": "+ccFmtSaldo(res.saldo), { tipo: "ok", ms: 4500 });
          // Mark client as contacted
          marcarContacto(cliente);
          onGuardado && onGuardado();
          onClose();
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo registrar la venta. Revisá la conexión y probá de nuevo.", { tipo: "error" });
        }
      });
      // Mientras se guarda no se cierra: parecería cancelada y se cargaría de nuevo
      const cerrar = () => { if(!guardando) onClose(); };

      return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
          onClick={e=>{if(e.target===e.currentTarget)cerrar();}}>
          <div style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:480,maxHeight:"92vh",overflowY:"auto"}}>
            {/* Header */}
            <div style={{background:"#A4232A",padding:"18px 20px",borderRadius:"20px 20px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:800,fontSize:16,color:"#fff"}}>Venta rapida</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.75)",marginTop:2}}>Registrar en cuenta corriente</div>
              </div>
              <button onClick={cerrar} aria-label="Cerrar" style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:20,width:32,height:32,cursor:"pointer",fontSize:18,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>

            <div style={{padding:"16px 20px 32px"}}>
              {/* Selector de cliente (solo si no viene preseleccionado) */}
              {!clienteInicial && (
                <>
                  <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Cliente *</label>
                  <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:14}}
                    aria-label="Cliente de la venta" value={cliente} onChange={e=>elegirCliente(e.target.value)}>
                    <option value="">— Seleccioná un cliente —</option>
                    {Array.from(new Set(clientesLista||[])).sort((a,b)=>String(a).localeCompare(String(b),"es",{sensitivity:"base"})).map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                </>
              )}
              {clienteInicial && (
                <div style={{background:"#F7EAEA",borderRadius:10,padding:"8px 14px",marginBottom:14,fontSize:13,color:"#7E1A20",fontWeight:700}}>
                  Cliente: {clienteInicial}
                </div>
              )}

              {/* Items */}
              <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:8}}>Productos *</label>
              {items.map((it,i)=>(
                <div key={i} style={{background:"#F7F8F9",borderRadius:12,padding:10,marginBottom:8}}>
                  <div style={{display:"flex",gap:6,marginBottom:6}}>
                    <input style={{flex:2,padding:"9px 10px",borderRadius:9,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                      placeholder="Producto" value={it.producto} onChange={e=>updItem(i,"producto",e.target.value)} />
                    {items.length>1&&(
                      <button onClick={()=>remItem(i)} aria-label={"Quitar fila "+(i+1)} style={{width:32,border:"none",borderRadius:9,background:"#F7EAEA",color:"#A4232A",fontSize:16,cursor:"pointer",flexShrink:0}}>×</button>
                    )}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 80px 1fr",gap:6}}>
                    <input type="number" inputMode="decimal" step="any" min="0" style={{padding:"9px 10px",borderRadius:9,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                      placeholder="Cant." value={it.cantidad} onChange={e=>updItem(i,"cantidad",e.target.value)} />
                    <select style={{padding:"9px 6px",borderRadius:9,border:"1.5px solid #D8DCE0",fontSize:12,background:"#fff"}}
                      value={it.unidad} onChange={e=>updItem(i,"unidad",e.target.value)}>
                      {["kg","pzas","bolsas","u"].map(u=><option key={u} value={u}>{u}</option>)}
                    </select>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#A3ABB3"}}>$</span>
                      <InputMonto style={{width:"100%",padding:"9px 10px 9px 22px",borderRadius:9,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
                        placeholder="Precio" value={it.precio} onChange={v=>updItem(i,"precio",v)} />
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={addItem}
                style={{width:"100%",padding:"9px 0",borderRadius:10,border:"1.5px dashed #A4232A",background:"#F7EAEA",color:"#A4232A",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:14}}>
                + Agregar producto
              </button>

              {/* Obs */}
              <input style={{width:"100%",padding:"10px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:13,marginBottom:14}}
                placeholder="Observaciones (opcional)" value={obs} onChange={e=>setObs(e.target.value)} />

              {/* Total */}
              {total>0&&(
                <div style={{background:"#F0F9F4",border:"1.5px solid #2F6B4F",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontWeight:700,fontSize:14,color:"#24523D"}}>Total</span>
                  <span style={{fontWeight:900,fontSize:20,color:"#24523D"}}>{fmt$(total)}</span>
                </div>
              )}

              <button onClick={guardar} disabled={guardando}
                style={{width:"100%",padding:16,borderRadius:12,border:"none",background:guardando?"#B9BFC5":"#A4232A",color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer",boxShadow:"0 4px 14px rgba(192,57,43,0.4)"}}>
                {guardando?"Guardando...":"Registrar venta"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    // ── REPORTE DE PRECIOS DE MÚLTIPLES CLIENTES (PDF) ──────
    function ReportePreciosClientes({ onBack }) {
      const [clientesLista, setClientesLista] = useState(null);
      const [seleccionados, setSeleccionados] = useState(new Set());
      const [busqueda, setBusqueda] = useState("");
      const [errorCarga, setErrorCarga] = useState(false);

      async function cargarClientes() {
        setErrorCarga(false); setClientesLista(null);
        try {
          const {db,collection,getDocs,query,orderBy} = fb();
          const snap = await getDocs(query(collection(db,"clientes"),orderBy("nombre","asc")));
          const nombres = snap.docs.map(d=>d.data().nombre).filter(Boolean);
          // Solo clientes que tengan al menos 1 precio cargado (el nombre se compara sin acentos ni mayúsculas)
          const snapPrecios = await getDocs(collection(db,"precios_cliente"));
          const conPrecios = p5PreciosPorCliente(snapPrecios.docs.map(d=>d.data()));
          const vistos = new Set();
          const final = nombres.filter(n=>{
            const k = SersaleBase.norm(n);
            if(!conPrecios.has(k) || vistos.has(k)) return false;
            vistos.add(k); return true;
          }).sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
          setClientesLista(final);
        } catch(e){
          console.error(e); setErrorCarga(true); setClientesLista([]);
          SersaleUI.toast("No se pudieron cargar los clientes. Revisá la conexión.", { tipo: "error" });
        }
      }
      useEffect(()=>{ cargarClientes(); },[]);

      const visibles = (clientesLista||[]).filter(c=>SersaleBase.coincide(c, busqueda));

      function toggleCliente(nombre) {
        const s = new Set(seleccionados);
        if(s.has(nombre)) s.delete(nombre); else s.add(nombre);
        setSeleccionados(s);
      }
      function seleccionarTodos() {
        // Suma los que se ven a los ya elegidos (con una búsqueda puesta no borra el resto)
        const s = new Set(seleccionados);
        visibles.forEach(c=>s.add(c));
        setSeleccionados(s);
      }
      function deseleccionarTodos() { setSeleccionados(new Set()); }

      const [generarPDF, generando] = SersaleBase.useAccion(async () => {
        if(seleccionados.size===0) { SersaleUI.toast("Seleccioná al menos un cliente", { tipo: "error" }); return; }
        try {
          const {db,collection,getDocs} = fb();
          // Una sola lectura de precios para todos los clientes elegidos;
          // por producto queda el más reciente por fecha
          const snap = await getDocs(collection(db,"precios_cliente"));
          const porCliente = p5PreciosPorCliente(snap.docs.map(d=>d.data()));
          const arrClientes = Array.from(seleccionados).sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
          const dataClientes = arrClientes.map(nombre=>({ cliente:nombre, precios:p5UltimosPrecios(porCliente.get(SersaleBase.norm(nombre))) }));
          armarPDF(dataClientes);
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo generar el PDF. Probá de nuevo.", { tipo: "error" });
        }
      });

      function armarPDF(dataClientes) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit:'mm', format:'a4' });
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const margin = 14;
        const pw = W - margin*2;
        const fmt$ = n => SersaleBase.fmtMonto(Math.round(p5Precio(n)));
        const hoyStr = SersaleBase.fmtFecha(SersaleBase.hoy());
        const PRODUCTOS_ACTUAL = getProductos();

        function dibujarHeader(y) {
          // Logo
          try { doc.addImage(window.__sersaleLogo, 'PNG', margin, y-4, 18, 18); } catch(e){}
          doc.setFontSize(14); doc.setTextColor(192,34,43); doc.setFont(undefined,'bold');
          doc.text('FRIGORIFICO SERSALE', margin+22, y+2);
          doc.setFontSize(7); doc.setTextColor(100); doc.setFont(undefined,'normal');
          doc.text('24 de Noviembre 1926, Parque Patricios - CABA', margin+22, y+7);
          doc.text('Tel: (011) 6763-7860 - @sersalefrigorifico', margin+22, y+11);
          // Título derecha
          doc.setFontSize(9); doc.setTextColor(130);
          doc.text('REPORTE DE PRECIOS', W-margin, y, { align:'right' });
          doc.setFontSize(11); doc.setTextColor(60); doc.setFont(undefined,'bold');
          doc.text('Generado: '+hoyStr, W-margin, y+7, { align:'right' });
          y += 18;
          doc.setDrawColor(192,34,43); doc.setLineWidth(0.8);
          doc.line(margin, y, W-margin, y);
          return y + 8;
        }

        // ── PORTADA ──
        let y = 16;
        y = dibujarHeader(y);
        doc.setFontSize(22); doc.setTextColor(44,62,80); doc.setFont(undefined,'bold');
        doc.text('Reporte de Precios', W/2, y+20, { align:'center' });
        doc.setFontSize(12); doc.setTextColor(120); doc.setFont(undefined,'normal');
        doc.text('por Cliente', W/2, y+28, { align:'center' });
        // Box con info
        doc.setFillColor(254,240,239);
        doc.roundedRect(margin+20, y+45, pw-40, 50, 3, 3, 'F');
        doc.setFontSize(10); doc.setTextColor(80); doc.setFont(undefined,'normal');
        doc.text('Fecha de generación:', margin+30, y+58);
        doc.setFont(undefined,'bold'); doc.setTextColor(40);
        doc.text(hoyStr, margin+30, y+65);
        doc.setFont(undefined,'normal'); doc.setTextColor(80);
        doc.text('Clientes incluidos:', margin+30, y+78);
        doc.setFont(undefined,'bold'); doc.setTextColor(40);
        doc.text(String(dataClientes.length), margin+30, y+85);
        // Lista de clientes incluidos (resumen)
        doc.setFontSize(9); doc.setTextColor(100); doc.setFont(undefined,'normal');
        doc.text('Clientes en este reporte:', margin, y+110);
        doc.setFontSize(10); doc.setTextColor(50);
        let yLista = y+118;
        dataClientes.forEach((d,i)=>{
          if(yLista > H-25) { doc.addPage(); yLista = 20; }
          doc.text('• '+d.cliente+' ('+d.precios.length+' precio'+(d.precios.length!==1?'s':'')+')', margin+4, yLista);
          yLista += 6;
        });

        // ── UNA PÁGINA POR CLIENTE ──
        dataClientes.forEach((d,idx)=>{
          doc.addPage();
          let y2 = 16;
          y2 = dibujarHeader(y2);
          // Header del cliente
          doc.setFillColor(192,34,43);
          doc.rect(margin, y2, pw, 12, 'F');
          doc.setTextColor(255); doc.setFont(undefined,'bold');
          // Un nombre largo se achica hasta entrar en la franja (sin pisar el "1 / N")
          let tamNombre = 13;
          doc.setFontSize(tamNombre);
          while(tamNombre > 6 && doc.getTextWidth(String(d.cliente)) > pw - 28) { tamNombre -= 0.5; doc.setFontSize(tamNombre); }
          doc.text(String(d.cliente), margin+4, y2+8);
          doc.setFontSize(9); doc.setFont(undefined,'normal');
          doc.text((idx+1)+' / '+dataClientes.length, W-margin-4, y2+8, { align:'right' });
          y2 += 18;

          // Si no hay precios
          if(d.precios.length===0) {
            doc.setFontSize(10); doc.setTextColor(120); doc.setFont(undefined,'italic');
            doc.text('Sin precios cargados', margin, y2+10);
            return;
          }

          // Agrupar por categoría
          const porCat = {};
          d.precios.forEach(p=>{
            // buscar a qué categoría pertenece
            let cat = "Otros";
            for(const [c, prods] of Object.entries(PRODUCTOS_ACTUAL)) {
              if(prods.includes(p.producto)) { cat = c; break; }
            }
            if(!porCat[cat]) porCat[cat] = [];
            porCat[cat].push(p);
          });
          const catsOrdenadas = Object.keys(porCat).sort((a,b)=>a.localeCompare(b,"es"));

          // Por cada categoría: encabezado + tabla
          catsOrdenadas.forEach(cat=>{
            const items = porCat[cat].sort((a,b)=>a.producto.localeCompare(b.producto,"es"));
            // Salto de página si no entra el header + al menos 2 filas
            if(y2 + 7 + 18 > H-15) { doc.addPage(); y2 = 16; y2 = dibujarHeader(y2); }
            // Header categoría
            doc.setFillColor(240,240,240);
            doc.rect(margin, y2, pw, 6, 'F');
            doc.setFontSize(8); doc.setTextColor(100); doc.setFont(undefined,'bold');
            doc.text(cat.toUpperCase(), margin+3, y2+4.2);
            y2 += 7;
            // Header tabla
            doc.setFillColor(44,62,80);
            doc.rect(margin, y2, pw, 7, 'F');
            doc.setFontSize(8); doc.setTextColor(255); doc.setFont(undefined,'bold');
            doc.text('PRODUCTO', margin+3, y2+5);
            doc.text('PRECIO / KG', W-margin-3, y2+5, { align:'right' });
            y2 += 9;
            // Filas
            doc.setFont(undefined,'normal'); doc.setTextColor(40);
            items.forEach(p=>{
              if(y2 > H-18) { doc.addPage(); y2 = 16; y2 = dibujarHeader(y2); }
              doc.setFontSize(9.5); doc.setFont(undefined,'normal');
              doc.text(String(p.producto), margin+3, y2+4);
              doc.setFont(undefined,'bold'); doc.setTextColor(192,34,43);
              doc.text(fmt$(p.precio), W-margin-3, y2+4, { align:'right' });
              doc.setTextColor(40);
              doc.setDrawColor(235); doc.setLineWidth(0.2);
              doc.line(margin, y2+6, W-margin, y2+6);
              y2 += 7;
            });
            y2 += 4;
          });
        });

        // Footer en todas las páginas
        const totalPaginas = doc.internal.getNumberOfPages();
        for(let i=1;i<=totalPaginas;i++){
          doc.setPage(i);
          doc.setFontSize(7); doc.setTextColor(150); doc.setFont(undefined,'normal');
          doc.text('Precios sujetos a cambio sin previo aviso · Frigorífico Sersale', W/2, H-6, { align:'center' });
          doc.text('Página '+i+' de '+totalPaginas, W-margin, H-6, { align:'right' });
        }

        const fileName = 'Reporte de Precios - '+hoyStr.replace(/\//g,'-')+'.pdf';
        window.compartirOdescargarPDF(doc, fileName);
      }

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:800,fontSize:16}}>Exportar Reporte</div>
              <div style={{fontSize:12,opacity:0.85}}>{seleccionados.size} seleccionado{seleccionados.size!==1?'s':''}</div>
            </div>
            <button onClick={generarPDF} disabled={generando||seleccionados.size===0}
              style={{background:seleccionados.size===0?"rgba(255,255,255,0.2)":"#fff",color:seleccionados.size===0?"rgba(255,255,255,0.6)":"#6B4E8E",border:"none",borderRadius:10,padding:"8px 14px",fontWeight:800,fontSize:13,cursor:seleccionados.size===0?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
              {generando ? "Generando..." : "Generar PDF"}
            </button>
          </div>

          <div style={{padding:16}}>
            {/* Buscador */}
            <div style={{position:"relative",marginBottom:12}}>
              <input
                style={{width:"100%",padding:"10px 14px 10px 36px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",boxSizing:"border-box"}}
                placeholder="Buscar cliente..."
                value={busqueda} onChange={e=>setBusqueda(e.target.value)} />
              <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:16,color:"#A3ABB3"}}>🔍</span>
              {busqueda&&<button onClick={()=>setBusqueda("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#A3ABB3"}}>✕</button>}
            </div>

            {/* Controles */}
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              <button onClick={seleccionarTodos}
                style={{flex:1,padding:"8px 0",borderRadius:10,border:"1.5px solid #6B4E8E",background:"#fff",color:"#6B4E8E",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                ✓ Seleccionar todos {busqueda?'(visibles)':''}
              </button>
              <button onClick={deseleccionarTodos}
                style={{flex:1,padding:"8px 0",borderRadius:10,border:"1.5px solid #D8DCE0",background:"#fff",color:"#5C666F",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                Limpiar
              </button>
            </div>

            {/* Lista de clientes */}
            {clientesLista===null
              ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><p>Cargando clientes...</p></div>
              : errorCarga
                ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}>
                    <p>No se pudieron cargar los clientes.</p>
                    <button onClick={cargarClientes} style={{marginTop:12,padding:"12px 20px",borderRadius:10,border:"1.5px solid #A4232A",background:"#fff",color:"#A4232A",fontWeight:700,fontSize:14,cursor:"pointer"}}>Reintentar</button>
                  </div>
              : visibles.length===0
                ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><div style={{fontSize:48}}>🔍</div><p>{busqueda.trim()&&clientesLista.length>0 ? "Sin resultados para \""+busqueda.trim()+"\"" : "Sin clientes con precios cargados"}</p></div>
                : visibles.map(c=>{
                  const checked = seleccionados.has(c);
                  return (
                    <button key={c} onClick={()=>toggleCliente(c)}
                      style={{width:"100%",background:checked?"#F7EAEA":"#fff",borderRadius:12,border:`1.5px solid ${checked?"#A4232A":"#D8DCE0"}`,padding:"12px 14px",marginBottom:8,textAlign:"left",cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
                      <div style={{width:22,height:22,borderRadius:6,border:`2px solid ${checked?"#A4232A":"#B9BFC5"}`,background:checked?"#A4232A":"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        {checked && <span style={{color:"#fff",fontSize:14,fontWeight:900,lineHeight:1}}>✓</span>}
                      </div>
                      <span style={{fontSize:14,fontWeight:checked?700:500,color:checked?"#A4232A":"#191E23"}}>{c}</span>
                    </button>
                  );
                })
            }
          </div>
        </div>
      );
    }

        // ── TAB PRECIOS ──────────────────────────────────────────
    function TabPrecios({ clientes }) {
      const [modoExportar, setModoExportar] = useState(false);
      const [todosClientes, setTodosClientes] = useState([]);
      const [clienteSel, setClienteSel] = useState("");
      const [precios, setPrecios] = useState([]);
      const [cargando, setCargando] = useState(false);
      const [modalOpen, setModalOpen] = useState(false);
      const [editando, setEditando] = useState(null);
      const [formProd, setFormProd] = useState("");
      const [formPrecio, setFormPrecio] = useState("");
      const [errorPrecios, setErrorPrecios] = useState(false);
      // Número de la última carga pedida: una respuesta que llega tarde (ya se eligió otro cliente) se descarta
      const cargaRef = React.useRef(0);
      // Catálogo vigente (el que se edita en Productos), no la lista fija del código
      const catalogo = getProductos();
      const enCatalogo = new Set(Object.values(catalogo).flat().filter(p=>p));

      // Cargar lista completa de clientes de Firebase
      useEffect(()=>{
        (async()=>{
          try {
            const {db,collection,getDocs,query,orderBy} = fb();
            const snap = await getDocs(query(collection(db,"clientes"),orderBy("nombre","asc")));
            setTodosClientes(snap.docs.map(d=>d.data().nombre).filter(Boolean));
          } catch(e){
            console.error(e);
            SersaleUI.toast("No se pudieron cargar los clientes. Revisá la conexión.", { tipo: "error" });
          }
        })();
      },[]);

      // silencioso: recarga sin vaciar la lista (después de guardar, para no perder el lugar)
      async function cargarPrecios(cliente, opciones) {
        const turno = ++cargaRef.current;
        if(!(opciones && opciones.silencioso)) { setCargando(true); setPrecios([]); }
        setErrorPrecios(false);
        try {
          const {db,collection,getDocs} = fb();
          const snap = await getDocs(collection(db,"precios_cliente"));
          if(turno !== cargaRef.current) return;
          // Precios del cliente (nombre sin mirar mayúsculas ni acentos); por producto, el más reciente por fecha
          const docs = snap.docs.map(d=>({ id:d.id, ...d.data() }));
          setPrecios(p5UltimosPrecios(p5PreciosPorCliente(docs).get(SersaleBase.norm(cliente))));
        } catch(e){
          console.error(e);
          if(turno !== cargaRef.current) return;
          setErrorPrecios(true);
          SersaleUI.toast("No se pudieron cargar los precios. Revisá la conexión.", { tipo: "error" });
        }
        setCargando(false);
      }

      function onSelectCliente(nombre) {
        setClienteSel(nombre);
        if(nombre) cargarPrecios(nombre);
        else { cargaRef.current++; setPrecios([]); setCargando(false); setErrorPrecios(false); }
      }

      function abrirPrecio(nombreProd) {
        const actual = precios.find(p=>p.producto===nombreProd) || null;
        setEditando(actual); setFormProd(nombreProd);
        setFormPrecio(actual && p5Precio(actual.precio)>0 ? String(p5Precio(actual.precio)) : "");
        setModalOpen(true);
      }

      const [guardar, guardando] = SersaleBase.useAccion(async () => {
        const producto = formProd.trim();
        const precio = SersaleBase.redondear(parseFloat(formPrecio), 2);
        if(!producto) { SersaleUI.toast("Seleccioná un producto", { tipo: "error" }); return; }
        if(!(precio>0)) { SersaleUI.toast("Ingresá un precio válido", { tipo: "error" }); return; }
        try {
          const {db,collection,addDoc,doc,updateDoc,getDocs,query,where} = fb();
          const fecha = new Date().toISOString();
          // Se corrige el precio vigente del producto ELEGIDO. Si en la ventana se cambió
          // de producto, el precio del producto con el que se abrió no se toca.
          const vigente = editando && editando.producto===producto ? editando : precios.find(p=>p.producto===producto);
          let escritura;
          if(vigente) {
            escritura = updateDoc(doc(db,"precios_cliente",vigente.id),{ producto, precio, fecha });
          } else {
            // Upsert: si ya existe ese producto para este cliente, actualizar; sino crear
            const snapEx = await getDocs(query(
              collection(db,"precios_cliente"),
              where("cliente","==",clienteSel),
              where("producto","==",producto)
            ));
            escritura = !snapEx.empty
              ? updateDoc(doc(db,"precios_cliente",snapEx.docs[0].id),{ precio, fecha })
              : addDoc(collection(db,"precios_cliente"),{ cliente:clienteSel, producto, precio, fecha });
          }
          const confirmado = await p5EsperarEscritura(escritura);
          setModalOpen(false);
          if(confirmado) SersaleUI.toast("Precio guardado: "+producto+" "+fmt$(precio), { tipo: "ok" });
          else SersaleUI.toast("Sin señal: el precio quedó guardado en este teléfono y se envía solo cuando vuelva la conexión.", { tipo: "info", ms: 6000 });
          cargarPrecios(clienteSel, { silencioso: true });
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo guardar el precio. Probá de nuevo.", { tipo: "error" });
        }
      });
      // Mientras se guarda no se cierra la ventana
      const cerrarModal = () => { if(!guardando) setModalOpen(false); };

      async function eliminar(id) {
        const ok = await SersaleUI.confirmar({ titulo: "¿Eliminar este precio?", aceptar: "Eliminar", peligro: true });
        if(!ok) return;
        try {
          const {db,doc,deleteDoc} = fb();
          await p5EsperarEscritura(deleteDoc(doc(db,"precios_cliente",id)));
          cargarPrecios(clienteSel, { silencioso: true });
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo eliminar el precio. Probá de nuevo.", { tipo: "error" });
        }
      }

      function compartirWA() {
        if(!clienteSel) return;
        if(precios.length===0) {
          SersaleUI.toast(cargando ? "Esperá a que carguen los precios" : "Este cliente no tiene precios cargados", { tipo: "info" });
          return;
        }
        const nl="\n";
        let msg="*Lista de Precios — "+clienteSel+"*"+nl;
        msg+="Frigorífico Sersale"+nl+nl;
        precios.forEach(p=>{
          msg+="• "+p.producto+": *"+fmt$(p.precio)+"*"+nl;
        });
        msg+=nl+"_Precios sujetos a cambio sin previo aviso_"+nl;
        msg+="_Frigorífico Sersale · (011) 6763-7860_";
        // El texto va codificado: un "&" o un "#" en el nombre cortaban el mensaje
        window.open(SersaleBase.waLink(msg),"_blank");
      }

      const fmt$ = n => SersaleBase.fmtMonto(Math.round(p5Precio(n)));

      // Una fila de la lista: producto, fecha de actualización y precio vigente
      const filaPrecio = nombreProd => {
        const precioObj = precios.find(p=>p.producto===nombreProd);
        const tienePrecio = !!precioObj;
        const actualizado = precioObj ? SersaleBase.fmtFecha(precioObj.fecha) : "";
        return (
          <div key={nombreProd}
            onClick={()=>abrirPrecio(nombreProd)}
            style={{background:"#fff",borderRadius:10,borderLeft:`4px solid ${tienePrecio?"#A4232A":"#D8DCE0"}`,border:`1px solid #EDEEF0`,borderLeftWidth:4,borderLeftColor:tienePrecio?"#A4232A":"#D8DCE0",padding:"10px 12px",marginBottom:5,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:13,color:tienePrecio?"#111":"#A3ABB3"}}>{nombreProd}</div>
              {actualizado&&<div style={{fontSize:10,color:"#B9BFC5",marginTop:1}}>Act: {actualizado}</div>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              {tienePrecio
                ? <div style={{fontWeight:900,fontSize:15,color:"#A4232A"}}>{fmt$(precioObj.precio)}</div>
                : <div style={{fontSize:11,color:"#B9BFC5",fontStyle:"italic"}}>Sin precio</div>
              }
              <div style={{color:"#D8DCE0",fontSize:14}}>›</div>
            </div>
          </div>
        );
      };
      // Precios guardados de productos que ya no están en el catálogo (también salen en el WhatsApp y en el PDF)
      const fueraCatalogo = precios.filter(p=>!enCatalogo.has(p.producto)).map(p=>p.producto);

      if (modoExportar) return <ReportePreciosClientes onBack={()=>setModoExportar(false)} />;

      return (
        <div>
          {/* Botón Exportar PDF */}
          <button onClick={()=>setModoExportar(true)}
            style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #6B4E8E",background:"#fff",color:"#6B4E8E",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            📄 Exportar PDF de precios por cliente
          </button>

          {/* Selector de cliente */}
          <div style={{marginBottom:14}}>
            <label style={{display:"block",fontWeight:700,fontSize:12,color:"#3A424A",marginBottom:6}}>Cliente</label>
            <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff"}}
              aria-label="Cliente" value={clienteSel} onChange={e=>onSelectCliente(e.target.value)}>
              <option value="">— Seleccioná un cliente —</option>
              {todosClientes.map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Sin cliente seleccionado */}
          {!clienteSel && (
            <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
              <div style={{fontSize:48}}>💲</div>
              <p style={{marginTop:8}}>Seleccioná un cliente para ver sus precios</p>
            </div>
          )}

          {/* Con cliente seleccionado */}
          {clienteSel && (
            <>
              {/* Acciones */}
              <div style={{display:"flex",gap:8,marginBottom:14}}>
                <button onClick={compartirWA}
                  style={{flex:1,padding:"10px 0",borderRadius:10,border:"none",background:"#25D366",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                  📲 Compartir por WA
                </button>
              </div>

              {/* KPI */}
              <div style={{background:"#fff",borderLeft:"4px solid #A4232A",borderTop:"1px solid #EDEEF0",borderRight:"1px solid #EDEEF0",borderBottom:"1px solid #EDEEF0",borderRadius:12,padding:"10px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:"0 2px 8px rgba(0,0,0,0.05)"}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14,color:"#111"}}>{clienteSel}</div>
                  <div style={{fontSize:12,color:"#79828B",marginTop:2}}>{precios.length-fueraCatalogo.length} de {enCatalogo.size} productos con precio acordado{fueraCatalogo.length>0?" · "+fueraCatalogo.length+" fuera del catálogo":""}</div>
                </div>
                <div style={{fontSize:11,color:"#79828B"}}>Tocá un precio para editarlo</div>
              </div>

              {/* Lista TODOS los productos agrupados por categoría */}
              {cargando ? (
                <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
              ) : errorPrecios ? (
                <div style={{textAlign:"center",color:"#79828B",marginTop:40}}>
                  <p>No se pudieron cargar los precios de este cliente.</p>
                  <button onClick={()=>cargarPrecios(clienteSel)} style={{marginTop:12,padding:"12px 20px",borderRadius:10,border:"1.5px solid #A4232A",background:"#fff",color:"#A4232A",fontWeight:700,fontSize:14,cursor:"pointer"}}>Reintentar</button>
                </div>
              ) : (
                <>
                {Object.entries(catalogo).sort((a,b)=>a[0].localeCompare(b[0],"es")).map(([cat, prods])=>{
                  const prodsValidos = (prods||[]).filter(p=>p);
                  if(!prodsValidos.length) return null;
                  return (
                    <div key={cat} style={{marginBottom:14}}>
                      {/* Header categoría */}
                      <div style={{background:"#EDEEF0",borderRadius:8,padding:"6px 12px",marginBottom:6,fontSize:11,fontWeight:800,color:"#5C666F",textTransform:"uppercase",letterSpacing:"0.5px"}}>
                        {cat}
                      </div>
                      {prodsValidos.map(filaPrecio)}
                    </div>
                  );
                })}
                {fueraCatalogo.length>0 && (
                  <div style={{marginBottom:14}}>
                    <div style={{background:"#EDEEF0",borderRadius:8,padding:"6px 12px",marginBottom:6,fontSize:11,fontWeight:800,color:"#5C666F",textTransform:"uppercase",letterSpacing:"0.5px"}}>
                      Fuera del catálogo
                    </div>
                    {fueraCatalogo.map(filaPrecio)}
                  </div>
                )}
                </>
              )}
            </>
          )}

          {/* Modal agregar/editar */}
          {modalOpen&&(
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)cerrarModal();}}>
              <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                  <span style={{fontWeight:800,fontSize:16}}>{editando?"Editar precio":"Nuevo precio"}</span>
                  <button onClick={cerrarModal} aria-label="Cerrar" style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
                </div>
                <div style={{background:"#F7EAEA",borderRadius:10,padding:"8px 14px",marginBottom:16,fontSize:13,color:"#7E1A20",fontWeight:700}}>
                  Cliente: {clienteSel}
                </div>
                <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Producto *</label>
                <select
                  style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,marginBottom:14,background:"#fff",fontFamily:"inherit"}}
                  aria-label="Producto"
                  value={formProd}
                  onChange={e=>{ const v=e.target.value; setFormProd(v); setEditando(precios.find(p=>p.producto===v)||null); }}>
                  <option value="">— Seleccioná un producto —</option>
                  {formProd && !enCatalogo.has(formProd) && <option value={formProd}>{formProd}</option>}
                  {Object.entries(catalogo).map(([cat,prods])=>
                    (prods||[]).filter(p=>p).length>0 && (
                      <optgroup key={cat} label={cat}>
                        {prods.filter(p=>p).map(p=><option key={p} value={p}>{p}</option>)}
                      </optgroup>
                    )
                  )}
                </select>
                <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Precio ($) *</label>
                <div style={{display:"flex",alignItems:"center",border:"1.5px solid #D8DCE0",borderRadius:12,overflow:"hidden",marginBottom:20}}>
                  <span style={{padding:"0 14px",fontSize:16,color:"#A3ABB3",fontWeight:700}}>$</span>
                  <InputMonto style={{flex:1,padding:"12px 8px",border:"none",fontSize:18,fontWeight:700,outline:"none"}}
                    aria-label="Precio" placeholder="0" value={formPrecio}
                    onChange={v=>setFormPrecio(v)} />
                </div>
                <button onClick={guardar} disabled={guardando}
                  style={{width:"100%",padding:16,borderRadius:12,border:"none",background:guardando?"#B9BFC5":"#A4232A",color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer",boxShadow:"0 4px 14px rgba(192,57,43,0.4)"}}>
                  {guardando?"Guardando...":editando?"Guardar cambios":"Agregar precio"}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

        // ── CUENTAS CORRIENTES ──────────────────────────────────

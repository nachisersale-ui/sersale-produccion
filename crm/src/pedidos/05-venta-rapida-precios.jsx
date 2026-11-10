    // ── MODAL VENTA RAPIDA ──────────────────────────────────
    function ModalVentaRapida({ clienteInicial, clientes, onClose, onGuardado }) {
      const [cliente, setCliente] = useState(clienteInicial||"");
      const [items, setItems] = useState([{producto:"",cantidad:"",unidad:"kg",precio:""}]);
      const [obs, setObs] = useState("");
      const [guardando, setGuardando] = useState(false);
      const [clientesLista, setClientesLista] = useState(clientes||[]);

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

      const addItem = () => setItems([...items,{producto:"",cantidad:"",unidad:"kg",precio:""}]);
      const updItem = (i,f,v) => { const a=[...items]; a[i][f]=v; setItems(a); };
      const remItem = i => items.length>1 && setItems(items.filter((_,idx)=>idx!==i));

      const total = items.reduce((s,it)=>{
        const kg = parseFloat(it.cantidad)||0;
        const p  = parseFloat(it.precio)||0;
        return s + (kg&&p ? kg*p : 0);
      },0);

      const fmt$ = n => "$"+Math.round(n).toLocaleString("es-AR");

      async function guardar() {
        if(!cliente) return alert("Seleccioná el cliente");
        const itemsValidos = items.filter(it=>it.producto.trim()&&parseFloat(it.cantidad)>0);
        if(!itemsValidos.length) return alert("Agregá al menos un producto con cantidad");
        if(total<=0) return alert("Ingresá los precios para calcular el total");
        setGuardando(true);
        try {
          const {db,collection,addDoc,getDocs,query,where,doc,updateDoc} = fb();
          const detalle = itemsValidos.map(it=>`${it.producto} ${it.cantidad}${it.unidad}`).join(", ");
          const montoFinal = Math.round(total);
          const hoy = new Date().toISOString().split("T")[0];
          // Registrar pedido en coleccion pedidos (para alertas y sugerencias)
          try {
            var tsNow = null;
            try { const ff=fb(); if(ff.Timestamp) tsNow=ff.Timestamp.now(); } catch(e2){}
            await addDoc(collection(db,"pedidos"),{
              cliente, tipo:"retiro",
              fechaPedido: tsNow || new Date(),
              fechaPedidoISO: new Date().toISOString(),
              fechaEntrega: hoy,
              items: itemsValidos.map(it=>({
                producto:it.producto.trim(),
                cantidad:parseFloat(it.cantidad),
                unidad:it.unidad,
                precio:parseFloat(it.precio)||0,
                kgReal:parseFloat(it.cantidad)
              })),
              obs: obs.trim() ? "VR: "+obs.trim() : "Venta rapida",
              estado: "despachado",
              origen: "venta_rapida",
              cuentaCorriente: true,
              historial: [{estado:"despachado", fecha:new Date().toISOString(), nota:"Venta rapida"}]
            });
          } catch(e){ console.error("Error creando pedido VR:",e); }
          // Registrar movimiento en CC
          await addDoc(collection(db,"cc_movimientos"),{
            cliente, tipo:"pedido",
            monto:montoFinal, movimiento:montoFinal,
            fecha:hoy, detalle, obs:obs.trim(),
            origen:"venta_rapida",
            items: itemsValidos.map(it=>({
              producto:it.producto.trim(),
              cantidad:parseFloat(it.cantidad),
              unidad:it.unidad,
              precio:parseFloat(it.precio)||0
            })),
            createdAt:new Date().toISOString()
          });
          // Actualizar saldo CC
          const snapMovs = await getDocs(query(collection(db,"cc_movimientos"),where("cliente","==",cliente)));
          let saldo=0;
          snapMovs.docs.forEach(d=>{ const m=d.data(); saldo+=m.tipo==="pedido"?m.monto:-m.monto; });
          const snapCC = await getDocs(query(collection(db,"cuentas_corrientes"),where("nombre","==",cliente)));
          if(!snapCC.empty) await updateDoc(doc(db,"cuentas_corrientes",snapCC.docs[0].id),{
            saldo:Math.round(saldo), ultimoMovimiento:hoy
          });
          // Mark client as contacted
          marcarContacto(cliente);
          onGuardado && onGuardado();
          onClose();
        } catch(e){ alert("Error al guardar: "+e.message); console.error(e); }
        setGuardando(false);
      }

      return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
          onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
          <div style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:480,maxHeight:"92vh",overflowY:"auto"}}>
            {/* Header */}
            <div style={{background:"#A4232A",padding:"18px 20px",borderRadius:"20px 20px 0 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:800,fontSize:16,color:"#fff"}}>Venta rapida</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.75)",marginTop:2}}>Registrar en cuenta corriente</div>
              </div>
              <button onClick={onClose} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:20,width:32,height:32,cursor:"pointer",fontSize:18,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>

            <div style={{padding:"16px 20px 32px"}}>
              {/* Selector de cliente (solo si no viene preseleccionado) */}
              {!clienteInicial && (
                <>
                  <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Cliente *</label>
                  <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:14}}
                    value={cliente} onChange={e=>setCliente(e.target.value)}>
                    <option value="">— Seleccioná un cliente —</option>
                    {(clientesLista||[]).sort().map(n=><option key={n} value={n}>{n}</option>)}
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
                      <button onClick={()=>remItem(i)} style={{width:32,border:"none",borderRadius:9,background:"#F7EAEA",color:"#A4232A",fontSize:16,cursor:"pointer",flexShrink:0}}>×</button>
                    )}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 80px 1fr",gap:6}}>
                    <input type="number" style={{padding:"9px 10px",borderRadius:9,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff"}}
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
      const [generando, setGenerando] = useState(false);

      useEffect(()=>{
        (async()=>{
          try {
            const {db,collection,getDocs,query,orderBy} = fb();
            const snap = await getDocs(query(collection(db,"clientes"),orderBy("nombre","asc")));
            const nombres = snap.docs.map(d=>d.data().nombre).filter(Boolean);
            // Solo clientes que tengan al menos 1 precio cargado
            const snapPrecios = await getDocs(collection(db,"precios_cliente"));
            const conPrecios = new Set();
            snapPrecios.docs.forEach(d=>{ const c=d.data().cliente; if(c) conPrecios.add(c); });
            const final = nombres.filter(n=>conPrecios.has(n)).sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
            setClientesLista(final);
          } catch(e){ console.error(e); setClientesLista([]); }
        })();
      },[]);

      function toggleCliente(nombre) {
        const s = new Set(seleccionados);
        if(s.has(nombre)) s.delete(nombre); else s.add(nombre);
        setSeleccionados(s);
      }
      function seleccionarTodos() {
        const q = busqueda.toLowerCase().trim();
        const visibles = (clientesLista||[]).filter(c=>!q || c.toLowerCase().includes(q));
        setSeleccionados(new Set(visibles));
      }
      function deseleccionarTodos() { setSeleccionados(new Set()); }

      async function generarPDF() {
        if(seleccionados.size===0) return alert("Seleccioná al menos un cliente");
        setGenerando(true);
        try {
          const {db,collection,getDocs,query,where} = fb();
          // Cargar precios de cada cliente seleccionado (en paralelo)
          const arrClientes = Array.from(seleccionados).sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
          const dataClientes = [];
          for(const nombre of arrClientes) {
            const snap = await getDocs(query(collection(db,"precios_cliente"),where("cliente","==",nombre)));
            // Deduplicar por producto: si hay varios, quedarse con el más reciente por fecha
            const mapProd = new Map();
            snap.docs.forEach(d=>{
              const data = d.data();
              if(!data.producto) return;
              const exist = mapProd.get(data.producto);
              if(!exist || (data.fecha||"") > (exist.fecha||"")) {
                mapProd.set(data.producto, data);
              }
            });
            const precios = Array.from(mapProd.values()).sort((a,b)=>a.producto.localeCompare(b.producto,"es"));
            dataClientes.push({ cliente:nombre, precios });
          }
          armarPDF(dataClientes);
        } catch(e){ alert("Error al generar PDF"); console.error(e); }
        setGenerando(false);
      }

      function armarPDF(dataClientes) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit:'mm', format:'a4' });
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const margin = 14;
        const pw = W - margin*2;
        const fmt$ = n => "$"+Math.round(n).toLocaleString("es-AR");
        const hoyStr = new Date().toLocaleDateString("es-AR");
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
          doc.setFontSize(13); doc.setTextColor(255); doc.setFont(undefined,'bold');
          doc.text(d.cliente, margin+4, y2+8);
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
              if(y2 > H-12) { doc.addPage(); y2 = 16; y2 = dibujarHeader(y2); }
              doc.setFontSize(9.5); doc.setFont(undefined,'normal');
              doc.text(p.producto, margin+3, y2+4);
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

      const q = busqueda.toLowerCase().trim();
      const visibles = (clientesLista||[]).filter(c=>!q || c.toLowerCase().includes(q));

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
              : visibles.length===0
                ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><div style={{fontSize:48}}>🔍</div><p>Sin clientes con precios cargados</p></div>
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
      const [guardando, setGuardando] = useState(false);
      // Usar PRODUCTOS global (mismo que en pedidos) — lista plana ordenada por categoría
      const PRODUCTOS_CAT = Object.entries(PRODUCTOS).sort((a,b)=>a[0].localeCompare(b[0],"es")).flatMap(([cat,prods])=>prods.filter(p=>p));

      // Cargar lista completa de clientes de Firebase
      useEffect(()=>{
        (async()=>{
          try {
            const {db,collection,getDocs,query,orderBy} = fb();
            const snap = await getDocs(query(collection(db,"clientes"),orderBy("nombre","asc")));
            setTodosClientes(snap.docs.map(d=>d.data().nombre).filter(Boolean));
          } catch(e){ console.error(e); }
        })();
      },[]);

      async function cargarPrecios(cliente) {
        setCargando(true); setPrecios([]);
        try {
          const {db,collection,getDocs,query,where} = fb();
          const snap = await getDocs(query(collection(db,"precios_cliente"),where("cliente","==",cliente)));
          // Deduplicar por producto: si hay varios docs, quedarse con el más reciente por fecha
          const mapProd = new Map();
          snap.docs.forEach(d=>{
            const data = { id:d.id, ...d.data() };
            if(!data.producto) return;
            const exist = mapProd.get(data.producto);
            if(!exist || (data.fecha||"") > (exist.fecha||"")) {
              mapProd.set(data.producto, data);
            }
          });
          const ps = Array.from(mapProd.values()).sort((a,b)=>a.producto.localeCompare(b.producto));
          setPrecios(ps);
        } catch(e){ console.error(e); }
        setCargando(false);
      }

      function onSelectCliente(nombre) {
        setClienteSel(nombre);
        if(nombre) cargarPrecios(nombre);
        else setPrecios([]);
      }

      function abrirNuevo() {
        setEditando(null); setFormProd(""); setFormPrecio(""); setModalOpen(true);
      }
      function abrirEditar(p) {
        setEditando(p); setFormProd(p.producto); setFormPrecio(String(p.precio)); setModalOpen(true);
      }

      async function guardar() {
        if(!formProd.trim()) return alert("Seleccioná un producto");
        if(!formPrecio||isNaN(+formPrecio)||+formPrecio<=0) return alert("Ingresá un precio válido");
        setGuardando(true);
        try {
          const {db,collection,addDoc,doc,updateDoc,getDocs,query,where} = fb();
          if(editando) {
            // Editar existente
            await updateDoc(doc(db,"precios_cliente",editando.id),{
              producto:formProd.trim(), precio:+formPrecio,
              fecha:new Date().toISOString()
            });
          } else {
            // Upsert: si ya existe ese producto para este cliente, actualizar; sino crear
            const snapEx = await getDocs(query(
              collection(db,"precios_cliente"),
              where("cliente","==",clienteSel),
              where("producto","==",formProd.trim())
            ));
            if(!snapEx.empty) {
              // Actualizar el más reciente
              await updateDoc(doc(db,"precios_cliente",snapEx.docs[0].id),{
                precio:+formPrecio, fecha:new Date().toISOString()
              });
            } else {
              await addDoc(collection(db,"precios_cliente"),{
                cliente:clienteSel, producto:formProd.trim(),
                precio:+formPrecio, fecha:new Date().toISOString()
              });
            }
          }
          setModalOpen(false);
          cargarPrecios(clienteSel);
        } catch(e){ alert("Error al guardar"); console.error(e); }
        setGuardando(false);
      }

      async function eliminar(id) {
        if(!confirm("¿Eliminar este precio?")) return;
        try {
          const {db,doc,deleteDoc} = fb();
          await deleteDoc(doc(db,"precios_cliente",id));
          cargarPrecios(clienteSel);
        } catch(e){ alert("Error"); }
      }

      function compartirWA() {
        if(!clienteSel||precios.length===0) return;
        const nl="%0A";
        let msg="*Lista de Precios — "+clienteSel+"*"+nl;
        msg+="Frigorífico Sersale"+nl+nl;
        precios.forEach(p=>{
          msg+="• "+p.producto+": *$"+Math.round(p.precio).toLocaleString("es-AR")+"*"+nl;
        });
        msg+=nl+"_Precios sujetos a cambio sin previo aviso_"+nl;
        msg+="_Frigorífico Sersale · (011) 6763-7860_";
        window.open("https://wa.me/?text="+msg,"_blank");
      }

      const fmt$ = n => "$"+Math.round(n).toLocaleString("es-AR");

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
              value={clienteSel} onChange={e=>onSelectCliente(e.target.value)}>
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
                  <div style={{fontSize:12,color:"#79828B",marginTop:2}}>{precios.length} de {Object.values(PRODUCTOS).flat().filter(p=>p).length} productos con precio acordado</div>
                </div>
                <div style={{fontSize:11,color:"#79828B"}}>Tocá un precio para editarlo</div>
              </div>

              {/* Lista TODOS los productos agrupados por categoría */}
              {cargando ? (
                <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
              ) : (
                Object.entries(PRODUCTOS).sort((a,b)=>a[0].localeCompare(b[0],"es")).map(([cat, prods])=>{
                  const prodsValidos = prods.filter(p=>p);
                  if(!prodsValidos.length) return null;
                  return (
                    <div key={cat} style={{marginBottom:14}}>
                      {/* Header categoría */}
                      <div style={{background:"#EDEEF0",borderRadius:8,padding:"6px 12px",marginBottom:6,fontSize:11,fontWeight:800,color:"#5C666F",textTransform:"uppercase",letterSpacing:"0.5px"}}>
                        {cat}
                      </div>
                      {prodsValidos.map(nombreProd=>{
                        const precioObj = precios.find(p=>p.producto===nombreProd);
                        const tienePrecio = !!precioObj;
                        return (
                          <div key={nombreProd}
                            onClick={()=>{ setEditando(precioObj||null); setFormProd(nombreProd); setFormPrecio(precioObj?String(precioObj.precio):""); setModalOpen(true); }}
                            style={{background:"#fff",borderRadius:10,borderLeft:`4px solid ${tienePrecio?"#A4232A":"#D8DCE0"}`,border:`1px solid #EDEEF0`,borderLeftWidth:4,borderLeftColor:tienePrecio?"#A4232A":"#D8DCE0",padding:"10px 12px",marginBottom:5,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontWeight:600,fontSize:13,color:tienePrecio?"#111":"#A3ABB3"}}>{nombreProd}</div>
                              {precioObj?.fecha&&<div style={{fontSize:10,color:"#B9BFC5",marginTop:1}}>Act: {precioObj.fecha.substring(0,10).split("-").reverse().join("/")}</div>}
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
                      })}
                    </div>
                  );
                })
              )}
            </>
          )}

          {/* Modal agregar/editar */}
          {modalOpen&&(
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setModalOpen(false);}}>
              <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                  <span style={{fontWeight:800,fontSize:16}}>{editando?"Editar precio":"Nuevo precio"}</span>
                  <button onClick={()=>setModalOpen(false)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
                </div>
                <div style={{background:"#F7EAEA",borderRadius:10,padding:"8px 14px",marginBottom:16,fontSize:13,color:"#7E1A20",fontWeight:700}}>
                  Cliente: {clienteSel}
                </div>
                <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Producto *</label>
                <select
                  style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,marginBottom:14,background:"#fff",fontFamily:"inherit"}}
                  value={formProd}
                  onChange={e=>setFormProd(e.target.value)}>
                  <option value="">— Seleccioná un producto —</option>
                  {Object.entries(PRODUCTOS).map(([cat,prods])=>
                    prods.filter(p=>p).length>0 && (
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
                    placeholder="0" value={formPrecio}
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

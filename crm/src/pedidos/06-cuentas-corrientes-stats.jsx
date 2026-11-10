    function TabCuentasCorrientes({ refresh }) {
      const [clientes, setClientes] = useState(null);
      const [clienteAbierto, setClienteAbierto] = useState(null);
      const [modalPago, setModalPago] = useState(null);
      const [pagoForm, setPagoForm] = useState({monto:"",formaPago:"transferencia",obs:""});
      const [guardandoPago, setGuardandoPago] = useState(false);
      const [modalNuevo, setModalNuevo] = useState(false);
      const [nuevoNombre, setNuevoNombre] = useState("");
      const [clientesDisponibles, setClientesDisponibles] = useState([]);

      async function cargarClientesDisponibles() {
        try {
          const {db,collection,getDocs,query,orderBy} = fb();
          // Todos los clientes registrados
          const snapCli = await getDocs(query(collection(db,"clientes"),orderBy("nombre","asc")));
          const todos = snapCli.docs.map(d=>d.data().nombre).filter(Boolean);
          // Quitar los que ya tienen CC
          const snapCC = await getDocs(collection(db,"cuentas_corrientes"));
          const yaCC = new Set(snapCC.docs.map(d=>d.data().nombre));
          setClientesDisponibles(todos.filter(n=>!yaCC.has(n)));
        } catch(e){ console.error(e); }
      }

      async function cargar() {
        try {
          const {db,collection,getDocs,query,orderBy} = fb();
          const snap = await getDocs(query(collection(db,"cuentas_corrientes"),orderBy("nombre","asc")));
          setClientes(snap.docs.map(d=>({id:d.id,...d.data()})));
        } catch(e){ console.error(e); setClientes([]); }
      }

      useEffect(()=>{
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
      },[]);

      // Refresco externo: una venta rápida cargada desde otra pestaña movió el saldo.
      // El ref evita una segunda lectura al montar cuando refresh ya venía en >0.
      const refrescoVisto = React.useRef(refresh);
      useEffect(()=>{
        if(refresh !== refrescoVisto.current) { refrescoVisto.current = refresh; cargar(); }
      },[refresh]);

      async function registrarPago() {
        const monto = parseFloat(pagoForm.monto);
        if(!monto||monto<=0) return alert("Ingresá un monto válido");
        setGuardandoPago(true);
        try {
          const {db,collection,addDoc,doc,updateDoc,getDocs,query,where} = fb();
          // 1. Registrar movimiento
          await addDoc(collection(db,"cc_movimientos"),{
            cliente:modalPago, tipo:"pago",
            formaPago:pagoForm.formaPago,
            monto, movimiento:-monto,
            obs:pagoForm.obs.trim(),
            fecha:new Date().toISOString().split("T")[0],
            detalle:"Pago — "+pagoForm.formaPago,
            createdAt:new Date().toISOString()
          });
          // 2. Recalcular saldo desde todos los movimientos (sin orderBy para evitar índice)
          const snap = await getDocs(query(collection(db,"cc_movimientos"),where("cliente","==",modalPago)));
          let saldo=0;
          snap.docs.forEach(d=>{ const m=d.data(); saldo += m.tipo==="pedido"?m.monto:-m.monto; });
          // 3. Actualizar saldo en cuenta corriente
          const cSnap = await getDocs(query(collection(db,"cuentas_corrientes"),where("nombre","==",modalPago)));
          if(!cSnap.empty) await updateDoc(doc(db,"cuentas_corrientes",cSnap.docs[0].id),{saldo:Math.round(saldo),ultimoMovimiento:new Date().toISOString().split("T")[0]});
          setModalPago(null);
          setPagoForm({monto:"",formaPago:"transferencia",obs:""});
          cargar();
          // Force detail to re-render by briefly closing and reopening
          if(clienteAbierto===modalPago) {
            const cli = clienteAbierto;
            setClienteAbierto(null);
            setTimeout(()=>setClienteAbierto(cli), 50);
          }
        } catch(e){ alert("Error al guardar: "+e.message); console.error(e); }
        setGuardandoPago(false);
      }

      async function crearCliente() {
        if(!nuevoNombre.trim()) return alert("Ingresá el nombre");
        try {
          const {db,collection,addDoc,Timestamp} = fb();
          await addDoc(collection(db,"cuentas_corrientes"),{
            nombre:nuevoNombre.trim(),saldo:0,
            creadoEn:new Date().toISOString(),ultimoMovimiento:new Date().toISOString().split("T")[0]
          });
          setNuevoNombre(""); setModalNuevo(false); cargar();
        } catch(e){ alert("Error"); }
      }

      const fmt$ = n => "$"+Math.round(Math.abs(n)).toLocaleString("es-AR");

      if(clienteAbierto) return <DetalleCuentaCorriente
        cliente={clienteAbierto}
        onBack={()=>{setClienteAbierto(null); cargar();}}
        onPago={()=>setModalPago(clienteAbierto)}
        onRefreshParent={cargar}
        refresh={refresh}
      />;

      const totalDeuda = (clientes||[]).filter(c=>c.saldo>0).reduce((s,c)=>s+c.saldo,0);
      const enDeuda = (clientes||[]).filter(c=>c.saldo>0).length;

      return (
        <div>
          {/* Resumen total */}
          {clientes && clientes.length>0 && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <div style={{background:"#fff",borderLeft:"4px solid #A4232A",borderTop:"1px solid #EDEEF0",borderRight:"1px solid #EDEEF0",borderBottom:"1px solid #EDEEF0",borderRadius:14,padding:"14px 12px",textAlign:"center",boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:13,fontWeight:800,color:"#A4232A"}}>{fmt$(totalDeuda)}</div>
                <div style={{fontSize:11,color:"#79828B",marginTop:2}}>Deuda total</div>
              </div>
              <div style={{background:"#fff",borderLeft:"4px solid #2A333B",borderTop:"1px solid #EDEEF0",borderRight:"1px solid #EDEEF0",borderBottom:"1px solid #EDEEF0",borderRadius:14,padding:"14px 12px",textAlign:"center",boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:22,fontWeight:800,color:"#2A333B"}}>{enDeuda}</div>
                <div style={{fontSize:11,color:"#79828B",marginTop:2}}>Con saldo</div>
              </div>
            </div>
          )}

          {/* Header + botón nuevo */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontWeight:700,fontSize:12,color:"#79828B",textTransform:"uppercase",letterSpacing:1}}>Cuentas Corrientes</span>
            <button onClick={()=>{setModalNuevo(true);cargarClientesDisponibles();}}
              style={{padding:"7px 14px",borderRadius:20,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
              + Nueva
            </button>
          </div>

          {/* Lista */}
          {clientes===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
          : clientes.length===0 ? (
            <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
              <div style={{fontSize:48}}>💳</div>
              <p style={{marginBottom:16}}>Sin cuentas corrientes</p>
              <button onClick={()=>setModalNuevo(true)} style={{padding:"12px 24px",borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,cursor:"pointer"}}>+ Crear primera</button>
            </div>
          ) : clientes.map(cl=>{
            const deuda = cl.saldo>0;
            const color = deuda?"#A4232A":cl.saldo===0?"#2F6B4F":"#26536E";
            return (
              <div key={cl.id} style={{background:"#fff",borderRadius:14,borderLeft:`4px solid ${color}`,borderTop:"1px solid #EDEEF0",borderRight:"1px solid #EDEEF0",borderBottom:"1px solid #EDEEF0",padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:15,color:"#111",marginBottom:2}}>{cl.nombre}</div>
                    <div style={{fontSize:11,color:"#79828B"}}>
                      {deuda?"⚠️ Saldo pendiente":"✅ Al día"}
                      {cl.ultimoMovimiento&&` · Último: ${cl.ultimoMovimiento.split("-").reverse().join("/")}`}
                    </div>
                  </div>
                  <div style={{fontWeight:900,fontSize:18,color}}>{fmt$(cl.saldo)}</div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setClienteAbierto(cl.nombre)}
                    style={{flex:1,padding:"9px 0",borderRadius:10,border:"1.5px solid #D8DCE0",background:"#fff",color:"#262C32",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    📋 Ver movimientos
                  </button>
                  <button onClick={()=>{setModalPago(cl.nombre);setPagoForm({monto:"",formaPago:"transferencia",obs:""}); }}
                    style={{flex:1,padding:"9px 0",borderRadius:10,border:"none",background:"#2F6B4F",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    💰 Registrar pago
                  </button>
                </div>
              </div>
            );
          })}

          {/* Modal nuevo cliente */}
          {modalNuevo&&(
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setModalNuevo(false);}}>
              <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <span style={{fontWeight:800,fontSize:16}}>+ Nueva cuenta corriente</span>
                  <button onClick={()=>setModalNuevo(false)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
                </div>
                {clientesDisponibles.length===0
                  ? <p style={{textAlign:"center",color:"#79828B",marginBottom:16,fontSize:13}}>Todos los clientes ya tienen cuenta corriente</p>
                  : <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:12}}
                      value={nuevoNombre} onChange={e=>setNuevoNombre(e.target.value)}>
                      <option value="">— Seleccioná un cliente —</option>
                      {clientesDisponibles.map(n=><option key={n} value={n}>{n}</option>)}
                    </select>
                }
                <button onClick={crearCliente}
                  style={{width:"100%",padding:14,borderRadius:12,border:"none",background:"#A4232A",color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer"}}>
                  Crear cuenta
                </button>
              </div>
            </div>
          )}

          {/* Modal pago */}
          {modalPago&&(
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setModalPago(null);}}>
              <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:480}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <span style={{fontWeight:800,fontSize:16}}>Registrar pago</span>
                  <button onClick={()=>setModalPago(null)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
                </div>
                <p style={{fontSize:13,color:"#79828B",marginBottom:16}}>{modalPago}</p>
                <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Monto *</label>
                <div style={{display:"flex",alignItems:"center",border:"1.5px solid #D8DCE0",borderRadius:12,overflow:"hidden",marginBottom:12}}>
                  <span style={{padding:"0 12px",fontSize:16,color:"#79828B"}}>$</span>
                  <InputMonto style={{flex:1,padding:"12px 8px",border:"none",fontSize:18,fontWeight:700,outline:"none"}}
                    placeholder="0" value={pagoForm.monto} onChange={v=>setPagoForm({...pagoForm,monto:v})} />
                </div>
                <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Forma de pago</label>
                <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",marginBottom:12}}
                  value={pagoForm.formaPago} onChange={e=>setPagoForm({...pagoForm,formaPago:e.target.value})}>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="cheque">Cheque</option>
                  <option value="otro">Otro</option>
                </select>
                <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Observaciones</label>
                <input style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,marginBottom:16}}
                  placeholder="Referencia, número de transferencia..." value={pagoForm.obs} onChange={e=>setPagoForm({...pagoForm,obs:e.target.value})} />
                <button onClick={registrarPago} disabled={guardandoPago}
                  style={{width:"100%",padding:16,borderRadius:12,border:"none",background:guardandoPago?"#B9BFC5":"#2F6B4F",color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer"}}>
                  {guardandoPago?"Guardando...":"✓ Confirmar pago"}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── DETALLE CUENTA CORRIENTE ─────────────────────────────
    // ── MODAL PDF CUENTA CORRIENTE ────────────────────────────────
    function ModalPdfCC({ cliente, movimientos, saldo, onClose }) {
      const hoy = new Date().toISOString().split("T")[0];
      const hace30 = new Date(Date.now()-30*24*60*60*1000).toISOString().split("T")[0];
      const [desde, setDesde] = useState(hace30);
      const [hasta, setHasta] = useState(hoy);
      const [generando, setGenerando] = useState(false);

      const fmt$ = n => "$"+Math.round(Math.abs(n)).toLocaleString("es-AR");
      const fmtF = f => {
        if(!f) return "—";
        const iso = f.substring(0,10);
        if(!iso.match(/^\d{4}-\d{2}-\d{2}$/)) return f;
        const [y,m,d] = iso.split("-");
        return `${d}/${m}/${y}`;
      };

      const movsFiltrados = movimientos.filter(m=>{
        const f = (m.fecha||"").substring(0,10);
        return f >= desde && f <= hasta;
      });

      const totalFact = movsFiltrados.filter(m=>m.tipo==="pedido").reduce((s,m)=>s+m.monto,0);
      const totalPag  = movsFiltrados.filter(m=>m.tipo==="pago").reduce((s,m)=>s+m.monto,0);
      const saldoPeriodo = totalFact - totalPag;

      function generarPDF() {
        setGenerando(true);
        try {
          const { jsPDF } = window.jspdf;
          const pdf = new jsPDF({orientation:'portrait',unit:'pt',format:'a4'});
          const PW = pdf.internal.pageSize.getWidth();
          const PH = pdf.internal.pageSize.getHeight();
          const M = 40, W = PW - M*2;

          // ── HEADER ──────────────────────────────────────────────
          pdf.setFillColor(192,57,43); pdf.rect(0,0,PW,70,'F');
          pdf.setFillColor(146,43,33); pdf.rect(0,0,8,70,'F');
          pdf.setFont('helvetica','bold'); pdf.setFontSize(18);
          pdf.setTextColor(255,255,255);
          pdf.text('CUENTA CORRIENTE', M+8, 42);
          pdf.setFont('helvetica','normal'); pdf.setFontSize(9);
          pdf.setTextColor(255,200,200);
          pdf.text('Frigorífico Sersale SRL  ·  CUIT 30-70227633-7', PW-M, 38, {align:'right'});
          pdf.text('(011) 6763-7860  ·  @sersalefrigorifico', PW-M, 52, {align:'right'});

          let y = 86;

          // ── DATOS CLIENTE ────────────────────────────────────────
          pdf.setFillColor(248,248,248); pdf.rect(M,y,W,52,'F');
          pdf.setDrawColor(220,220,220); pdf.setLineWidth(0.5); pdf.rect(M,y,W,52,'S');
          pdf.setFillColor(192,57,43); pdf.rect(M,y,4,52,'F');

          pdf.setFont('helvetica','bold'); pdf.setFontSize(13); pdf.setTextColor(30,30,30);
          pdf.text(cliente, M+14, y+20);
          pdf.setFont('helvetica','normal'); pdf.setFontSize(9); pdf.setTextColor(130,130,130);
          pdf.text(`Período: ${fmtF(desde)} al ${fmtF(hasta)}`, M+14, y+36);
          pdf.text(`Generado: ${fmtF(hoy)}`, PW-M, y+36, {align:'right'});
          y += 64;

          // ── RESUMEN ──────────────────────────────────────────────
          const boxW = (W-16)/3;
          const boxes = [
            {label:'Facturado en período', valor:fmt$(totalFact), color:[192,57,43]},
            {label:'Pagado en período',    valor:fmt$(totalPag),  color:[26,122,66]},
            {label:'Saldo actual',         valor:fmt$(saldo),     color:saldo>0?[192,57,43]:[26,122,66]},
          ];
          boxes.forEach((b,i)=>{
            const bx = M + i*(boxW+8);
            pdf.setFillColor(255,255,255); pdf.rect(bx,y,boxW,44,'F');
            pdf.setDrawColor(220,220,220); pdf.setLineWidth(0.5); pdf.rect(bx,y,boxW,44,'S');
            pdf.setFillColor(...b.color); pdf.rect(bx,y,boxW,4,'F');
            pdf.setFont('helvetica','bold'); pdf.setFontSize(12);
            pdf.setTextColor(...b.color);
            pdf.text(b.valor, bx+boxW/2, y+26, {align:'center'});
            pdf.setFont('helvetica','normal'); pdf.setFontSize(7); pdf.setTextColor(150,150,150);
            pdf.text(b.label, bx+boxW/2, y+37, {align:'center'});
          });
          y += 56;

          // ── TABLA MOVIMIENTOS ────────────────────────────────────
          if(movsFiltrados.length===0){
            pdf.setFont('helvetica','italic'); pdf.setFontSize(11); pdf.setTextColor(160,160,160);
            pdf.text('Sin movimientos en el período seleccionado.', PW/2, y+30, {align:'center'});
          } else {
            // Header tabla
            const COL={fecha:M, tipo:M+70, detalle:M+130, monto:PW-M-70, saldoAc:PW-M};
            const HDR_H=22, ROW_H=26, FTR_H=22;

            pdf.setFillColor(40,40,40); pdf.rect(M,y,W,HDR_H,'F');
            pdf.setFont('helvetica','bold'); pdf.setFontSize(7.5); pdf.setTextColor(200,200,200);
            pdf.text('FECHA',        COL.fecha+4,  y+HDR_H/2+3);
            pdf.text('TIPO',         COL.tipo+4,   y+HDR_H/2+3);
            pdf.text('DETALLE',      COL.detalle+4,y+HDR_H/2+3);
            pdf.setTextColor(220,150,150);
            pdf.text('IMPORTE',      COL.monto,    y+HDR_H/2+3, {align:'right'});
            pdf.setTextColor(180,200,220);
            pdf.text('SALDO',        COL.saldoAc,  y+HDR_H/2+3, {align:'right'});
            y += HDR_H;

            // Calcular saldo acumulado desde el inicio de todos los movimientos
            // para mostrar saldo corrido en el período
            let saldoAcum = 0;
            // Primero sumar todos los movimientos ANTES del período
            movimientos.filter(m=>(m.fecha||"").substring(0,10)<desde)
              .forEach(m=>{ saldoAcum += m.tipo==="pedido"?m.monto:-m.monto; });

            movsFiltrados.forEach((mov,i)=>{
              // Nueva página si no hay espacio
              if(y+ROW_H > PH-FTR_H-10){
                // Footer
                drawFtrPDF(pdf,PW,PH,M,cliente);
                pdf.addPage();
                // Re-header
                pdf.setFillColor(192,57,43); pdf.rect(0,0,PW,50,'F');
                pdf.setFont('helvetica','bold'); pdf.setFontSize(14); pdf.setTextColor(255,255,255);
                pdf.text('CUENTA CORRIENTE — '+cliente+' (cont.)', M+8, 30);
                y = 60;
                // Re-header tabla
                pdf.setFillColor(40,40,40); pdf.rect(M,y,W,HDR_H,'F');
                pdf.setFont('helvetica','bold'); pdf.setFontSize(7.5); pdf.setTextColor(200,200,200);
                pdf.text('FECHA',COL.fecha+4,y+HDR_H/2+3);
                pdf.text('TIPO',COL.tipo+4,y+HDR_H/2+3);
                pdf.text('DETALLE',COL.detalle+4,y+HDR_H/2+3);
                pdf.setTextColor(220,150,150); pdf.text('IMPORTE',COL.monto,y+HDR_H/2+3,{align:'right'});
                pdf.setTextColor(180,200,220); pdf.text('SALDO',COL.saldoAc,y+HDR_H/2+3,{align:'right'});
                y += HDR_H;
              }

              saldoAcum += mov.tipo==="pedido"?mov.monto:-mov.monto;
              const esPago = mov.tipo==="pago";

              if(i%2===0){pdf.setFillColor(252,252,252);}else{pdf.setFillColor(255,255,255);}
              pdf.rect(M,y,W,ROW_H,'F');
              pdf.setDrawColor(240,240,240); pdf.setLineWidth(0.3);
              pdf.line(M,y+ROW_H,M+W,y+ROW_H);

              // Acento color
              pdf.setFillColor(esPago?26:192, esPago?122:57, esPago?66:43);
              pdf.rect(M,y,3,ROW_H,'F');

              // Fecha
              pdf.setFont('helvetica','normal'); pdf.setFontSize(8.5); pdf.setTextColor(80,80,80);
              pdf.text(fmtF(mov.fecha), COL.fecha+8, y+ROW_H/2+3.5);

              // Tipo chip
              pdf.setFillColor(esPago?232:255, esPago?245:237, esPago?239:236);
              pdf.rect(COL.tipo+4, y+5, 42, 16,'F');
              pdf.setFont('helvetica','bold'); pdf.setFontSize(7);
              pdf.setTextColor(esPago?26:192, esPago?122:57, esPago?66:43);
              pdf.text(esPago?'PAGO':'PEDIDO', COL.tipo+25, y+ROW_H/2+3, {align:'center'});

              // Detalle
              pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.setTextColor(100,100,100);
              let det = (mov.detalle||mov.obs||'-');
              if(det.length>38) det=det.substring(0,36)+'...';
              pdf.text(det, COL.detalle+4, y+ROW_H/2+3.5);

              // Monto
              pdf.setFont('helvetica','bold'); pdf.setFontSize(9.5);
              pdf.setTextColor(esPago?26:192, esPago?122:57, esPago?66:43);
              pdf.text((esPago?'-':'+')+fmt$(mov.monto), COL.monto, y+ROW_H/2+4, {align:'right'});

              // Saldo acumulado
              pdf.setFont('helvetica','normal'); pdf.setFontSize(8.5);
              pdf.setTextColor(saldoAcum>0?192:26, saldoAcum>0?57:122, saldoAcum>0?43:66);
              pdf.text(fmt$(saldoAcum), COL.saldoAc, y+ROW_H/2+4, {align:'right'});

              y += ROW_H;
            });

            // Fila totales
            y += 4;
            pdf.setFillColor(245,245,245); pdf.rect(M,y,W,28,'F');
            pdf.setDrawColor(200,200,200); pdf.setLineWidth(0.5); pdf.rect(M,y,W,28,'S');
            pdf.setFont('helvetica','bold'); pdf.setFontSize(9); pdf.setTextColor(60,60,60);
            pdf.text(`${movsFiltrados.length} movimiento${movsFiltrados.length!==1?'s':''}`, M+10, y+18);
            pdf.setTextColor(192,57,43);
            pdf.text('Saldo: '+fmt$(saldo), COL.saldoAc, y+18, {align:'right'});
          }

          drawFtrPDF(pdf,PW,PH,M,cliente);

          const fechaArchivo = new Date().toLocaleDateString('es-AR').replace(/\//g,'-');
          pdf.save(`CC_Sersale_${cliente.replace(/\s+/g,'_')}_${fmtF(desde)}_${fmtF(hasta)}.pdf`);
        } catch(e){
          alert("Error al generar PDF: "+e.message);
          console.error(e);
        }
        setGenerando(false);
      }

      function drawFtrPDF(pdf,PW,PH,M,cliente){
        pdf.setFillColor(248,248,248); pdf.rect(0,PH-22,PW,22,'F');
        pdf.setDrawColor(220,220,220); pdf.setLineWidth(0.4); pdf.line(0,PH-22,PW,PH-22);
        pdf.setFont('helvetica','normal'); pdf.setFontSize(7); pdf.setTextColor(160,160,160);
        pdf.text('Frigorífico Sersale SRL  ·  CUIT 30-70227633-7  ·  Documento informativo — no válido como factura',
          PW/2, PH-7, {align:'center'});
      }

      return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
          onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
          <div style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:480,padding:"24px 20px 36px"}}>
            {/* Header modal */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontWeight:800,fontSize:16}}>Exportar PDF</div>
                <div style={{fontSize:12,color:"#79828B",marginTop:2}}>{cliente}</div>
              </div>
              <button onClick={onClose} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
            </div>

            {/* Selector de fechas */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <div>
                <label style={{display:"block",fontSize:12,fontWeight:700,color:"#555",marginBottom:5}}>Desde</label>
                <input type="date" value={desde} onChange={e=>setDesde(e.target.value)}
                  style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,fontFamily:"inherit"}} />
              </div>
              <div>
                <label style={{display:"block",fontSize:12,fontWeight:700,color:"#555",marginBottom:5}}>Hasta</label>
                <input type="date" value={hasta} onChange={e=>setHasta(e.target.value)}
                  style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,fontFamily:"inherit"}} />
              </div>
            </div>

            {/* Preview */}
            <div style={{background:"#F7F8F9",borderRadius:12,padding:"12px 16px",marginBottom:20,fontSize:13}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{color:"#79828B"}}>Movimientos en el período</span>
                <span style={{fontWeight:800}}>{movsFiltrados.length}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{color:"#79828B"}}>Facturado</span>
                <span style={{fontWeight:700,color:"#A4232A"}}>{fmt$(totalFact)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{color:"#79828B"}}>Pagado</span>
                <span style={{fontWeight:700,color:"#2F6B4F"}}>{fmt$(totalPag)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid #E4E7EA",paddingTop:8}}>
                <span style={{color:"#79828B"}}>Saldo actual</span>
                <span style={{fontWeight:900,fontSize:15,color:saldo>0?"#A4232A":"#2F6B4F"}}>{fmt$(saldo)}</span>
              </div>
            </div>

            <button onClick={generarPDF} disabled={generando||movsFiltrados.length===0}
              style={{width:"100%",padding:16,borderRadius:12,border:"none",
                background:generando||movsFiltrados.length===0?"#B9BFC5":"#A4232A",
                color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer",
                boxShadow:movsFiltrados.length>0?"0 4px 14px rgba(192,57,43,0.4)":"none"}}>
              {generando?"Generando...":movsFiltrados.length===0?"Sin movimientos en el período":"📥 Descargar PDF"}
            </button>
          </div>
        </div>
      );
    }

    function DetalleCuentaCorriente({ cliente, onBack, onPago, onRefreshParent, refresh }) {
      const [movimientos, setMovimientos] = useState(null);
      const [saldo, setSaldo] = useState(0);
      const [ventaOpen, setVentaOpen] = useState(false);
      const [pdfOpen, setPdfOpen] = useState(false);

      async function cargar() {
        try {
          const {db,collection,getDocs,query,where} = fb();
          const snap = await getDocs(query(
            collection(db,"cc_movimientos"),
            where("cliente","==",cliente)
          ));
          // Ordenar en cliente por fecha + createdAt
          const movs = snap.docs.map(d=>({id:d.id,...d.data()}))
            .sort((a,b)=>{
              const fd = (a.fecha||"").localeCompare(b.fecha||"");
              if(fd!==0) return fd;
              return (a.createdAt||"").localeCompare(b.createdAt||"");
            });
          setMovimientos(movs);
          let s=0; movs.forEach(m=>{ s += m.tipo==="pedido"?m.monto:-m.monto; });
          setSaldo(Math.round(s));
        } catch(e){ console.error(e); setMovimientos([]); }
      }

      useEffect(()=>{
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
      },[]);

      // Refresco externo: el saldo y los movimientos cambiaron desde otra pantalla
      const refrescoVisto = React.useRef(refresh);
      useEffect(()=>{
        if(refresh !== refrescoVisto.current) { refrescoVisto.current = refresh; cargar(); }
      },[refresh]);

      const fmt$ = n => "$"+Math.round(Math.abs(n)).toLocaleString("es-AR");
      const fmtF = f => {
        if(!f) return "—";
        // Tomar solo los primeros 10 chars (YYYY-MM-DD) e ignorar el resto
        const iso = f.substring(0,10);
        if(!iso.match(/^\d{4}-\d{2}-\d{2}$/)) return f;
        const [y,m,d] = iso.split("-");
        return `${d}/${m}/${y}`;
      };
      const totalPedidos = (movimientos||[]).filter(m=>m.tipo==="pedido").reduce((s,m)=>s+m.monto,0);
      const totalPagos   = (movimientos||[]).filter(m=>m.tipo==="pago").reduce((s,m)=>s+m.monto,0);

      return (
        <>
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:16}}>{cliente}</div>
              <div style={{fontSize:11,opacity:.85}}>Cuenta corriente</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setPdfOpen(true)} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.3)",borderRadius:20,padding:"6px 10px",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                📄 PDF
              </button>
              <button onClick={()=>setVentaOpen(true)} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.3)",borderRadius:20,padding:"6px 10px",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                Venta
              </button>
              <button onClick={onPago} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.3)",borderRadius:20,padding:"6px 10px",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                💰 Pago
              </button>
            </div>
          </div>

          <div style={{padding:16}}>
            {/* Resumen */}
            <div style={{background:"#fff",borderRadius:14,border:"1px solid #EDEEF0",padding:16,marginBottom:16,boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:800,color:"#A4232A"}}>{fmt$(totalPedidos)}</div>
                  <div style={{fontSize:10,color:"#79828B",marginTop:2}}>Facturado</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:800,color:"#2F6B4F"}}>{fmt$(totalPagos)}</div>
                  <div style={{fontSize:10,color:"#79828B",marginTop:2}}>Pagado</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:800,color:saldo>0?"#A4232A":"#2F6B4F"}}>{fmt$(saldo)}</div>
                  <div style={{fontSize:10,color:"#79828B",marginTop:2}}>Saldo</div>
                </div>
              </div>
              <div style={{background:saldo>0?"#F7EAEA":"#DDE9E2",borderRadius:10,padding:"8px 12px",textAlign:"center",fontSize:13,fontWeight:800,color:saldo>0?"#7E1A20":"#24523D"}}>
                {saldo>0?`⚠️ Debe ${fmt$(saldo)}`:"✅ Al día"}
              </div>
            </div>

            {/* Movimientos */}
            <p style={{fontWeight:700,fontSize:12,color:"#79828B",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>
              Movimientos ({(movimientos||[]).length})
            </p>
            {movimientos===null?<p style={{textAlign:"center",color:"#79828B"}}>Cargando...</p>
            :movimientos.length===0?<div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><div style={{fontSize:48}}>📋</div><p>Sin movimientos</p></div>
            :[...movimientos].reverse().map((m,i)=>{
              const esPago=m.tipo==="pago";
              return (
                <div key={m.id||i} style={{background:"#fff",borderRadius:12,borderLeft:`4px solid ${esPago?"#2F6B4F":"#A4232A"}`,borderTop:"1px solid #EDEEF0",borderRight:"1px solid #EDEEF0",borderBottom:"1px solid #EDEEF0",padding:12,marginBottom:8,boxShadow:"0 1px 4px rgba(0,0,0,0.05)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:11,fontWeight:800,padding:"2px 8px",borderRadius:6,background:esPago?"#DDE9E2":"#F7EAEA",color:esPago?"#24523D":"#7E1A20"}}>
                          {esPago?"▼ PAGO":"▲ PEDIDO"}
                        </span>
                        {m.formaPago&&<span style={{fontSize:11,color:"#79828B"}}>{m.formaPago}</span>}
                        {m.origen==="importado"&&<span style={{fontSize:10,color:"#B9BFC5"}}>hist.</span>}
                      </div>
                      {m.detalle&&m.detalle!=="-"&&<div style={{fontSize:12,color:"#5C666F",marginBottom:2}}>📦 {m.detalle.substring(0,60)}{m.detalle.length>60?"...":""}</div>}
                      {m.obs&&<div style={{fontSize:11,color:"#79828B"}}>📝 {m.obs}</div>}
                    </div>
                    <div style={{textAlign:"right",minWidth:90}}>
                      <div style={{fontWeight:800,fontSize:15,color:esPago?"#2F6B4F":"#A4232A"}}>{esPago?"-":"+"}{fmt$(m.monto)}</div>
                      <div style={{fontSize:11,color:"#A3ABB3",marginTop:2}}>{fmtF(m.fecha)}</div>
                      {m.saldo!=null&&<div style={{fontSize:10,color:"#B9BFC5"}}>Saldo: {fmt$(m.saldo)}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {ventaOpen && (
          <ModalVentaRapida
            clienteInicial={cliente}
            clientes={null}
            onClose={()=>setVentaOpen(false)}
            onGuardado={()=>{ cargar(); if(onRefreshParent) onRefreshParent(); }}
          />
        )}
        {pdfOpen && (
          <ModalPdfCC
            cliente={cliente}
            movimientos={movimientos||[]}
            saldo={saldo}
            onClose={()=>setPdfOpen(false)}
          />
        )}
      </>
      );
    }
    function TabStats({ pedidos }) {
      const [periodo, setPeriodo] = useState(() => {
        const n = new Date();
        return n.getFullYear()+"-"+String(n.getMonth()+1).padStart(2,"0");
      });
      const filtrados = pedidos.filter(p=>p.estado!=="cancelado"&&p.fechaEntrega&&p.fechaEntrega.startsWith(periodo));
      const prods = {};
      filtrados.forEach(p=>{
        (p.items||[]).forEach(it=>{
          const k = it.producto;
          if(!prods[k]) prods[k]={nombre:it.producto,unidades:0,kgTotal:0,pedidos:0,unidad:it.unidad||"kg"};
          const cant = parseFloat(it.cantidad)||0;
          const kg   = it.kgReal!=null ? parseFloat(it.kgReal)||0 : cant;
          if(it.unidad==="kg"){
            prods[k].unidades += cant;
            prods[k].kgTotal  += cant;
          } else {
            prods[k].unidades += cant;
            prods[k].kgTotal  += kg;
          }
          prods[k].pedidos++;
        });
      });
      const rankP = Object.values(prods).sort((a,b)=>b.kgTotal-a.kgTotal);
      const maxP = rankP[0]?.kgTotal||1;
      const clis = {};
      filtrados.forEach(p=>{if(!clis[p.cliente])clis[p.cliente]={nombre:p.cliente,pedidos:0};clis[p.cliente].pedidos++;});
      const rankC = Object.values(clis).sort((a,b)=>b.pedidos-a.pedidos).slice(0,8);
      const dias=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"],porDiaS=[0,0,0,0,0,0,0];
      filtrados.forEach(p=>{if(p.fechaEntrega)porDiaS[new Date(p.fechaEntrega+"T12:00:00").getDay()]++;});
      const maxD=Math.max(...porDiaS)||1;
      return (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
            <input type="month" style={{flex:1,padding:"10px 12px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none"}}
              value={periodo} onChange={e=>setPeriodo(e.target.value)} />
            <div style={{background:"#2A333B",color:"#fff",borderRadius:12,padding:"10px 14px",fontSize:13,fontWeight:700,whiteSpace:"nowrap"}}>{filtrados.length} pedidos</div>
          </div>
          {filtrados.length===0 ? (
            <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}><div style={{fontSize:48}}>📊</div><p>Sin datos para este período</p></div>
          ) : (<>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <div style={{background:"#fff",borderRadius:14,padding:"14px 12px",border:"1.5px solid #2A333B",textAlign:"center"}}>
                <div style={{fontSize:26,fontWeight:900,color:"#2A333B"}}>{rankP.length}</div>
                <div style={{fontSize:11,color:"#79828B",marginTop:2}}>Productos distintos</div>
              </div>
              <div style={{background:"#fff",borderRadius:14,padding:"14px 12px",border:"1.5px solid #6B4E8E",textAlign:"center"}}>
                <div style={{fontSize:26,fontWeight:900,color:"#6B4E8E"}}>{rankC.length}</div>
                <div style={{fontSize:11,color:"#79828B",marginTop:2}}>Clientes activos</div>
              </div>
            </div>
            <p style={{fontWeight:700,fontSize:12,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Top productos por cantidad</p>
            <div style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",overflow:"hidden",marginBottom:16}}>
              {/* Header tabla */}
              <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:8,padding:"8px 14px",background:"#F7F8F9",borderBottom:"1px solid #EDEEF0"}}>
                <span style={{fontSize:10,fontWeight:800,color:"#79828B",textTransform:"uppercase",letterSpacing:.5}}>Producto</span>
                <span style={{fontSize:10,fontWeight:800,color:"#79828B",textTransform:"uppercase",letterSpacing:.5,textAlign:"right",minWidth:70}}>Unidades</span>
                <span style={{fontSize:10,fontWeight:800,color:"#79828B",textTransform:"uppercase",letterSpacing:.5,textAlign:"right",minWidth:60}}>Kg total</span>
              </div>
              {rankP.slice(0,10).map((p,i)=>(
                <div key={p.nombre} style={{padding:"10px 14px",borderBottom:i<Math.min(rankP.length,10)-1?"1px solid #F7F8F9":"none"}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:8,alignItems:"center",marginBottom:5}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
                      <span style={{fontSize:11,fontWeight:700,color:"#fff",background:i===0?"#B5872F":i===1?"#95A5A6":i===2?"#CD6155":"#2A333B",borderRadius:99,width:20,height:20,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{i+1}</span>
                      <span style={{fontSize:13,fontWeight:600,color:"#262C32",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre}</span>
                    </div>
                    {/* Columna unidades — solo si no es kg */}
                    <span style={{fontWeight:700,fontSize:12,color:"#2A333B",textAlign:"right",minWidth:70,whiteSpace:"nowrap"}}>
                      {p.unidad==="kg" ? "—" : `${Number.isInteger(p.unidades)?p.unidades:p.unidades.toFixed(1)} ${p.unidad}`}
                    </span>
                    {/* Columna kg totales */}
                    <span style={{fontWeight:700,fontSize:12,color:"#A4232A",textAlign:"right",minWidth:60,whiteSpace:"nowrap"}}>
                      {p.kgTotal>0 ? `${Number.isInteger(p.kgTotal)?p.kgTotal:p.kgTotal.toFixed(1)} kg` : "—"}
                    </span>
                  </div>
                  <div style={{background:"#EDEEF0",borderRadius:99,height:4,overflow:"hidden"}}>
                    <div style={{background:i===0?"#B5872F":"#2A333B",height:"100%",borderRadius:99,width:(p.kgTotal/maxP*100)+"%"}}/>
                  </div>
                </div>
              ))}
            </div>
            <p style={{fontWeight:700,fontSize:12,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Clientes más frecuentes</p>
            <div style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:14,marginBottom:16}}>
              {rankC.map((cl,i)=>(
                <div key={cl.nombre} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:i<rankC.length-1?"1px solid #F2F3F5":"none"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,fontWeight:700,color:"#6B4E8E",background:"#F5EEF8",borderRadius:99,width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center"}}>{i+1}</span>
                    <span style={{fontSize:13,color:"#262C32"}}>{cl.nombre}</span>
                  </div>
                  <span style={{fontSize:12,color:"#79828B"}}><strong style={{color:"#6B4E8E"}}>{cl.pedidos}</strong> pedido{cl.pedidos!==1?"s":""}</span>
                </div>
              ))}
            </div>
            <p style={{fontWeight:700,fontSize:12,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Pedidos por día de semana</p>
            <div style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:14,marginBottom:16}}>
              <div style={{display:"flex",gap:4,alignItems:"flex-end",height:80,justifyContent:"space-between"}}>
                {dias.map((dia,i)=>(
                  <div key={dia} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                    <span style={{fontSize:10,color:"#2A333B",fontWeight:700}}>{porDiaS[i]>0?porDiaS[i]:""}</span>
                    <div style={{width:"100%",background:porDiaS[i]>0?"#2A333B":"#E4E7EA",borderRadius:"4px 4px 0 0",height:(porDiaS[i]/maxD*60+4)+"px"}}/>
                    <span style={{fontSize:10,color:"#79828B"}}>{dia}</span>
                  </div>
                ))}
              </div>
            </div>
          </>)}
        </div>
      );
    }


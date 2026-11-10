    function TabCuentasCorrientes({ refresh }) {
      const [clientes, setClientes] = useState(null);
      const [errorCarga, setErrorCarga] = useState(false);
      const [clienteAbierto, setClienteAbierto] = useState(null);
      const [modalPago, setModalPago] = useState(null);
      const [pagoForm, setPagoForm] = useState({monto:"",formaPago:"transferencia",obs:""});
      const [modalNuevo, setModalNuevo] = useState(false);
      const [nuevoNombre, setNuevoNombre] = useState("");
      const [clientesDisponibles, setClientesDisponibles] = useState(null); // null = cargando
      // Avisa al detalle abierto que hay movimientos nuevos (un pago recién cargado)
      const [recargas, setRecargas] = useState(0);
      // Id del pago que se está cargando: si hay que reintentar, no se duplica
      const pagoId = React.useRef(null);

      async function cargarClientesDisponibles() {
        setClientesDisponibles(null);
        try {
          const {db,collection,getDocs,query,orderBy} = fb();
          // Todos los clientes registrados
          const snapCli = await getDocs(query(collection(db,"clientes"),orderBy("nombre","asc")));
          const todos = snapCli.docs.map(d=>d.data().nombre).filter(Boolean);
          // Quitar los que ya tienen CC (mismo nombre aunque cambien mayúsculas o acentos)
          const snapCC = await getDocs(collection(db,"cuentas_corrientes"));
          const yaCC = snapCC.docs.map(d=>d.data().nombre);
          setClientesDisponibles(todos.filter(n=>!yaCC.some(c=>ccMismoCliente(c,n))));
        } catch(e){
          console.error(e);
          setClientesDisponibles([]);
          SersaleUI.toast("No se pudo cargar la lista de clientes.", { tipo: "error" });
        }
      }

      async function cargar() {
        try {
          const {db,collection,getDocs,query,orderBy} = fb();
          const snap = await getDocs(query(collection(db,"cuentas_corrientes"),orderBy("nombre","asc")));
          // Las cuentas fusionadas por la migración (mergedInto) ya no se usan
          setClientes(snap.docs.map(d=>({id:d.id,...d.data()})).filter(c=>!c.mergedInto));
          setErrorCarga(false);
        } catch(e){ console.error(e); setErrorCarga(true); }
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

      function abrirPago(nombre) {
        pagoId.current = null;
        setPagoForm({monto:"",formaPago:"transferencia",obs:""});
        setModalPago(nombre);
      }
      function abrirNuevo() {
        setNuevoNombre("");
        setModalNuevo(true);
        cargarClientesDisponibles();
      }

      const [registrarPago, guardandoPago] = SersaleBase.useAccion(async () => {
        const monto = SersaleBase.redondear(parseFloat(pagoForm.monto), 2);
        if(!monto||monto<=0) { SersaleUI.toast("Ingresá un monto válido", { tipo: "error" }); return; }
        try {
          const {db,collection,doc} = fb();
          if(!pagoId.current) pagoId.current = doc(collection(db,"cc_movimientos")).id;
          const hoy = SersaleBase.hoy();
          // Movimiento y saldo se guardan juntos (o no se guarda nada)
          const r = await ccAsentarMovimiento({
            cliente: modalPago, movId: pagoId.current, ultimoMovimiento: hoy,
            datos: {
              tipo:"pago", formaPago:pagoForm.formaPago, monto,
              obs:pagoForm.obs.trim(), fecha:hoy,
              detalle:"Pago — "+pagoForm.formaPago
            }
          });
          if(!r.asentado) throw new Error("El cliente no tiene cuenta corriente: "+modalPago);
          pagoId.current = null;
          setModalPago(null);
          setPagoForm({monto:"",formaPago:"transferencia",obs:""});
          SersaleUI.toast("Pago de "+SersaleBase.fmtMonto(monto)+" registrado. Saldo: "+ccFmtSaldo(r.saldo), { tipo: "ok" });
          setRecargas(n=>n+1);
          cargar();
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo registrar el pago. Revisá la conexión y probá de nuevo.", { tipo: "error" });
        }
      });

      const [crearCliente, creando] = SersaleBase.useAccion(async () => {
        const nombre = nuevoNombre.trim();
        if(!nombre) { SersaleUI.toast("Elegí un cliente", { tipo: "error" }); return; }
        try {
          const {db,doc,runTransaction} = fb();
          if(await ccBuscarCuenta(nombre)) {
            SersaleUI.toast(nombre+" ya tiene cuenta corriente", { tipo: "info" });
          } else {
            // Id fijo por cliente: dos toques (o dos teléfonos) no abren dos cuentas.
            const ref = doc(db,"cuentas_corrientes","cta_"+SersaleBase.norm(nombre).replace(/[^a-z0-9]+/g,"_").slice(0,80));
            // Si el cliente ya tenía movimientos sueltos, la cuenta arranca con esa suma.
            const saldoInicial = ccSaldoDeMovimientos(await ccMovimientosDe(nombre, null));
            await runTransaction(db, async tx => {
              const snap = await tx.get(ref);
              if(snap.exists()) return;
              tx.set(ref,{
                nombre,saldo:saldoInicial,
                creadoEn:new Date().toISOString(),ultimoMovimiento:SersaleBase.hoy()
              });
            });
            await esperarCopiaLocal(ref, d => !!d);
            SersaleUI.toast("Cuenta corriente creada", { tipo: "ok" });
          }
          setNuevoNombre(""); setModalNuevo(false); cargar();
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo crear la cuenta. Probá de nuevo.", { tipo: "error" });
        }
      });

      const fmt$ = n => "$"+Math.round(Math.abs(n)).toLocaleString("es-AR");

      // Hoja de pago: se dibuja tanto sobre la lista como sobre el detalle de una cuenta
      const hojaPago = modalPago && (
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setModalPago(null);}}>
              <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px calc(32px + env(safe-area-inset-bottom))",width:"100%",maxWidth:480}}>
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
                <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:16,background:"#fff",marginBottom:12}}
                  value={pagoForm.formaPago} onChange={e=>setPagoForm({...pagoForm,formaPago:e.target.value})}>
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="cheque">Cheque</option>
                  <option value="otro">Otro</option>
                </select>
                <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Observaciones</label>
                <input style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:16,marginBottom:16}}
                  placeholder="Referencia, número de transferencia..." value={pagoForm.obs} onChange={e=>setPagoForm({...pagoForm,obs:e.target.value})} />
                <button onClick={registrarPago} disabled={guardandoPago}
                  style={{width:"100%",padding:16,borderRadius:12,border:"none",background:guardandoPago?"#B9BFC5":"#2F6B4F",color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer"}}>
                  {guardandoPago?"Guardando...":"✓ Confirmar pago"}
                </button>
              </div>
            </div>
      );

      if(clienteAbierto) return (
        <>
          <DetalleCuentaCorriente
            cliente={clienteAbierto}
            onBack={()=>{setClienteAbierto(null); cargar();}}
            onPago={()=>abrirPago(clienteAbierto)}
            onRefreshParent={cargar}
            refresh={String(refresh)+"/"+recargas}
          />
          {hojaPago}
        </>
      );

      const totalDeuda = (clientes||[]).filter(c=>c.saldo>0).reduce((s,c)=>s+c.saldo,0);
      const enDeuda = (clientes||[]).filter(c=>c.saldo>0).length;

      return (
        <div>
          {errorCarga && (
            <div style={{background:"#F7EAEA",border:"1px solid #E3B9BC",borderRadius:12,padding:"12px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
              <span style={{flex:1,fontSize:13,color:"#7E1A20",fontWeight:600}}>No se pudieron cargar las cuentas corrientes.</span>
              <button onClick={cargar} style={{padding:"10px 14px",minHeight:44,borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>Reintentar</button>
            </div>
          )}
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
            <button onClick={abrirNuevo}
              style={{padding:"7px 14px",borderRadius:20,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>
              + Nueva
            </button>
          </div>

          {/* Lista */}
          {clientes===null ? (errorCarga ? null : <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>)
          : clientes.length===0 ? (
            <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
              <div style={{fontSize:48}}>💳</div>
              <p style={{marginBottom:16}}>Sin cuentas corrientes</p>
              <button onClick={abrirNuevo} style={{padding:"12px 24px",borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,cursor:"pointer"}}>+ Crear primera</button>
            </div>
          ) : clientes.map(cl=>{
            const estadoSaldo = ccEstadoSaldo(cl.saldo);
            const deuda = estadoSaldo==="debe";
            const color = deuda?"#A4232A":estadoSaldo==="al_dia"?"#2F6B4F":"#26536E";
            return (
              <div key={cl.id} style={{background:"#fff",borderRadius:14,borderLeft:`4px solid ${color}`,borderTop:"1px solid #EDEEF0",borderRight:"1px solid #EDEEF0",borderBottom:"1px solid #EDEEF0",padding:14,marginBottom:10,boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:15,color:"#111",marginBottom:2}}>{cl.nombre}</div>
                    <div style={{fontSize:11,color:"#79828B"}}>
                      {deuda?"⚠️ Saldo pendiente":estadoSaldo==="a_favor"?"🔵 Saldo a favor del cliente":"✅ Al día"}
                      {ccDia(cl.ultimoMovimiento)&&` · Último: ${SersaleBase.fmtFecha(ccDia(cl.ultimoMovimiento))}`}
                    </div>
                  </div>
                  <div data-saldo={cl.nombre} style={{fontWeight:900,fontSize:18,color,whiteSpace:"nowrap"}}>{ccFmtSaldo(cl.saldo)}</div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setClienteAbierto(cl.nombre)}
                    style={{flex:1,padding:"9px 0",borderRadius:10,border:"1.5px solid #D8DCE0",background:"#fff",color:"#262C32",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                    📋 Ver movimientos
                  </button>
                  <button onClick={()=>abrirPago(cl.nombre)}
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
                {clientesDisponibles===null
                  ? <p style={{textAlign:"center",color:"#79828B",marginBottom:16,fontSize:13}}>Cargando clientes...</p>
                  : clientesDisponibles.length===0
                  ? <p style={{textAlign:"center",color:"#79828B",marginBottom:16,fontSize:13}}>Todos los clientes ya tienen cuenta corriente</p>
                  : <select style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:16,background:"#fff",marginBottom:12}}
                      value={nuevoNombre} onChange={e=>setNuevoNombre(e.target.value)}>
                      <option value="">— Seleccioná un cliente —</option>
                      {clientesDisponibles.map(n=><option key={n} value={n}>{n}</option>)}
                    </select>
                }
                <button onClick={crearCliente} disabled={creando||!nuevoNombre}
                  style={{width:"100%",padding:14,borderRadius:12,border:"none",background:creando||!nuevoNombre?"#B9BFC5":"#A4232A",color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer"}}>
                  {creando?"Creando...":"Crear cuenta"}
                </button>
              </div>
            </div>
          )}

          {hojaPago}
        </div>
      );
    }

    // ── DETALLE CUENTA CORRIENTE ─────────────────────────────
    // ── MODAL PDF CUENTA CORRIENTE ────────────────────────────────
    function ModalPdfCC({ cliente, movimientos, saldo, onClose }) {
      const hoy = SersaleBase.hoy();
      const hace30 = SersaleBase.sumarDias(hoy,-30);
      const [desde, setDesde] = useState(hace30);
      const [hasta, setHasta] = useState(hoy);
      const [generando, setGenerando] = useState(false);

      // Importes de movimientos (ya llevan + o − adelante) y saldos (con su signo)
      const fmt$ = n => "$"+Math.round(Math.abs(Number(n)||0)).toLocaleString("es-AR");
      const fmtS = ccFmtSaldo;
      const fmtF = f => {
        if(!f) return "—";
        const iso = ccDia(f);
        if(!iso) return typeof f==="string" ? f : "—";
        return SersaleBase.fmtFecha(iso);
      };

      const movsFiltrados = movimientos.filter(m=>{
        const f = ccDia(m.fecha);
        return f >= desde && f <= hasta;
      });

      const totalFact = movsFiltrados.filter(m=>m.tipo==="pedido").reduce((s,m)=>s+(Number(m.monto)||0),0);
      const totalPag  = movsFiltrados.filter(m=>m.tipo!=="pedido").reduce((s,m)=>s+(Number(m.monto)||0),0);

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
            {label:saldo<0?'Saldo actual (a favor del cliente)':'Saldo actual', valor:fmtS(saldo), color:saldo>0?[192,57,43]:[26,122,66]},
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

            // Saldo corrido: arranca en lo que el cliente debía antes del período,
            // y esa cifra se imprime para que las filas cierren con el saldo final.
            const previos = movimientos.filter(m=>ccDia(m.fecha)<desde);
            let saldoAcum = ccSaldoDeMovimientos(previos);
            if(previos.length>0){
              pdf.setFillColor(245,245,245); pdf.rect(M,y,W,ROW_H,'F');
              pdf.setDrawColor(240,240,240); pdf.setLineWidth(0.3);
              pdf.line(M,y+ROW_H,M+W,y+ROW_H);
              pdf.setFont('helvetica','italic'); pdf.setFontSize(8.5); pdf.setTextColor(100,100,100);
              pdf.text('Saldo anterior al '+fmtF(desde), COL.fecha+8, y+ROW_H/2+3.5);
              pdf.setFont('helvetica','bold'); pdf.setFontSize(8.5);
              pdf.setTextColor(saldoAcum>0?192:26, saldoAcum>0?57:122, saldoAcum>0?43:66);
              pdf.text(fmtS(saldoAcum), COL.saldoAc, y+ROW_H/2+4, {align:'right'});
              y += ROW_H;
            }

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

              saldoAcum = SersaleBase.redondear(saldoAcum + ccImporteFirmado(mov), 2);
              const esPago = mov.tipo!=="pedido";

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
              pdf.text(fmtS(saldoAcum), COL.saldoAc, y+ROW_H/2+4, {align:'right'});

              y += ROW_H;
            });

            // Fila totales (en otra hoja si no entra arriba del pie)
            if(y+4+28 > PH-FTR_H-10){
              drawFtrPDF(pdf,PW,PH,M,cliente);
              pdf.addPage();
              y = 40;
            }
            y += 4;
            pdf.setFillColor(245,245,245); pdf.rect(M,y,W,28,'F');
            pdf.setDrawColor(200,200,200); pdf.setLineWidth(0.5); pdf.rect(M,y,W,28,'S');
            pdf.setFont('helvetica','bold'); pdf.setFontSize(9); pdf.setTextColor(60,60,60);
            pdf.text(`${movsFiltrados.length} movimiento${movsFiltrados.length!==1?'s':''}`, M+10, y+18);
            // Saldo al cierre del período: es el de la última fila de arriba
            pdf.setTextColor(saldoAcum>0?192:26, saldoAcum>0?57:122, saldoAcum>0?43:66);
            pdf.text('Saldo al '+fmtF(hasta)+': '+fmtS(saldoAcum)+(saldoAcum<0?' (a favor del cliente)':''), COL.saldoAc, y+18, {align:'right'});
          }

          drawFtrPDF(pdf,PW,PH,M,cliente);

          // Nombre de archivo sin barras ni acentos; en el teléfono se abre el menú de compartir
          const nombreArchivo = `CC_Sersale_${SersaleBase.norm(cliente).replace(/[^a-z0-9]+/g,'_')}_${desde}_a_${hasta}.pdf`;
          window.compartirOdescargarPDF(pdf, nombreArchivo);
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo generar el PDF. Probá de nuevo.", { tipo: "error" });
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
          onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
          <div style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:480,padding:"24px 20px calc(36px + env(safe-area-inset-bottom))"}}>
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
                  style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:16,fontFamily:"inherit"}} />
              </div>
              <div>
                <label style={{display:"block",fontSize:12,fontWeight:700,color:"#555",marginBottom:5}}>Hasta</label>
                <input type="date" value={hasta} onChange={e=>setHasta(e.target.value)}
                  style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:16,fontFamily:"inherit"}} />
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
                <span style={{fontWeight:900,fontSize:15,color:saldo>0?"#A4232A":saldo<0?"#26536E":"#2F6B4F"}}>{fmtS(saldo)}{saldo<0?" a favor":""}</span>
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
      const [cuenta, setCuenta] = useState(null);
      const [errorCarga, setErrorCarga] = useState(false);
      const [ventaOpen, setVentaOpen] = useState(false);
      const [pdfOpen, setPdfOpen] = useState(false);

      async function cargar() {
        try {
          // Mismas reglas que al cobrar o facturar: el cliente se reconoce aunque
          // el nombre esté escrito con otras mayúsculas o acentos.
          const cta = await ccBuscarCuenta(cliente);
          const movs = await ccMovimientosDe(cliente, cta);
          setCuenta(cta);
          setMovimientos(movs);
          setSaldo(Math.round(ccSaldoDeMovimientos(movs)));
          setErrorCarga(false);
        } catch(e){ console.error(e); setErrorCarga(true); }
      }

      useEffect(()=>{
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
      },[]);

      // Refresco externo: el saldo y los movimientos cambiaron desde otra pantalla
      const refrescoVisto = React.useRef(refresh);
      useEffect(()=>{
        if(refresh !== refrescoVisto.current) { refrescoVisto.current = refresh; cargar(); }
      },[refresh]);

      // El saldo guardado en la cuenta (el de la lista y el panel) y la suma de los
      // movimientos deberían ser iguales. Si no lo son, se avisa y la persona decide.
      const saldoGuardado = cuenta ? (Number(cuenta.saldo)||0) : null;
      const saldoDistinto = movimientos!==null && saldoGuardado!==null && Math.abs(saldoGuardado - saldo) >= 1;
      const [recalcular, recalculando] = SersaleBase.useAccion(async () => {
        const ok = await SersaleUI.confirmar({
          titulo: "¿Corregir el saldo guardado?",
          cuerpo: "La cuenta de "+cliente+" tiene guardado "+ccFmtSaldo(saldoGuardado)+" y sus movimientos suman "+ccFmtSaldo(saldo)+". Si aceptás, el saldo de la cuenta pasa a ser "+ccFmtSaldo(saldo)+".",
          aceptar: "Usar "+ccFmtSaldo(saldo), cancelar: "Dejar como está"
        });
        if(!ok) return;
        try {
          const r = await ccRecalcularSaldo(cliente);
          if(r && r.cambio) SersaleUI.toast("Entró un movimiento mientras tanto. Revisá de nuevo.", { tipo: "info" });
          else SersaleUI.toast("Saldo corregido", { tipo: "ok" });
          await cargar();
          if(onRefreshParent) onRefreshParent();
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo corregir el saldo. Probá de nuevo.", { tipo: "error" });
        }
      });

      const fmt$ = n => "$"+Math.round(Math.abs(Number(n)||0)).toLocaleString("es-AR");
      const fmtF = f => {
        if(!f) return "—";
        // Solo el día (AAAA-MM-DD); tolera fechas guardadas como Timestamp
        const iso = ccDia(f);
        if(!iso) return typeof f==="string" ? f : "—";
        return SersaleBase.fmtFecha(iso);
      };
      const totalPedidos = (movimientos||[]).filter(m=>m.tipo==="pedido").reduce((s,m)=>s+(Number(m.monto)||0),0);
      const totalPagos   = (movimientos||[]).filter(m=>m.tipo!=="pedido").reduce((s,m)=>s+(Number(m.monto)||0),0);
      const estadoSaldo = ccEstadoSaldo(saldo);
      const cargando = movimientos===null && !errorCarga;

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
                  <div data-saldo-detalle style={{fontSize:13,fontWeight:800,color:estadoSaldo==="debe"?"#A4232A":estadoSaldo==="a_favor"?"#26536E":"#2F6B4F"}}>{movimientos===null?"…":ccFmtSaldo(saldo)}</div>
                  <div style={{fontSize:10,color:"#79828B",marginTop:2}}>Saldo</div>
                </div>
              </div>
              {movimientos===null
                ? <div style={{background:"#EDEEF0",borderRadius:10,padding:"8px 12px",textAlign:"center",fontSize:13,fontWeight:800,color:"#5C666F"}}>{errorCarga?"No se pudo cargar":"Cargando..."}</div>
                : <div data-estado-saldo={estadoSaldo} style={{background:estadoSaldo==="debe"?"#F7EAEA":estadoSaldo==="a_favor"?"#DCE5EB":"#DDE9E2",borderRadius:10,padding:"8px 12px",textAlign:"center",fontSize:13,fontWeight:800,color:estadoSaldo==="debe"?"#7E1A20":estadoSaldo==="a_favor"?"#26536E":"#24523D"}}>
                    {estadoSaldo==="debe"?`⚠️ Debe ${fmt$(saldo)}`:estadoSaldo==="a_favor"?`🔵 Saldo a favor del cliente: ${fmt$(saldo)}`:"✅ Al día"}
                  </div>
              }
              {saldoDistinto && (
                <div data-aviso="saldo-distinto" style={{background:"#F0E7D9",border:"1px solid #D9B98A",borderRadius:10,padding:"10px 12px",marginTop:10,fontSize:12,color:"#784212"}}>
                  <div style={{fontWeight:700,marginBottom:6}}>El saldo guardado de la cuenta ({ccFmtSaldo(saldoGuardado)}) no coincide con la suma de estos movimientos ({ccFmtSaldo(saldo)}).</div>
                  <div style={{marginBottom:8}}>En la lista de cuentas y en el panel se ve el guardado.</div>
                  <button onClick={recalcular} disabled={recalculando}
                    style={{padding:"10px 14px",minHeight:44,borderRadius:10,border:"1.5px solid #A8702A",background:"#fff",color:"#784212",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                    {recalculando?"Corrigiendo...":"Corregir saldo guardado"}
                  </button>
                </div>
              )}
            </div>
            {errorCarga && (
              <div style={{background:"#F7EAEA",border:"1px solid #E3B9BC",borderRadius:12,padding:"12px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
                <span style={{flex:1,fontSize:13,color:"#7E1A20",fontWeight:600}}>No se pudieron cargar los movimientos.</span>
                <button onClick={cargar} style={{padding:"10px 14px",minHeight:44,borderRadius:10,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>Reintentar</button>
              </div>
            )}

            {/* Movimientos */}
            <p style={{fontWeight:700,fontSize:12,color:"#79828B",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>
              Movimientos ({(movimientos||[]).length})
            </p>
            {movimientos===null?(cargando?<p style={{textAlign:"center",color:"#79828B"}}>Cargando...</p>:null)
            :movimientos.length===0?<div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><div style={{fontSize:48}}>📋</div><p>Sin movimientos</p></div>
            :[...movimientos].reverse().map((m,i)=>{
              const esPago=m.tipo!=="pedido";
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
                      {m.detalle&&m.detalle!=="-"&&<div style={{fontSize:12,color:"#5C666F",marginBottom:2}}>📦 {String(m.detalle).substring(0,60)}{String(m.detalle).length>60?"...":""}</div>}
                      {m.obs&&<div style={{fontSize:11,color:"#79828B"}}>📝 {m.obs}</div>}
                    </div>
                    <div style={{textAlign:"right",minWidth:90}}>
                      <div style={{fontWeight:800,fontSize:15,color:esPago?"#2F6B4F":"#A4232A"}}>{esPago?"-":"+"}{fmt$(m.monto)}</div>
                      <div style={{fontSize:11,color:"#A3ABB3",marginTop:2}}>{fmtF(m.fecha)}</div>
                      {m.saldo!=null&&<div style={{fontSize:10,color:"#B9BFC5"}}>Saldo: {ccFmtSaldo(m.saldo)}</div>}
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
      const [periodo, setPeriodo] = useState(() => SersaleBase.hoy().slice(0,7));
      const filtrados = pedidos.filter(p=>p.estado!=="cancelado"&&p.fechaEntrega&&p.fechaEntrega.startsWith(periodo));
      const prods = {};
      filtrados.forEach(p=>{
        (p.items||[]).forEach(it=>{
          const k = it.producto;
          if(!prods[k]) prods[k]={nombre:it.producto,unidades:0,kgTotal:0,pedidos:0,unidad:it.unidad||"kg"};
          const cant = parseFloat(it.cantidad)||0;
          const pesado = it.kgReal!=null && it.kgReal!=="" ? parseFloat(it.kgReal)||0 : null;
          prods[k].unidades += cant;
          if((it.unidad||"kg")==="kg"){
            // Por kilo: lo que marcó la balanza; si no se pesó, lo pedido
            prods[k].kgTotal += pesado!=null ? pesado : cant;
          } else if(pesado!=null && p.origen!=="venta_rapida"){
            // Por pieza, bolsa o unidad: solo suma kilos si se pesó de verdad
            // (la venta rápida copia la cantidad en kgReal: eso no son kilos)
            prods[k].kgTotal += pesado;
          }
          prods[k].pedidos++;
        });
      });
      const rankP = Object.values(prods).sort((a,b)=>b.kgTotal-a.kgTotal);
      const maxP = rankP[0]?.kgTotal||1;
      const clis = {};
      filtrados.forEach(p=>{if(!clis[p.cliente])clis[p.cliente]={nombre:p.cliente,pedidos:0};clis[p.cliente].pedidos++;});
      const totalClientes = Object.keys(clis).length;
      const rankC = Object.values(clis).sort((a,b)=>b.pedidos-a.pedidos).slice(0,8);
      const dias=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"],porDiaS=[0,0,0,0,0,0,0];
      filtrados.forEach(p=>{const ds=SersaleBase.diaSemana(p.fechaEntrega); if(ds>=0&&ds<=6)porDiaS[ds]++;});
      const maxD=Math.max(...porDiaS)||1;
      return (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
            <input type="month" style={{flex:1,padding:"10px 12px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:16,background:"#fff",outline:"none"}}
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
                <div style={{fontSize:26,fontWeight:900,color:"#6B4E8E"}}>{totalClientes}</div>
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


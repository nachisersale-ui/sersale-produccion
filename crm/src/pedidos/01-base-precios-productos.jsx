    const { useState, useEffect } = React;

    const LAST_SEEN_KEY = "sersale_last_seen";

    const ESTADOS = {
      pendiente:  { label:"PENDIENTE",  color:"#A4232A", bg:"#F7EAEA" },
      preparando: { label:"PREPARANDO", color:"#26536E", bg:"#DCE5EB" },
      listo:      { label:"LISTO ✓",   color:"#24523D", bg:"#D0F0E0" },
      despachado: { label:"DESPACHADO", color:"#626C76", bg:"#E4E7EA" },
      cancelado:  { label:"CANCELADO",  color:"#7E1A20", bg:"#EEDADB" },
    };

    const CLIENTES_DEFAULT = [
      "Supermercado Don Juan","Carnicería El Gaucho","Rotisería La Porteña",
      "Distribuidora Río de la Plata","Restaurant El Fogón","Carnicería San Martín",
      "Almacén Central","Distribuidora Norte","Hotel Castelar"
    ];


    // ── FORMATO DE MONTOS (separador de miles) ──────────────
    // Valor interno: string plano con "." decimal ("1000000.5")
    // Valor mostrado: formato es-AR ("1.000.000,5")
    function fmtMilesTxt(raw) {
      if (raw === null || raw === undefined) return "";
      let s = String(raw).trim();
      if (s === "") return "";
      const neg = s.charAt(0) === "-";
      s = s.replace(/-/g, "");
      const partes = s.split(".");
      let ent = (partes[0] || "").replace(/\D/g, "");
      const dec = partes.length > 1 ? partes[1].replace(/\D/g, "") : undefined;
      ent = ent.replace(/^0+(?=\d)/, "");
      const entF = ent === "" ? (dec !== undefined ? "0" : "") : ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      return (neg ? "-" : "") + entF + (dec !== undefined ? "," + dec : "");
    }
    function desfmtMiles(txt) {
      if (txt === null || txt === undefined) return "";
      let s = String(txt).replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".");
      const neg = s.charAt(0) === "-";
      s = s.replace(/[^0-9.]/g, "");
      const p = s.split(".");
      if (p.length > 2) s = p[0] + "." + p.slice(1).join("");
      if (s.charAt(0) === ".") s = "0" + s;
      const q = s.split(".");
      if (q.length === 2) s = q[0] + "." + q[1].slice(0, 2);
      return (neg && s !== "" ? "-" : "") + s;
    }

    // Número pegado desde otro lado (app del banco, planilla, WhatsApp) -> texto
    // como se escribe en el campo: sin puntos de miles y con coma decimal.
    //   "152340.50" -> "152340,5"   "152.340,50" -> "152340,5"   "$ 8.990" -> "8990"
    function p1TextoPegado(txt) {
      const s = String(txt == null ? "" : txt).replace(/[^\d.,-]/g, "");
      if (!/\d/.test(s)) return "";
      const coma = s.lastIndexOf(","), punto = s.lastIndexOf(".");
      // "8,990.50" (coma de miles y punto decimal) no lo resuelve SersaleBase.numero
      const n = coma !== -1 && punto > coma ? parseFloat(s.replace(/,/g, "")) : SersaleBase.numero(s);
      if (!isFinite(n)) return "";
      return String(SersaleBase.redondear(n, 2)).replace(".", ",");
    }

    // Input de monto con separador de miles en vivo y cursor estable
    function InputMonto({ value, onChange, ...rest }) {
      const ref = React.useRef(null);
      const caretRef = React.useRef(null);
      React.useEffect(() => {
        const el = ref.current;
        if (!el || caretRef.current === null) return;
        const objetivo = caretRef.current;
        caretRef.current = null;
        // Solo se acomoda el cursor del campo en el que se está escribiendo
        // (en algunos Safari mover la selección de otro campo le roba el foco).
        if (document.activeElement !== el) return;
        const t = el.value;
        let cnt = 0, pos = t.length;
        if (objetivo === 0) { pos = 0; }
        else {
          for (let i = 0; i < t.length; i++) {
            if (/[0-9,]/.test(t[i])) cnt++;
            if (cnt === objetivo) { pos = i + 1; break; }
          }
        }
        try { el.setSelectionRange(pos, pos); } catch (e) {}
      });
      function handleChange(e) {
        const el = e.target;
        let texto = el.value;
        let cs = el.selectionStart || 0;
        // Los puntos de miles los pone el campo solo: si la persona escribe un
        // punto (teclado numérico de la PC, iPhone configurado en otra región)
        // es el decimal. Antes se descartaba y "1500.50" quedaba en 150.050.
        const previo = fmtMilesTxt(value);
        const ne = e.nativeEvent;
        const tipeoPunto = cs > 0 && texto.charAt(cs - 1) === "." &&
          ((ne && ne.data === ".") || texto.slice(0, cs - 1) + texto.slice(cs) === previo);
        if (tipeoPunto) {
          const yaTieneComa = previo.indexOf(",") !== -1;
          texto = texto.slice(0, cs - 1) + (yaTieneComa ? "" : ",") + texto.slice(cs);
          if (yaTieneComa) cs -= 1;
        }
        const nuevo = desfmtMiles(texto);
        if (nuevo === String(value == null ? "" : value)) {
          // La tecla no cambió el valor: no va a haber otro dibujo que acomode el cursor.
          caretRef.current = null;
        } else {
          let cuenta = (texto.slice(0, cs).match(/[0-9,]/g) || []).length;
          // Coma al principio: el campo muestra "0," y el cursor va después de la coma.
          if (cuenta > 0 && /^[^0-9,]*,/.test(texto)) cuenta += 1;
          caretRef.current = cuenta;
        }
        onChange(nuevo);
      }
      // Pegar un importe: se interpreta el número entero que se pegó (con punto
      // o con coma decimal) en vez de pasarlo carácter por carácter.
      function handlePaste(e) {
        const cd = e.clipboardData || window.clipboardData;
        const pegado = p1TextoPegado(cd ? cd.getData("text") : "");
        e.preventDefault();
        if (!pegado) return;
        const el = e.target;
        const a = el.selectionStart == null ? el.value.length : el.selectionStart;
        const b = el.selectionEnd == null ? a : el.selectionEnd;
        const antes = el.value.slice(0, a) + pegado;
        caretRef.current = (antes.match(/[0-9,]/g) || []).length;
        onChange(desfmtMiles(antes + el.value.slice(b)));
      }
      // Backspace sobre un punto de miles borra el dígito anterior
      function handleKeyDown(e) {
        if (e.key !== "Backspace") return;
        const el = e.target;
        if (el.selectionStart !== el.selectionEnd) return;
        const s = el.selectionStart;
        if (s > 1 && el.value.charAt(s - 1) === ".") {
          e.preventDefault();
          const nuevo = el.value.slice(0, s - 2) + el.value.slice(s);
          caretRef.current = (el.value.slice(0, s - 2).match(/[0-9,]/g) || []).length;
          onChange(desfmtMiles(nuevo));
        }
      }
      return (
        <input ref={ref} type="text" inputMode="decimal" value={fmtMilesTxt(value)}
          onChange={handleChange} onKeyDown={handleKeyDown} onPaste={handlePaste} {...rest} />
      );
    }

    // ── GUARDAR CON MALA SEÑAL ─────────────────────────────
    const p1SinSenal = () => typeof navigator !== "undefined" && navigator.onLine === false;
    const P1_SIN_SENAL = "Sin conexión: no se guardó. Probá de nuevo cuando vuelva la señal.";
    // Espera una escritura. Con señal floja js/fb.js la da por terminada cuando
    // el cambio quedó anotado en el teléfono (se envía solo) y lleva la cuenta de
    // lo pendiente. Devuelve true si el servidor confirmó y false si quedó
    // pendiente de envío.
    async function p1Escribir(promesa) {
      const pendientes = () => (window.__sersaleDatos && window.__sersaleDatos.pendientes ? window.__sersaleDatos.pendientes().cantidad : 0);
      const antes = pendientes();
      await promesa;
      return pendientes() <= antes;
    }

    // ── HISTORIAL PRECIOS POR CLIENTE ──────────────────────
    // "$8.990" o "$8.990,5": tolera precios guardados como texto o faltantes.
    const p1Precio = v => "$" + SersaleBase.fmtNumero(v, 2);
    // "dd/mm/aa" en hora de Buenos Aires.
    const p1FechaCorta = v => { const f = SersaleBase.fmtFecha(v); return f ? f.slice(0, 6) + f.slice(8) : "sin fecha"; };
    const p1FechaOrden = v => typeof v === "string" ? v : (SersaleBase.aFecha(v) ? SersaleBase.aFecha(v).toISOString() : "");

    function HistorialPrecios({ cliente, onBack }) {
      const [precios, setPrecios] = useState(null);
      const [fallo, setFallo] = useState(false); // no se pudieron leer los precios
      const [filtroProducto, setFiltroProducto] = useState("");
      const [editModal, setEditModal] = useState(null); // {id, producto, precio} or {nuevo:true}
      const [formProducto, setFormProducto] = useState("");
      const [formPrecio, setFormPrecio] = useState("");

      async function cargar() {
        setFallo(false);
        try {
          const { db, collection, getDocs, query, where } = fb();
          let lista = (await getDocs(query(
            collection(db,"precios_cliente"),
            where("cliente","==",cliente)
          ))).docs;
          if (lista.length === 0) {
            // Igual que el remito: sin coincidencia exacta, el mismo nombre sin mirar mayúsculas ni acentos
            const todos = await getDocs(collection(db,"precios_cliente"));
            lista = todos.docs.filter(d => SersaleBase.mismoNombre(d.data().cliente, cliente));
          }
          const docs = lista.map(d=>({id:d.id,...d.data()}))
            .sort((a,b)=>p1FechaOrden(b.fecha).localeCompare(p1FechaOrden(a.fecha)));
          const grouped = {};
          docs.forEach(d=>{
            if(!grouped[d.producto]) grouped[d.producto]=[];
            grouped[d.producto].push(d);
          });
          setPrecios(grouped);
        } catch(e){
          // Nunca mostrar "Sin precios registrados" si en realidad no se pudo leer.
          console.error(e); setPrecios(null); setFallo(true);
        }
      }

      useEffect(()=>{
        window.scrollTo(0,0);
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
      },[]);

      function abrirEditar(entry) {
        setEditModal(entry);
        setFormProducto(entry.producto);
        setFormPrecio(String(entry.precio));
      }
      function abrirNuevo() {
        setEditModal({nuevo:true});
        setFormProducto("");
        setFormPrecio("");
      }
      const [guardarPrecio, guardando] = SersaleBase.useAccion(async () => {
        const producto = String(formProducto||"").trim();
        if(editModal.nuevo && !producto) return SersaleUI.toast("Elegí el producto", { tipo:"error" });
        if(!formPrecio||isNaN(+formPrecio)||+formPrecio<=0) return SersaleUI.toast("Ingresá un precio válido", { tipo:"error" });
        if(p1SinSenal()) return SersaleUI.toast(P1_SIN_SENAL, { tipo:"error" });
        try {
          const { db, collection, addDoc, doc, updateDoc } = fb();
          const fecha = new Date().toISOString();
          const confirmado = await p1Escribir(editModal.nuevo
            ? addDoc(collection(db,"precios_cliente"),{ cliente, producto, precio:+formPrecio, fecha })
            : updateDoc(doc(db,"precios_cliente",editModal.id),{ precio:+formPrecio, fecha }));
          setEditModal(null);
          if(confirmado) SersaleUI.toast("Precio guardado", { tipo:"ok" });
          else SersaleUI.toast("Guardado en el teléfono. Se envía cuando vuelva la señal.", { tipo:"info" });
          await cargar();
        } catch(e){
          console.error(e);
          if(e && e.code === "not-found") {
            // El renglón que se estaba editando ya no existe: se muestra la lista como está ahora.
            setEditModal(null);
            SersaleUI.toast("Ese precio ya no existe: lo borraron desde otro teléfono.", { tipo:"error" });
            await cargar();
            return;
          }
          SersaleUI.toast("No se pudo guardar. Probá de nuevo.", { tipo:"error" });
        }
      });

      // Borra uno o varios renglones del historial, todos juntos.
      async function borrarRenglones(ids, avisoOk) {
        if(p1SinSenal()) return SersaleUI.toast("Sin conexión: no se eliminó. Probá de nuevo cuando vuelva la señal.", { tipo:"error" });
        try {
          const { db, doc, writeBatch } = fb();
          let confirmado = true;
          for (let i = 0; i < ids.length; i += 400) {
            const lote = writeBatch(db);
            ids.slice(i, i + 400).forEach(id => lote.delete(doc(db,"precios_cliente",id)));
            if(!(await p1Escribir(lote.commit()))) confirmado = false;
          }
          if(confirmado) SersaleUI.toast(avisoOk, { tipo:"ok" });
          else SersaleUI.toast("Eliminado en el teléfono. Se envía cuando vuelva la señal.", { tipo:"info" });
          await cargar();
        } catch(e){
          console.error(e);
          SersaleUI.toast("No se pudo eliminar. Probá de nuevo.", { tipo:"error" });
        }
      }
      // ✕ de un renglón: borra ese solo precio. Si es el más nuevo, el anterior
      // vuelve a ser el vigente (y el que trae el próximo remito): se avisa antes.
      const [eliminarPrecio, eliminando] = SersaleBase.useAccion(async (entrada, prod, hist) => {
        const queda = hist[0] === entrada ? hist[1] : null;
        const ok = await SersaleUI.confirmar({
          titulo: "¿Eliminar este precio?",
          cuerpo: prod + ": " + p1Precio(entrada.precio) + " del " + p1FechaCorta(entrada.fecha) + "."
            + (queda ? " Vuelve a quedar vigente el anterior: " + p1Precio(queda.precio) + " del " + p1FechaCorta(queda.fecha) + "."
              : hist.length === 1 ? " El producto queda sin precio para este cliente." : ""),
          aceptar: "Eliminar", peligro: true,
        });
        if(!ok) return;
        await borrarRenglones([entrada.id], "Precio eliminado");
      });
      // ✕ de la tarjeta: saca el producto de este cliente, con todo su historial.
      // (Antes borraba solo el último renglón y el precio anterior quedaba como
      // vigente sin avisar.)
      const [quitarProducto, quitando] = SersaleBase.useAccion(async (prod, hist) => {
        const ok = await SersaleUI.confirmar({
          titulo: "¿Sacar " + prod + " de los precios de este cliente?",
          cuerpo: (hist.length === 1
            ? "Se borra su precio (" + p1Precio(hist[0].precio) + ")."
            : "Se borran los " + hist.length + " precios guardados de este producto. Para borrar uno solo, usá la ✕ de ese renglón.")
            + " El próximo remito no va a traer precio para este producto.",
          aceptar: hist.length === 1 ? "Eliminar" : "Borrar los " + hist.length, peligro: true,
        });
        if(!ok) return;
        await borrarRenglones(hist.map(h=>h.id), "Producto quitado de los precios");
      });
      const borrando = eliminando || quitando;

      const productos = precios ? Object.keys(precios).filter(p=>!filtroProducto.trim()||SersaleBase.coincide(p, filtroProducto)).sort() : [];

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            <button onClick={onBack} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:"12px 14px",margin:"-12px -8px -12px -14px"}}>←</button>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:16}}>Precios — {cliente}</div>
              <div style={{fontSize:11,opacity:.8}}>Historial por producto · Tocá para editar</div>
            </div>
            <button onClick={abrirNuevo} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"none",borderRadius:10,padding:"8px 14px",fontWeight:700,fontSize:13,cursor:"pointer"}}>+ Nuevo</button>
          </div>
          <div style={{padding:16}}>
            <input style={{width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:16,background:"#fff",outline:"none",marginBottom:14}}
              placeholder="🔍 Buscar producto..." value={filtroProducto} onChange={e=>setFiltroProducto(e.target.value)} />
            {fallo ? (
              <div style={{textAlign:"center",color:"#5C666F",marginTop:60}}>
                <div style={{fontSize:48}}>⚠️</div>
                <p style={{fontWeight:700,color:"#A4232A"}}>No se pudieron cargar los precios</p>
                <p style={{fontSize:13,marginTop:8}}>{p1SinSenal() ? "No hay conexión." : "Puede ser la señal."} Los precios guardados no se tocaron.</p>
                <button onClick={cargar} style={{marginTop:16,padding:"12px 22px",minHeight:44,borderRadius:10,border:"none",background:"#26536E",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Reintentar</button>
              </div>
            )
            : precios===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
            : productos.length===0 && Object.keys(precios).length>0 ? (
              <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
                <div style={{fontSize:48}}>🔍</div>
                <p>Sin resultados para "{filtroProducto.trim()}"</p>
              </div>
            )
            : productos.length===0 ? (
              <div style={{textAlign:"center",color:"#A3ABB3",marginTop:60}}>
                <div style={{fontSize:48}}>📈</div>
                <p>Sin precios registrados para este cliente</p>
                <p style={{fontSize:12,marginTop:8}}>Tocá <b>+ Nuevo</b> para agregar un precio manualmente</p>
              </div>
            ) : productos.map(prod=>{
              const hist = precios[prod];
              const ultimo = hist[0];
              const anterior = hist[1];
              const diffCrudo = anterior && Number(anterior.precio)>0 ? ((ultimo.precio - anterior.precio)/anterior.precio*100) : NaN;
              const diff = isFinite(diffCrudo) ? SersaleBase.redondear(diffCrudo, 1) : null;
              return (
                <div key={prod} style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:14,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{flex:1,paddingRight:8,cursor:"pointer"}} onClick={()=>abrirEditar(ultimo)}>
                      <div style={{fontWeight:700,fontSize:14,color:"#191E23",marginBottom:2}}>{prod}</div>
                      <div style={{fontSize:11,color:"#79828B"}}>{hist.length} precio{hist.length!==1?"s":""} registrado{hist.length!==1?"s":""} · Tocá para editar</div>
                    </div>
                    <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                      <div style={{textAlign:"right",cursor:"pointer"}} onClick={()=>abrirEditar(ultimo)}>
                        <div style={{fontWeight:900,fontSize:18,color:"#26536E"}}>{p1Precio(ultimo.precio)}/kg</div>
                        {diff!==null && (
                          <div style={{fontSize:11,fontWeight:600,color:diff>0?"#C33039":diff<0?"#2F6B4F":"#79828B"}}>
                            {diff===0 ? "= igual que el anterior" : (diff>0?"▲":"▼")+" "+SersaleBase.fmtNumero(Math.abs(diff),1)+"% vs anterior"}
                          </div>
                        )}
                      </div>
                      <button onClick={()=>quitarProducto(prod, hist)} disabled={borrando} aria-label={"Sacar "+prod+" de los precios"} style={{background:"none",border:"none",color:"#C33039",fontSize:16,cursor:"pointer",padding:"12px 14px",margin:"-10px -10px -10px -6px",opacity:0.5}}>✕</button>
                    </div>
                  </div>
                  {hist.length>1 && (
                    <div style={{display:"flex",gap:6,alignItems:"flex-end",marginBottom:8,height:36}}>
                      {hist.slice(0,8).reverse().map((h,i,arr)=>{
                        const min=Math.min(...arr.map(x=>x.precio));
                        const max=Math.max(...arr.map(x=>x.precio));
                        const pct=max===min?80:20+((h.precio-min)/(max-min))*60;
                        const isLast=i===arr.length-1;
                        return <div key={i} style={{flex:1,background:isLast?"#26536E":"#DCE5EB",borderRadius:"3px 3px 0 0",height:`${pct}%`,minHeight:4,transition:"height .3s"}} title={p1Precio(h.precio)}></div>;
                      })}
                    </div>
                  )}
                  <div style={{borderTop:"1px solid #EDEEF0",paddingTop:8}}>
                    {hist.slice(0,4).map((h,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",color:i===0?"#191E23":"#79828B",alignItems:"center"}}>
                        <span>{p1FechaCorta(h.fecha)}</span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontWeight:i===0?700:400}}>{p1Precio(h.precio)}/kg</span>
                          <button onClick={()=>eliminarPrecio(h, prod, hist)} disabled={borrando} aria-label={"Eliminar el precio del "+p1FechaCorta(h.fecha)} style={{background:"none",border:"none",color:"#B9BFC5",fontSize:12,cursor:"pointer",padding:"8px 12px",margin:"-8px -12px -8px -4px"}}>✕</button>
                        </div>
                      </div>
                    ))}
                    {hist.length>4 && <div style={{fontSize:11,color:"#A3ABB3",marginTop:4}}>+ {hist.length-4} registros anteriores</div>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Modal editar/nuevo precio */}
          {editModal && (
            <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
              <div style={{background:"#fff",borderRadius:16,padding:24,width:"100%",maxWidth:380,boxShadow:"0 8px 32px rgba(0,0,0,0.3)"}}>
                <h3 style={{fontSize:16,fontWeight:800,marginBottom:16,color:"#2A333B"}}>{editModal.nuevo?"Agregar precio":"Editar precio"}</h3>
                <div style={{marginBottom:14}}>
                  <label style={{display:"block",fontWeight:700,fontSize:12,color:"#3A424A",marginBottom:6}}>Producto</label>
                  {editModal.nuevo ? (
                    <select value={formProducto} onChange={e=>setFormProducto(e.target.value)}
                      style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:16,outline:"none",background:"#fff"}}>
                      <option value="">— Seleccionar producto —</option>
                      {Object.entries(getProductos()).map(([cat, prods])=>(
                        <optgroup key={cat} label={cat}>
                          {(Array.isArray(prods)?prods:[]).filter(p=>p).map(p=>{
                            const yaExiste = precios && precios[p];
                            return <option key={p} value={p} style={{color:yaExiste?"#A3ABB3":"#191E23"}}>{p}{yaExiste?" (ya cargado)":""}</option>;
                          })}
                        </optgroup>
                      ))}
                    </select>
                  ) : (
                    /* El nombre no se cambia desde acá: renombrar un solo renglón partía el
                       historial en dos y el precio viejo quedaba como vigente. */
                    <div style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid #EDEEF0",background:"#F7F8F9",fontSize:16,color:"#191E23"}}>{formProducto}</div>
                  )}
                </div>
                <div style={{marginBottom:20}}>
                  <label style={{display:"block",fontWeight:700,fontSize:12,color:"#3A424A",marginBottom:6}}>Precio por kg ($)</label>
                  <InputMonto value={formPrecio} onChange={v=>setFormPrecio(v)}
                    placeholder="0" enterKeyHint="done"
                    style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:18,fontWeight:700,outline:"none",textAlign:"right"}} />
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>setEditModal(null)} style={{flex:1,padding:13,borderRadius:10,border:"1.5px solid #D8DCE0",background:"#fff",color:"#5C666F",fontWeight:700,fontSize:14,cursor:"pointer"}}>Cancelar</button>
                  <button onClick={guardarPrecio} disabled={guardando}
                    style={{flex:1,padding:13,borderRadius:10,border:"none",background:guardando?"#A3ABB3":"#26536E",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                    {guardando?"Guardando...":"💾 Guardar"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── GESTIÓN DE CLIENTES ─────────────────────────────────

    // ── GESTIÓN DE PRODUCTOS ─────────────────────────────────
    // Productos de una categoría, sin los renglones vacíos que pueda haber guardados.
    const p1ProductosDe = (categorias, cat) => (categorias && Array.isArray(categorias[cat]) ? categorias[cat] : []).filter(p=>p);
    // El catálogo vigente para toda la app: getProductos() y la variable PRODUCTOS (02).
    function p1UsarCatalogo(categorias) {
      window.__productosOverride = categorias;
      PRODUCTOS = categorias;
    }

    function GestionProductos({ onBack }) {
      const [cats, setCats] = useState(null); // {cat: [prod,...]}
      const [fallo, setFallo] = useState(false); // no se pudo leer el catálogo guardado
      const [modalCat, setModalCat] = useState(null); // cat seleccionada para agregar prod
      const [modalNuevaCat, setModalNuevaCat] = useState(false);
      const [inputProd, setInputProd] = useState("");
      const [inputCat, setInputCat] = useState("");
      const [expandida, setExpandida] = useState(null);

      async function cargar() {
        setFallo(false);
        try {
          const {db,doc,getDoc} = fb();
          const snap = await getDoc(doc(db,"config","productos"));
          // Sin documento todavía (primera vez): la lista fija del código es la base.
          setCats(snap.exists() && snap.data().categorias ? snap.data().categorias : PRODUCTOS);
        } catch(e){
          // Si no se pudo leer NO se muestra la lista fija: guardar desde ahí
          // pisaba el catálogo real con el de fábrica.
          console.error(e); setCats(null); setFallo(true);
        }
      }

      // Aplica UN cambio sobre el catálogo tal como está guardado en ese momento
      // (no sobre la copia de esta pantalla), dentro de una transacción: así no
      // se pisa lo que agregó o sacó otro teléfono. `cambio(categorias)` modifica
      // la copia que recibe; si devuelve un texto, no se guarda y se muestra.
      // Devuelve true solo si quedó guardado.
      const [aplicarCambio, guardando] = SersaleBase.useAccion(async (cambio) => {
        if(p1SinSenal()){ SersaleUI.toast(P1_SIN_SENAL, { tipo:"error" }); return false; }
        try {
          const {db,doc,runTransaction} = fb();
          const ref = doc(db,"config","productos");
          const res = await runTransaction(db, async tx => {
            const snap = await tx.get(ref);
            const actual = snap.exists() && snap.data().categorias ? snap.data().categorias : PRODUCTOS;
            const nuevas = {};
            Object.keys(actual).forEach(c => { nuevas[c] = Array.isArray(actual[c]) ? actual[c].slice() : actual[c]; });
            const aviso = cambio(nuevas);
            if(aviso) return { aviso, categorias: actual };
            const datos = { categorias: nuevas, updatedAt: new Date().toISOString() };
            if(snap.exists()) tx.update(ref, datos); else tx.set(ref, datos);
            return { categorias: nuevas };
          });
          p1UsarCatalogo(res.categorias);
          setCats(res.categorias);
          if(res.aviso){ SersaleUI.toast(res.aviso, { tipo:"error" }); return false; }
          return true;
        } catch(e){
          console.error(e);
          SersaleUI.toast(p1SinSenal() ? P1_SIN_SENAL : "No se pudo guardar. Probá de nuevo.", { tipo:"error" });
          return false;
        }
      });

      async function agregarProducto() {
        const nombre = inputProd.trim();
        const cat = modalCat;
        if(!nombre || !cat) return;
        const ok = await aplicarCambio(c => {
          const lista = p1ProductosDe(c, cat);
          if(lista.some(p=>SersaleBase.mismoNombre(p, nombre))) return "Ya existe ese producto en esta categoría";
          c[cat] = [...(Array.isArray(c[cat]) ? c[cat] : []), nombre];
        });
        // Solo se cierra y se limpia si quedó guardado: si falló, lo escrito sigue ahí.
        if(ok){ setInputProd(""); setModalCat(null); SersaleUI.toast("Producto agregado", { tipo:"ok" }); }
      }

      async function eliminarProducto(cat, prod) {
        const si = await SersaleUI.confirmar({
          titulo: "¿Eliminar el producto?",
          cuerpo: prod + " se saca de " + cat + ". Los pedidos y precios ya cargados no cambian.",
          aceptar: "Eliminar", peligro: true,
        });
        if(!si) return;
        const ok = await aplicarCambio(c => {
          if(Array.isArray(c[cat])) c[cat] = c[cat].filter(p=>p!==prod);
        });
        if(ok) SersaleUI.toast("Producto eliminado", { tipo:"ok" });
      }

      async function agregarCategoria() {
        const nombre = inputCat.trim();
        if(!nombre) return;
        const ok = await aplicarCambio(c => {
          if(Object.keys(c).some(k=>SersaleBase.mismoNombre(k, nombre))) return "Ya existe esa categoría";
          c[nombre] = [];
        });
        if(ok){ setInputCat(""); setModalNuevaCat(false); SersaleUI.toast("Categoría creada", { tipo:"ok" }); }
      }

      async function eliminarCategoria(cat) {
        if(p1ProductosDe(cats, cat).length>0){ SersaleUI.toast("Vaciá la categoría antes de eliminarla", { tipo:"error" }); return; }
        const si = await SersaleUI.confirmar({ titulo: "¿Eliminar la categoría?", cuerpo: cat, aceptar: "Eliminar", peligro: true });
        if(!si) return;
        const ok = await aplicarCambio(c => {
          // Otro teléfono pudo haberle cargado productos mientras tanto.
          if(p1ProductosDe(c, cat).length>0) return "La categoría ahora tiene productos: no se eliminó";
          delete c[cat];
        });
        if(ok) SersaleUI.toast("Categoría eliminada", { tipo:"ok" });
      }

      useEffect(()=>{
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
      },[]);

      const totalProds = cats ? Object.keys(cats).reduce((n,c)=>n+p1ProductosDe(cats,c).length, 0) : 0;

      return (
        <div className="crm-page">
          {/* Header */}
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(17,122,101,0.35)"}}>
            <button onClick={onBack} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:"12px 14px",margin:"-12px -8px -12px -14px"}}>←</button>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:16}}>Gestión de Productos</div>
              <div style={{fontSize:11,opacity:.85}}>{cats?`${Object.keys(cats).length} categorías · ${totalProds} productos`:fallo?"Sin datos":"Cargando..."}</div>
            </div>
            {cats && (
              <button onClick={()=>setModalNuevaCat(true)}
                style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700}}>
                + Categoría
              </button>
            )}
          </div>

          <div style={{padding:16}}>
            {fallo ? (
              <div style={{textAlign:"center",color:"#5C666F",marginTop:60}}>
                <div style={{fontSize:48}}>⚠️</div>
                <p style={{fontWeight:700,color:"#A4232A"}}>No se pudo cargar el catálogo de productos</p>
                <p style={{fontSize:13,marginTop:8}}>{p1SinSenal() ? "No hay conexión." : "Puede ser la señal."} El catálogo guardado no se tocó.</p>
                <button onClick={cargar} style={{marginTop:16,padding:"12px 22px",minHeight:44,borderRadius:10,border:"none",background:"#1F5E56",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Reintentar</button>
              </div>
            ) : !cats ? (
              <p style={{textAlign:"center",color:"#79828B",marginTop:60}}>Cargando...</p>
            ) : (
              Object.entries(cats).map(([cat, prods])=>{
                const abierta = expandida===cat;
                const prodsValidos = p1ProductosDe(cats, cat);
                return (
                  <div key={cat} style={{background:"#fff",borderRadius:14,border:"1px solid #E4E7EA",marginBottom:10,overflow:"hidden",boxShadow:"0 2px 6px rgba(0,0,0,0.04)"}}>
                    {/* Header categoría */}
                    <div onClick={()=>setExpandida(abierta?null:cat)}
                      style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",cursor:"pointer",borderBottom:abierta?"1px solid #F2F3F5":"none"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:4,height:24,background:"#1F5E56",borderRadius:2}}/>
                        <div>
                          <div style={{fontWeight:800,fontSize:14,color:"#111"}}>{cat}</div>
                          <div style={{fontSize:11,color:"#A3ABB3",marginTop:1}}>{prodsValidos.length} producto{prodsValidos.length!==1?"s":""}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        {prodsValidos.length===0&&(
                          <button onClick={e=>{e.stopPropagation();eliminarCategoria(cat);}} disabled={guardando}
                            style={{background:"#F7EAEA",border:"none",borderRadius:6,padding:"4px 8px",fontSize:11,color:"#A4232A",cursor:"pointer",fontWeight:700}}>
                            Eliminar
                          </button>
                        )}
                        <span style={{color:"#B9BFC5",fontSize:14,transform:abierta?"rotate(180deg)":"none",display:"inline-block",transition:"transform .2s"}}>▼</span>
                      </div>
                    </div>

                    {/* Lista productos */}
                    {abierta && (
                      <div style={{padding:"8px 12px 12px"}}>
                        {prodsValidos.map(prod=>(
                          <div key={prod} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 4px",borderBottom:"1px solid #F7F8F9"}}>
                            <span style={{fontSize:13,color:"#262C32"}}>{prod}</span>
                            <button onClick={()=>eliminarProducto(cat,prod)} disabled={guardando} aria-label={"Eliminar "+prod}
                              style={{background:"#F7EAEA",border:"none",borderRadius:6,width:26,height:26,cursor:"pointer",fontSize:13,color:"#A4232A",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                              ✕
                            </button>
                          </div>
                        ))}
                        {prodsValidos.length===0&&(
                          <p style={{fontSize:12,color:"#B9BFC5",textAlign:"center",padding:"8px 0",fontStyle:"italic"}}>Sin productos — agregá uno</p>
                        )}
                        <button onClick={()=>{setModalCat(cat);setInputProd("");}}
                          style={{width:"100%",marginTop:10,padding:"10px 0",borderRadius:10,border:"1.5px dashed #1F5E56",background:"#F0FAF8",color:"#1F5E56",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                          + Agregar producto
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Modal agregar producto */}
          {modalCat&&(
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setModalCat(null);}}>
              <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:16}}>+ Nuevo producto</div>
                    <div style={{fontSize:12,color:"#79828B",marginTop:2}}>Categoría: {modalCat}</div>
                  </div>
                  <button onClick={()=>setModalCat(null)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
                </div>
                <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Nombre del producto *</label>
                <input autoFocus autoCapitalize="words" enterKeyHint="done" style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:16,marginBottom:16,fontFamily:"inherit"}}
                  placeholder="Ej: Jamón Serrano"
                  value={inputProd} onChange={e=>setInputProd(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter")agregarProducto();}} />
                <button onClick={agregarProducto} disabled={guardando||!inputProd.trim()}
                  style={{width:"100%",padding:14,borderRadius:12,border:"none",
                    background:guardando||!inputProd.trim()?"#B9BFC5":"#1F5E56",
                    color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer"}}>
                  {guardando?"Guardando...":"Agregar"}
                </button>
              </div>
            </div>
          )}

          {/* Modal nueva categoría */}
          {modalNuevaCat&&(
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:10000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
              onClick={e=>{if(e.target===e.currentTarget)setModalNuevaCat(false);}}>
              <div style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"24px 20px 36px",width:"100%",maxWidth:480}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <div style={{fontWeight:800,fontSize:16}}>+ Nueva categoría</div>
                  <button onClick={()=>setModalNuevaCat(false)} style={{background:"#EDEEF0",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18}}>×</button>
                </div>
                <label style={{display:"block",fontWeight:700,fontSize:13,color:"#3A424A",marginBottom:6}}>Nombre de la categoría *</label>
                <input autoFocus autoCapitalize="words" enterKeyHint="done" style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:16,marginBottom:16,fontFamily:"inherit"}}
                  placeholder="Ej: Fiambres Importados"
                  value={inputCat} onChange={e=>setInputCat(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter")agregarCategoria();}} />
                <button onClick={agregarCategoria} disabled={guardando||!inputCat.trim()}
                  style={{width:"100%",padding:14,borderRadius:12,border:"none",
                    background:guardando||!inputCat.trim()?"#B9BFC5":"#1F5E56",
                    color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer"}}>
                  {guardando?"Guardando...":"Crear categoría"}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }


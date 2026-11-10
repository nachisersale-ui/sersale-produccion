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

    // Input de monto con separador de miles en vivo y cursor estable
    function InputMonto({ value, onChange, ...rest }) {
      const ref = React.useRef(null);
      const caretRef = React.useRef(null);
      React.useEffect(() => {
        const el = ref.current;
        if (!el || caretRef.current === null) return;
        const objetivo = caretRef.current;
        caretRef.current = null;
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
        const cs = el.selectionStart || 0;
        caretRef.current = (el.value.slice(0, cs).match(/[0-9,]/g) || []).length;
        onChange(desfmtMiles(el.value));
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
          onChange={handleChange} onKeyDown={handleKeyDown} {...rest} />
      );
    }

    // ── HISTORIAL PRECIOS POR CLIENTE ──────────────────────
    function HistorialPrecios({ cliente, onBack }) {
      const [precios, setPrecios] = useState(null);
      const [filtroProducto, setFiltroProducto] = useState("");
      const [editModal, setEditModal] = useState(null); // {id, producto, precio} or {nuevo:true}
      const [formProducto, setFormProducto] = useState("");
      const [formPrecio, setFormPrecio] = useState("");
      const [guardando, setGuardando] = useState(false);

      function cargar() {
        (async()=>{
          try {
            const { db, collection, getDocs, query, where } = fb();
            const snap = await getDocs(query(
              collection(db,"precios_cliente"),
              where("cliente","==",cliente)
            ));
            const docs = snap.docs.map(d=>({id:d.id,...d.data()}))
              .sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||""));
            const grouped = {};
            docs.forEach(d=>{
              if(!grouped[d.producto]) grouped[d.producto]=[];
              grouped[d.producto].push(d);
            });
            setPrecios(grouped);
          } catch(e){ console.error(e); setPrecios({}); }
        })();
      }

      useEffect(()=>{
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
      async function guardarPrecio() {
        if(!formProducto.trim()) return alert("Ingresá el producto");
        if(!formPrecio||isNaN(+formPrecio)||+formPrecio<=0) return alert("Ingresá un precio válido");
        setGuardando(true);
        try {
          const { db, collection, addDoc, doc, updateDoc } = fb();
          if(editModal.nuevo) {
            await addDoc(collection(db,"precios_cliente"),{
              cliente, producto:formProducto.trim(), precio:+formPrecio,
              fecha:new Date().toISOString()
            });
          } else {
            await updateDoc(doc(db,"precios_cliente",editModal.id),{
              producto:formProducto.trim(), precio:+formPrecio,
              fecha:new Date().toISOString()
            });
          }
          setEditModal(null);
          cargar();
        } catch(e){ alert("Error al guardar"); console.error(e); }
        setGuardando(false);
      }
      async function eliminarPrecio(id, producto) {
        if(!confirm("¿Eliminar precio de "+producto+"?")) return;
        try {
          const { db, doc, deleteDoc } = fb();
          await deleteDoc(doc(db,"precios_cliente",id));
          cargar();
        } catch(e){ alert("Error al eliminar"); console.error(e); }
      }

      const productos = precios ? Object.keys(precios).filter(p=>!filtroProducto||p.toLowerCase().includes(filtroProducto.toLowerCase())).sort() : [];

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"16px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:16}}>Precios — {cliente}</div>
              <div style={{fontSize:11,opacity:.8}}>Historial por producto · Tocá para editar</div>
            </div>
            <button onClick={abrirNuevo} style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"none",borderRadius:10,padding:"8px 14px",fontWeight:700,fontSize:13,cursor:"pointer"}}>+ Nuevo</button>
          </div>
          <div style={{padding:16}}>
            <input style={{width:"100%",padding:"11px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:14}}
              placeholder="🔍 Buscar producto..." value={filtroProducto} onChange={e=>setFiltroProducto(e.target.value)} />
            {precios===null ? <p style={{textAlign:"center",color:"#79828B",marginTop:40}}>Cargando...</p>
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
              const diff = anterior ? ((ultimo.precio - anterior.precio)/anterior.precio*100) : null;
              return (
                <div key={prod} style={{background:"#fff",borderRadius:14,border:"1px solid var(--borde)",boxShadow:"var(--sombra)",padding:14,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{flex:1,paddingRight:8,cursor:"pointer"}} onClick={()=>abrirEditar(ultimo)}>
                      <div style={{fontWeight:700,fontSize:14,color:"#191E23",marginBottom:2}}>{prod}</div>
                      <div style={{fontSize:11,color:"#79828B"}}>{hist.length} precio{hist.length!==1?"s":""} registrado{hist.length!==1?"s":""} · Tocá para editar</div>
                    </div>
                    <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
                      <div style={{textAlign:"right",cursor:"pointer"}} onClick={()=>abrirEditar(ultimo)}>
                        <div style={{fontWeight:900,fontSize:18,color:"#26536E"}}>${ultimo.precio.toLocaleString("es-AR")}/kg</div>
                        {diff!==null && (
                          <div style={{fontSize:11,fontWeight:600,color:diff>0?"#C33039":diff<0?"#2F6B4F":"#79828B"}}>
                            {diff>0?"▲":"▼"} {Math.abs(diff).toFixed(1)}% vs anterior
                          </div>
                        )}
                      </div>
                      <button onClick={()=>eliminarPrecio(ultimo.id, prod)} style={{background:"none",border:"none",color:"#C33039",fontSize:16,cursor:"pointer",padding:"2px 4px",opacity:0.5}}>✕</button>
                    </div>
                  </div>
                  {hist.length>1 && (
                    <div style={{display:"flex",gap:6,alignItems:"flex-end",marginBottom:8,height:36}}>
                      {hist.slice(0,8).reverse().map((h,i,arr)=>{
                        const min=Math.min(...arr.map(x=>x.precio));
                        const max=Math.max(...arr.map(x=>x.precio));
                        const pct=max===min?80:20+((h.precio-min)/(max-min))*60;
                        const isLast=i===arr.length-1;
                        return <div key={i} style={{flex:1,background:isLast?"#26536E":"#DCE5EB",borderRadius:"3px 3px 0 0",height:`${pct}%`,minHeight:4,transition:"height .3s"}} title={`$${h.precio}`}></div>;
                      })}
                    </div>
                  )}
                  <div style={{borderTop:"1px solid #EDEEF0",paddingTop:8}}>
                    {hist.slice(0,4).map((h,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",color:i===0?"#191E23":"#79828B",alignItems:"center"}}>
                        <span>{new Date(h.fecha).toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"2-digit"})}</span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontWeight:i===0?700:400}}>${h.precio.toLocaleString("es-AR")}/kg</span>
                          {i>0 && <button onClick={()=>eliminarPrecio(h.id, prod)} style={{background:"none",border:"none",color:"#B9BFC5",fontSize:12,cursor:"pointer",padding:0}}>✕</button>}
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
                      style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,outline:"none",background:"#fff"}}>
                      <option value="">— Seleccionar producto —</option>
                      {Object.entries(getProductos()).map(([cat, prods])=>(
                        <optgroup key={cat} label={cat}>
                          {prods.filter(p=>p).map(p=>{
                            const yaExiste = precios && precios[p];
                            return <option key={p} value={p} style={{color:yaExiste?"#A3ABB3":"#191E23"}}>{p}{yaExiste?" (ya cargado)":""}</option>;
                          })}
                        </optgroup>
                      ))}
                    </select>
                  ) : (
                    <input value={formProducto} onChange={e=>setFormProducto(e.target.value)}
                      style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid #D8DCE0",fontSize:14,outline:"none"}} />
                  )}
                </div>
                <div style={{marginBottom:20}}>
                  <label style={{display:"block",fontWeight:700,fontSize:12,color:"#3A424A",marginBottom:6}}>Precio por kg ($)</label>
                  <InputMonto value={formPrecio} onChange={v=>setFormPrecio(v)}
                    placeholder="0"
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
    function GestionProductos({ onBack }) {
      const [cats, setCats] = useState(null); // {cat: [prod,...]}
      const [guardando, setGuardando] = useState(false);
      const [modalCat, setModalCat] = useState(null); // cat seleccionada para agregar prod
      const [modalNuevaCat, setModalNuevaCat] = useState(false);
      const [inputProd, setInputProd] = useState("");
      const [inputCat, setInputCat] = useState("");
      const [expandida, setExpandida] = useState(null);

      async function cargar() {
        try {
          const {db,doc,getDoc} = fb();
          const snap = await getDoc(doc(db,"config","productos"));
          if(snap.exists()) {
            setCats(snap.data().categorias);
          } else {
            // Primera vez: usar PRODUCTOS hardcodeado como base
            setCats(PRODUCTOS);
          }
        } catch(e){ console.error(e); setCats(PRODUCTOS); }
      }

      async function guardar(nuevasCats) {
        setGuardando(true);
        try {
          const {db,doc,setDoc} = fb();
          await setDoc(doc(db,"config","productos"), { categorias: nuevasCats, updatedAt: new Date().toISOString() });
          window.__productosOverride = nuevasCats;
          setCats(nuevasCats);
        } catch(e){ alert("Error al guardar"); console.error(e); }
        setGuardando(false);
      }

      async function agregarProducto() {
        const nombre = inputProd.trim();
        if(!nombre) return;
        const nuevasCats = {...cats};
        if(!nuevasCats[modalCat]) nuevasCats[modalCat] = [];
        if(nuevasCats[modalCat].includes(nombre)){ alert("Ya existe ese producto en esta categoría"); return; }
        nuevasCats[modalCat] = [...nuevasCats[modalCat], nombre];
        await guardar(nuevasCats);
        setInputProd(""); setModalCat(null);
      }

      async function eliminarProducto(cat, prod) {
        if(!confirm(`¿Eliminar "${prod}" de ${cat}?`)) return;
        const nuevasCats = {...cats, [cat]: cats[cat].filter(p=>p!==prod)};
        await guardar(nuevasCats);
      }

      async function agregarCategoria() {
        const nombre = inputCat.trim();
        if(!nombre) return;
        if(cats[nombre]){ alert("Ya existe esa categoría"); return; }
        const nuevasCats = {...cats, [nombre]: []};
        await guardar(nuevasCats);
        setInputCat(""); setModalNuevaCat(false);
      }

      async function eliminarCategoria(cat) {
        if(cats[cat]?.length>0){ alert("Vaciá la categoría antes de eliminarla"); return; }
        if(!confirm(`¿Eliminar la categoría "${cat}"?`)) return;
        const nuevasCats = {...cats};
        delete nuevasCats[cat];
        await guardar(nuevasCats);
      }

      useEffect(()=>{
        if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar);
      },[]);

      const totalProds = cats ? Object.values(cats).flat().filter(p=>p).length : 0;

      return (
        <div className="crm-page">
          {/* Header */}
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(17,122,101,0.35)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:16}}>Gestión de Productos</div>
              <div style={{fontSize:11,opacity:.85}}>{cats?`${Object.keys(cats).length} categorías · ${totalProds} productos`:"Cargando..."}</div>
            </div>
            <button onClick={()=>setModalNuevaCat(true)}
              style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"1px solid rgba(255,255,255,0.4)",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12,fontWeight:700}}>
              + Categoría
            </button>
          </div>

          <div style={{padding:16}}>
            {!cats ? (
              <p style={{textAlign:"center",color:"#79828B",marginTop:60}}>Cargando...</p>
            ) : (
              Object.entries(cats).map(([cat, prods])=>{
                const abierta = expandida===cat;
                const prodsValidos = (prods||[]).filter(p=>p);
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
                          <button onClick={e=>{e.stopPropagation();eliminarCategoria(cat);}}
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
                            <button onClick={()=>eliminarProducto(cat,prod)}
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
                <input autoFocus style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,marginBottom:16,fontFamily:"inherit"}}
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
                <input autoFocus style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,marginBottom:16,fontFamily:"inherit"}}
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


    // ── CLIENTES: lo que está guardado a nombre de un cliente ──
    // Pedidos, remitos, precios, devoluciones y cuenta corriente no guardan el id
    // del cliente: lo nombran. Estas son las colecciones (y el campo) donde figura.
    const P2_DONDE_FIGURA_EL_CLIENTE = [
      ["cuentas_corrientes","nombre"], ["cc_movimientos","cliente"], ["precios_cliente","cliente"],
      ["pedidos","cliente"], ["remitos","cliente"], ["devoluciones","cliente"],
    ];

    /** Documentos de esas colecciones que nombran al cliente (misma regla que la cuenta corriente: sin mirar mayúsculas ni acentos). */
    async function p2GuardadoANombreDe(nombre, colecciones) {
      const { db, collection, getDocs } = fb();
      const out = [];
      for (const [col, campo] of colecciones) {
        const snap = await getDocs(collection(db, col));
        snap.docs.forEach(d => {
          const valor = d.data()[campo];
          if (ccMismoCliente(valor, nombre)) out.push({ col, id: d.id, campo, valor });
        });
      }
      return out;
    }

    /**
     * Guarda muchas escrituras de a tandas. Cada tanda se guarda entera o no se
     * guarda; `alFinal` va en la última (ahí se escribe la ficha del cliente, así
     * si algo falla antes la ficha queda como estaba y se puede reintentar).
     */
    async function p2GuardarEnTandas(pasos, alFinal) {
      const { db, runTransaction } = fb();
      const TANDA = 400; // una transacción admite hasta 500 escrituras
      let i = 0;
      do {
        const tanda = pasos.slice(i, i + TANDA);
        i += TANDA;
        const ultima = i >= pasos.length;
        await runTransaction(db, async tx => { tanda.forEach(p => p(tx)); if (ultima) alFinal(tx); });
      } while (i < pasos.length);
    }

    /**
     * Cambia el nombre de un cliente y lleva el nombre nuevo a todo lo que estaba
     * guardado con el anterior. Si hay otra ficha con el mismo nombre no se sabe
     * de cuál de las dos es cada cosa: ahí solo se cambia la ficha.
     * `guardado` es lo que devolvió p2GuardadoANombreDe para el nombre anterior.
     */
    async function p2RenombrarCliente(actual, datos, guardado) {
      const { db, doc } = fb();
      const ref = doc(db, "clientes", actual.id);
      const pasos = guardado
        .filter(g => g.valor !== datos.nombre)
        .map(g => tx => tx.update(doc(db, g.col, g.id), { [g.campo]: datos.nombre }));
      await p2GuardarEnTandas(pasos, tx => tx.update(ref, datos));
      await esperarCopiaLocal(ref, d => !!d && d.nombre === datos.nombre);
    }

    function GestionClientes({ onBack }) {
      const [clientes, setClientes] = useState(null);
      const [errorCarga, setErrorCarga] = useState(false);
      const [nombre, setNombre] = useState("");
      const [telefono, setTelefono] = useState("");
      const [direccion, setDireccion] = useState("");
      const [cuentaCorriente, setCuentaCorriente] = useState(false);
      const [editando, setEditando] = useState(null);
      const [clientePrecios, setClientePrecios] = useState(null);
      // Clientes que tienen cuenta corriente abierta (nombre normalizado). Las cuentas que se
      // abren desde Cuentas Corrientes, un remito o una venta rápida no tildan la ficha.
      const [conCuenta, setConCuenta] = useState(() => new Set());
      const tieneCuenta = c => !!c.cuentaCorriente || conCuenta.has(SersaleBase.norm(c.nombre));

      function verPrecios(nombreCliente) { setClientePrecios(nombreCliente); }

      async function cargar() {
        try {
          const { db, collection, getDocs, query, orderBy } = fb();
          const snap = await getDocs(query(collection(db,"clientes"), orderBy("nombre","asc")));
          setClientes(snap.docs.map(d=>({id:d.id,...d.data()})));
          setErrorCarga(false);
        } catch(e) {
          console.error("[Clientes] No se pudo cargar la lista:", e);
          setErrorCarga(true);
          return;
        }
        try {
          const { db, collection, getDocs } = fb();
          const cuentas = await getDocs(collection(db,"cuentas_corrientes"));
          setConCuenta(new Set(cuentas.docs.map(d=>d.data()).filter(c=>!c.mergedInto).map(c=>SersaleBase.norm(c.nombre)).filter(Boolean)));
        } catch(e) {
          // Sin las cuentas, la lista se muestra igual con la marca de cada ficha.
          console.error("[Clientes] No se pudieron leer las cuentas corrientes:", e);
        }
      }

      const [guardar, guardando] = SersaleBase.useAccion(async () => {
        const nom = nombre.trim();
        if (!nom) { SersaleUI.toast("Ingresá el nombre del cliente", { tipo: "error" }); return; }
        const { db, collection, addDoc, doc, updateDoc, getDocs, Timestamp } = fb();
        try {
          const todos = (await getDocs(collection(db,"clientes"))).docs.map(d=>({id:d.id,...d.data()}));
          const actual = editando ? todos.find(c=>c.id===editando) : null;
          if (editando && !actual) {
            SersaleUI.toast("Ese cliente ya no existe: lo eliminaron desde otro teléfono.", { tipo: "error" });
            cancelarEdicion();
            await cargar();
            return;
          }
          const datos = { nombre:nom, telefono:telefono.trim(), direccion:direccion.trim(), cuentaCorriente };
          const cambiaNombre = !!actual && actual.nombre !== nom;
          // Dos fichas con el mismo nombre parten el historial del cliente (y al borrar una se llevaba lo de la otra).
          if (!actual || cambiaNombre) {
            const repetido = todos.find(c => c.id !== editando && ccMismoCliente(c.nombre, nom));
            if (repetido) { SersaleUI.toast(`Ya hay un cliente cargado como "${repetido.nombre}".`, { tipo: "error" }); return; }
          }
          let aviso = actual ? "Cliente actualizado" : "Cliente guardado";
          if (cambiaNombre) {
            const hayOtroIgual = todos.some(c => c.id !== actual.id && ccMismoCliente(c.nombre, actual.nombre));
            const guardado = hayOtroIgual ? [] : (await p2GuardadoANombreDe(actual.nombre, P2_DONDE_FIGURA_EL_CLIENTE)).filter(g => g.valor !== nom);
            if (guardado.length) {
              const ok = await SersaleUI.confirmar({
                titulo: "¿Cambiar el nombre del cliente?",
                cuerpo: `"${actual.nombre}" pasa a llamarse "${nom}". El nombre nuevo se pone también en sus pedidos, remitos, precios y cuenta corriente (${guardado.length} registro${guardado.length!==1?"s":""}).`,
                aceptar: "Cambiar nombre"
              });
              if (!ok) return;
              aviso = "Nombre cambiado en la ficha, los pedidos, los precios y la cuenta corriente";
            }
            try {
              await p2RenombrarCliente(actual, datos, guardado);
            } catch(e) {
              // La ficha se escribe al final: si se cortó antes, sigue con el nombre viejo y repetir el cambio completa lo que faltó.
              console.error("[Clientes] Cambio de nombre incompleto:", e);
              SersaleUI.toast("No se pudo terminar el cambio de nombre. Tocá Actualizar otra vez para completarlo.", { tipo: "error", ms: 8000 });
              return;
            }
          } else if (actual) {
            await updateDoc(doc(db,"clientes",editando), datos);
          } else {
            await addDoc(collection(db,"clientes"), { ...datos, creadoEn:Timestamp.now() });
          }
          cancelarEdicion();
          SersaleUI.toast(aviso, { tipo: "ok" });
          await cargar();
        } catch(e) {
          console.error("[Clientes] Error al guardar:", e);
          SersaleUI.toast("No se pudo guardar. Probá de nuevo.", { tipo: "error" });
        }
      });

      const [eliminar, eliminando] = SersaleBase.useAccion(async (c) => {
        const { db, doc, collection, getDocs } = fb();
        try {
          const todos = (await getDocs(collection(db,"clientes"))).docs.map(d=>({id:d.id,...d.data()}));
          const hayOtroIgual = todos.some(x => x.id !== c.id && ccMismoCliente(x.nombre, c.nombre));
          let cuerpo, borrar = [];
          if (hayOtroIgual) {
            // Los precios y la cuenta se unen por nombre: con dos fichas iguales son de la que queda.
            cuerpo = "Hay otro cliente cargado con el mismo nombre: se borra solo esta ficha. Los precios, la cuenta corriente y sus movimientos quedan para el otro.";
          } else {
            const cuenta = await ccBuscarCuenta(c.nombre);
            const movs = await ccMovimientosDe(c.nombre, cuenta);
            const resto = await p2GuardadoANombreDe(c.nombre, [["precios_cliente","cliente"],["cuentas_corrientes","nombre"]]);
            borrar = [...movs.map(m=>({ col:"cc_movimientos", id:m.id })), ...resto];
            const saldo = cuenta ? Math.round(Number(cuenta.saldo)||0) : 0;
            cuerpo = "Se borran también sus precios guardados, su cuenta corriente y los movimientos de la cuenta."
              + (saldo>0 ? ` Hoy debe ${ccFmtSaldo(saldo)}: esa deuda deja de figurar.` : saldo<0 ? ` Tiene ${ccFmtSaldo(-saldo)} a favor: ese saldo deja de figurar.` : "")
              + " Los pedidos y remitos no se borran.";
          }
          const ok = await SersaleUI.confirmar({ titulo: `¿Eliminar a "${c.nombre}"?`, cuerpo, aceptar: "Eliminar", peligro: true });
          if (!ok) return;
          // Todo junto y la ficha al final: si se corta, el cliente sigue en la lista y se puede volver a eliminar.
          const ref = doc(db,"clientes",c.id);
          await p2GuardarEnTandas(borrar.map(b => tx => tx.delete(doc(db,b.col,b.id))), tx => tx.delete(ref));
          await esperarCopiaLocal(ref, d => d === null);
          if (editando === c.id) cancelarEdicion();
          SersaleUI.toast("Cliente eliminado", { tipo: "ok" });
        } catch(e) {
          console.error("[Clientes] Error al eliminar:", e);
          SersaleUI.toast("No se pudo eliminar el cliente. Probá de nuevo.", { tipo: "error" });
        }
        await cargar();
      });

      function iniciarEdicion(c) {
        setEditando(c.id); setNombre(c.nombre); setTelefono(c.telefono||""); setDireccion(c.direccion||""); setCuentaCorriente(tieneCuenta(c));
        window.scrollTo(0,0);
      }

      function cancelarEdicion() {
        setEditando(null); setNombre(""); setTelefono(""); setDireccion(""); setCuentaCorriente(false);
      }

      useEffect(()=>{ if(window.__fbReady) cargar(); else document.addEventListener("fbReady",cargar); },[]);

      if (clientePrecios) return <HistorialPrecios cliente={clientePrecios} onBack={()=>setClientePrecios(null)} />;

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={onBack} style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Clientes</div>
          </div>
          <div style={{padding:20}}>
            {/* Formulario */}
            <div style={{background:"#fff",borderRadius:14,border:`1.5px solid ${editando?"#A8702A":"#A4232A"}`,padding:16,marginBottom:20}}>
              <p style={{fontWeight:700,fontSize:13,color:editando?"#A8702A":"#A4232A",marginBottom:12}}>
                {editando ? "✏️ Editar cliente" : "➕ Nuevo cliente"}
              </p>
              <input style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:8}}
                placeholder="Nombre del cliente *" value={nombre} onChange={e=>setNombre(e.target.value)} />
              <input style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:8}}
                placeholder="Teléfono (opcional)" type="tel" value={telefono} onChange={e=>setTelefono(e.target.value)} />
              <input style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:8}}
                placeholder="Dirección de entrega" value={direccion} onChange={e=>setDireccion(e.target.value)} />
              <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,cursor:"pointer"}}>
                <input type="checkbox" checked={cuentaCorriente} onChange={e=>setCuentaCorriente(e.target.checked)} style={{width:18,height:18}} />
                <span style={{fontSize:14,color:"#3A424A"}}>Tiene cuenta corriente</span>
              </label>
              <div style={{display:"flex",gap:8}}>
                <button onClick={guardar} disabled={guardando}
                  style={{flex:1,padding:12,borderRadius:12,border:"none",background:guardando?"#B9BFC5":editando?"#A8702A":"#A4232A",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                  {guardando ? "Guardando..." : editando ? "Actualizar" : "Guardar"}
                </button>
                {editando && <button onClick={cancelarEdicion} style={{padding:"12px 16px",borderRadius:12,border:"1.5px solid #D8DCE0",background:"transparent",color:"#79828B",fontSize:14,cursor:"pointer"}}>Cancelar</button>}
              </div>
            </div>

            {/* Lista */}
            <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>
              Clientes registrados {clientes && `(${clientes.length})`}
            </p>
            {clientes===null ? (errorCarga
                ? <div style={{textAlign:"center",color:"#A4232A",marginTop:20}}>
                    <p style={{marginBottom:10}}>No se pudieron cargar los clientes.</p>
                    <button onClick={cargar} style={{padding:"12px 18px",borderRadius:12,border:"1.5px solid #A4232A",background:"#fff",color:"#A4232A",fontWeight:700,fontSize:14,cursor:"pointer"}}>Reintentar</button>
                  </div>
                : <p style={{textAlign:"center",color:"#79828B",marginTop:20}}>Cargando...</p>)
            : clientes.length===0
              ? <div style={{textAlign:"center",color:"#A3ABB3",marginTop:40}}><div style={{fontSize:48}}>👥</div><p>Sin clientes aún</p></div>
              : clientes.map(c=>(
                <div key={c.id} style={{background:"#fff",borderRadius:14,border:"1.5px solid #D8DCE0",padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14,color:"#191E23"}}>{c.nombre}</div>
                    <div style={{display:"flex",gap:10,marginTop:3,flexWrap:"wrap"}}>
                      {c.telefono && <span style={{fontSize:12,color:"#79828B"}}>📞 {c.telefono}</span>}
                      {tieneCuenta(c) && <span style={{fontSize:12,color:"#6B4E8E",fontWeight:600}}>💳 Cta Cte</span>}
                    </div>
                    {c.direccion && <div style={{fontSize:12,color:"#79828B",marginTop:2}}>📍 {c.direccion}</div>}
                  </div>
                  <button onClick={()=>verPrecios(c.nombre)} style={{padding:"6px 10px",borderRadius:8,border:"1.5px solid #26536E",background:"transparent",color:"#26536E",cursor:"pointer",fontSize:13}}>📈</button>
                  <button onClick={()=>iniciarEdicion(c)} aria-label={"Editar "+c.nombre} style={{padding:"6px 10px",borderRadius:8,border:"1.5px solid #D8DCE0",background:"transparent",color:"#5C666F",cursor:"pointer",fontSize:13}}>✏️</button>
                  <button onClick={()=>eliminar(c)} disabled={eliminando} aria-label={"Eliminar "+c.nombre} style={{padding:"6px 10px",borderRadius:8,border:"1.5px solid #fee",background:"#fee",color:"#A4232A",cursor:"pointer",fontSize:13}}>🗑️</button>
                </div>
              ))
            }
          </div>
        </div>
      );
    }

    let PRODUCTOS = {
      "Jamones Cocidos": ["Jamón Cocido Natural Sublime","Jamón Cocido Especial Bajo Sodio","Jamón Cocido de Pata"],
      "Paletas Cocidas": ["Fiambre Cocido de Paleta de Cerdo","Fiambre de Cerdo p/ Emparedados"],
      "Jamones Crudos y Bondiolas": ["Jamón Crudo c/ Hueso 12 Meses","Jamón Crudo Entero Listo s/ Hueso","Jamón Crudo Listo por 1/2 Punta","Jamón Crudo Listo por 1/2 Garrón","Bondiola Seca al Papel","Bondiola Seca Serrana"],
      "Embutidos Secos": ["Salamín Picado Fino","Salamín Picado Grueso","Sopresatta de Cerdo","Chorizo Tipo Candelario","Chorizo Tipo Cantimpalo","Longaniza Tipo Española","Longaniza Tipo Calabresa","Longaniza T/ Calabresa Bastón","Salame Tipo Milán","Salame Tipo Español","Salame Chacarero de Campo"],
      "Embutidos Frescos": ["Chorizo Puro Cerdo","Chorizo Especial Vacuno/Cerdo","Chorizo Bombón","Chorizo Bombón Puro Cerdo","Morcilla Criolla","Morcilla Criolla Rosca","Morcilla Criolla Bombón","Morcilla Vasca","Salchicha Fresca Parrillera"],
      "Cerdo y Varios": ["Pecho c/ Manta","Carré c/ Hueso","Bondiola Fresca","Pernil Fresco","Paleta Fresca","Costillitas de Cerdo","Matambrito de Cerdo","Cinta de Lomo","Ribs","Pollo","Churrasquitos de Cerdo"],
      "Quesos": ["Queso Tybo","Queso Roquefort","Queso Pategras","Queso Mar del Plata","Queso Sardo","Queso Reggianito","Queso Gruyere","Queso Cremoso","Queso Port Salut","Queso Mozzarella"],
      "Artículos Varios": [],
      "Pancetas y Ahumados": ["Panceta Ahumada","Panceta Salada","Lomo Ahumado","Lomo Tipo Suizo","Salchichas de Viena","Salchichas de Copetin","Pechito Ahumado"],
      "Pastas Finas": ["Mortadela Bocha","Mortadela Bologna","Mortadela Familiar","Salchichón c/ Jamón","Salchichón Primavera","Salchichón c/ Jamón Familiar","Salchichón Primavera Familiar"],
    };
    // Aplicar override desde Firebase si existe
    if(window.__productosOverride) PRODUCTOS = window.__productosOverride;
    // El catálogo de Firestore llega después de que corre este archivo (pedidos.html
    // avisa con "fbReady"): recién ahí se puede tomar. Sin esto PRODUCTOS quedaba
    // siempre con la lista fija y lo que la lee directo (pestaña Precios) no veía
    // los productos agregados desde "Productos".
    document.addEventListener("fbReady", () => { if(window.__productosOverride) PRODUCTOS = window.__productosOverride; });
    // Helper que siempre devuelve la versión más reciente
    function getProductos(){ return window.__productosOverride || PRODUCTOS; }

    const UNIDADES = ["kg","piezas","ganchos","bolsas","unidades"];
    // Un pedido viejo sin fecha mostraba "Invalid Date": ahora una raya.
    const fmt  = iso => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric"}); };
    const fmtH = iso => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}); };
    const today = () => SersaleBase.hoy();
    // ── EMAILJS ──────────────────────────────────────────────
    const EMAILJS_SVC = "service_u0mi57u";
    const EMAILJS_TPL = "template_efcs57a";
    const EMAILJS_KEY = "AGBFe1nQznm3aOdrm";

    async function enviarEmailAlertas(alertas) {
      if (typeof emailjs === "undefined" || alertas.length === 0) return false;
      emailjs.init({ publicKey: EMAILJS_KEY });
      // fechaPedido es un Timestamp (o falta): la fecha ya resuelta viene en _fechaDisplay.
      const fF = f => SersaleBase.fmtFecha(f) || "-";
      const hoyStr = new Date().toLocaleDateString("es-AR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
      let body = "ALERTAS DE RECONTACTO - " + hoyStr.toUpperCase() + "\n\n";
      body += alertas.length + " cliente(s) requieren recontacto:\n\n";
      alertas.forEach((a, i) => {
        const up = a.ultimoPedido;
        const prods = (up.items||[]).map(it=>it.producto).join(", ");
        const total = (up.items||[]).reduce((s,it)=>{ const kg=it.kgReal!=null?it.kgReal:parseFloat(it.cantidad)||0; return s+kg*(parseFloat(it.precio)||0); },0);
        body += (i+1)+". "+a.cliente+"\n";
        body += "   Dias sin pedir: "+a.diasSinPedir+"d (limite: "+a.diasAlerta+"d)\n";
        body += "   Ultimo pedido: "+fF(up._fechaDisplay || up.fechaEntrega || up.fechaPedido)+" - "+prods+"\n";
        if (total>0) body += "   Monto: $"+Math.round(total).toLocaleString("es-AR")+"\n";
        body += "\n";
      });
      body += "---\nFrigorifico Sersale - Sistema de Pedidos";
      try {
        await emailjs.send(EMAILJS_SVC, EMAILJS_TPL, { message: body });
        return true;
      } catch(e) { console.error("EmailJS error:", e); return false; }
    }

    async function verificarYEnviarAlertas(alertas) {
      if (!alertas || alertas.filter(a=>a.enAlerta).length === 0) return;
      try {
        const { db, doc, getDoc, setDoc } = fb();
        const hoy = SersaleBase.hoy(); // día de Buenos Aires: con el de UTC, después de las 21 mandaba otro mail y al día siguiente ninguno
        const ref = doc(db, "config", "ultima_alerta_email");
        const snap = await getDoc(ref);
        if (snap.exists() && snap.data().fecha === hoy) return;
        const activas = alertas.filter(a=>a.enAlerta);
        const ok = await enviarEmailAlertas(activas);
        if (ok) await setDoc(ref, { fecha: hoy, cantidad: activas.length, updatedAt: new Date().toISOString() });
      } catch(e) { console.error(e); }
    }

        const fb = () => ({ db: window.__db, ...window.__fb });

    // Mark client as recently contacted (removes from alerts/suggestions)
    // `opciones.cuentaCorriente`: si hay que crear la ficha (cliente cargado con "Otro"),
    // se guarda con la marca de cuenta corriente que se tildó en el pedido.
    // Devuelve true si quedó guardado y false si no se pudo (para que quien la llama pueda avisar).
    async function marcarContacto(nombreCliente, opciones) {
      if(!nombreCliente) return false;
      try {
        const { db, collection, getDocs, query, where, doc, updateDoc, addDoc } = fb();
        // Find client doc by name (sin mirar mayúsculas, acentos ni espacios de más)
        const snap = await getDocs(collection(db,"clientes"));
        let found = null;
        snap.docs.forEach(d => {
          const data = d.data();
          if(data.nombre && SersaleBase.mismoNombre(data.nombre, nombreCliente)) found = d;
        });
        if(found) {
          await updateDoc(doc(db,"clientes",found.id), {
            ultimoContacto: new Date().toISOString(),
            ultimoPedidoRegistrado: SersaleBase.hoy()
          });
          console.log("[Contacto] Marked as contacted:", nombreCliente);
        } else {
          // Client not in clientes collection - create entry
          await addDoc(collection(db,"clientes"), {
            nombre: nombreCliente,
            telefono: "",
            direccion: "",
            cuentaCorriente: !!(opciones && opciones.cuentaCorriente),
            ultimoContacto: new Date().toISOString(),
            ultimoPedidoRegistrado: SersaleBase.hoy(),
            creadoEn: new Date().toISOString()
          });
          console.log("[Contacto] Created client + marked as contacted:", nombreCliente);
        }
        return true;
      } catch(e) { console.error("[Contacto] Error:", e); return false; }
    }

    function getLastSeen() { return localStorage.getItem(LAST_SEEN_KEY) || "2000-01-01T00:00:00.000Z"; }
    function setLastSeen() { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); }

    // ── HOME ────────────────────────────────────────────────
    function Home({ onSelect, nuevosPedidos }) {
      return (
        <div className="crm-page">
          <div style={{background:"radial-gradient(120% 90% at 50% -10%, rgba(164,35,42,.55) 0%, rgba(164,35,42,0) 60%), #12161A",borderBottom:"2px solid #A4232A",padding:"38px 20px 30px",textAlign:"center"}}>
            <img src="assets/logo.png" alt="Sersale" style={{height:110,width:"auto",marginBottom:12,filter:"drop-shadow(0 3px 12px rgba(0,0,0,0.5))"}} />
            <div style={{color:"#fff",fontWeight:900,fontSize:24,letterSpacing:"-0.5px"}}>Frigorífico Sersale</div>
            <div style={{color:"rgba(255,255,255,0.8)",fontSize:14,marginTop:4}}>Sistema de Pedidos</div>
          </div>
          <div style={{padding:20}}>
            <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,margin:"8px 0 14px"}}>¿Quién sos?</p>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(280px, 1fr))",gap:12}}>
              {[
                {key:"comercial", icon:"💼", label:"Comercial",  desc:"Cargar y gestionar pedidos",            color:"#A4232A", showBadge:false},
                {key:"deposito",  icon:"🏭", label:"Depósito",   desc:"Ver pedidos a preparar y despachar",    color:"#26536E", showBadge:true},
                {key:"director",  icon:"📊", label:"Director",   desc:"Panel general y cuentas corrientes",    color:"#2A333B", showBadge:true},
                {key:"clientes",  icon:"👥", label:"Clientes",   desc:"Agregar, editar y eliminar clientes",   color:"#6B4E8E", showBadge:false},
                {key:"productos", icon:"🥩", label:"Productos",  desc:"Agregar productos a cada categoría",      color:"#1F5E56", showBadge:false},
              ].map(v=>(
                <button key={v.key} onClick={()=>onSelect(v.key)}
                  style={{display:"flex",alignItems:"center",gap:16,padding:"18px 20px",borderRadius:16,border:`2px solid ${v.color}`,background:"#fff",cursor:"pointer",textAlign:"left"}}>
                  <span style={{fontSize:32}}>{v.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center"}}>
                      <span style={{fontWeight:800,fontSize:16,color:v.color}}>{v.label}</span>
                      {v.showBadge && nuevosPedidos>0 && <span className="new-badge">{nuevosPedidos}</span>}
                    </div>
                    <div style={{fontSize:13,color:"#79828B",marginTop:2}}>{v.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            {nuevosPedidos>0 && (
              <div style={{marginTop:16,padding:"14px 16px",background:"#F0E7D9",borderRadius:14,border:"1.5px solid #A8702A",fontSize:13,color:"#784212",textAlign:"center",fontWeight:600}}>
                🛒 {nuevosPedidos} pedido{nuevosPedidos!==1?"s":""} nuevo{nuevosPedidos!==1?"s":""} desde tu última visita
              </div>
            )}
          </div>
        </div>
      );
    }

    // ── SELECTOR DE CLIENTE BUSCABLE (con búsqueda + orden alfabético) ──
    function SelectorClienteBuscable({ valor, onChange, clientes, placeholder }) {
      const [abierto, setAbierto] = useState(false);
      const [busqueda, setBusqueda] = useState("");
      const refContenedor = React.useRef(null);
      const refInput = React.useRef(null);

      useEffect(()=>{
        function handleClickFuera(e) {
          if (refContenedor.current && !refContenedor.current.contains(e.target)) {
            setAbierto(false); setBusqueda("");
          }
        }
        if (abierto) document.addEventListener("mousedown", handleClickFuera);
        return ()=>document.removeEventListener("mousedown", handleClickFuera);
      },[abierto]);

      useEffect(()=>{
        if (abierto && refInput.current) refInput.current.focus();
      },[abierto]);

      // Separar "Otro" del resto y ordenar el resto alfabéticamente
      const tieneOtro = clientes.includes("Otro");
      const resto = clientes.filter(c=>c!=="Otro").sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
      const ordenados = tieneOtro ? [...resto, "Otro"] : resto;

      // Sin mirar acentos ni mayúsculas ("lopez" encuentra "López"). "Otro" queda
      // siempre a mano: si el cliente no está, se toca ahí y el nombre buscado ya va cargado.
      const q = busqueda.trim();
      const filtrados = q ? ordenados.filter(c=>c==="Otro" || SersaleBase.coincide(c, q)) : ordenados;

      function seleccionar(c) {
        onChange(c, q);
        setAbierto(false);
        setBusqueda("");
      }

      return (
        <div ref={refContenedor} style={{position:"relative",marginBottom:8}}>
          <button type="button" onClick={()=>setAbierto(!abierto)}
            style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{color:valor?"#191E23":"#79828B"}}>{valor || (placeholder || "— Seleccioná un cliente —")}</span>
            <span style={{color:"#79828B",fontSize:12,marginLeft:8}}>{abierto?"▲":"▼"}</span>
          </button>
          {abierto && (
            <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"#fff",border:"1.5px solid #D8DCE0",borderRadius:12,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",zIndex:1000,maxHeight:320,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{position:"relative",padding:8,borderBottom:"1px solid #E4E7EA"}}>
                <input ref={refInput}
                  style={{width:"100%",padding:"8px 12px 8px 32px",borderRadius:8,border:"1.5px solid #D8DCE0",fontSize:14,outline:"none",boxSizing:"border-box"}}
                  placeholder="Buscar cliente..."
                  value={busqueda} onChange={e=>setBusqueda(e.target.value)} />
                <span style={{position:"absolute",left:18,top:"50%",transform:"translateY(-50%)",fontSize:14,color:"#A3ABB3"}}>🔍</span>
              </div>
              <div style={{overflowY:"auto",flex:1}}>
                {filtrados.length===0
                  ? <div style={{padding:"16px 14px",textAlign:"center",color:"#A3ABB3",fontSize:13}}>Sin resultados</div>
                  : filtrados.map(c=>(
                    <button key={c} type="button" onClick={()=>seleccionar(c)}
                      style={{width:"100%",padding:"10px 14px",border:"none",background:c===valor?"#F7EAEA":"#fff",textAlign:"left",cursor:"pointer",fontSize:14,color:c==="Otro"?"#6B4E8E":"#191E23",fontWeight:c===valor||c==="Otro"?600:400,borderBottom:"1px solid #F2F3F5"}}
                      onMouseEnter={e=>{ if(c!==valor) e.currentTarget.style.background="#F7F8F9"; }}
                      onMouseLeave={e=>{ if(c!==valor) e.currentTarget.style.background="#fff"; }}>
                      {c==="Otro" ? "➕ Otro (cliente nuevo)" : c}
                    </button>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── NUEVO PEDIDO ────────────────────────────────────────
    // ── BUSCADOR RÁPIDO DE PRODUCTOS ─────────────────────────
    // Busca en todo el catálogo sin pasar por categoría. Tolera acentos
    // y permite varias palabras sueltas ("crudo hueso" → "Jamón Crudo c/ Hueso").
    function BuscadorProductos({ onElegir, yaElegidos }) {
      const [q, setQ] = useState("");
      const [marcado, setMarcado] = useState(0);
      const refInput = React.useRef(null);
      const refLista = React.useRef(null);

      const normalizar = t => (t||"").toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
        .replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();

      // Catálogo plano: producto + su categoría. Se rearma si llega (o cambia) el catálogo de Firestore.
      const productosAhora = getProductos();
      const catalogo = React.useMemo(()=>{
        const out = [];
        Object.entries(productosAhora).forEach(([cat, prods])=>{
          (prods||[]).forEach(prod=>{ if(prod) out.push({prod, cat, norm:normalizar(prod), normCat:normalizar(cat)}); });
        });
        return out;
      },[productosAhora]);

      const resultados = React.useMemo(()=>{
        const term = normalizar(q);
        if(!term) return [];
        const palabras = term.split(" ");
        return catalogo
          .map(e=>{
            const texto = e.norm + " " + e.normCat;
            if(!palabras.every(w=>texto.includes(w))) return null;
            // Prioridad: empieza con lo buscado > lo tiene el nombre > solo la categoría
            let peso = 2;
            if(e.norm.startsWith(term)) peso = 0;
            else if(e.norm.includes(term)) peso = 1;
            return {...e, peso};
          })
          .filter(Boolean)
          .sort((a,b)=> a.peso!==b.peso ? a.peso-b.peso : a.prod.localeCompare(b.prod,"es"))
          .slice(0,8);
      },[q, catalogo]);

      useEffect(()=>{ setMarcado(0); },[q]);

      // Mantener a la vista el resultado marcado con las flechas
      useEffect(()=>{
        if(!refLista.current) return;
        const fila = refLista.current.children[marcado];
        if(fila && fila.scrollIntoView) fila.scrollIntoView({block:"nearest"});
      },[marcado]);

      function elegir(r) {
        onElegir(r.cat, r.prod);
        setQ("");
        setMarcado(0);
        if(refInput.current) refInput.current.focus();
      }

      function onKeyDown(e) {
        if(!resultados.length) return;
        if(e.key==="ArrowDown"){ e.preventDefault(); setMarcado(m=>(m+1)%resultados.length); }
        else if(e.key==="ArrowUp"){ e.preventDefault(); setMarcado(m=>(m-1+resultados.length)%resultados.length); }
        else if(e.key==="Enter"){ e.preventDefault(); elegir(resultados[marcado]); }
        else if(e.key==="Escape"){ setQ(""); }
      }

      return (
        <div style={{marginBottom:10}}>
          <div style={{position:"relative"}}>
            <input ref={refInput} value={q} onChange={e=>setQ(e.target.value)} onKeyDown={onKeyDown}
              placeholder="Buscar producto y agregarlo..."
              style={{width:"100%",padding:"12px 14px 12px 38px",borderRadius:12,
                border:"1.5px solid "+(q?"#A4232A":"#D8DCE0"),fontSize:14,background:"#fff",
                outline:"none",boxSizing:"border-box",fontFamily:"inherit"}} />
            <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",fontSize:14,color:"#A3ABB3"}}>🔍</span>
            {q && (
              <button type="button" onClick={()=>{setQ(""); if(refInput.current) refInput.current.focus();}}
                style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",border:"none",
                  background:"none",color:"#A3ABB3",fontSize:15,cursor:"pointer",padding:4,lineHeight:1}}>✕</button>
            )}
          </div>
          {q && (
            <div style={{marginTop:6,background:"#fff",border:"1.5px solid #D8DCE0",borderRadius:12,
              overflow:"hidden",boxShadow:"0 8px 24px rgba(18,22,26,0.10)"}}>
              {resultados.length===0
                ? <div style={{padding:"14px",textAlign:"center",color:"#A3ABB3",fontSize:13}}>
                    Sin resultados — podés cargarlo con el selector de abajo
                  </div>
                : <div ref={refLista} style={{maxHeight:260,overflowY:"auto"}}>
                    {resultados.map((r,idx)=>{
                      const repetido = (yaElegidos||[]).includes(r.prod);
                      return (
                        <button key={r.cat+"|"+r.prod} type="button"
                          onClick={()=>elegir(r)} onMouseEnter={()=>setMarcado(idx)}
                          style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",
                            gap:10,padding:"10px 13px",border:"none",cursor:"pointer",textAlign:"left",
                            borderBottom:idx<resultados.length-1?"1px solid #F2F3F5":"none",
                            background:idx===marcado?"#F7EAEA":"#fff",fontFamily:"inherit"}}>
                          <span style={{minWidth:0}}>
                            <span style={{display:"block",fontSize:13.5,fontWeight:600,color:"#191E23"}}>{r.prod}</span>
                            <span style={{display:"block",fontSize:11,color:"#79828B",marginTop:1}}>{r.cat}</span>
                          </span>
                          <span style={{flexShrink:0,fontSize:11,fontWeight:700,
                            color:repetido?"#A8702A":"#A4232A"}}>{repetido?"ya está":"+ agregar"}</span>
                        </button>
                      );
                    })}
                  </div>
              }
              <div style={{padding:"7px 13px",background:"#F7F8F9",borderTop:"1px solid #F2F3F5",
                fontSize:10.5,color:"#A3ABB3"}}>Enter agrega · ↑↓ para moverte · Esc limpia</div>
            </div>
          )}
        </div>
      );
    }

    function NuevoPedido({ onBack, onSaved }) {
      const [cliente, setCliente] = useState("");
      const [clienteCustom, setClienteCustom] = useState("");
      const [cuentaCorriente, setCuentaCorriente] = useState(false);
      const [entrega, setEntrega] = useState("");
      const [items, setItems] = useState([{categoria:"",producto:"",cantidad:"",unidad:"kg",obs:""}]);
      const [tipo, setTipo] = useState("");
      const [obsGeneral, setObsGeneral] = useState("");
      const [clientesDB, setClientesDB] = useState([]);
      const [saldoCC, setSaldoCC] = useState(null);
      const consultaSaldo = React.useRef(0);

      useEffect(()=>{
        async function cargarClientes() {
          try {
            const { db, collection, getDocs, query, orderBy } = fb();
            const snap = await getDocs(query(collection(db,"clientes"), orderBy("nombre","asc")));
            setClientesDB(snap.docs.map(d=>({id:d.id,...d.data()})));
          } catch(e) {
            console.error("[Pedido] No se pudieron cargar los clientes:", e);
            SersaleUI.toast("No se pudieron cargar los clientes. Volvé a entrar a Nuevo Pedido.", { tipo: "error" });
          }
        }
        if(window.__fbReady) cargarClientes(); else document.addEventListener("fbReady",cargarClientes);
      },[]);

      // Al seleccionar cliente, auto-marcar cuenta corriente si corresponde.
      // `buscado` es lo que se había escrito en el buscador (sirve de nombre al elegir "Otro").
      async function onSelectCliente(val, buscado) {
        setCliente(val);
        setSaldoCC(null);
        const turno = ++consultaSaldo.current; // si se cambia de cliente antes de que llegue el saldo, el que llega tarde se descarta
        if (val==="Otro" && buscado && !clienteCustom.trim()) setClienteCustom(buscado);
        const found = clientesDB.find(c=>c.nombre===val);
        setCuentaCorriente(!!(found && found.cuentaCorriente));
        if (!val || val==="Otro") return;
        try {
          // La cuenta se busca aunque la ficha no tenga la marca: las que se abren
          // desde "Cuentas Corrientes" no la ponen, y la deuda tiene que verse igual.
          const cuenta = await ccBuscarCuenta(val);
          if (turno !== consultaSaldo.current) return;
          if (cuenta) { setSaldoCC(Number(cuenta.saldo)||0); setCuentaCorriente(true); }
        } catch(e) {
          console.error("[Pedido] No se pudo leer la cuenta corriente:", e);
          if (turno === consultaSaldo.current) SersaleUI.toast("No se pudo consultar el saldo de la cuenta corriente.", { tipo: "error" });
        }
      }

      // Volver con un pedido a medio cargar: se pregunta antes de perderlo.
      async function volver() {
        const hayCarga = items.some(it=>it.producto||it.cantidad) || !!obsGeneral.trim();
        if (hayCarga) {
          const salir = await SersaleUI.confirmar({ titulo: "¿Salir sin guardar?", cuerpo: "Se pierde lo que cargaste en este pedido.", aceptar: "Salir", cancelar: "Seguir cargando", peligro: true });
          if (!salir) return;
        }
        onBack();
      }

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

      // Los clientes cargados en Clientes + "Otro". (Antes se sumaban nueve nombres de
      // demostración escritos en el código, que no eran clientes de la base.)
      const todosClientes = [
        ...clientesDB.map(c=>c.nombre),
        "Otro"
      ];

      const [guardar, guardando] = SersaleBase.useAccion(async () => {
        const falta = texto => { SersaleUI.toast(texto, { tipo: "error" }); };
        let nombreCliente = cliente==="Otro" ? clienteCustom.trim() : cliente;
        if (!nombreCliente) return falta("Seleccioná o ingresá el cliente");
        if (cliente==="Otro") {
          // Si el nombre escrito a mano es el de un cliente que ya está (con otra
          // mayúscula o sin acento), el pedido va a nombre de ese cliente.
          const existente = clientesDB.find(c=>SersaleBase.mismoNombre(c.nombre, nombreCliente));
          if (existente) nombreCliente = existente.nombre;
        }
        if (!tipo) return falta("Seleccioná si es envío o retiro");
        if (!entrega) return falta("Ingresá la fecha de entrega");
        // Una fila a medio cargar (producto sin cantidad o al revés) frena el guardado:
        // antes se descartaba sin avisar y el pedido salía incompleto.
        const val = [];
        for (let i=0; i<items.length; i++) {
          const it = items[i];
          const prod = String(it.producto||"").trim(), cant = String(it.cantidad==null?"":it.cantidad).trim();
          if (!prod && !cant) continue;
          if (!prod) return falta(`Al ítem ${i+1} le falta el producto`);
          if (!cant) return falta(`Al ítem ${i+1} (${prod}) le falta la cantidad`);
          if (!(parseFloat(cant) > 0)) return falta(`La cantidad del ítem ${i+1} (${prod}) tiene que ser mayor a 0`);
          val.push(it);
        }
        if (!val.length) return falta("Agregá al menos un producto");
        try {
          const { db, collection, addDoc, Timestamp } = fb();
          const pedidoRef = await addDoc(collection(db,"pedidos"), {
            cliente: nombreCliente, cuentaCorriente, tipo,
            fechaPedido: Timestamp.now(),
            fechaPedidoISO: new Date().toISOString(),
            fechaEntrega: entrega,
            items: val, obs: obsGeneral.trim(),
            estado: "pendiente",
            historial: [{estado:"pendiente", fecha:new Date().toISOString(), nota:"Pedido creado"}]
          });
          // Si tiene cuenta corriente, se anota el "Pendiente de facturar" ($0, el importe lo pone
          // el remito) atado al pedido con pedidoId. Sin cuenta abierta no se anota nada: la
          // cuenta y el cargo los crea el remito.
          let sinPendiente = false;
          if(cuentaCorriente) {
            try {
              const cuenta = await ccBuscarCuenta(nombreCliente);
              if (cuenta) {
                await ccAsentarMovimiento({
                  cliente: nombreCliente, cuenta,
                  ultimoMovimiento: cuenta.ultimoMovimiento, // un pendiente de $0 no cambia la fecha del último movimiento
                  datos: {
                    tipo:"pedido", monto:0, fecha:entrega,
                    detalle:val.map(it=>it.producto).join(", "), obs:"Pendiente de facturar",
                    origen:"pedido_app", pedidoId:pedidoRef.id
                  }
                });
              }
            } catch(e){ console.error("[Pedido] No se pudo anotar el pendiente en la cuenta corriente:", e); sinPendiente = true; }
          }
          // Mark client as contacted for alerts/suggestions
          marcarContacto(nombreCliente, { cuentaCorriente });
          if (sinPendiente) SersaleUI.toast("Pedido guardado. No se pudo anotar el pendiente en la cuenta corriente: el cargo se hace con el remito.", { tipo: "info", ms: 6000 });
          else SersaleUI.toast("Pedido guardado", { tipo: "ok" });
          onSaved();
        } catch(e) {
          console.error("[Pedido] Error al guardar:", e);
          SersaleUI.toast("No se pudo guardar el pedido. Probá de nuevo.", { tipo: "error" });
        }
      });

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={volver} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:0}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Nuevo Pedido</div>
          </div>
          <div style={{padding:20}}>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Cliente</label>
            <SelectorClienteBuscable valor={cliente} onChange={onSelectCliente} clientes={todosClientes} />
            {cliente==="Otro" && (
              <input style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",marginBottom:8}}
                placeholder="Nombre del cliente" value={clienteCustom} onChange={e=>setClienteCustom(e.target.value)} />
            )}
            {saldoCC !== null && (
              <div data-saldo-cc style={{borderRadius:12,padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:8,
                background:saldoCC>50000?"#F7EAEA":saldoCC>0?"#F3EEE2":"#E9F0EC",
                border:`1.5px solid ${saldoCC>50000?"#C33039":saldoCC>0?"#B5872F":"#2F6B4F"}`}}>
                <span style={{fontSize:18}}>{saldoCC>50000?"⚠️":saldoCC>0?"💳":"✅"}</span>
                <div>
                  <div style={{fontWeight:700,fontSize:13,color:saldoCC>50000?"#A4232A":saldoCC>0?"#A8702A":"#2F6B4F"}}>
                    {ccEstadoSaldo(saldoCC)==="debe" ? "Saldo pendiente: "+ccFmtSaldo(saldoCC)
                      : ccEstadoSaldo(saldoCC)==="a_favor" ? "Saldo a favor: "+ccFmtSaldo(-saldoCC)
                      : "Cuenta corriente al día"}
                  </div>
                  {saldoCC>50000&&<div style={{fontSize:11,color:"#C33039"}}>Este cliente tiene deuda elevada</div>}
                </div>
              </div>
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
              value={entrega} onChange={e=>setEntrega(e.target.value)} min={today()} />
            <p style={{fontWeight:700,fontSize:13,color:"#5C666F",textTransform:"uppercase",letterSpacing:1,margin:"0 0 10px"}}>Productos</p>
            <BuscadorProductos onElegir={agregarDesdeBuscador} yaElegidos={items.map(it=>it.producto).filter(Boolean)} />
            {items.map((item,i)=>(
              <div key={i} style={{background:"#fff",borderRadius:14,border:"1.5px solid #A4232A",padding:14,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontWeight:600,color:"#A4232A",fontSize:13}}>Ítem {i+1}</span>
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
                        {[...(getProductos()[item.categoria]||[])].sort((a,b)=>a.localeCompare(b,"es")).map(p=><option key={p} value={p}>{p}</option>)}
                      </select>
                )}
                <div style={{display:"flex",gap:8}}>
                  <input style={{flex:1,padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none"}}
                    type="number" inputMode="decimal" min="0" step="any" placeholder="Cantidad" value={item.cantidad} onChange={e=>updItem(i,"cantidad",e.target.value)} />
                  <select style={{width:110,padding:"12px 10px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none"}}
                    value={item.unidad} onChange={e=>updItem(i,"unidad",e.target.value)}>
                    {UNIDADES.map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <input style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:13,background:"#fff",marginTop:8}}
                  placeholder="Observación (opcional)" value={item.obs} onChange={e=>updItem(i,"obs",e.target.value)} />
              </div>
            ))}
            <button onClick={addItem} style={{width:"100%",padding:12,borderRadius:12,border:"2px dashed #A4232A",background:"transparent",cursor:"pointer",fontWeight:600,fontSize:14,color:"#A4232A",marginBottom:16}}>
              + Agregar otro producto
            </button>
            <label style={{display:"block",fontWeight:600,fontSize:13,color:"#3A424A",marginBottom:6}}>Observaciones generales</label>
            <textarea style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1.5px solid #D8DCE0",fontSize:14,background:"#fff",outline:"none",height:70,resize:"none"}}
              placeholder="Notas sobre el pedido, horario de entrega, etc." value={obsGeneral} onChange={e=>setObsGeneral(e.target.value)} />
            <button onClick={guardar} disabled={guardando}
              style={{width:"100%",padding:16,borderRadius:14,border:"none",background:guardando?"#B9BFC5":"#A4232A",color:"#fff",fontWeight:800,fontSize:16,cursor:"pointer",marginTop:12}}>
              {guardando ? "Guardando..." : "✓ Guardar Pedido"}
            </button>
          </div>
        </div>
      );
    }


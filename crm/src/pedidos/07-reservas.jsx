    // ── RESERVAS DE FIN DE AÑO ──────────────────────────────
    // Lo que los clientes dejan reservado para las fiestas: quién, qué, cuántos
    // kilos, a qué precio se acordó, cuánto dejó de seña y cuándo retira.
    //
    // Colección `reservas` (un documento por ítem reservado):
    //   fechaReserva  "AAAA-MM-DD"  día en que se tomó la reserva
    //   cliente       texto         nombre de quien reserva
    //   contacto      texto         teléfono, dirección o lo que haga falta para ubicarlo
    //   item          texto         "LECHÓN", un producto del catálogo o texto libre
    //   cantidad      número|null   cuántas unidades reserva ("2 lechones"). null, 1 o falta = una.
    //                               Con más de una, kg y kgHasta son los kilos DE CADA UNA
    //   kg            número        kilos pedidos (si dio un rango, el mínimo)
    //   kgHasta       número|null   tope cuando no pidió un peso justo ("de 10 a 12 kg" → 12): hasta
    //                               cuántos kilos se le puede vender. null (o falta) = peso justo
    //   precioKg      número|null   precio acordado por kilo (null = a convenir)
    //   sena          número        seña que dejó (0 = no dejó nada)
    //   fechaRetiro   "AAAA-MM-DD"  día en que retira ("" = a confirmar)
    //   sucursal      "patricios" | "caballito"  por cuál retira (opcional: las reservas viejas no lo
    //                               tienen y se deduce de la observación; ver rsvSucursal)
    //   obs           texto
    //   estado        "pendiente" | "entregada"
    //   creadoEn / actualizadoEn (ISO), creadoPor (usuario)

    const RSV_ITEMS_FIESTAS = ["LECHÓN", "CORDERO", "COCHINILLO", "MEDIO LECHÓN", "MEDIO CORDERO"];
    const RSV_OTRO = "__otro__";
    // Sucursal por la que retira. Las reservas anteriores a este campo no lo tienen: se toma
    // de la observación ("retira por Senillosa") y, si no dice nada, es Parque Patricios.
    const RSV_SUCURSALES = [
      { id: "patricios", nombre: "Parque Patricios", calle: "24 de Noviembre 1926" },
      { id: "caballito", nombre: "Caballito", calle: "Senillosa 626" },
    ];
    function rsvSucursal(r) {
      const s = r && r.sucursal;
      if (s === "patricios" || s === "caballito") return s;
      return /senillosa|caballito/i.test(String((r && r.obs) || "")) ? "caballito" : "patricios";
    }
    const rsvSucursalNombre = r => RSV_SUCURSALES.find(x => x.id === rsvSucursal(r)).nombre;
    const RSV_BAJADAS = "sersale_rsv_bajadas"; // marca en el teléfono: las reservas ya se bajaron del servidor alguna vez

    /** Cuántas unidades reserva ("2 lechones" → 2). Las reservas sin el dato son de una. */
    function rsvCant(r) {
      const n = Math.floor(Number(r && r.cantidad) || 0);
      return n > 1 ? n : 1;
    }
    /** Kilos de toda la reserva (los de cada unidad × la cantidad), tomando el mínimo del rango. */
    function rsvKgTot(r) {
      return (Number(r.kg) || 0) * rsvCant(r);
    }
    /** Total estimado de la reserva (kg × cantidad × precio), o null si falta kilos o precio. */
    function rsvTotal(r) {
      const kg = rsvKgTot(r), precio = Number(r.precioKg) || 0;
      return kg > 0 && precio > 0 ? SersaleBase.redondear(kg * precio, 0) : null;
    }
    /** Lo que falta cobrar al retirar (total − seña), o null si no hay total. */
    function rsvResta(r) {
      const total = rsvTotal(r);
      return total == null ? null : SersaleBase.redondear(total - (Number(r.sena) || 0), 0);
    }
    /** Kilos para mostrar: "30,4 kg". */
    function rsvKg(n) {
      return SersaleBase.fmtNumero(Number(n) || 0, 3) + " kg";
    }
    /** Tope de kilos cuando el cliente dio un rango ("de 10 a 12 kg" → 12); null si pidió un peso justo. */
    function rsvKgHasta(r) {
      const kg = Number(r.kg) || 0, hasta = Number(r.kgHasta) || 0;
      return hasta > kg ? hasta : null;
    }
    /** "10 kg", o "10 a 12 kg" si el máximo es mayor que el mínimo. */
    function rsvKgRango(min, max) {
      const a = SersaleBase.redondear(Number(min) || 0, 3), b = SersaleBase.redondear(Number(max) || 0, 3);
      return b > a ? SersaleBase.fmtNumero(a, 3) + " a " + rsvKg(b) : rsvKg(a);
    }
    /** Lo máximo que puede llevar una reserva entera: el tope del rango (o los kilos si pidió un peso justo) × la cantidad. */
    function rsvKgMax(r) {
      const hasta = rsvKgHasta(r);
      return (hasta != null ? hasta : Number(r.kg) || 0) * rsvCant(r);
    }
    /** Kilos de una reserva para mostrar: "10 kg", "10 a 12 kg" o, con más de una unidad, "2 × 10 a 12 kg". */
    function rsvKgTexto(r) {
      return (rsvCant(r) > 1 ? rsvCant(r) + " × " : "") + rsvKgRango(r.kg, rsvKgHasta(r));
    }
    /** Total si se lleva el tope del rango; null si no dio un rango o falta el precio. */
    function rsvTotalMax(r) {
      const hasta = rsvKgHasta(r), precio = Number(r.precioKg) || 0;
      return hasta != null && precio > 0 ? SersaleBase.redondear(hasta * rsvCant(r) * precio, 0) : null;
    }
    /** Lo que faltaría cobrar si se lleva el tope del rango; null si no dio un rango o falta el precio. */
    function rsvRestaMax(r) {
      const total = rsvTotalMax(r);
      return total == null ? null : SersaleBase.redondear(total - (Number(r.sena) || 0), 0);
    }
    /** "$85.000", o "$85.000 a $105.000" si hay un máximo mayor. */
    function rsvMontoRango(min, max) {
      return max != null && max > min ? SersaleBase.fmtMonto(min) + " a " + SersaleBase.fmtMonto(max) : SersaleBase.fmtMonto(min);
    }
    /**
     * Lo que falta cobrar de una reserva, en palabras: "$85.000", "$85.000 a $105.000",
     * "hasta $20.000" (la seña ya cubre el mínimo del rango) o "" si no queda nada.
     */
    function rsvRestaTexto(r) {
      const min = rsvResta(r), max = rsvRestaMax(r);
      if (min == null) return "";
      if (min > 0) return rsvMontoRango(min, max);
      return max != null && max > 0 ? "hasta " + SersaleBase.fmtMonto(max) : "";
    }
    /**
     * Kilos del campo (SersaleBase.InputDecimal los entrega con punto decimal: "10.250")
     * → número. En kilos el punto nunca separa miles: con SersaleBase.numero(), que es
     * para montos, "10,250" se guardaba como 10.250 kg.
     */
    function rsvKilos(v) {
      const n = parseFloat(v);
      return isFinite(n) ? n : 0;
    }
    /** Ítems conocidos (los de las fiestas y el catálogo de pedidos), por nombre sin mayúsculas ni acentos. */
    function rsvItemsDeLista() {
      const catalogo = getProductos() || {};
      const indice = new Map();
      RSV_ITEMS_FIESTAS.concat(...Object.keys(catalogo).map(cat => p1ProductosDe(catalogo, cat))).forEach(it => {
        const k = SersaleBase.norm(it);
        if (k && !indice.has(k)) indice.set(k, String(it));
      });
      return indice;
    }
    /** "lechon" o " Medio  Lechón " → el nombre de la lista ("MEDIO LECHÓN"); si no está en la lista, lo escrito. */
    function rsvItemDeLista(texto, indice) {
      const t = String(texto == null ? "" : texto).trim().replace(/\s+/g, " ");
      return (indice || rsvItemsDeLista()).get(SersaleBase.norm(t)) || t;
    }
    /**
     * Orden de la lista. "reserva": por fecha de reserva y, en el mismo día, por
     * orden de carga. "retiro": por fecha de retiro (las que no tienen fecha, al
     * final) y después por orden de reserva.
     */
    function rsvOrdenar(lista, criterio) {
      const porReserva = (a, b) =>
        String(a.fechaReserva || "").localeCompare(String(b.fechaReserva || "")) ||
        String(a.creadoEn || "").localeCompare(String(b.creadoEn || ""));
      const copia = lista.slice();
      if (criterio === "retiro") {
        copia.sort((a, b) => {
          // String(): una fecha cargada a mano en la base como número no tiene que tirar la pantalla
          const ra = String(a.fechaRetiro || "9999-99-99"), rb = String(b.fechaRetiro || "9999-99-99");
          return ra.localeCompare(rb) || porReserva(a, b);
        });
      } else copia.sort(porReserva);
      return copia;
    }

    // ── Teléfonos escritos en "contacto" ──
    // Un botón que llama o escribe a otro número es peor que no tenerlo: solo se
    // ofrece cuando lo escrito cierra como teléfono argentino.
    /**
     * Número nacional (característica + número, 10 cifras) de un teléfono escrito con o
     * sin +54, 9, 0 y 15: "011 15 5555-1234" → "1155551234". "15 5555-1234" (15 y ocho
     * cifras) solo puede ser un celular de Buenos Aires (11). Si no cierra, "".
     */
    function rsvNumeroNacional(cifras) {
      let d = String(cifras);
      if (d.length > 10 && d.indexOf("54") === 0) d = d.slice(2);
      if (d.length > 10 && d.charAt(0) === "9") d = d.slice(1);
      if (d.length > 10 && d.charAt(0) === "0") d = d.slice(1);
      if (d.length === 12) {
        // característica + 15 + número
        const m = /^(11)15(\d{8})$/.exec(d) || /^([23]\d{2})15(\d{7})$/.exec(d) || /^([23]\d{3})15(\d{6})$/.exec(d);
        d = m ? m[1] + m[2] : "";
      } else if (/^15\d{8}$/.test(d)) d = "11" + d.slice(2);
      return /^(11|[23]\d)\d{8}$/.test(d) ? d : "";
    }
    /**
     * Teléfonos que hay en "contacto", en el orden en que están escritos: [{ llamar, wa, celular }].
     * `llamar`: las cifras como se marcan. `wa`: el número para WhatsApp (549 +
     * característica + número) o "" si no se puede saber (un fijo sin característica).
     * `celular`: está escrito como celular (con 15 o con +54 9).
     */
    function rsvTelefonos(contacto) {
      const salida = [];
      const texto = String(contacto == null ? "" : contacto).replace(/\S+@\S+/g, " "); // los mails no son teléfonos
      // Un teléfono son grupos de cifras unidos por un espacio, guion o punto (a lo sumo
      // dos seguidos) en el mismo renglón. "Senillosa 626 - 11 5555-1234" o la dirección en
      // el renglón de arriba son cosas separadas (antes se llamaba al 626 11 5555-1234).
      (texto.match(/\+?\(?\d+\)?(?:[ .-]{0,2}\(?\d+\)?)*/g) || []).forEach(trozo => {
        const grupos = trozo.match(/\d+/g);
        // Si adelante quedó pegada la altura de la calle ("Senillosa 626 11 5555-1234"), se saca de a un grupo.
        for (let i = 0; i < grupos.length; i++) {
          const resto = grupos.slice(i), d = resto.join("");
          // Un primer grupo de una o dos cifras solo puede ser 9, 11, 15 o 54 ("Senillosa 26 4943-2106": 26 no es característica)
          const suelto = resto[0].length <= 2 && ["9", "11", "15", "54"].indexOf(resto[0]) === -1;
          const nacional = suelto ? "" : rsvNumeroNacional(d);
          // Fijo de acá sin característica: "4943-2106" (un DNI, un CUIT o una fecha no tienen esa forma)
          const local = !nacional && d.length === 8 && (resto.length === 1 || (resto.length === 2 && resto[0].length === 4));
          if (nacional || local) {
            const conPais = !!nacional && d.length > 10 && d.indexOf("54") === 0;
            const celular = !!nacional && [nacional, "0" + nacional, "54" + nacional].indexOf(d) === -1;
            salida.push({ llamar: (conPais ? "+" : "") + d, wa: nacional ? "549" + nacional : "", celular });
            break;
          }
        }
      });
      return salida;
    }
    /**
     * Número para WhatsApp de lo escrito en "contacto", o "". Si hay varios teléfonos, el que
     * está escrito como celular ("011 4943-2106 / 15-5555-1234": el segundo).
     */
    function rsvWhatsApp(contacto) {
      const conWa = rsvTelefonos(contacto).filter(x => x.wa);
      const t = conWa.filter(x => x.celular)[0] || conWa[0];
      return t ? t.wa : "";
    }
    /** Primer teléfono escrito en "contacto", para llamar, o "". */
    function rsvTelefono(contacto) {
      const t = rsvTelefonos(contacto)[0];
      return t ? t.llamar : "";
    }
    /** "en 3 días", "HOY", "MAÑANA", "hace 2 días"; "" si no hay fecha. */
    function rsvCuando(dia) {
      if (!dia) return "";
      const n = SersaleBase.diasEntre(SersaleBase.hoy(), dia);
      if (isNaN(n)) return "";
      if (n === 0) return "HOY";
      if (n === 1) return "MAÑANA";
      if (n > 1) return "en " + n + " días";
      return n === -1 ? "ayer" : "hace " + -n + " días";
    }
    /** Fechas de retiro típicas de las fiestas que vienen: [{ dia, texto }]. */
    function rsvFechasFiestas() {
      const hoy = SersaleBase.hoy();
      let anio = Number(hoy.slice(0, 4));
      if (hoy > anio + "-12-31") anio += 1;
      return ["12-23", "12-24", "12-30", "12-31"]
        .map(md => ({ dia: anio + "-" + md, texto: md.slice(3) + "/" + md.slice(0, 2) }))
        .filter(f => f.dia >= hoy);
    }

    const RSV_CAMPO = { width:"100%", padding:"12px 14px", borderRadius:12, border:"1.5px solid #D8DCE0", fontSize:16, background:"#fff", outline:"none", boxSizing:"border-box" };
    const RSV_ETIQUETA = { display:"block", fontWeight:600, fontSize:13, color:"#3A424A", margin:"14px 0 6px" };

    // ── Formulario (alta y edición) ──
    function ReservaForm({ reserva, anteriores, onCerrar, onGuardada }) {
      const nueva = !reserva || !reserva.id;
      const catalogo = getProductos() || {};
      // Lo que ya está guardado puede venir cargado a mano en la base con otro tipo de dato
      // (un teléfono como número): los textos se leen como texto y las fechas, solo si lo son.
      const txt = v => (v == null ? "" : String(v));
      const dia = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
      const previa = reserva || {};
      const itemInicial = txt(previa.item);
      const esConocido = it => Object.keys(catalogo).some(cat => p1ProductosDe(catalogo, cat).includes(it)) || RSV_ITEMS_FIESTAS.includes(it);

      const [fechaReserva, setFechaReserva] = useState(dia(previa.fechaReserva) || SersaleBase.hoy());
      const [cliente, setCliente] = useState(txt(previa.cliente));
      const [contacto, setContacto] = useState(txt(previa.contacto));
      const [itemSel, setItemSel] = useState(itemInicial === "" ? "" : esConocido(itemInicial) ? itemInicial : RSV_OTRO);
      const [itemLibre, setItemLibre] = useState(itemInicial !== "" && !esConocido(itemInicial) ? itemInicial : "");
      const [cantidad, setCantidad] = useState(rsvCant(previa) > 1 ? String(rsvCant(previa)) : "");
      const [kg, setKg] = useState(previa.kg != null ? String(previa.kg) : "");
      const [kgHasta, setKgHasta] = useState(rsvKgHasta(previa) != null ? String(rsvKgHasta(previa)) : "");
      const [precioKg, setPrecioKg] = useState(previa.precioKg != null ? String(previa.precioKg) : "");
      const [sena, setSena] = useState(Number(previa.sena) > 0 ? String(previa.sena) : "");
      const [fechaRetiro, setFechaRetiro] = useState(dia(previa.fechaRetiro));
      const [obs, setObs] = useState(txt(previa.obs));
      const [sucursal, setSucursal] = useState(rsvSucursal(previa));
      const [precioSugerido, setPrecioSugerido] = useState(false);
      const [cargados, setCargados] = useState([]);
      // El formulario arranca arriba aunque la lista estuviera bajada. Con setTimeout corre después de que
      // useAtras anota el historial, así al volver la lista queda donde estaba.
      useEffect(() => { const t = setTimeout(() => window.scrollTo(0, 0), 0); return () => clearTimeout(t); }, []);

      // Al elegir el ítem propone el precio de la última reserva de ese ítem (si no se escribió otro).
      function elegirItem(v) {
        setItemSel(v);
        if (precioKg && !precioSugerido) return;
        const ult = v && v !== RSV_OTRO ? rsvOrdenar((anteriores || []).filter(x => x.item === v && Number(x.precioKg) > 0), "reserva").pop() : null;
        setPrecioKg(ult ? String(ult.precioKg) : "");
        setPrecioSugerido(!!ult);
      }

      const item = itemSel === RSV_OTRO ? rsvItemDeLista(itemLibre) : itemSel;
      const borrador = { cantidad: parseInt(cantidad, 10) || 0, kg: rsvKilos(kg), kgHasta: rsvKilos(kgHasta), precioKg: SersaleBase.numero(precioKg), sena: SersaleBase.numero(sena) };
      const total = rsvTotal(borrador), resta = rsvResta(borrador);
      // Con un rango de kilos ("de 10 a 12"), el total y lo que resta también son un rango.
      // Con la seña igual al total del tope no resta nada ("$0"): con el resto del mínimo decía "-$20.000".
      const totalMax = rsvTotalMax(borrador), restaMax = rsvRestaMax(borrador);

      // ── Salir con algo a medio cargar: se pregunta antes de perderlo ──
      // "Lo escrito" se compara contra cómo estaba el formulario al abrirlo (o al quedar
      // listo para el ítem siguiente con "Guardar y cargar otro").
      const firma = JSON.stringify([fechaReserva, cliente, contacto, itemSel, itemLibre, cantidad, kg, kgHasta, precioKg, sena, fechaRetiro, obs, sucursal]);
      const firmaBase = React.useRef(null);
      if (firmaBase.current === null) firmaBase.current = firma;
      const hayCambios = firma !== firmaBase.current;
      const preguntando = React.useRef(false);
      async function salir() {
        if (preguntando.current) return;
        if (hayCambios) {
          preguntando.current = true;
          let ok = false;
          try {
            ok = await SersaleUI.confirmar({ titulo: "¿Salir sin guardar?", cuerpo: nueva ? "Se pierde lo que cargaste en esta reserva." : "Se pierden los cambios que hiciste en esta reserva.", aceptar: "Salir", cancelar: "Seguir cargando", peligro: true });
          } finally { preguntando.current = false; }
          if (!ok) return;
        }
        onCerrar();
      }
      // El gesto "atrás" del teléfono hace lo mismo que la flecha. Como el gesto ya consumió
      // la entrada del historial, se anota otra (rearmar): si la persona decide seguir
      // cargando, el próximo "atrás" tiene que volver a caer acá y no salir de Reservas.
      const salirActual = React.useRef(salir);
      salirActual.current = salir;
      const [rearmar, setRearmar] = useState(0);
      useEffect(() => SersaleBase.abrirAtras(() => { setRearmar(n => n + 1); salirActual.current(); }), [rearmar]);

      function datos() {
        const falta = (m, id) => {
          SersaleUI.toast(m, { tipo: "error" });
          const el = id && document.getElementById(id);
          if (el) { el.scrollIntoView({ block: "center" }); try { el.focus({ preventScroll: true }); } catch (e) {} }
          return null;
        };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaReserva)) return falta("Poné la fecha del pedido.", "rsv-fecha");
        if (!cliente.trim()) return falta("Escribí el nombre del cliente.", "rsv-cliente");
        if (!item) return falta(itemSel === RSV_OTRO ? "Escribí qué reserva." : "Elegí qué reserva.", itemSel === RSV_OTRO ? "rsv-otro" : "rsv-item");
        if (borrador.cantidad > 99) return falta("La cantidad es demasiado grande. Revisala.", "rsv-cantidad");
        if (!(borrador.kg > 0)) return falta(rsvCant(borrador) > 1 ? "Poné cuántos kilos tiene que tener cada uno." : "Poné cuántos kilos necesita.", "rsv-kg");
        // "Hasta" igual a los kilos es un peso justo; menor, un error de tipeo.
        if (borrador.kgHasta > 0 && borrador.kgHasta < borrador.kg) return falta("El «hasta» tiene que ser mayor que los kilos. Si pidió un peso justo, dejalo vacío.", "rsv-kg-hasta");
        if (borrador.precioKg < 0 || borrador.sena < 0) return falta("El precio y la seña no pueden ser negativos. Revisá los importes.", borrador.precioKg < 0 ? "rsv-precio" : "rsv-sena");
        if (fechaRetiro && fechaRetiro < fechaReserva) return falta("La fecha de retiro no puede ser anterior a la del pedido.", "rsv-retiro");
        if (total != null && borrador.sena > (totalMax != null ? totalMax : total)) return falta("La seña es mayor que el total de la reserva. Revisá los importes.", "rsv-sena");
        return {
          fechaReserva,
          cliente: cliente.trim().replace(/\s+/g, " "),
          contacto: contacto.trim(),
          item,
          cantidad: rsvCant(borrador) > 1 ? rsvCant(borrador) : null,
          kg: SersaleBase.redondear(borrador.kg, 3),
          kgHasta: rsvKgHasta(borrador) != null ? SersaleBase.redondear(borrador.kgHasta, 3) : null,
          precioKg: borrador.precioKg > 0 ? SersaleBase.redondear(borrador.precioKg, 2) : null,
          sena: SersaleBase.redondear(borrador.sena, 2),
          fechaRetiro: fechaRetiro || "",
          sucursal,
          obs: obs.trim(),
        };
      }

      const [guardar, guardando] = SersaleBase.useAccion(async (otroItem) => {
        const d = datos();
        if (!d) return;
        try {
          const { db, collection, addDoc, doc, updateDoc } = fb();
          const ahora = new Date().toISOString();
          if (nueva) {
            await addDoc(collection(db, "reservas"), { ...d, estado: "pendiente", creadoEn: ahora, creadoPor: sessionStorage.getItem("sersale_usuario") || "" });
          } else {
            // Solo se escribe lo que se cambió en este formulario. Si se mandaban todos los
            // campos, lo que otro teléfono había anotado mientras tanto (la seña que acaba de
            // dejar) volvía al valor que tenía cuando se abrió esta pantalla.
            const cambios = {};
            Object.keys(d).forEach(k => { if (d[k] !== reserva[k] && !(d[k] == null && reserva[k] == null)) cambios[k] = d[k]; });
            // Una reserva vieja no tiene el campo `sucursal`: si quedó la que ya se leía de su
            // observación, no es un cambio (y no se escribe nada si no se tocó nada).
            if (reserva.sucursal == null && cambios.sucursal === rsvSucursal(reserva)) delete cambios.sucursal;
            if (Object.keys(cambios).length > 0) await updateDoc(doc(db, "reservas", reserva.id), { ...cambios, actualizadoEn: ahora });
          }
          SersaleUI.toast(nueva ? "Reserva guardada: " + d.cliente + " · " + d.item : "Reserva actualizada", { tipo: "ok" });
          if (otroItem === true) {
            // Mismo cliente, otro ítem: queda el nombre, el contacto y las fechas.
            setItemSel(""); setItemLibre(""); setCantidad(""); setKg(""); setKgHasta(""); setPrecioKg(""); setSena(""); setObs(""); setPrecioSugerido(false);
            firmaBase.current = null; // lo que queda ya está guardado: no es "algo a medio cargar"
            setCargados(c => c.concat(d.item + " · " + rsvKgTexto(d)));
            const sel = document.getElementById("rsv-item");
            if (sel) sel.scrollIntoView({ block: "center" });
            if (onGuardada) onGuardada(false);
          } else if (onGuardada) onGuardada(true);
        } catch (e) {
          console.error(e);
          SersaleUI.toast(e && e.code === "permission-denied"
            ? "La base de datos no permite guardar reservas. Avisá para que se habilite."
            : e && e.code === "not-found"
            ? "Esta reserva ya no existe: la eliminaron desde otro teléfono. No se guardó nada."
            : "No se pudo guardar la reserva. Probá de nuevo.", { tipo: "error" });
        }
      });

      const fiestas = rsvFechasFiestas();
      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"18px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={()=>salir()} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:"4px 8px 4px 0",minHeight:44}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>{nueva ? "Nueva reserva" : "Editar reserva"}</div>
          </div>
          <div style={{padding:"6px 20px 24px"}}>
            <label style={RSV_ETIQUETA} htmlFor="rsv-fecha">Fecha del pedido</label>
            <input id="rsv-fecha" type="date" style={RSV_CAMPO} value={fechaReserva} onChange={e=>setFechaReserva(e.target.value)} />

            <label style={RSV_ETIQUETA} htmlFor="rsv-cliente">Nombre del cliente</label>
            {/* Texto libre: quienes reservan son particulares, no los clientes cargados en el CRM. */}
            <input id="rsv-cliente" style={RSV_CAMPO} placeholder="Nombre y apellido" autoComplete="off" autoCapitalize="words" autoCorrect="off" spellCheck={false}
              value={cliente} onChange={e=>setCliente(e.target.value)} />

            <label style={RSV_ETIQUETA} htmlFor="rsv-contacto">Datos de contacto</label>
            <textarea id="rsv-contacto" style={{...RSV_CAMPO, minHeight:64, resize:"vertical", fontFamily:"inherit"}} placeholder="Teléfono, dirección, quién retira…"
              value={contacto} onChange={e=>setContacto(e.target.value)} />

            {cargados.length > 0 && (
              <div style={{marginTop:14,padding:"10px 12px",borderRadius:12,background:"#DDEBE3",color:"#1F4D38",fontSize:13}}>
                <strong>Ya guardado para {cliente.trim()}:</strong> {cargados.join(" · ")}
              </div>
            )}
            <label style={RSV_ETIQUETA} htmlFor="rsv-item">Qué reserva</label>
            <select id="rsv-item" style={RSV_CAMPO} value={itemSel} onChange={e=>elegirItem(e.target.value)}>
              <option value="">Elegir…</option>
              <optgroup label="Fiestas">
                {RSV_ITEMS_FIESTAS.map(it => <option key={it} value={it}>{it}</option>)}
              </optgroup>
              {Object.keys(catalogo).filter(cat => p1ProductosDe(catalogo, cat).length > 0).map(cat => (
                <optgroup key={cat} label={cat}>
                  {p1ProductosDe(catalogo, cat).map(it => <option key={cat + "|" + it} value={it}>{it}</option>)}
                </optgroup>
              ))}
              <option value={RSV_OTRO}>Otro (escribir)…</option>
            </select>
            {itemSel === RSV_OTRO && (
              <input id="rsv-otro" autoFocus style={{...RSV_CAMPO, marginTop:8}} placeholder="Escribí qué reserva" aria-label="Otro ítem" autoCapitalize="characters"
                value={itemLibre} onChange={e=>setItemLibre(e.target.value)} />
            )}

            <label style={RSV_ETIQUETA} htmlFor="rsv-cantidad">Cantidad <span style={{textTransform:"none",letterSpacing:0,fontWeight:400}}>(opcional, si lleva más de uno)</span></label>
            <input id="rsv-cantidad" style={{...RSV_CAMPO, maxWidth:140}} inputMode="numeric" autoComplete="off" placeholder="1" aria-label="Cantidad"
              value={cantidad} onChange={e=>setCantidad(e.target.value.replace(/\D/g, "").slice(0, 3))} />

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <label style={RSV_ETIQUETA} htmlFor="rsv-kg">{rsvCant(borrador) > 1 ? "Kilos de cada uno" : "Kilos"}</label>
                <SersaleBase.InputDecimal id="rsv-kg" style={RSV_CAMPO} placeholder="Ej: 10,5" aria-label="Kilos" value={kg} onChange={e=>setKg(e.target.value)} />
              </div>
              <div>
                <label style={RSV_ETIQUETA} htmlFor="rsv-kg-hasta">Hasta <span style={{textTransform:"none",letterSpacing:0,fontWeight:400}}>(opcional)</span></label>
                <SersaleBase.InputDecimal id="rsv-kg-hasta" style={RSV_CAMPO} placeholder="Ej: 12" aria-label="Hasta (kg)" value={kgHasta} onChange={e=>setKgHasta(e.target.value)} />
              </div>
            </div>
            <div id="rsv-kg-ayuda" style={{marginTop:6,fontSize:12,color:"#79828B",lineHeight:1.35}}>
              {borrador.kg > 0 && rsvKgHasta(borrador) != null /* sin kilos todavía no hay rango: decía "de 0 a 12 kg" */
                ? <>Se le puede vender de <strong style={{color:"#3A424A"}}>{rsvKgTexto(borrador)}</strong>.</>
                : rsvCant(borrador) > 1 && borrador.kg > 0
                ? <>Son <strong style={{color:"#3A424A"}}>{rsvKgTexto(borrador)}</strong>: {rsvKg(rsvKgTot(borrador))} en total.</>
                : <>Si no pidió un peso justo (ej. “de 10 a 12 kg”), poné en <strong style={{color:"#5C666F"}}>Hasta</strong> el máximo que se le puede vender.</>}
            </div>

            <label style={RSV_ETIQUETA} htmlFor="rsv-precio">Precio por kg</label>
            <div style={{position:"relative"}}>
              <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#A3ABB3",fontSize:16}}>$</span>
              <InputMonto id="rsv-precio" style={{...RSV_CAMPO, paddingLeft:26}} placeholder="A convenir" aria-label="Precio por kg" value={precioKg} onChange={v=>{ setPrecioKg(v); setPrecioSugerido(false); }} />
            </div>
            {precioSugerido && (
              <div style={{marginTop:8,fontSize:13,color:"#784212"}}>Precio de la última reserva de {itemSel}. Cambialo si acordaste otro.</div>
            )}
            {total != null && (
              <div style={{marginTop:8,fontSize:13,color:"#5C666F"}}>Total estimado: <strong style={{color:"#191E23"}}>{rsvMontoRango(total, totalMax)}</strong>{totalMax != null && " según lo que pese"}</div>
            )}

            <label style={RSV_ETIQUETA} htmlFor="rsv-sena">Seña</label>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <div style={{position:"relative",flex:1}}>
                <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#A3ABB3",fontSize:16}}>$</span>
                <InputMonto id="rsv-sena" style={{...RSV_CAMPO, paddingLeft:26}} placeholder="0" aria-label="Seña" value={sena} onChange={v=>setSena(v)} />
              </div>
              <button type="button" onClick={()=>setSena("")} aria-pressed={!(borrador.sena > 0)}
                style={{minHeight:46,padding:"0 14px",borderRadius:12,border:"1.5px solid " + (borrador.sena > 0 ? "#D8DCE0" : "#A8702A"),background:borrador.sena > 0 ? "#fff" : "#F0E7D9",color:borrador.sena > 0 ? "#5C666F" : "#784212",fontWeight:600,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>
                Sin seña
              </button>
            </div>
            {resta != null && borrador.sena > 0 && (
              <div style={{marginTop:8,fontSize:13,color:"#5C666F"}}>Resta cobrar al retirar: <strong style={{color:"#191E23"}}>{rsvRestaTexto(borrador) || SersaleBase.fmtMonto(restaMax != null ? restaMax : resta)}</strong></div>
            )}

            <label style={RSV_ETIQUETA} htmlFor="rsv-retiro">Fecha de retiro</label>
            <input id="rsv-retiro" type="date" style={RSV_CAMPO} value={fechaRetiro} min={fechaReserva || undefined} onChange={e=>setFechaRetiro(e.target.value)} />
            {fiestas.length > 0 && (
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
                {fiestas.map(f => (
                  <button key={f.dia} type="button" onClick={()=>setFechaRetiro(f.dia)}
                    style={{minHeight:44,padding:"0 12px",borderRadius:22,border:"1.5px solid " + (fechaRetiro === f.dia ? "#A4232A" : "#D8DCE0"),background:fechaRetiro === f.dia ? "#A4232A" : "#fff",color:fechaRetiro === f.dia ? "#fff" : "#3A424A",fontWeight:600,fontSize:14,cursor:"pointer"}}>
                    {f.texto}
                  </button>
                ))}
                <button type="button" onClick={()=>setFechaRetiro("")} aria-pressed={!fechaRetiro}
                  style={{minHeight:44,padding:"0 12px",borderRadius:22,border:"1.5px solid " + (!fechaRetiro ? "#A8702A" : "#D8DCE0"),background:!fechaRetiro ? "#F0E7D9" : "#fff",color:!fechaRetiro ? "#784212" : "#3A424A",fontWeight:600,fontSize:14,cursor:"pointer",whiteSpace:"nowrap"}}>
                  A confirmar
                </button>
              </div>
            )}

            <label style={RSV_ETIQUETA} id="rsv-sucursal-et">Retira por</label>
            <div role="group" aria-labelledby="rsv-sucursal-et" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {RSV_SUCURSALES.map(s => (
                <button key={s.id} type="button" data-sucursal={s.id} onClick={()=>setSucursal(s.id)} aria-pressed={sucursal === s.id}
                  style={{minHeight:56,padding:"6px 10px",borderRadius:12,border:"1.5px solid " + (sucursal === s.id ? "#A4232A" : "#D8DCE0"),background:sucursal === s.id ? "#A4232A" : "#fff",color:sucursal === s.id ? "#fff" : "#3A424A",cursor:"pointer",textAlign:"center"}}>
                  <span style={{display:"block",fontWeight:700,fontSize:15}}>{s.nombre}</span>
                  <span style={{display:"block",fontSize:12,opacity:0.85}}>{s.calle}</span>
                </button>
              ))}
            </div>

            <label style={RSV_ETIQUETA} htmlFor="rsv-obs">Observaciones (opcional)</label>
            <input id="rsv-obs" style={RSV_CAMPO} placeholder="Ej: lo quiere deshuesado" value={obs} onChange={e=>setObs(e.target.value)} />

            <button disabled={guardando} onClick={()=>guardar(false)}
              style={{width:"100%",minHeight:52,marginTop:22,borderRadius:14,border:"none",background:guardando?"#A3ABB3":"#A4232A",color:"#fff",fontWeight:700,fontSize:16,cursor:"pointer"}}>
              {guardando ? "Guardando..." : nueva ? "✓ Guardar reserva" : "✓ Guardar cambios"}
            </button>
            {nueva && (
              <button disabled={guardando} onClick={()=>guardar(true)}
                style={{width:"100%",minHeight:48,marginTop:10,borderRadius:14,border:"1.5px solid #2A333B",background:"#fff",color:"#2A333B",fontWeight:600,fontSize:14,cursor:"pointer"}}>
                Guardar y cargar otro ítem de este cliente
              </button>
            )}
          </div>
        </div>
      );
    }

    // ── Tarjeta de una reserva ──
    // `alTocar`: en las vistas agrupadas, tocar el encabezado de la tarjeta abierta la vuelve a cerrar.
    function ReservaTarjeta({ r, orden, plegable, onEditar, onEstado, onEliminar, ocupado, alTocar }) {
      const [abierta, setAbierta] = useState(false);
      const ver = !plegable || abierta;
      const total = rsvTotal(r), resta = rsvResta(r);
      const hasta = rsvKgHasta(r), restaTexto = rsvRestaTexto(r);
      const sena = Number(r.sena) || 0;
      const entregada = r.estado === "entregada";
      const cuando = entregada ? "" : rsvCuando(r.fechaRetiro);
      const urgente = cuando === "HOY" || cuando === "MAÑANA";
      const vencida = !entregada && r.fechaRetiro && r.fechaRetiro < SersaleBase.hoy();
      const wa = rsvWhatsApp(r.contacto), tel = rsvTelefono(r.contacto);
      const dato = { fontFamily:"'IBM Plex Mono',ui-monospace,monospace", fontVariantNumeric:"tabular-nums" };
      const accion = { minHeight:44, minWidth:44, padding:"0 12px", borderRadius:12, fontWeight:600, fontSize:13, cursor:"pointer" };
      const sinSena = <span style={{display:"inline-block",padding:"1px 8px",borderRadius:10,background:"#F0E7D9",color:"#784212",fontWeight:700,fontSize:12}}>Sin seña</span>;
      return (
        <div data-reserva={r.id} style={{background:"#fff",borderRadius:14,border:"1px solid #D8DCE0",borderLeft:"4px solid " + (entregada ? "#2F6B4F" : vencida ? "#A8702A" : "#A4232A"),padding:"14px 14px 12px",marginBottom:12,opacity:entregada?0.82:1}}>
          <div onClick={plegable ? ()=>setAbierta(x=>!x) : alTocar} role={plegable || alTocar ? "button" : undefined} aria-expanded={plegable ? abierta : alTocar ? true : undefined} style={{cursor:plegable || alTocar?"pointer":"default"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <span style={{...dato,flexShrink:0,minWidth:30,textAlign:"center",padding:"4px 6px",borderRadius:8,background:"#EDEEF0",color:"#3A424A",fontSize:12,fontWeight:600}}>{orden}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:800,fontSize:16,color:"#191E23",overflowWrap:"anywhere"}}>{r.cliente}</div>
                <div style={{fontSize:15,color:"#191E23",marginTop:3,overflowWrap:"anywhere"}}>
                  <strong>{r.item}</strong> · <strong style={{whiteSpace:"nowrap"}}>{rsvCant(r) > 1 && <><span style={dato}>{rsvCant(r)}</span> × </>}<span style={dato}>{SersaleBase.fmtNumero(Number(r.kg) || 0, 3)}</span>{hasta != null && <> a <span style={dato}>{SersaleBase.fmtNumero(hasta, 3)}</span></>} kg</strong>
                </div>
              </div>
              {entregada && <span className="badge" style={{background:"#DDEBE3",color:"#2F6B4F",flexShrink:0}}>ENTREGADA</span>}
            </div>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginTop:10,fontSize:15,color:"#191E23"}}>
              <div>
                <div>Retira: {r.fechaRetiro ? <strong style={dato}>{SersaleBase.fmtFecha(r.fechaRetiro)}</strong> : <strong>a confirmar</strong>}</div>
                <div data-sucursal={rsvSucursal(r)} style={{marginTop:2,fontSize:13,color:"#5C666F"}}>Por <strong style={{color:"#191E23"}}>{rsvSucursalNombre(r)}</strong></div>
                {cuando && <div style={{marginTop:2}}><span style={{display:"inline-block",whiteSpace:"nowrap",padding:"1px 8px",borderRadius:10,fontSize:12,fontWeight:700,background:urgente?"#A4232A":vencida?"#F0E7D9":"#EDEEF0",color:urgente?"#fff":vencida?"#784212":"#5C666F"}}>{cuando}</span></div>}
              </div>
              <div style={{textAlign:"right"}}>
                {entregada ? null
                  : resta == null ? null
                  : restaTexto ? <div>Resta: <strong style={{...dato,display:"inline-block"}}>{restaTexto}</strong></div> /* inline-block y no nowrap: el rango va junto si entra y, en un iPhone angosto, se parte entre los importes ("$130.500 a $166.750" se salía de la tarjeta) */
                  : <span className="badge" style={{background:"#DDEBE3",color:"#2F6B4F"}}>PAGADO</span>}
                {!entregada && !(sena > 0) && <div style={{marginTop:2}}>{sinSena}</div>}
              </div>
            </div>
            {plegable && <div aria-hidden="true" style={{textAlign:"center",lineHeight:"12px",marginTop:4,fontSize:12,color:"#A3ABB3"}}>{abierta ? "▴" : "▾"}</div>}
          </div>

          {ver && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 12px",marginTop:8,fontSize:13,color:"#5C666F"}}>
              <div>Seña: <strong style={{...dato,color:sena > 0 ? "#2F6B4F" : "#3A424A"}}>{SersaleBase.fmtMonto(sena)}</strong></div>
              <div>Total: <strong style={{...dato,color:"#3A424A"}}>{total != null ? rsvMontoRango(total, rsvTotalMax(r)) : "—"}</strong></div>
              <div>Precio: {r.precioKg ? <strong style={{...dato,color:"#3A424A"}}>{SersaleBase.fmtMonto(r.precioKg)}/kg</strong> : <strong style={{color:"#3A424A"}}>a convenir</strong>}</div>
              <div>Reservó: <strong style={{...dato,color:"#3A424A"}}>{SersaleBase.fmtFecha(r.fechaReserva) || "—"}</strong></div>
            </div>
          )}

          {ver && (r.contacto || r.obs) && (
            <div style={{marginTop:10,padding:"8px 10px",background:"#F7F8F9",borderRadius:10,fontSize:13,color:"#3A424A",whiteSpace:"pre-line",overflowWrap:"anywhere"}}>
              {r.contacto && <div>📞 {r.contacto}</div>}
              {r.obs && <div style={{marginTop:r.contacto?4:0,color:"#5C666F"}}>📝 {r.obs}</div>}
            </div>
          )}

          {ver && (
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
              {entregada
                ? <button disabled={ocupado} onClick={()=>onEstado(r, "pendiente")} style={{...accion,border:"1.5px solid #D8DCE0",background:"#fff",color:"#3A424A"}}>↩ Volver a pendiente</button>
                : <button disabled={ocupado} onClick={()=>onEstado(r, "entregada")} style={{...accion,flex:"1 0 auto",whiteSpace:"nowrap",border:"none",background:"#2F6B4F",color:"#fff"}}>✓ Entregada</button>}
              {wa && <a href={SersaleBase.waLink("", wa)} target="_blank" rel="noopener" aria-label={"WhatsApp a " + r.cliente} style={{...accion,display:"inline-flex",alignItems:"center",justifyContent:"center",textDecoration:"none",border:"1.5px solid #2F6B4F",background:"#fff",color:"#2F6B4F"}}>WhatsApp</a>}
              {tel && <a href={"tel:" + tel} aria-label={"Llamar a " + r.cliente} style={{...accion,display:"inline-flex",alignItems:"center",justifyContent:"center",textDecoration:"none",border:"1.5px solid #26536E",background:"#fff",color:"#26536E"}}>Llamar</a>}
              <button disabled={ocupado} onClick={()=>onEditar(r)} style={{...accion,border:"1.5px solid #2A333B",background:"#fff",color:"#2A333B"}}>Editar</button>
              <button disabled={ocupado} onClick={()=>onEliminar(r)} aria-label={"Eliminar la reserva de " + r.cliente} style={{...accion,border:"1.5px solid #C33039",background:"#fff",color:"#C33039"}}>🗑</button>
            </div>
          )}
        </div>
      );
    }

    // ── Vistas agrupadas (por día de retiro, por producto, por cliente) ──
    const RSV_DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const rsvAtrasada = r => r.estado !== "entregada" && !!r.fechaRetiro && String(r.fechaRetiro) < SersaleBase.hoy();
    /** "Jueves 24/12/2026", o "Retiro a confirmar" si no tiene fecha. */
    function rsvDiaTexto(dia) {
      if (!dia) return "Retiro a confirmar";
      const n = SersaleBase.diaSemana(dia);
      return (RSV_DIAS[n] ? RSV_DIAS[n] + " " : "") + (SersaleBase.fmtFecha(dia) || String(dia));
    }
    /** Cuántas hay y cuántos kilos suman (mínimo y tope) las reservas de una lista. */
    function rsvSuma(lista) {
      return { cantidad: lista.length, kg: lista.reduce((s, r) => s + rsvKgTot(r), 0), kgMax: lista.reduce((s, r) => s + rsvKgMax(r), 0) };
    }
    /** Qué hay que tener de cada cosa para una lista de reservas: [{ item, cantidad, kg, kgMax }], de mayor a menor. */
    function rsvPorItem(lista, deLista) {
      const mapa = new Map();
      lista.forEach(r => {
        const nombre = rsvItemDeLista(r.item, deLista) || "(sin ítem)";
        const k = SersaleBase.norm(nombre);
        if (!mapa.has(k)) mapa.set(k, { item: nombre, cantidad: 0, kg: 0, kgMax: 0, reservas: [] });
        const g = mapa.get(k);
        g.cantidad += rsvCant(r); g.kg += rsvKgTot(r); g.kgMax += rsvKgMax(r); g.reservas.push(r);
      });
      return Array.from(mapa.values()).sort((a, b) => b.kgMax - a.kgMax || b.kg - a.kg || String(a.item).localeCompare(String(b.item), "es"));
    }

    /**
     * Arma una vista agrupada: qué reservas entran (filtro o búsqueda) y sus bloques, con
     * todo lo que se muestra de cada uno ya calculado. `hoy` es el día de hoy ("AAAA-MM-DD").
     */
    function rsvAgrupar(todas, modo, filtro, buscar, hoy) {
      const deLista = rsvItemsDeLista();
      const pendientes = todas.filter(r => r.estado !== "entregada");
      const entregadas = todas.filter(r => r.estado === "entregada");
      const sinSena = pendientes.filter(r => !(Number(r.sena) > 0));
      const atrasadas = pendientes.filter(r => !!r.fechaRetiro && String(r.fechaRetiro) < hoy);
      const buscando = String(buscar || "").trim() !== "";
      const deFiltro = filtro === "sinsena" ? sinSena : filtro === "atrasadas" ? atrasadas : filtro === "entregadas" ? entregadas : filtro === "todas" ? todas : pendientes;
      const filtradas = buscando ? todas.filter(r => SersaleBase.coincide([r.cliente, r.item, r.contacto, r.obs].join(" "), buscar)) : deFiltro;
      const mapa = new Map();
      rsvOrdenar(filtradas, modo === "cliente" ? "retiro" : "reserva").forEach(r => {
        const item = modo === "producto" ? rsvItemDeLista(r.item, deLista) || "(sin ítem)" : "";
        const k = modo === "dia" ? String(r.fechaRetiro || "") : modo === "producto" ? SersaleBase.norm(item) : SersaleBase.norm(r.cliente || "");
        if (!mapa.has(k)) mapa.set(k, { clave: modo + "|" + k, dia: modo === "dia" ? String(r.fechaRetiro || "") : null, titulo: modo === "dia" ? rsvDiaTexto(r.fechaRetiro) : modo === "producto" ? item : (r.cliente || "(sin nombre)"), filas: [] });
        mapa.get(k).filas.push(r);
      });
      const grupos = Array.from(mapa.values());
      grupos.forEach(g => {
        // Lo que hay que tener se cuenta sobre lo que todavía no se entregó (si queda algo).
        const porEntregar = g.filas.filter(r => r.estado !== "entregada");
        g.suma = rsvSuma(porEntregar.length > 0 ? porEntregar : g.filas);
        g.pendientes = porEntregar.length;
        g.totales = g.suma.cantidad + (g.suma.cantidad === 1 ? " reserva" : " reservas") + " · " + rsvKgRango(g.suma.kg, g.suma.kgMax);
        g.porItem = [];
        g.sub = "";
        if (modo === "dia") {
          const n = g.dia ? SersaleBase.diasEntre(hoy, g.dia) : null;
          g.color = !g.dia ? "#79828B" : n < 0 ? (g.pendientes > 0 ? "#C33039" : "#79828B") : n === 0 ? "#2F6B4F" : n === 1 ? "#A8702A" : "#26536E";
          g.sub = g.dia ? (n < 0 && g.pendientes > 0 ? "sin retirar (" + rsvCuando(g.dia) + ")" : rsvCuando(g.dia)) : "";
          g.porItem = rsvPorItem(porEntregar, deLista).map(x => ({ item: x.item, varias: x.cantidad !== x.reservas.length, texto: x.item + " ×" + x.cantidad + " · " + rsvKgRango(x.kg, x.kgMax) }));
          // Dentro de cada día, por producto (así el depósito lo ve junto) y después por orden de reserva.
          g.filas = rsvPorItem(g.filas, deLista).reduce((l, x) => l.concat(rsvOrdenar(x.reservas, "reserva")), []);
        } else if (modo === "producto") {
          g.color = "#A8702A";
        } else {
          g.color = "#2A333B";
          if (porEntregar.length === 0) g.sub = "todo entregado";
          else {
            const senas = porEntregar.reduce((s, r) => s + (Number(r.sena) || 0), 0);
            const resta = porEntregar.reduce((s, r) => s + Math.max(0, rsvResta(r) || 0), 0);
            const restaMax = porEntregar.reduce((s, r) => { const max = rsvRestaMax(r); return s + Math.max(0, (max != null ? max : rsvResta(r)) || 0); }, 0);
            g.sub = "seña " + SersaleBase.fmtMonto(senas) + (restaMax > 0 ? " · resta " + (resta > 0 ? rsvMontoRango(resta, restaMax) : "hasta " + SersaleBase.fmtMonto(restaMax)) : "");
          }
        }
      });
      if (modo === "dia") grupos.sort((a, b) => (a.dia || "9999-99-99").localeCompare(b.dia || "9999-99-99"));
      else if (modo === "producto") grupos.sort((a, b) => b.suma.kgMax - a.suma.kgMax || String(a.titulo).localeCompare(String(b.titulo), "es"));
      else grupos.sort((a, b) => String(a.titulo).localeCompare(String(b.titulo), "es", { sensitivity: "base" }));
      return { sinSena, atrasadas, filtradas, grupos };
    }

    // ── Planilla para el depósito (PDF) ──
    // Qué hay que preparar cada día: un resumen por producto y el detalle reserva por
    // reserva, con una casilla para ir tildando. Sin precios ni señas: es para el depósito.
    function rsvPlanillaPDF(pendientes, soloDia, sucursal) {
      const deSucursal = sucursal ? RSV_SUCURSALES.find(x => x.id === sucursal) : null;
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
      const mx = 12, pw = W - mx * 2;
      const deLista = rsvItemsDeLista();
      const txt = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
      const corto = (t, ancho) => {
        t = txt(t);
        if (doc.getTextWidth(t) <= ancho) return t;
        while (t.length > 1 && doc.getTextWidth(t + "...") > ancho) t = t.slice(0, -1);
        return t + "...";
      };
      const ahora = new Date();
      const generada = SersaleBase.fmtFecha(SersaleBase.hoy()) + " " + SersaleBase.fmtHora(ahora);
      const dias = Array.from(new Set(pendientes.map(r => String(r.fechaRetiro || ""))))
        .filter(d => soloDia === undefined || d === soloDia)
        .sort((a, b) => (a || "9999").localeCompare(b || "9999"));
      let y = 0;
      // Con las dos sucursales juntas se suma una columna angosta que dice por cuál retira
      // (cx[6]); con una sola, la planilla queda como siempre y lo dice el título.
      const cx = deSucursal
        ? [mx, mx + 8, mx + 17, mx + 17 + pw * 0.27, mx + 17 + pw * 0.5, mx + 17 + pw * 0.66]
        : [mx, mx + 8, mx + 17, mx + 17 + pw * 0.25, mx + 17 + pw * 0.45, mx + 17 + pw * 0.735, mx + 17 + pw * 0.615];
      const finKilos = deSucursal ? cx[5] : cx[6];
      function cabeceraHoja(dia, sigue) {
        y = 14;
        doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(164, 35, 42);
        doc.text("FRIGORÍFICO SERSALE", mx, y);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110);
        doc.text("Planilla para el depósito  ·  generada el " + generada, W - mx, y, { align: "right" });
        y += 4;
        doc.setDrawColor(164, 35, 42); doc.setLineWidth(0.6); doc.line(mx, y, W - mx, y);
        y += 8;
        doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(25);
        doc.text("RESERVAS PARA PREPARAR" + (deSucursal ? "  ·  RETIRO POR " + deSucursal.nombre.toUpperCase() : ""), mx, y);
        y += 7;
        doc.setFontSize(12); doc.setTextColor(164, 35, 42);
        doc.text(rsvDiaTexto(dia).toUpperCase() + (sigue ? "  (continúa)" : ""), mx, y);
        y += 6;
      }
      function cabeceraDetalle() {
        doc.setFillColor(42, 51, 59); doc.rect(mx, y, pw, 6.5, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(255);
        doc.text("LISTO", cx[0] + 0.6, y + 4.4);
        doc.text("N°", cx[1] + 2, y + 4.4);
        doc.text("CLIENTE", cx[2] + 1, y + 4.4);
        doc.text("QUÉ LLEVA", cx[3] + 1, y + 4.4);
        doc.text("KILOS", cx[4] + 1, y + 4.4);
        if (!deSucursal) doc.text("RETIRA POR", cx[6] + 1, y + 4.4);
        doc.text("OBSERVACIONES", cx[5] + 1, y + 4.4);
        y += 6.5;
      }
      dias.forEach((dia, n) => {
        if (n > 0) doc.addPage();
        const delDia = pendientes.filter(r => String(r.fechaRetiro || "") === dia);
        cabeceraHoja(dia, false);
        // Resumen: cuánto hay que tener de cada cosa
        const suma = rsvSuma(delDia);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(60);
        doc.text(suma.cantidad + (suma.cantidad === 1 ? " reserva" : " reservas") + "  ·  " + rsvKgRango(suma.kg, suma.kgMax) + " en total", mx, y);
        y += 5;
        doc.setFillColor(237, 238, 240); doc.rect(mx, y, pw * 0.6, 6, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(60);
        doc.text("QUÉ HAY QUE TENER", mx + 2, y + 4.1);
        doc.text("CANTIDAD", mx + pw * 0.34, y + 4.1);
        doc.text("KILOS", mx + pw * 0.45, y + 4.1);
        y += 6;
        const porItem = rsvPorItem(delDia, deLista);
        porItem.forEach(g => {
          doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(25);
          doc.text(corto(g.item, pw * 0.32), mx + 2, y + 4.6);
          doc.setFont("helvetica", "normal");
          doc.text(String(g.cantidad), mx + pw * 0.34, y + 4.6);
          doc.text(rsvKgRango(g.kg, g.kgMax), mx + pw * 0.45, y + 4.6);
          doc.setDrawColor(225); doc.setLineWidth(0.2); doc.line(mx, y + 6.4, mx + pw * 0.6, y + 6.4);
          y += 6.4;
        });
        y += 6;
        // Detalle: por producto y, dentro de cada uno, por orden de reserva
        cabeceraDetalle();
        let nro = 0;
        porItem.forEach(g => {
          rsvOrdenar(g.reservas, "reserva").forEach(r => {
            if (y + 8 > H - 12) { doc.addPage(); cabeceraHoja(dia, true); cabeceraDetalle(); }
            nro += 1;
            doc.setDrawColor(60); doc.setLineWidth(0.35); doc.rect(cx[0] + 1.6, y + 1.6, 4.2, 4.2);
            doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(110);
            doc.text(String(nro), cx[1] + 2, y + 5);
            doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(25);
            doc.text(corto(r.cliente, cx[3] - cx[2] - 3), cx[2] + 1, y + 5);
            doc.setFont("helvetica", "normal");
            doc.text(corto(rsvItemDeLista(r.item, deLista), cx[4] - cx[3] - 3), cx[3] + 1, y + 5);
            doc.setFont("helvetica", "bold");
            doc.text(corto(rsvKgTexto(r), finKilos - cx[4] - 2), cx[4] + 1, y + 5);
            if (!deSucursal) { doc.setFontSize(8.5); doc.text(rsvSucursal(r) === "caballito" ? "CABALLITO" : "P. PATRICIOS", cx[6] + 1, y + 5); doc.setFontSize(10); }
            doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(70);
            doc.text(corto(r.obs, mx + pw - cx[5] - 2), cx[5] + 1, y + 5);
            doc.setDrawColor(215); doc.setLineWidth(0.2); doc.line(mx, y + 7.6, W - mx, y + 7.6);
            y += 7.6;
          });
        });
      });
      return doc;
    }
    const rsvPlanillaArchivo = (soloDia, sucursal) => "Reservas para preparar - " + (sucursal ? RSV_SUCURSALES.find(x => x.id === sucursal).nombre + " - " : "") + (soloDia === undefined ? "todas" : soloDia ? SersaleBase.fmtFecha(soloDia).replace(/\//g, "-") : "retiro a confirmar") + ".pdf";

    // ── Fila compacta de una reserva (vistas agrupadas) ──
    // Una línea por reserva; al tocarla se abre la tarjeta completa, con los mismos datos
    // y botones que en la lista.
    // (React.memo: al abrir una fila, escribir en el buscador o plegar un bloque, las demás
    // filas no se vuelven a dibujar.)
    const ReservaFila = React.memo(function ReservaFila({ r, vista, abierta, onAbrir, lugar, hoy, ocupado, onEditar, onEstado, onEliminar }) {
      const entregada = r.estado === "entregada";
      const atrasada = !entregada && !!r.fechaRetiro && String(r.fechaRetiro) < hoy;
      const restaTexto = rsvRestaTexto(r), resta = rsvResta(r);
      const sena = Number(r.sena) || 0;
      const retiro = r.fechaRetiro ? SersaleBase.fmtFechaCorta(r.fechaRetiro) : "a confirmar";
      const dato = { fontFamily:"'IBM Plex Mono',ui-monospace,monospace", fontVariantNumeric:"tabular-nums" };
      const principal = vista === "cliente" ? r.item : r.cliente;
      const detalle = (vista === "dia" ? r.item : "Retira " + retiro) + " · " + rsvSucursalNombre(r);
      if (abierta) {
        return (
          <div data-reserva-fila={r.id} style={{margin:"6px 0 2px"}}>
            <button type="button" onClick={()=>onAbrir(null)} aria-label={"Cerrar el detalle de " + r.cliente} style={{display:"block",width:"100%",minHeight:36,border:"none",background:"transparent",color:"#5C666F",fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"right",padding:"0 4px"}}>Cerrar ▴</button>
            <ReservaTarjeta r={r} orden={entregada ? "✓" : "#" + (lugar || "")} plegable={false} ocupado={ocupado} onEditar={onEditar} onEstado={onEstado} onEliminar={onEliminar} alTocar={()=>onAbrir(null)} />
          </div>
        );
      }
      return (
        <button type="button" data-reserva-fila={r.id} onClick={()=>onAbrir(r.id)} aria-label={"Ver la reserva de " + r.cliente + ": " + r.item}
          style={{display:"flex",alignItems:"center",gap:10,width:"100%",minHeight:50,padding:"7px 2px",border:"none",borderTop:"1px solid #EDEEF0",background:"transparent",textAlign:"left",cursor:"pointer",opacity:entregada?0.7:1}}>
          <span style={{flex:1,minWidth:0}}>
            <span style={{display:"block",fontWeight:700,fontSize:15,color:"#191E23",overflowWrap:"anywhere"}}>{principal}</span>
            <span style={{display:"block",fontSize:13,color:atrasada && vista !== "dia" ? "#A8702A" : "#5C666F",overflowWrap:"anywhere"}}>{detalle}{r.obs ? " · " + r.obs : ""}</span>
          </span>
          <span style={{flexShrink:0,textAlign:"right"}}>
            <strong style={{...dato,display:"block",fontSize:14,color:"#191E23",whiteSpace:"nowrap"}}>{rsvKgTexto(r)}</strong>
            <span style={{display:"block",fontSize:12,fontWeight:600,whiteSpace:"nowrap",color:entregada ? "#2F6B4F" : !(sena > 0) ? "#784212" : resta != null && !restaTexto ? "#2F6B4F" : "#5C666F"}}>
              {entregada ? "✓ Entregada" : !(sena > 0) ? "Sin seña" : resta == null ? "A convenir" : restaTexto ? "Resta " + restaTexto : "Pagado"}
            </span>
          </span>
        </button>
      );
    });

    // ── Pantalla de reservas ──
    function Reservas({ onBack }) {
      const [reservas, setReservas] = useState(null); // null = cargando
      const [error, setError] = useState(null); // null | "permiso" | "otro"
      // Lo que se ve, ¿lo confirmó el servidor o es solo lo guardado en este teléfono?
      const [copia, setCopia] = useState({ sinServidor: false, nuncaBajadas: false });
      const [intento, setIntento] = useState(0);
      const [form, setForm] = useState(null); // null | {} (nueva) | reserva (editar)
      const [ver, setVer] = useState("pendiente"); // pendiente | entregada | todas
      const [orden, setOrden] = useState(() => (sessionStorage.getItem("sersale_rsv_orden") === "retiro" ? "retiro" : "reserva"));
      const [buscar, setBuscar] = useState("");
      const [verResumen, setVerResumen] = useState(null); // null = según cuántos renglones tenga
      // Cómo se organiza la pantalla: por día de retiro, por producto, por cliente, o la lista de siempre.
      const [modo, setModo] = useState(() => { const m = sessionStorage.getItem("sersale_rsv_modo"); return ["dia", "producto", "cliente", "lista"].includes(m) ? m : "dia"; });
      // Sucursal de retiro que se está mirando ("" = las dos).
      const [suc, setSuc] = useState(() => { const s = sessionStorage.getItem("sersale_rsv_suc"); return s === "patricios" || s === "caballito" ? s : ""; });
      const elegirSuc = s => { setSuc(s); setFilaAbierta(null); try { sessionStorage.setItem("sersale_rsv_suc", s); } catch (e) {} };
      const [filtro, setFiltro] = useState("pendientes"); // pendientes | sinsena | atrasadas | entregadas | todas
      const [plegados, setPlegados] = useState({}); // grupos cerrados a mano
      const [filaAbierta, setFilaAbierta] = useState(null);
      function elegirModo(m) { setModo(m); setFilaAbierta(null); try { sessionStorage.setItem("sersale_rsv_modo", m); } catch (e) {} }

      // La lista se mantiene al día sola (también con lo que carga otro teléfono).
      useEffect(() => {
        let cortar = null, vivo = true;
        function escuchar() {
          const { db, collection, onSnapshot } = fb();
          // includeMetadataChanges: también avisa cuando lo que se mostró de la copia del
          // teléfono queda confirmado por el servidor (aunque no cambie ninguna reserva).
          cortar = onSnapshot(collection(db, "reservas"), { includeMetadataChanges: true },
            snap => {
              if (!vivo) return;
              // Sin señal Firestore contesta con lo guardado en el teléfono. Si este teléfono
              // nunca bajó las reservas, eso es una lista vacía (o solo lo cargado acá) que NO
              // significa "no hay reservas": se anota cuándo se bajaron de verdad para poder avisarlo.
              const sinServidor = !!(snap.metadata && snap.metadata.fromCache);
              let bajadas = !sinServidor;
              try {
                if (bajadas) localStorage.setItem(RSV_BAJADAS, "1");
                else bajadas = !!localStorage.getItem(RSV_BAJADAS);
              } catch (e) {}
              setCopia({ sinServidor, nuncaBajadas: !bajadas });
              setError(null);
              setReservas(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            },
            e => { console.error(e); if (vivo) setError(e && e.code === "permission-denied" ? "permiso" : "otro"); });
        }
        if (window.__fbReady) escuchar(); else document.addEventListener("fbReady", escuchar, { once: true });
        return () => { vivo = false; document.removeEventListener("fbReady", escuchar); if (cortar) cortar(); };
      }, [intento]);

      // (El gesto "atrás" del teléfono con el formulario abierto lo atiende ReservaForm.)

      function elegirOrden(o) { setOrden(o); try { sessionStorage.setItem("sersale_rsv_orden", o); } catch (e) {} }

      const [cambiarEstado, cambiando] = SersaleBase.useAccion(async (r, estado) => {
        if (estado === "entregada") {
          const resta = rsvResta(r), restaTexto = rsvRestaTexto(r);
          const ok = await SersaleUI.confirmar({
            titulo: "Marcar como entregada",
            cuerpo: r.cliente + " · " + r.item + " · " + rsvKgTexto(r) + "\n" + (resta == null ? "Precio a convenir: se cobra al entregar." : restaTexto ? "Resta cobrar: " + restaTexto + (rsvKgHasta(r) != null ? " (según lo que pese, de " + rsvKgTexto(r) + ")" : " (calculado con " + rsvKg(r.kg) + ")") : "Ya está pago con la seña."),
            aceptar: "Entregada",
          });
          if (!ok) return;
        }
        try {
          const { db, doc, updateDoc } = fb();
          const ahora = new Date().toISOString();
          await updateDoc(doc(db, "reservas", r.id), estado === "entregada" ? { estado, entregadaEn: ahora, actualizadoEn: ahora } : { estado, actualizadoEn: ahora });
          SersaleUI.toast(estado === "entregada" ? "Entregada: " + r.cliente : "Vuelve a pendientes: " + r.cliente, { tipo: "ok" });
        } catch (e) {
          console.error(e);
          SersaleUI.toast("No se pudo guardar el cambio. Probá de nuevo.", { tipo: "error" });
        }
      });

      const [eliminar, eliminando] = SersaleBase.useAccion(async (r) => {
        const sena = Number(r.sena) || 0;
        const ok = await SersaleUI.confirmar({
          titulo: "Eliminar reserva",
          cuerpo: r.cliente + " · " + r.item + " · " + rsvKgTexto(r) + (sena > 0 ? "\nOjo: dejó una seña de " + SersaleBase.fmtMonto(sena) + "." : "") + "\nNo se puede deshacer.",
          aceptar: "Eliminar",
          peligro: true,
        });
        if (!ok) return;
        try {
          const { db, doc, deleteDoc } = fb();
          await deleteDoc(doc(db, "reservas", r.id));
          SersaleUI.toast("Reserva eliminada", { tipo: "ok" });
        } catch (e) {
          console.error(e);
          SersaleUI.toast("No se pudo eliminar. Probá de nuevo.", { tipo: "error" });
        }
      });

      // Las vistas agrupadas se arman una sola vez por cambio de datos, de vista, de filtro o
      // de búsqueda (no en cada toque), y las filas no se vuelven a dibujar si no cambiaron.
      const hoyDia = SersaleBase.hoy();
      const deSuc = React.useMemo(() => (suc ? (reservas || []).filter(r => rsvSucursal(r) === suc) : reservas || []), [reservas, suc]);
      const agrupado = React.useMemo(
        () => (modo === "lista" ? { sinSena: [], atrasadas: [], filtradas: [], grupos: [] } : rsvAgrupar(deSuc, modo, filtro, buscar, hoyDia)),
        [deSuc, modo, filtro, buscar, hoyDia]
      );
      const acciones = React.useRef({});
      acciones.current = { editar: x => setForm(x), estado: cambiarEstado, eliminar };
      const alEditar = React.useCallback(x => acciones.current.editar(x), []);
      const alCambiarEstado = React.useCallback((r, estado) => acciones.current.estado(r, estado), []);
      const alEliminar = React.useCallback(r => acciones.current.eliminar(r), []);

      if (form) {
        return <ReservaForm key={form.id || "nueva"} reserva={form} anteriores={reservas || []} onCerrar={()=>setForm(null)} onGuardada={cerrar => { if (cerrar) setForm(null); }} />;
      }

      const todas = deSuc;
      const hayReservas = (reservas || []).length > 0;
      const sucVacia = suc && hayReservas && todas.length === 0 ? "No hay reservas para retirar por " + RSV_SUCURSALES.find(x => x.id === suc).nombre + "." : null;
      // No se afirma "no hay reservas" (ni que la lista está completa) si este teléfono nunca
      // las bajó, o si está sin conexión y no tiene ninguna guardada.
      const sinConfirmar = copia.nuncaBajadas || (copia.sinServidor && todas.length === 0 && navigator.onLine === false);
      const pendientes = todas.filter(r => r.estado !== "entregada");
      const entregadas = todas.filter(r => r.estado === "entregada");
      // El número de cada reserva es su lugar en el orden de reserva entre las pendientes.
      const lugar = {};
      // (entre las de las dos sucursales: el número no cambia al mirar una sola)
      rsvOrdenar((reservas || []).filter(r => r.estado !== "entregada"), "reserva").forEach((r, i) => { lugar[r.id] = i + 1; });
      // Al buscar se mira en todas (pendientes y entregadas): si no, una ya entregada "no existe".
      const buscando = buscar.trim() !== "";
      const base = buscando ? todas : ver === "pendiente" ? pendientes : ver === "entregada" ? entregadas : todas;
      const visibles = modo !== "lista" ? [] : rsvOrdenar(base, orden).filter(r => !buscando || SersaleBase.coincide([r.cliente, r.item, r.contacto, r.obs].join(" "), buscar));
      const plegable = visibles.length > 8;

      // Resumen de lo pendiente: cuánto hay que tener de cada cosa.
      // "Lechon", "LECHÓN" y "lechón " son lo mismo: se juntan (antes salían en renglones
      // separados y ninguno decía cuánto lechón hay que tener).
      const deLista = rsvItemsDeLista();
      const porItem = new Map();
      (modo !== "lista" ? [] : rsvOrdenar(pendientes, "reserva")).forEach(r => {
        const nombre = rsvItemDeLista(r.item, deLista) || "(sin ítem)";
        const k = SersaleBase.norm(nombre);
        if (!porItem.has(k)) porItem.set(k, { item: nombre, cantidad: 0, kg: 0, kgMax: 0 });
        porItem.get(k).cantidad += rsvCant(r);
        porItem.get(k).kg += rsvKgTot(r);
        porItem.get(k).kgMax += rsvKgMax(r);
      });
      const resumen = Array.from(porItem.values()).sort((a, b) => b.kgMax - a.kgMax || b.kg - a.kg);
      // Con reservas "de 10 a 12 kg" lo que hay que tener también es un rango: mínimo y tope.
      const totalKg = pendientes.reduce((s, r) => s + rsvKgTot(r), 0);
      const totalKgMax = pendientes.reduce((s, r) => s + rsvKgMax(r), 0);
      const hayRango = SersaleBase.redondear(totalKgMax, 1) > SersaleBase.redondear(totalKg, 1);
      const totalSenas = pendientes.reduce((s, r) => s + (Number(r.sena) || 0), 0);
      const totalResta = pendientes.reduce((s, r) => s + Math.max(0, rsvResta(r) || 0), 0);
      const totalRestaMax = pendientes.reduce((s, r) => { const max = rsvRestaMax(r); return s + Math.max(0, (max != null ? max : rsvResta(r)) || 0); }, 0);

      // ── Vistas agrupadas ──
      const agrupada = modo !== "lista";
      const { sinSena, atrasadas, filtradas, grupos } = agrupado;
      function planilla(dia) {
        try {
          const para = dia === undefined ? pendientes : pendientes.filter(r => String(r.fechaRetiro || "") === dia);
          if (para.length === 0) { SersaleUI.toast("No hay reservas pendientes para la planilla.", { tipo: "info" }); return; }
          rsvPlanillaPDF(pendientes, dia, suc).save(rsvPlanillaArchivo(dia, suc));
        } catch (e) {
          console.error(e);
          SersaleUI.toast("No se pudo armar la planilla. Probá de nuevo.", { tipo: "error" });
        }
      }
      const pestana = activo => ({ flex:"1 0 auto", minHeight:46, padding:"0 10px", border:"none", borderBottom:"3px solid " + (activo ? "#A4232A" : "transparent"), background:"transparent", color:activo ? "#A4232A" : "#5C666F", fontWeight:700, fontSize:14, cursor:"pointer", whiteSpace:"nowrap" });

      const resumenAbierto = verResumen == null ? resumen.length <= 4 : verResumen;
      const chip = activo => ({ minHeight:44, padding:"0 14px", borderRadius:20, border:"1.5px solid " + (activo ? "#A4232A" : "#D8DCE0"), background:activo ? "#A4232A" : "#fff", color:activo ? "#fff" : "#3A424A", fontWeight:600, fontSize:13, cursor:"pointer", whiteSpace:"nowrap" });
      const dato = { fontFamily:"'IBM Plex Mono',ui-monospace,monospace", fontVariantNumeric:"tabular-nums" };

      return (
        <div className="crm-page">
          <div className="chapa" style={{background:"#12161A",borderBottom:"2px solid #A4232A",color:"#fff",padding:"14px 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:10,boxShadow:"0 4px 20px rgba(192,57,43,0.35)"}}>
            <button onClick={onBack} aria-label="Volver" style={{background:"none",color:"#fff",border:"none",cursor:"pointer",fontSize:20,padding:"4px 8px 4px 0",minHeight:44,minWidth:44,textAlign:"left"}}>←</button>
            <div style={{flex:1,fontWeight:800,fontSize:16}}>Reservas fin de año</div>
            <button onClick={()=>setForm({})} style={{minHeight:44,padding:"0 14px",borderRadius:10,border:"1px solid rgba(239,234,225,0.3)",background:"rgba(239,234,225,0.12)",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>+ Nueva</button>
          </div>

          <div style={{padding:"16px 16px 24px"}}>
            {error && (
              <div style={{textAlign:"center",padding:"30px 16px",background:"#fff",borderRadius:14,border:"1px solid #D8DCE0"}}>
                <p style={{fontWeight:700,fontSize:15,marginBottom:6}}>No se pudieron cargar las reservas</p>
                <p style={{fontSize:13,color:"#5C666F",marginBottom:14}}>{error === "permiso" ? "La base de datos no permite ver las reservas. Avisá para que se habilite." : navigator.onLine === false ? "No hay conexión." : "Puede ser la señal."}</p>
                <button onClick={()=>{ setError(null); setReservas(null); setIntento(n => n + 1); }} style={{minHeight:44,padding:"0 20px",borderRadius:12,border:"none",background:"#2A333B",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>Reintentar</button>
              </div>
            )}

            {!error && reservas === null && <p style={{textAlign:"center",color:"#79828B",padding:"40px 0"}}>Cargando reservas…</p>}

            {!error && reservas !== null && (
              <>
                {sinConfirmar && (
                  <div role="status" style={{background:"#F0E7D9",border:"1.5px solid #A8702A",color:"#784212",borderRadius:14,padding:"12px 14px",marginBottom:14,fontSize:13,fontWeight:600,lineHeight:1.4}}>
                    {navigator.onLine === false ? "Sin conexión: " : "Sin señal suficiente: "}
                    en este teléfono todavía no se pudieron traer las reservas ya anotadas{todas.length > 0 ? ", puede haber más de las que se ven" : ""}. Cuando conecte aparecen solas. Lo que cargues mientras tanto queda guardado.
                  </div>
                )}
                <div role="tablist" aria-label="Cómo ver las reservas" style={{display:"flex",overflowX:"auto",borderBottom:"1px solid #D8DCE0",marginBottom:12,WebkitOverflowScrolling:"touch"}}>
                  <button role="tab" aria-selected={modo==="dia"} onClick={()=>elegirModo("dia")} style={pestana(modo==="dia")}>Por día</button>
                  <button role="tab" aria-selected={modo==="producto"} onClick={()=>elegirModo("producto")} style={pestana(modo==="producto")}>Por producto</button>
                  <button role="tab" aria-selected={modo==="cliente"} onClick={()=>elegirModo("cliente")} style={pestana(modo==="cliente")}>Por cliente</button>
                  <button role="tab" aria-selected={modo==="lista"} onClick={()=>elegirModo("lista")} style={pestana(modo==="lista")}>Lista</button>
                </div>
                {hayReservas && (
                  <div role="group" aria-label="Sucursal de retiro" style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginBottom:10,WebkitOverflowScrolling:"touch"}}>
                    <button onClick={()=>elegirSuc("")} aria-pressed={suc===""} style={chip(suc==="")}>Las dos sucursales</button>
                    {RSV_SUCURSALES.map(s => (
                      <button key={s.id} onClick={()=>elegirSuc(s.id)} aria-pressed={suc===s.id} style={chip(suc===s.id)}>
                        {s.nombre} ({(reservas || []).filter(r => r.estado !== "entregada" && rsvSucursal(r) === s.id).length})
                      </button>
                    ))}
                  </div>
                )}
                {(agrupada ? todas.length > 0 : (todas.length > 6 || buscando)) && (
                  <div style={{position:"relative",marginBottom:12}}>
                    <input style={{...RSV_CAMPO, paddingRight:48}} placeholder="🔍 Buscar cliente, ítem o teléfono" aria-label="Buscar reserva" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
                      value={buscar} onChange={e=>setBuscar(e.target.value)} />
                    {buscando && <button onClick={()=>setBuscar("")} aria-label="Borrar la búsqueda" style={{position:"absolute",right:2,top:2,width:44,height:44,border:"none",background:"transparent",color:"#5C666F",fontSize:18,cursor:"pointer"}}>✕</button>}
                  </div>
                )}
                {buscando && <div style={{fontSize:12,color:"#5C666F",margin:"-4px 2px 10px"}}>{(agrupada ? filtradas : visibles).length} {(agrupada ? filtradas : visibles).length === 1 ? "reserva encontrada" : "reservas encontradas"} (pendientes y entregadas)</div>}

                {agrupada && (
                  <>
                    {sucVacia ? (
                      <p style={{textAlign:"center",padding:"36px 16px",color:"#79828B",fontSize:14}}>{sucVacia}</p>
                    ) : todas.length === 0 ? (
                      <div style={{textAlign:"center",padding:"36px 16px",color:"#79828B"}}>
                        {!sinConfirmar && <p style={{fontWeight:700,fontSize:15,color:"#3A424A",marginBottom:6}}>Todavía no hay reservas</p>}
                        {!sinConfirmar && <p style={{fontSize:13,marginBottom:16}}>Anotá acá lo que los clientes dejan reservado para las fiestas.</p>}
                        <button onClick={()=>setForm({})} style={{minHeight:48,padding:"0 22px",borderRadius:14,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>+ Nueva reserva</button>
                      </div>
                    ) : (
                      <>
                        {!buscando && (
                          <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginBottom:10,WebkitOverflowScrolling:"touch"}}>
                            <button onClick={()=>setFiltro("pendientes")} aria-pressed={filtro==="pendientes"} style={chip(filtro==="pendientes")}>Pendientes ({pendientes.length})</button>
                            <button onClick={()=>setFiltro("sinsena")} aria-pressed={filtro==="sinsena"} style={chip(filtro==="sinsena")}>Sin seña ({sinSena.length})</button>
                            <button onClick={()=>setFiltro("atrasadas")} aria-pressed={filtro==="atrasadas"} style={chip(filtro==="atrasadas")}>Atrasadas ({atrasadas.length})</button>
                            <button onClick={()=>setFiltro("entregadas")} aria-pressed={filtro==="entregadas"} style={chip(filtro==="entregadas")}>Entregadas ({entregadas.length})</button>
                            <button onClick={()=>setFiltro("todas")} aria-pressed={filtro==="todas"} style={chip(filtro==="todas")}>Todas ({todas.length})</button>
                          </div>
                        )}
                        {pendientes.length > 0 && (
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",background:"#fff",border:"1px solid #D8DCE0",borderRadius:14,padding:"10px 14px",marginBottom:12}}>
                            <div style={{fontSize:13,color:"#3A424A"}}>
                              <strong style={dato}>{pendientes.length}</strong> pendientes · <strong style={dato}>{rsvKgRango(totalKg, totalKgMax)}</strong> · <span style={{color:"#2F6B4F"}}><strong style={dato}>{SersaleBase.fmtMonto(totalSenas)}</strong> en señas</span>
                            </div>
                            <button onClick={()=>planilla(undefined)} style={{minHeight:44,padding:"0 14px",borderRadius:10,border:"none",background:"#2A333B",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>🖨️ Planilla para el depósito</button>
                          </div>
                        )}
                        {grupos.length === 0 && (
                          <p style={{textAlign:"center",color:"#79828B",padding:"30px 0"}}>
                            {buscando ? "Ninguna reserva coincide con la búsqueda." : filtro === "pendientes" ? "No quedan reservas pendientes." : filtro === "sinsena" ? "Todas las pendientes dejaron seña." : filtro === "atrasadas" ? "No hay reservas atrasadas." : filtro === "entregadas" ? "Todavía no se entregó ninguna reserva." : "No hay reservas."}
                          </p>
                        )}
                        {grupos.map(g => {
                          const cerrado = !!plegados[g.clave];
                          const { color, porItem, sub } = g;
                          return (
                            <div key={g.clave} data-rsv-grupo={g.titulo} style={{background:"#fff",border:"1px solid #D8DCE0",borderRadius:14,marginBottom:12,overflow:"hidden"}}>
                              <div style={{display:"flex",alignItems:"stretch",background:color}}>
                                <button type="button" onClick={()=>setPlegados(p => ({ ...p, [g.clave]: !p[g.clave] }))} aria-expanded={!cerrado} aria-label={(cerrado ? "Abrir " : "Cerrar ") + g.titulo}
                                  style={{flex:1,minWidth:0,minHeight:50,padding:"8px 12px",border:"none",background:"transparent",color:"#fff",textAlign:"left",cursor:"pointer"}}>
                                  <span style={{display:"block",fontWeight:800,fontSize:15,overflowWrap:"anywhere"}}>{g.titulo}{sub ? <span style={{fontWeight:600,fontSize:12,opacity:0.9}}> — {sub}</span> : null}</span>
                                  <span style={{display:"block",fontSize:12,fontWeight:600,opacity:0.92}}>{g.totales} {cerrado ? "▾" : "▴"}</span>
                                </button>
                                {modo === "dia" && g.pendientes > 0 && (
                                  <button type="button" onClick={()=>planilla(g.dia)} aria-label={"Planilla de " + g.titulo} style={{minWidth:48,border:"none",borderLeft:"1px solid rgba(255,255,255,0.25)",background:"transparent",color:"#fff",fontSize:18,cursor:"pointer"}}>🖨️</button>
                                )}
                              </div>
                              {!cerrado && (
                                <div style={{padding:"4px 12px 8px"}}>
                                  {(porItem.length > 1 || porItem.some(x => x.varias)) /* un solo producto: se muestra si alguna reserva lleva más de una unidad */ && (
                                    <div style={{display:"flex",gap:6,flexWrap:"wrap",padding:"8px 0 6px"}}>
                                      {porItem.map(x => <span key={x.item} style={{padding:"3px 9px",borderRadius:99,background:"#EDEEF0",color:"#3A424A",fontSize:12,fontWeight:600}}>{x.texto}</span>)}
                                    </div>
                                  )}
                                  {g.filas.map(r => (
                                    <ReservaFila key={r.id} r={r} vista={modo} abierta={filaAbierta === r.id} onAbrir={setFilaAbierta} lugar={lugar[r.id]} hoy={hoyDia}
                                      ocupado={cambiando || eliminando} onEditar={alEditar} onEstado={alCambiarEstado} onEliminar={alEliminar} />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                )}

                {!agrupada && pendientes.length > 0 && !buscando && (
                  <div style={{background:"#fff",borderRadius:14,border:"1px solid #D8DCE0",padding:"12px 14px",marginBottom:14}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:8,textAlign:"center"}}>
                      <div><div style={{...dato,fontWeight:700,fontSize:18,color:"#191E23"}}>{pendientes.length}</div><div style={{fontSize:11,color:"#79828B"}}>pendientes</div></div>
                      <div><div style={{...dato,fontWeight:700,fontSize:18,color:"#191E23"}}>{SersaleBase.fmtNumero(totalKg, 1)}</div><div style={{fontSize:11,color:"#79828B"}}>kg reservados</div>{hayRango && <div style={{fontSize:11,color:"#784212",fontWeight:600}}>hasta <span style={dato}>{SersaleBase.fmtNumero(totalKgMax, 1)}</span> kg</div>}</div>
                      <div><div style={{...dato,fontWeight:700,fontSize:18,color:"#2F6B4F"}}>{SersaleBase.fmtMonto(totalSenas)}</div><div style={{fontSize:11,color:"#79828B"}}>en señas</div></div>
                    </div>
                    <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #EDEEF0"}}>
                      <button onClick={()=>setVerResumen(!resumenAbierto)} aria-expanded={resumenAbierto} style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%",minHeight:44,margin:"-10px 0 -4px",padding:0,border:"none",background:"transparent",cursor:"pointer",fontSize:11,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",color:"#5C666F"}}>
                        <span>Qué hay que tener ({resumen.length})</span><span style={{fontSize:13,letterSpacing:0,textTransform:"none"}}>{resumenAbierto ? "Ocultar ▴" : "Ver ▾"}</span>
                      </button>
                      {resumenAbierto && resumen.map(x => (
                        <div key={x.item} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:13,padding:"3px 0",color:"#191E23"}}>
                          <span style={{overflowWrap:"anywhere"}}>{x.item} <span style={{color:"#79828B"}}>× {x.cantidad}</span></span>
                          <strong style={{...dato,flexShrink:0}}>{rsvKgRango(x.kg, x.kgMax)}</strong>
                        </div>
                      ))}
                      {totalRestaMax > 0 && <div style={{marginTop:6,fontSize:12,color:"#5C666F"}}>Resta cobrar al entregar: <strong style={dato}>{totalResta > 0 ? rsvMontoRango(totalResta, totalRestaMax) : "hasta " + SersaleBase.fmtMonto(totalRestaMax)}</strong></div>}
                    </div>
                  </div>
                )}

                {!agrupada && !buscando && <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginBottom:8,WebkitOverflowScrolling:"touch"}}>
                  <button onClick={()=>setVer("pendiente")} style={chip(ver==="pendiente")}>Pendientes ({pendientes.length})</button>
                  <button onClick={()=>setVer("entregada")} style={chip(ver==="entregada")}>Entregadas ({entregadas.length})</button>
                  <button onClick={()=>setVer("todas")} style={chip(ver==="todas")}>Todas ({todas.length})</button>
                </div>}
                {!agrupada && <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                  <span style={{fontSize:12,color:"#79828B"}}>Ordenar por fecha de</span>
                  <button onClick={()=>elegirOrden("reserva")} aria-pressed={orden==="reserva"} style={{...chip(orden==="reserva"),background:orden==="reserva"?"#2A333B":"#fff",borderColor:orden==="reserva"?"#2A333B":"#D8DCE0"}}>Reserva</button>
                  <button onClick={()=>elegirOrden("retiro")} aria-pressed={orden==="retiro"} style={{...chip(orden==="retiro"),background:orden==="retiro"?"#2A333B":"#fff",borderColor:orden==="retiro"?"#2A333B":"#D8DCE0"}}>Retiro</button>
                </div>}

                {!agrupada && visibles.length === 0 && (
                  <div style={{textAlign:"center",padding:"36px 16px",color:"#79828B"}}>
                    {sucVacia ? sucVacia : todas.length === 0 ? (
                      <>
                        {!sinConfirmar && <p style={{fontWeight:700,fontSize:15,color:"#3A424A",marginBottom:6}}>Todavía no hay reservas</p>}
                        {!sinConfirmar && <p style={{fontSize:13,marginBottom:16}}>Anotá acá lo que los clientes dejan reservado para las fiestas.</p>}
                        <button onClick={()=>setForm({})} style={{minHeight:48,padding:"0 22px",borderRadius:14,border:"none",background:"#A4232A",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer"}}>+ Nueva reserva</button>
                      </>
                    ) : buscar.trim() ? "Ninguna reserva coincide con la búsqueda." : ver === "pendiente" ? "No quedan reservas pendientes." : "Todavía no se entregó ninguna reserva."}
                  </div>
                )}

                {!agrupada && visibles.map((r, i) => {
                  const f = r.fechaRetiro || "";
                  const cabecera = orden === "retiro" && (i === 0 || (visibles[i - 1].fechaRetiro || "") !== f);
                  const delDia = cabecera ? visibles.filter(x => (x.fechaRetiro || "") === f) : [];
                  const n = f ? SersaleBase.diasEntre(SersaleBase.hoy(), f) : null;
                  // Un día pasado solo es "sin retirar" si le queda alguna pendiente.
                  const atrasado = f && n < 0 && delDia.some(x => x.estado !== "entregada");
                  return (
                    <React.Fragment key={r.id}>
                      {cabecera && (
                        <div style={{background:!f || (n < 0 && !atrasado) ? "#79828B" : n < 0 ? "#C33039" : n === 0 ? "#2F6B4F" : n === 1 ? "#A8702A" : "#26536E",borderRadius:10,padding:"6px 12px",margin:"4px 0 6px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:4}}>
                          <span style={{fontWeight:700,fontSize:12,color:"#fff"}}>{f ? ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"][SersaleBase.diaSemana(f)] + " " + SersaleBase.fmtFechaCorta(f) + " — " + (atrasado ? "sin retirar (" + rsvCuando(f) + ")" : rsvCuando(f)) : "Retiro a confirmar"}</span>
                          <span style={{fontSize:11,background:"rgba(255,255,255,0.25)",color:"#fff",borderRadius:99,padding:"2px 8px",fontWeight:700}}>{delDia.length} · {rsvKgRango(delDia.reduce((s2, x) => s2 + rsvKgTot(x), 0), delDia.reduce((s2, x) => s2 + rsvKgMax(x), 0))}</span>
                        </div>
                      )}
                      <ReservaTarjeta r={r} orden={r.estado === "entregada" ? "✓" : "#" + (lugar[r.id] || "")}
                        plegable={plegable} ocupado={cambiando || eliminando}
                        onEditar={x=>setForm(x)} onEstado={cambiarEstado} onEliminar={eliminar} />
                    </React.Fragment>
                  );
                })}
              </>
            )}
          </div>
        </div>
      );
    }

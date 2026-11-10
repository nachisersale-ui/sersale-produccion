    // ── CUENTA CORRIENTE: REGLAS COMPARTIDAS ────────────────
    // Un solo lugar para todo lo que toca cc_movimientos y cuentas_corrientes.
    // Este archivo se compila antes que el resto de src/pedidos/, así que estas
    // funciones son globales para todos. No guardan nada con formato nuevo: los
    // documentos que ya existen se leen igual que antes.
    //
    // Reglas (las mismas para remito, venta rápida, pago y devolución):
    //   · Un movimiento de tipo "pedido" SUMA su monto al saldo; cualquier otro
    //     tipo ("pago", crédito por devolución) lo RESTA. `monto` siempre es
    //     positivo; `movimiento` guarda el mismo importe con signo.
    //   · Saldo positivo = el cliente debe. Saldo negativo = saldo a favor del cliente.
    //   · El cliente se reconoce por nombre sin distinguir mayúsculas, acentos ni
    //     espacios de más (SersaleBase.mismoNombre), o por `clienteId` si la
    //     cuenta y el movimiento lo tienen (lo escribe migracion.html).
    //   · Las cuentas con `mergedInto` (fusionadas por migracion.html) no se usan.
    //   · El movimiento y el saldo se guardan juntos en una transacción: el saldo
    //     nuevo es el saldo guardado más (o menos) el importe del movimiento. Nunca
    //     se pisa el saldo con una suma hecha en el teléfono, salvo que la persona
    //     lo pida con ccRecalcularSaldo.
    //
    // Funciones:
    //   ccImporteFirmado(mov)            importe con signo de un movimiento (+ pedido, − pago).
    //   ccSaldoDeMovimientos(movs)       saldo que resulta de sumar una lista de movimientos.
    //   ccMismoCliente(a, b)             ¿dos nombres son el mismo cliente?
    //   ccDia(valor)                     "AAAA-MM-DD" de la fecha de un movimiento (texto, Timestamp o {seconds}).
    //   ccFmtSaldo(n)                    saldo para mostrar, con signo: "$1.200" / "-$1.200".
    //   ccEstadoSaldo(n)                 "debe" | "al_dia" | "a_favor".
    //   ccBuscarCuenta(nombre)           cuenta corriente del cliente ({ id, ...datos }) o null.
    //   ccMovimientosDe(nombre, cuenta)  movimientos del cliente, ordenados por fecha y hora de carga.
    //   ccMovimientoDePedido(movs, pedido, remitoNro)
    //                                    movimiento que le corresponde a un pedido al hacer su remito:
    //                                    el ya vinculado (pedidoId / remitoNro) o el "Pendiente de facturar".
    //   ccAsentarMovimiento(opts)        crea o corrige UN movimiento y ajusta el saldo, todo junto.
    //                                    Sirve para pago, venta rápida, devolución y cargo de remito.
    //   ccPrepararAsiento / ccLeerAsiento / ccEscribirAsiento / ccEsperarAsiento
    //                                    las partes de ccAsentarMovimiento, para meter el asiento
    //                                    dentro de una transacción más grande (el remito lo hace).
    //   ccRecalcularSaldo(nombre)        pisa el saldo guardado con la suma de los movimientos (mantenimiento).
    //   esperarCopiaLocal(ref, listo, ms)
    //                                    después de una transacción, espera a que la copia del teléfono tenga el
    //                                    cambio (para que la lectura que sigue ya lo muestre). La usan las de arriba.

    /**
     * Las transacciones se confirman en el servidor y la copia del teléfono se
     * entera un instante después: si se vuelve a leer enseguida puede venir el
     * dato viejo. Esto espera (como mucho `ms`, 4 s por defecto) a que la copia
     * local del documento `ref` cumpla `listo(datos)` (datos = null si no existe).
     * Nunca falla: si no llega a tiempo, sigue.
     */
    function esperarCopiaLocal(ref, listo, ms) {
      return new Promise(resolve => {
        let cortar = null, hecho = false, reloj = null;
        const fin = () => {
          if (hecho) return;
          hecho = true;
          clearTimeout(reloj);
          if (cortar) cortar();
          resolve();
        };
        reloj = setTimeout(fin, ms || 4000);
        try {
          cortar = fb().onSnapshot(ref, snap => {
            let ok = true;
            try { ok = !!listo(snap.exists() ? snap.data() : null); } catch(e) { ok = true; }
            if (ok) fin();
          }, fin);
          if (hecho) cortar();
        } catch(e) { fin(); }
      });
    }

    /** Importe con signo: "pedido" suma, todo lo demás resta. Tolera monto en texto o faltante. */
    function ccImporteFirmado(mov) {
      if (!mov) return 0;
      const monto = Number(mov.monto) || 0;
      return mov.tipo === "pedido" ? monto : -monto;
    }

    /** Saldo de una lista de movimientos (positivo = debe). */
    function ccSaldoDeMovimientos(movs) {
      return SersaleBase.redondear((movs || []).reduce((s, m) => s + ccImporteFirmado(m), 0), 2);
    }

    /** ¿Es el mismo cliente? Ignora mayúsculas, acentos y espacios de más. Un nombre vacío no coincide con nada. */
    function ccMismoCliente(a, b) {
      return SersaleBase.norm(a) !== "" && SersaleBase.mismoNombre(a, b);
    }

    /**
     * Día "AAAA-MM-DD" de una fecha de movimiento. Los textos se toman tal cual
     * (primeros 10 caracteres, como siempre se mostraron); Timestamp, {seconds}
     * o Date se pasan a día de Buenos Aires. Devuelve "" si no hay fecha válida.
     */
    function ccDia(valor) {
      if (typeof valor === "string") {
        const s = valor.trim().substring(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
      }
      if (valor == null) return "";
      return SersaleBase.diaDe(valor);
    }

    /** Saldo con signo para mostrar: "$1.200", "-$1.200" (a favor del cliente). */
    function ccFmtSaldo(n) {
      return SersaleBase.fmtMonto(Math.round(Number(n) || 0));
    }

    /** "debe" (saldo > 0), "a_favor" (saldo < 0) o "al_dia". */
    function ccEstadoSaldo(n) {
      const x = Math.round(Number(n) || 0);
      return x > 0 ? "debe" : x < 0 ? "a_favor" : "al_dia";
    }

    function ccTextoISO(v) {
      if (typeof v === "string") return v;
      const d = SersaleBase.aFecha(v);
      return d ? d.toISOString() : "";
    }
    function ccOrdenMovimientos(a, b) {
      const fd = (ccDia(a.fecha) || ccDia(a.createdAt)).localeCompare(ccDia(b.fecha) || ccDia(b.createdAt));
      if (fd !== 0) return fd;
      return ccTextoISO(a.createdAt).localeCompare(ccTextoISO(b.createdAt));
    }

    /** De una lista de cuentas, la del cliente: no fusionada, y si hay varias, la de nombre idéntico. */
    function ccElegirCuenta(cuentas, nombre) {
      const candidatas = (cuentas || []).filter(c => !c.mergedInto && ccMismoCliente(c.nombre, nombre));
      if (!candidatas.length) return null;
      return candidatas.find(c => c.nombre === nombre) || candidatas[0];
    }

    /** Cuenta corriente del cliente o null. */
    async function ccBuscarCuenta(nombre) {
      const { db, collection, getDocs } = fb();
      const snap = await getDocs(collection(db, "cuentas_corrientes"));
      return ccElegirCuenta(snap.docs.map(d => ({ id: d.id, ...d.data() })), nombre);
    }

    /** Movimientos del cliente (por nombre o por clienteId de la cuenta), del más viejo al más nuevo. */
    async function ccMovimientosDe(nombre, cuenta) {
      const { db, collection, getDocs } = fb();
      const snap = await getDocs(collection(db, "cc_movimientos"));
      const clienteId = cuenta && cuenta.clienteId;
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => ccMismoCliente(m.cliente, nombre) || (cuenta && ccMismoCliente(m.cliente, cuenta.nombre)) || (!!clienteId && m.clienteId === clienteId))
        .sort(ccOrdenMovimientos);
    }

    /**
     * Movimiento de cuenta corriente que corresponde a un pedido cuando se hace
     * (o se corrige) su remito. `movs` son los movimientos del cliente.
     *   1. El que ya está vinculado: mismo pedidoId, o el remitoNro del remito ya emitido.
     *   2. Si no, el "Pendiente de facturar" que dejó el alta del pedido: origen
     *      "pedido_app", monto 0, misma fecha de entrega (si hay varios, el que
     *      tiene los mismos productos).
     * Devuelve null si hay que crear uno nuevo.
     */
    function ccMovimientoDePedido(movs, pedido, remitoNro) {
      const lista = movs || [];
      let m = lista.find(x => x.pedidoId && x.pedidoId === pedido.id);
      if (!m && remitoNro != null && remitoNro !== "") m = lista.find(x => x.tipo === "pedido" && x.remitoNro != null && Number(x.remitoNro) === Number(remitoNro));
      if (m) return m;
      const pendientes = lista.filter(x =>
        x.tipo === "pedido" && x.origen === "pedido_app" && (Number(x.monto) || 0) === 0 &&
        x.remitoNro == null && !x.pedidoId && ccDia(x.fecha) === (pedido.fechaEntrega || ""));
      const productos = (pedido.items || []).map(it => it.producto).join(", ");
      return pendientes.find(x => x.detalle === productos) || pendientes[0] || null;
    }

    /**
     * Lecturas previas de un asiento (fuera de la transacción).
     *   opts.cliente      nombre del cliente, como figura en el pedido o en la cuenta.
     *   opts.cuenta       cuenta ya buscada con ccBuscarCuenta (opcional: si falta, se busca).
     *   opts.movId        id del movimiento a corregir, o id fijo para uno nuevo (opcional: sin id se crea con id nuevo).
     *                     Con id, repetir la misma llamada no duplica nada: el movimiento queda con los datos nuevos y
     *                     el saldo se ajusta solo por la diferencia (sirve para reintentar después de un error de red).
     *   opts.abrirCuenta  true: si el cliente no tiene cuenta, se abre en la misma transacción
     *                     (con saldo = suma de lo que ya tuviera en cc_movimientos). Sin esto, y sin cuenta, no se escribe nada.
     *   opts.conSaldo     true: guarda en el movimiento el saldo que deja (campo `saldo`, como hacen las devoluciones).
     *   opts.ultimoMovimiento  día a dejar en la cuenta (por defecto, hoy).
     */
    async function ccPrepararAsiento(opts) {
      const { db, collection, doc } = fb();
      const cuenta = opts.cuenta !== undefined ? opts.cuenta : await ccBuscarCuenta(opts.cliente);
      const plan = {
        cliente: opts.cliente,
        cuenta: cuenta || null,
        abrirCuenta: !!opts.abrirCuenta,
        conSaldo: !!opts.conSaldo,
        ultimoMovimiento: opts.ultimoMovimiento || SersaleBase.hoy(),
        cuentaRef: cuenta ? doc(db, "cuentas_corrientes", cuenta.id) : (opts.abrirCuenta ? doc(collection(db, "cuentas_corrientes")) : null),
        movRef: opts.movId ? doc(db, "cc_movimientos", opts.movId) : doc(collection(db, "cc_movimientos")),
        movConocido: !!opts.movId,
        saldoPrevioSinCuenta: 0,
        cuentaSnap: null,
        movSnap: null,
      };
      // Cuenta nueva: arranca con lo que el cliente ya tuviera asentado (movimientos huérfanos).
      if (!cuenta && opts.abrirCuenta) plan.saldoPrevioSinCuenta = ccSaldoDeMovimientos(opts.movs || await ccMovimientosDe(opts.cliente, null));
      return plan;
    }

    /** Lecturas del asiento dentro de la transacción (antes de cualquier escritura). */
    async function ccLeerAsiento(tx, plan) {
      plan.cuentaSnap = plan.cuentaRef ? await tx.get(plan.cuentaRef) : null;
      // Se lee siempre, también cuando el movimiento es nuevo: si se cortó la señal justo al
      // confirmar, Firestore vuelve a ejecutar la transacción y el movimiento ya está guardado.
      // Al verlo, el saldo se ajusta solo por la diferencia (cero) y no se cobra dos veces.
      plan.movSnap = await tx.get(plan.movRef);
    }

    /**
     * Escrituras del asiento dentro de la transacción. `datos` son los campos del
     * movimiento: tipo ("pedido" | "pago"), monto (positivo), fecha, detalle, obs,
     * origen, formaPago, remitoNro, pedidoId, items… Lo que no se pasa no se toca.
     * Devuelve { asentado, corregido, delta, saldo, movId, cuentaId, cuentaAbierta }.
     * Después de la transacción conviene llamar a ccEsperarAsiento(plan).
     */
    function ccEscribirAsiento(tx, plan, datos) {
      const hayCuenta = !!(plan.cuentaSnap && plan.cuentaSnap.exists());
      if (!plan.cuentaRef || (!hayCuenta && !plan.abrirCuenta)) return { asentado: false };
      const cuentaDatos = hayCuenta ? plan.cuentaSnap.data() : null;
      const saldoGuardado = hayCuenta ? (Number(cuentaDatos.saldo) || 0) : plan.saldoPrevioSinCuenta;
      const previo = plan.movSnap && plan.movSnap.exists() ? plan.movSnap.data() : null;
      const ahora = new Date().toISOString();
      const nuevo = previo ? { ...previo, ...datos } : { ...datos };
      const delta = ccImporteFirmado(nuevo) - (previo ? ccImporteFirmado(previo) : 0);
      const saldo = SersaleBase.redondear(saldoGuardado + delta, 2);
      const extra = plan.conSaldo ? { saldo } : {};
      if (previo) {
        tx.update(plan.movRef, { ...datos, movimiento: ccImporteFirmado(nuevo), updatedAt: ahora, ...extra });
      } else {
        const mov = { cliente: hayCuenta ? cuentaDatos.nombre : plan.cliente, ...datos, movimiento: ccImporteFirmado(nuevo), createdAt: ahora, ...extra };
        if (hayCuenta && cuentaDatos.clienteId) mov.clienteId = cuentaDatos.clienteId;
        tx.set(plan.movRef, mov);
      }
      if (hayCuenta) tx.update(plan.cuentaRef, { saldo, ultimoMovimiento: plan.ultimoMovimiento });
      else tx.set(plan.cuentaRef, { nombre: plan.cliente, saldo, creadoEn: ahora, ultimoMovimiento: plan.ultimoMovimiento });
      plan.marca = ahora;
      plan.saldoFinal = saldo;
      return { asentado: true, corregido: !!previo, delta, saldo, movId: plan.movRef.id, cuentaId: plan.cuentaRef.id, cuentaAbierta: !hayCuenta };
    }

    /**
     * Crea o corrige un movimiento y ajusta el saldo de la cuenta en una sola
     * transacción (o no se guarda nada). Ejemplos:
     *   pago:        ccAsentarMovimiento({ cliente, movId, datos: { tipo: "pago", formaPago, monto, fecha, detalle, obs } })
     *   venta/cargo: ccAsentarMovimiento({ cliente, datos: { tipo: "pedido", monto, fecha, detalle, obs, origen } })
     *   devolución:  ccAsentarMovimiento({ cliente, conSaldo: true, datos: { tipo: "pago", monto, fecha, detalle, obs, origen: "devolucion" } })
     * Mismas opciones que ccPrepararAsiento, más `datos`. Si el resultado trae
     * asentado:false es que el cliente no tiene cuenta (y no se pidió abrirla).
     */
    async function ccAsentarMovimiento(opts) {
      const { db, runTransaction } = fb();
      const plan = await ccPrepararAsiento(opts);
      const res = await runTransaction(db, async tx => {
        plan.marca = null;
        await ccLeerAsiento(tx, plan);
        return ccEscribirAsiento(tx, plan, opts.datos);
      });
      await ccEsperarAsiento(plan);
      return res;
    }

    /** Después de la transacción de un asiento: espera a que el teléfono tenga el movimiento y el saldo nuevos. */
    async function ccEsperarAsiento(plan) {
      if (!plan || !plan.marca) return;
      const marca = plan.marca;
      await esperarCopiaLocal(plan.movRef, d => !!d && (d.createdAt === marca || d.updatedAt === marca));
      await esperarCopiaLocal(plan.cuentaRef, d => !!d && Number(d.saldo) === plan.saldoFinal, 1500);
    }

    /**
     * Mantenimiento: deja en la cuenta la suma de sus movimientos. Solo cuando la
     * persona lo pide (el saldo guardado y los movimientos no coinciden).
     * Devuelve { cuentaId, anterior, saldo, cambio } (cambio:true = entró un movimiento
     * en el medio y no se tocó nada) o null si el cliente no tiene cuenta.
     */
    async function ccRecalcularSaldo(nombre) {
      const { db, doc, runTransaction } = fb();
      const cuenta = await ccBuscarCuenta(nombre);
      if (!cuenta) return null;
      const saldo = ccSaldoDeMovimientos(await ccMovimientosDe(cuenta.nombre, cuenta));
      const ref = doc(db, "cuentas_corrientes", cuenta.id);
      const res = await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return null;
        const anterior = Number(snap.data().saldo) || 0;
        // Si entró un movimiento mientras se sumaba, la suma ya es vieja: no se pisa nada.
        if (anterior !== (Number(cuenta.saldo) || 0)) return { cuentaId: cuenta.id, anterior, saldo: anterior, cambio: true };
        tx.update(ref, { saldo });
        return { cuentaId: cuenta.id, anterior, saldo, cambio: false };
      });
      if (res && !res.cambio) await esperarCopiaLocal(ref, d => !!d && Number(d.saldo) === saldo);
      return res;
    }


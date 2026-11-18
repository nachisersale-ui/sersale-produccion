# Cuentas corrientes y remitos — arreglos

Archivos tocados: `src/pedidos/03-pedidos-comercial-remito.jsx`, `src/pedidos/06-cuentas-corrientes-stats.jsx`.
Archivo nuevo: `src/pedidos/00-cuenta-corriente.jsx` (reglas de cuenta corriente en un solo lugar).
Pruebas: `tests/arreglos-cc.test.mjs` (18 pruebas). Pasan con este código; corridas contra el código anterior fallan las 18 (algunas solo porque buscan elementos nuevos de la pantalla).

Candidatos revisados: `docs/auditoria/mapas/pedidos-3.json` y `pedidos-6.json`.
Resultado: 38 arreglados, 4 descartados, 14 pendientes.

## Cómo queda la cuenta corriente

Reglas únicas, en `00-cuenta-corriente.jsx` (cada función está explicada arriba del archivo):

- Un movimiento `tipo: "pedido"` suma su monto al saldo; cualquier otro (`"pago"`, crédito por devolución) lo resta. Saldo positivo = debe; negativo = a favor del cliente.
- El cliente se reconoce por nombre sin mirar mayúsculas, acentos ni espacios de más (`SersaleBase.mismoNombre`), o por `clienteId` si la cuenta y el movimiento lo tienen. Las cuentas con `mergedInto` no se usan.
- Movimiento y saldo se guardan juntos en una transacción. El saldo nuevo es el saldo guardado más o menos el importe del movimiento. Ya no se pisa el saldo con una suma hecha en el teléfono.
- No cambia ningún formato guardado. Campos nuevos, todos opcionales: `pedidoId` en el movimiento de un remito; `fechaEntrega`, `tipo` y `updatedAt` en el remito. Ids fijos solo en documentos nuevos: remito `ped_<id del pedido>`, cargo de remito sin pendiente previo `remito_<id del pedido>`, cuenta creada con "+ Nueva" `cta_<nombre>`. Los documentos anteriores se siguen encontrando por sus campos (`pedidoId`, `remitoNro`, `nombre`).

Funciones: `ccImporteFirmado`, `ccSaldoDeMovimientos`, `ccMismoCliente`, `ccDia`, `ccFmtSaldo`, `ccEstadoSaldo`, `ccBuscarCuenta`, `ccMovimientosDe`, `ccMovimientoDePedido`, `ccAsentarMovimiento` (y sus partes `ccPrepararAsiento` / `ccLeerAsiento` / `ccEscribirAsiento` / `ccEsperarAsiento`), `ccRecalcularSaldo`, `esperarCopiaLocal`.

En `03` quedó además `pedidoCambiarEstado(visto, nuevoEstado, itemsConKg)`, pensada para que también la use el Depósito (ver "Pendiente en otros archivos").

Cambio de comportamiento a tener en cuenta: guardar un remito, registrar un pago, crear una cuenta y cambiar estado o kg **desde Comercial** ahora necesitan conexión (son transacciones). Sin señal avisan "No se pudo guardar" y no guardan nada. El Depósito sigue igual que antes.

## Arreglado

### Críticos

**1. Remito: un ítem pesado en 0 kg se cobraba por la cantidad pedida**
- Qué pasaba: Distribuidora Mayorista pide 40 kg de Jamón Cocido Natural Sublime, no hay y el depósito carga 0 kg. La pantalla y el PDF mostraban 0 kg, pero al guardar el remito quedaba con 40 kg y a la cuenta corriente se le cargaban 40 × $10.090 = $403.600 de más.
- Qué se cambió: una sola cuenta de kg (`kgFacturables`) y un solo juego de filas para pantalla, PDF, remito guardado y cuenta corriente.
- Prueba: "remito: un ítem pesado en 0 kg no se cobra…".

**2. Remito: guardarlo dos veces cobraba dos veces**
- Qué pasaba: se guarda el remito, se ve un precio mal, se vuelve atrás, se abre de nuevo y se guarda. Quedaban dos remitos (0040 y 0041), dos cargos en la cuenta y el saldo con los dos. Lo mismo al reintentar después de un error.
- Qué se cambió: un remito por pedido. Si el pedido ya tiene remito, la pantalla lo avisa y al guardar corrige ese remito y su cargo (el saldo se ajusta solo por la diferencia). No gasta otro número.
- Prueba: "remito: volver a guardarlo corrige el mismo remito y su cargo, no cobra dos veces".

**3. Pago: registrar un pago podía borrar cargos del saldo**
- Qué pasaba: el remito reconocía al cliente aunque el nombre estuviera con otras mayúsculas; el pago recalculaba el saldo solo con los movimientos de nombre idéntico. Carnicería El Trébol con un cargo de $120.000 escrito "CARNICERÍA EL TRÉBOL": saldo $780.925; se registra un pago de $10.000 y el saldo pasaba a $650.925 en vez de $770.925. Ese cargo tampoco se veía en el detalle ni en el PDF.
- Qué se cambió: reglas únicas (arriba). El pago resta solo el pago. El detalle y el PDF muestran todos los movimientos del cliente.
- Prueba: "cuenta corriente: registrar un pago resta solo el pago…".

### Altos

**4. Remito: el PDF compartido después de guardar llevaba el número siguiente**
- Qué pasaba: se guarda el 0040 y el PDF que se le manda al cliente dice 0041. El próximo remito también es 0041.
- Qué se cambió: después de guardar queda el número guardado. El campo del número es solo de lectura (lo que se escribía ahí nunca se guardaba).
- Prueba: la del punto 1 (revisa el texto del PDF y el nombre del archivo).

**5. Remito: si fallaba la parte de cuenta corriente igual decía "Guardado"**
- Qué pasaba: el remito, los precios, el movimiento y el saldo eran escrituras separadas; si fallaba una del medio, la pantalla decía "✓ Guardado" con la cuenta sin cargar, y reintentar creaba otro remito.
- Qué se cambió: número, remito, precios, movimiento y saldo van en una sola transacción. Si falla, no queda nada guardado, se avisa y el botón queda listo para reintentar.
- Prueba: "remito: si falla al guardar no queda nada a medias…".

**6. Pedidos: una tarjeta vieja pisaba lo que cargó otro teléfono**
- Qué pasaba: (a) con la lista de Comercial abierta desde temprano, "En preparación" reescribía los ítems viejos y borraba un producto agregado después; (b) "Guardar Cambios" en Editar borraba los kg que el depósito había pesado mientras tanto; (c) un pedido cancelado desde otro teléfono volvía a "preparando".
- Qué se cambió: en Comercial el cambio se hace contra el pedido como está en la base. Si el estado o los productos cambiaron, no escribe nada, avisa y recarga la lista. De los kg solo se guardan los que la persona tocó. Editar conserva los kg actuales del pedido.
- Pruebas: "pedidos: una tarjeta vieja no revive un pedido cancelado…", "pedidos: con la lista vieja, «En preparación» no borra…", "pedidos: corregir un kg desde una tarjeta vieja…", "editar pedido: guardar no borra los kg…".
- Falta la misma corrección en el Depósito (archivo 04).

**7. Un pedido marcado Despachado antes del remito no se podía facturar**
- Qué pasaba: sale el camión, se toca "Despachado" y el pedido pasa al Historial sin botones. En un cliente con cuenta, el "Pendiente de facturar" quedaba en $0 para siempre (en los datos de ejemplo: Panificadora Gamas Caballito, entrega 05/11).
- Qué se cambió: en Comercial → Historial, las tarjetas despachadas tienen "🧾 Remito". Al guardarlo, el pendiente toma el importe. No aparece en ventas rápidas.
- Prueba: "remito: un pedido ya despachado sin remito se puede facturar desde el Historial…".

**8. Cuenta corriente: el botón "Pago" dentro del detalle no hacía nada**
- Qué pasaba: en "Ver movimientos", tocar "💰 Pago" no mostraba nada; la hoja aparecía recién al volver a la lista, a veces con el monto escrito para otro cliente.
- Qué se cambió: la hoja de pago se dibuja también sobre el detalle, siempre arranca vacía, y al confirmar el detalle se actualiza solo.
- Prueba: "cuenta corriente: el botón «Pago» dentro del detalle…".

**9. Un saldo a favor del cliente se mostraba como deuda**
- Qué pasaba: Almacén D'Agostino tiene $25.258 a favor. La lista decía "$25.258 · Al día" y el PDF terminaba con "Saldo: $25.258" en rojo.
- Qué se cambió: los saldos se muestran con signo ("-$25.258"), con la leyenda "Saldo a favor del cliente" en lista, detalle y PDF.
- Prueba: "cuenta corriente: un saldo a favor del cliente se muestra como tal…".

**10. Cuentas fusionadas por la migración**
- Qué pasaba: una cuenta fusionada (`mergedInto`) seguía apareciendo como tarjeta en $0, y el primer pago sobre la cuenta principal deshacía el saldo consolidado.
- Qué se cambió: las cuentas fusionadas no se listan ni se usan; el pago ya no recalcula.
- Prueba: la del punto 3 (incluye una cuenta fusionada).

### Medios

**11. Pedido marcado "cuenta corriente" de un cliente sin cuenta: deuda que no se veía en ningún lado**
- Qué pasaba: se guardaba el movimiento pero no había cuenta que lo mostrara.
- Qué se cambió: al guardar el remito se abre la cuenta en la misma transacción y la pantalla lo dice. Una cuenta nueva (acá o con "+ Nueva") arranca con la suma de lo que el cliente ya tuviera en movimientos sueltos.
- Prueba: "remito: pedido marcado «cuenta corriente» de un cliente sin cuenta…". La contraria: "remito: cliente sin cuenta corriente y pedido sin marcar…".

**12. Número de remito tomado con leer-y-después-escribir**
- Qué pasaba: dos teléfonos guardando a la vez podían sacar el mismo número.
- Qué se cambió: el número se toma dentro de la transacción del remito.
- Prueba: indirecta, en las de remito (contador y número).

**13. El remito guardado no tenía fecha de entrega ni tipo**
- Qué pasaba: al reimprimirlo desde el cliente salía "Retiro por local" y entrega "-".
- Qué se cambió: se guardan `fechaEntrega` y `tipo`. Prueba: la del punto 1.

**14. Fechas del remito y de la cuenta en hora de Londres**
- Qué pasaba: un remito o un pago cargado a las 22:30 quedaba con fecha de mañana; el PDF de cuenta decía "Generado" mañana y "Hasta" mañana.
- Qué se cambió: todo con `SersaleBase.hoy()`.
- Pruebas: las de los puntos 1, 3, 9 y "«Crear cuenta» con doble toque…", que corren a las 22:30.

**15. Cancelar un pedido era un solo toque sin vuelta atrás**
- Qué se cambió: ❌ pide confirmación en una hoja propia. Prueba: "pedidos: cancelar pide confirmación".

**16. Cambios de estado sin aviso de error; la hoja de kg se cerraba antes de guardar**
- Qué se cambió: los botones se bloquean mientras se guarda; si falla se avisa y la hoja queda abierta con los kg escritos. Campos de kg con teclado decimal.
- Prueba: las del punto 6.

**17. El remito se armaba con la copia vieja del pedido**
- Qué pasaba: el depósito corrige un peso a las 9:30; la lista de Comercial es de las 8:00; el remito facturaba el peso viejo.
- Qué se cambió: al abrir el remito se relee el pedido, y al guardar se verifica otra vez: si cambió, avisa, muestra lo nuevo y no guarda.
- Prueba: "remito: factura los kg que hay ahora en el pedido…".

**18. Editar: cambiar el producto de una fila conservaba los kg del anterior**
- Qué pasaba: Bondiola pesada en 12,4 kg pasa a ser Paleta: el remito facturaba 12,4 kg de Paleta.
- Qué se cambió: al cambiar producto o categoría se limpia el kg de esa fila. Prueba: "editar pedido…".

**19. Pago en tres pasos sueltos**
- Qué pasaba: si fallaba después de guardar el movimiento, se veía un error, se cargaba de nuevo y quedaban dos pagos.
- Qué se cambió: una transacción; reintentar no duplica (mismo id de movimiento) y el botón se bloquea. Prueba: la del punto 3 (doble toque).

**20. El PDF de cuenta no cerraba con sus filas**
- Qué pasaba: la última fila decía $300.000 y abajo "Saldo: $450.000" (el de hoy, no el del período), sin saldo inicial.
- Qué se cambió: fila "Saldo anterior al <desde>", y al pie "Saldo al <hasta>" igual a la última fila. El saldo de hoy sigue arriba como "Saldo actual". Prueba: la del punto 9.

**21. Errores de carga mostrados como "sin datos"**
- Qué pasaba: si fallaba la lectura, un deudor se veía "Sin movimientos · ✅ Al día" y la lista "Sin cuentas corrientes". Mientras cargaba, todos decían "Al día".
- Qué se cambió: aviso de error con "Reintentar"; mientras carga dice "Cargando...". Sin prueba propia.

**22. "Crear cuenta" con doble toque abría dos cuentas**
- Qué se cambió: botón bloqueado, se verifica que no exista y la cuenta nueva usa un id fijo por cliente. Prueba: "«Crear cuenta» con doble toque…".

**23. La hoja "Exportar PDF" quedaba debajo de la barra de navegación**
- Qué se cambió: misma capa que las demás hojas. El PDF ahora se comparte (menú del iPhone) en vez de descargarse. Prueba: la del punto 9.

**24. Estadísticas: "Clientes activos" nunca pasaba de 8**
- Qué se cambió: cuenta todos los clientes del mes. Prueba: "estadísticas: «Clientes activos»…".

**25. Estadísticas: "Kg total" contaba unidades como kilos**
- Qué pasaba: 12 unidades de salame sin pesar figuraban como 12 kg; lo pedido por kilo no tomaba el peso real.
- Qué se cambió: por kilo usa lo pesado (o lo pedido si no se pesó); por pieza/bolsa/unidad solo suma kilos si hay peso real. Sin prueba (no es plata ni dato guardado). Ver "Para decidir".

**26. Una fecha guardada como Timestamp rompía el detalle**
- Qué se cambió: `ccDia` acepta texto, Timestamp o `{seconds}`. Prueba: la del punto 8 (incluye un movimiento importado así).

### Bajos

27. Editar pedido mostraba a casi todos los clientes como "Otro" con el nombre editable: ahora queda elegido en la lista cuando terminan de cargar los clientes. Prueba: "editar pedido…".
28. Lista de Comercial: si fallaba la carga quedaba "Cargando..." para siempre: ahora avisa y ofrece "Reintentar".
29. PDF del remito: con muchos ítems el total se salía de la hoja: ahora sigue en otra página.
30. Remito: total con decimales sueltos (111026.4999): cada renglón y el total se redondean a centavos antes de guardar; el cargo sigue en pesos enteros.
31. Remito: los precios guardados que llegaban tarde pisaban lo que ya se había escrito: ahora no.
32. Remito: si no se podía leer el contador mostraba "0001": ahora no inventa un número; se asigna al guardar.
33. "+ Crear primera" no cargaba la lista de clientes y decía que todos tenían cuenta.
34. Nombre del archivo del PDF de cuenta con barras: ahora `CC_Sersale_<cliente>_<desde>_a_<hasta>.pdf`.
35. PDF de cuenta: con 22 movimientos la fila final se pisaba con el pie: ahora pasa de hoja.
36. Avisos: `alert()` reemplazados por avisos propios en lo tocado; campos tocados a 16 px.

### Encontrados al revisar

**37. Después de guardar, la pantalla podía mostrar el dato viejo (medio)**
- Qué pasaba: una transacción se confirma en el servidor y la copia del teléfono se entera un instante después. Si se relee enseguida puede venir lo anterior (se registra el pago y el detalle no lo muestra).
- Qué se cambió: `esperarCopiaLocal` espera a que el teléfono tenga el cambio antes de recargar. Se usa en todo lo que guarda en 03 y 06.
- Prueba: las de pago y de pedidos fallaban de a ratos sin esto. El origen está en `js/fb.js` (ver "Pendiente en otros archivos").

**38. Saldo guardado distinto a la suma de movimientos (medio)**
- Qué pasaba: la lista muestra el saldo guardado y el detalle la suma de movimientos. Si no coinciden no había forma de verlo ni de corregirlo.
- Qué se cambió: el detalle avisa con los dos importes y ofrece "Corregir saldo guardado", con confirmación.
- Prueba: "cuenta corriente: si el saldo guardado no coincide…".

## Descartado

- 03 #14 (una parte): "si se cierra la app sin señal se pierde lo cargado". No: `js/fb.js` guarda lo pendiente en el teléfono (lo prueba `tests/datos.test.mjs`).
- 06 #3 (c): saldo calculado con una copia parcial después de un corte. No se pudo armar un caso, y el saldo ya no se recalcula al pagar.
- 03 ux#12 y 06 ux#7: "zoom al enfocar campos chicos". Hoy no pasa (la página fija la escala).
- 03 seguridad#4 y 06 seguridad#3: confirman que no hay inyección de HTML en estas pantallas. Nada que arreglar.

## Pendiente

1. **Cancelar o editar un pedido no toca su cuenta corriente** (03 #12, medio). Cancelar un pedido con remito deja el remito y el cargo. Cancelar antes del remito deja un "Pendiente de facturar" de $0 para siempre (en los datos de ejemplo: San Cayetano, 31/10). Cambiar la fecha de entrega o el cliente deja el pendiente viejo y el remito crea otro movimiento. Necesita una decisión y que el pendiente lleve `pedidoId` (archivo 02).
2. **Piezas, ganchos, bolsas y unidades sin pesar se facturan como kilos** (03 #7, medio). Ver "Para decidir".
3. **Los precios del remito no vuelven al pedido** (03 #11, medio): el Panel factura mal si el remito se guarda en otro mes que la entrega. Es de `dashboard.html`.
4. **Lista vieja en el Depósito** (03 #3): la corrección del punto 6 falta en el archivo 04.
5. **Compartir el PDF antes de guardar** (03 ux#2): se puede mandar un remito que nunca se guardó, con un número provisorio. Ver "Para decidir".
6. **Remitos duplicados que ya estén en la base** por el punto 2: no se tocan. Corregir uno no borra el otro ni su cargo. Hay que revisarlos a mano.
7. **Marca NUEVO en Comercial nunca aparece** (03 #18, bajo): se arregla en el archivo 08.
8. **Corregir kg agrega un "listo" más al historial** (03 #22, bajo). Es el comportamiento de siempre; no se tocó.
9. **Editar: una fila con producto que ya no está en el catálogo se ve vacía** y se pierde al guardar (03 #25, bajo).
10. **Estadísticas cuenta como pedidos los movimientos de cuenta sin pedido** (06 #14, bajo). Ver "Para decidir".
11. **Un pago mal cargado no se puede anular ni fechar** (06 ux#1).
12. **Sin conexión, Comercial y Cuentas no guardan** (cambio de este trabajo). Ver "Para decidir".
13. **Accesos**: director y operario se distinguen solo en la pantalla; la base no pide identidad, y los movimientos no guardan quién los cargó (03 y 06, seguridad).
14. Usabilidad y velocidad sin tocar: el gesto "atrás" del iPhone sale de la página, botones de menos de 44 px, borradores que se pierden si iOS recarga, lista de cuentas sin buscador, Comercial lee todos los pedidos cada vez.

## Pendiente en otros archivos

Código que hoy repite reglas de cuenta corriente y tiene que pasar a las funciones de `00-cuenta-corriente.jsx`.

**`src/pedidos/02-clientes-nuevo-pedido.jsx`**
- Líneas 35-70, `GestionClientes.eliminar`: pregunta con `confirm()` del navegador y borra precios, movimientos y cuenta comparando con `toLowerCase().trim()`, uno por uno y sin transacción. Pasar a `SersaleUI.confirmar` y `ccMismoCliente` / `ccBuscarCuenta` / `ccMovimientosDe`. Ojo: es un borrado; `ccMismoCliente` además ignora acentos.
- Líneas 502-516, `NuevoPedido.onSelectCliente` (consulta en la 511): busca la cuenta por nombre idéntico para mostrar el saldo y traga el error. Usar `ccBuscarCuenta(val)` y `ccFmtSaldo`.
- Líneas 559-584, `NuevoPedido.guardar`: crea el "Pendiente de facturar" (574) y, si hay monto, recalcula el saldo por nombre idéntico con una regla propia (`if(m.monto>0)`, 577-581); la fecha de `ultimoMovimiento` sale en UTC; los errores se tragan. Usar `ccAsentarMovimiento({ cliente, datos: { tipo:"pedido", monto, fecha: entrega, detalle, obs, origen:"pedido_app", pedidoId } })` con el id del pedido recién creado.
- Línea 167, `today()`: fecha en UTC. Usar `SersaleBase.hoy()`.

**`src/pedidos/04-deposito-remitos-historial.jsx`**
- No tiene reglas de cuenta corriente.
- Líneas 280-290, `VistaDeposito.cambiarEstado`: escribe estado, historial e ítems desde la copia en memoria (287: `upd.items = itemsConKg`). Cambiar por `pedidoCambiarEstado(visto, nuevoEstado, itemsConKg)` (está en 03). Como es una transacción necesita señal: decidir qué hace el depósito sin conexión.
- Línea 170, `HistorialFiltrado`: no pasa `onRemito`; hoy el botón le llega por `ComercialCtx`. Si se prefiere, pasarlo como prop.
- Líneas 415-507 y 558-620, `generarPDFRemito` y `VerRemitoGuardado`: dibujan el mismo PDF que `RemitoPedido.imprimir` (03). Los remitos nuevos ya traen `fechaEntrega` y `tipo`. Conviene dejar un solo dibujo del PDF.

**`src/pedidos/05-venta-rapida-precios.jsx`**
- Líneas 34-93, `ModalVentaRapida.guardar`: fecha en UTC (44); crea el movimiento (68-81) y después recalcula el saldo por nombre idéntico (82-89): pisa cargos escritos con otro nombre y no es transacción. Si el cliente no tiene cuenta, guarda el movimiento igual y la deuda no se ve. Usar `ccAsentarMovimiento({ cliente, abrirCuenta, datos: { tipo:"pedido", monto, fecha: SersaleBase.hoy(), detalle, obs, origen:"venta_rapida", items } })`.

**`src/pedidos/07-alertas-hoja-ruta.jsx`**
- No tiene reglas de cuenta corriente. Nada que cambiar por esto.

**`src/pedidos/08-director-devoluciones-app.jsx`**
- Líneas 521-543, `TabDevoluciones.guardar`: lee el saldo, le resta el crédito y lo escribe (531), busca la cuenta por nombre idéntico, fechas en UTC (519, 532, 537) y traga el error (543). Usar `ccAsentarMovimiento({ cliente, conSaldo: true, datos: { tipo:"pago", monto, fecha: SersaleBase.hoy(), detalle, obs, origen:"devolucion" } })`.
- Líneas 51-106, cálculo de alertas: junta nombres con `toLowerCase().trim()` (52-57), convierte fechas a mano (68-84) y compara por nombre idéntico (91). Usar `SersaleBase.norm` y `ccDia`.
- Líneas 830-831, `App.seleccionar`: marca "visto" antes de entrar a la vista; por eso NUEVO nunca aparece en Comercial.

**Fuera de `src/pedidos/`**
- `src/js/fb.js`, líneas 140-152 y 170-176: después de una transacción, `getDocs` de una colección entera puede devolver lo anterior, porque responde la escucha que ya está abierta. `tests/datos.test.mjs` ("después de una transacción, la lectura siguiente ya ve el cambio") falla de a ratos por esto (leyó 1000 en vez de 1500 en una corrida completa). En 03 y 06 se evita con `esperarCopiaLocal`.
- `src/pedidos.html`, línea 43: `window.__fb` no ofrece `writeBatch` ni `getDocsFromServer`.
- `src/dashboard.html`, líneas 313-348 y 371-379: la facturación sale de precios en el pedido, que el remito no escribe (pendiente 3). Con `fechaEntrega` en el remito ya se puede cruzar por entrega. En la 315 conviene saltear cuentas con `mergedInto`.
- `src/migracion.html`, línea 230: `normaliza` saca además la puntuación del final; `SersaleBase.norm` no. Dos nombres que solo difieren en un punto final se juntan en la migración pero no en la app (salvo por `clienteId`).

## Para decidir con el dueño

1. **Saldo guardado y movimientos que no coinciden.** Hoy se avisa en el detalle y se corrige a mano. ¿Vale siempre la suma de movimientos? Si es así se puede corregir solo.
2. **Productos por pieza, gancho, bolsa o unidad sin peso.** El remito multiplica la cantidad por el precio "por kg". ¿Esos productos se cobran por kilo (hay que exigir el peso) o por unidad?
3. **Cancelar un pedido que ya tiene remito.** ¿Se anula el cargo, se hace una nota de crédito, o no se deja cancelar? ¿Y el "Pendiente de facturar" de un pedido cancelado se borra?
4. **Compartir el PDF del remito antes de guardarlo.** ¿Se usa como proforma, o hay que obligar a guardar primero?
5. **Pedido marcado "cuenta corriente" de un cliente sin cuenta.** Ahora la cuenta se abre sola al hacer el remito. ¿Así, o que pregunte?
6. **Pagos mal cargados.** ¿Hace falta anular un pago y cargarlo con otra fecha?
7. **"Despachado" con un toque.** Sigue sin confirmación, porque el remito ya se puede hacer después. ¿Confirmación también?
8. **Estadísticas.** ¿Los kilos del ranking son los pesados (así quedó) o los pedidos? ¿Los movimientos de cuenta sin pedido cuentan como pedidos del mes?
9. **Sin señal.** Remitos, pagos y cambios de estado desde Comercial ahora exigen conexión. ¿Alcanza, o se necesita cargar sin señal?
10. **Accesos.** Cualquiera con la dirección del sistema puede leer y escribir saldos: no hay usuarios reales en la base. ¿Se avanza con ingreso por usuario?

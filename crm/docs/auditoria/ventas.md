# Ventas diarias (ventas.html): arreglos

Archivo tocado: `src/ventas.html`. Pruebas: `tests/arreglos-ventas.test.mjs` (11 pruebas; pasan tres veces seguidas junto con `smoke.test.mjs`, y la tanda completa de 66 también pasa).

Nadie había revisado este archivo antes: los defectos salen de leerlo entero. Cada uno se comprobó en la página real antes de tocarlo, y las 11 pruebas se corrieron también contra la versión anterior para confirmar que fallaban.

No cambia ningún formato guardado: los registros de `ventas_diarias` siguen con los mismos campos y el mismo id (`fecha_sucursal`). Lo único distinto es que los totales calculados se guardan redondeados a centavos.

Los importes de los ejemplos son los de la base de ejemplo de las pruebas (hoy = martes 10/11/2026).

## Arreglado

### 1. Un segundo toque en "Guardar" reemplazaba el registro recién cargado por uno en cero — crítica
- **Qué pasaba:** al guardar, el formulario se limpia pero la fecha y la sucursal quedan. Si se tocaba "Guardar" otra vez (por ejemplo porque no se vio el aviso, ver punto 4), se guardaba el formulario vacío encima: Total Z $1.250.000 pasaba a $0, sin cobros ni gastos, y sin preguntar.
- **Qué se cambió:** un formulario sin nada cargado no se guarda ("No hay nada cargado: completá el Total Z antes de guardar"). Además, ver punto 2.
- **Prueba:** "un segundo toque en Guardar, con el formulario ya limpio, no pisa el registro con ceros".

### 2. Guardar pisaba sin avisar el registro que ya existía para ese día y sucursal — alta
- **Qué pasaba:** el registro se identifica por fecha + sucursal y se escribía encima de lo que hubiera. La página abre siempre en Parque Patricios: si se cargaba el cierre de Caballito sin cambiar el botón, se perdía el de Parque Patricios (el del lunes 9/11, Total Z $995.700, quedaba reemplazado por lo nuevo). Lo mismo con una fecha mal elegida o con dos teléfonos cargando el mismo cierre.
- **Qué se cambió:** antes de guardar se mira si ya hay registro. Si lo hay, pregunta: "09/11/2026 · Parque Patricios ya tiene cargado Total Z $995.700 (ventas $1.055.300). Si seguís, se reemplaza por lo que cargaste ahora (Total Z $111.000)" con botones Cancelar / Reemplazar. Cancelar deja el registro y el formulario como estaban. La lectura y la escritura van en una transacción, así que con dos teléfonos a la vez uno guarda y al otro le pregunta.
- **Pruebas:** "si ya hay un registro de ese día y sucursal, pregunta antes de reemplazarlo" y "dos teléfonos cargan el mismo cierre a la vez: uno guarda y al otro le pregunta".

### 3. Después de las 21 hs la fecha propuesta era la de mañana — alta
- **Qué pasaba:** la fecha se armaba con el día UTC. Cargando el cierre el 10/11 a las 22:30 proponía 11/11; si se guardaba así, el cierre quedaba un día corrido y el cierre real del 11/11 lo reemplazaba al día siguiente (punto 2). Es la fila de `src/ventas.html` en `_pendientes-entre-archivos.md`.
- **Qué se cambió:** se usa `SersaleBase.hoy()` (día de Buenos Aires). El mes del Historial también.
- **Prueba:** "a las 22:30 propone la fecha de hoy, guarda en ese día con totales redondeados y el aviso se ve".

### 4. El aviso de "Registro guardado" (y el de error) no se veía — alta
- **Qué pasaba:** la página dibujaba su propio aviso a 24 px del borde inferior, por debajo de la barra de navegación del Director. Asomaban 7 px durante 3 segundos. El director no tenía forma de saber si se había guardado o si había fallado, y eso invita al segundo toque del punto 1.
- **Qué se cambió:** los avisos salen con `SersaleUI.toast`, arriba de la barra. El de guardado dice qué se guardó: "Registro guardado: 10/11/2026 · Parque Patricios".
- **Prueba:** la misma del punto 3 (controla que nada tape el aviso).

### 5. Sin conexión, "Guardar" quedaba en "Guardando..." para siempre — alta
- **Qué pasaba:** esta página no guarda copia en el teléfono. Sin señal, el botón quedaba en "Guardando..." sin ningún mensaje (comprobado: 30 segundos sin cambios) y, si se cerraba la página, el cierre se perdía.
- **Qué se cambió:** sin señal avisa al instante "Sin conexión. No se guardó: probá de nuevo cuando vuelva la señal." Si hay señal pero el servidor no contesta, a los pocos segundos avisa "No se pudo guardar. Probá de nuevo." En los dos casos el formulario queda con lo escrito y el botón vuelve a estar disponible. Lo mismo al editar un registro.
- **Pruebas:** "sin conexión: avisa que no se guardó, no muestra 'sin registros', y al volver la señal guarda lo escrito" y "si el servidor no responde al guardar: avisa, deja el formulario como estaba y se puede reintentar".

### 6. Con la app abierta desde el día anterior, la fecha propuesta seguía siendo la de ayer — alta
- **Qué pasaba:** la fecha se ponía una sola vez, al abrir. Si la app instalada quedaba abierta desde el lunes a la noche, el martes seguía mostrando lunes: el cierre del martes se guardaba como lunes y pisaba el del lunes.
- **Qué se cambió:** al volver a la app, si cambió el día y no hay una carga a medio hacer, la fecha pasa a hoy y se refresca la cotización. No se toca una fecha elegida a mano en el mismo día, ni una carga empezada (aunque pase la medianoche).
- **Prueba:** "la app quedó abierta desde ayer: al volver propone la fecha de hoy y no toca el cierre de ayer".

### 7. Reportes: "Esta semana" y "Semana anterior" corridos un día después de las 21 hs — media
- **Qué pasaba:** los rangos se armaban en UTC. El martes 10/11 a las 22:30, "Esta semana" empezaba el martes: mostraba "Sin datos para el período" y dejaba afuera el lunes ($1.746.900). "Semana anterior" iba de martes 3 a lunes 9 ($14.064.400) en vez de lunes 2 a domingo 8 ($14.312.500). "Este mes" decía "01/11 — 11/11".
- **Qué se cambió:** los rangos se calculan con días de Buenos Aires (`SersaleBase.hoy`, `sumarDias`, `diaSemana`). La Comparativa también toma el mes en curso de ahí.
- **Prueba:** "a las 22:30 del martes, 'Esta semana' arranca el lunes y 'Semana anterior' va de lunes a domingo".

### 8. "Días" y "promedio por día" contaban registros, no días — media
- **Qué pasaba:** cada día tiene un registro por sucursal. Con las dos sucursales, del 1 al 9/11 decía "18 días" y "prom $948.022/día" (el real es $1.896.044). La Comparativa mostraba octubre con "62d". El reporte impreso, igual.
- **Qué se cambió:** se cuentan fechas distintas en Historial, Reportes, reporte impreso y Comparativa. Ahora: "9 días", "prom $1.896.044/día", octubre "31d". Coincide con el criterio que ya usa el Panel.
- **Prueba:** "los días se cuentan una vez aunque haya dos sucursales, y el reporte impreso cierra con sus filas".

### 9. Sin conexión, Historial, Reportes y Comparativa decían "Sin registros para este período" — media
- **Qué pasaba:** sin señal la consulta devuelve una lista vacía en vez de fallar, y la pantalla la mostraba como si no hubiera datos.
- **Qué se cambió:** si la respuesta no vino del servidor se muestra "Sin conexión. No se pudieron cargar los datos." con un botón "Reintentar". El botón también aparece cuando la carga da error.
- **Prueba:** la primera del punto 5.

### 10. Al cambiar de filtro rápido quedaba en pantalla la respuesta del filtro anterior — media
- **Qué pasaba:** en el iPhone, la rueda del mes dispara una consulta por cada paso. Si la de octubre llegaba después que la de septiembre, quedaba octubre en pantalla con el filtro en septiembre. En Reportes, además, "Exportar / Imprimir PDF" imprimía el período viejo.
- **Qué se cambió:** cada carga lleva un número y las respuestas viejas se descartan (Historial, Reportes y Comparativa).
- **Prueba:** "al cambiar de filtro rápido no queda en pantalla la respuesta del filtro anterior".

### 11. Editar un registro — media
- **Qué pasaba:**
  - Leía el registro y después lo escribía, sin transacción: si otro teléfono lo cambiaba en el medio, los totales podían quedar sin cerrar.
  - Con dos ingresos extra con centavos (1.000,10 + 2.000,20) la suma interna da 3000,3000000000002. Al guardar cualquier cambio, aunque no se tocara Extra-Z, el sistema creía que el importe era otro y fundía los dos ingresos en uno solo ("Picada para evento + Venta a vecino"). La ventana además mostraba "3.000,3000000000002".
  - Un registro sin la lista de gastos (solo el total) quedaba con gastos $0 y el neto inflado. No sé si hay registros así en la base real; queda cubierto por las dudas.
  - Si se tocaba "Cancelar" mientras guardaba, la edición se cortaba con error (visto en el código; no lo reproduje).
- **Qué se cambió:** la edición va en una transacción y recalcula los totales con los gastos y extras que tenga el registro en ese momento; los importes se comparan y se guardan redondeados a centavos; si no hay lista de gastos se conserva el total que estaba; se usa el id real del registro.
- **Prueba:** "editar un registro: no desarma los extras con centavos, redondea los totales y respeta registros viejos".

### 12. Totales con centavos guardados con decimales de más — baja
- **Qué pasaba:** los totales se sumaban sin redondear: extras de 1.000,10 y 2.000,20 guardaban `extraZ: 3000.3000000000002`.
- **Qué se cambió:** `extraZ`, `totalGasto`, `totalVentas`, `totalNeto` y `totalCobros` se redondean con `SersaleBase.redondear` antes de guardar (carga y edición).
- **Prueba:** la del punto 3 (compara el registro completo) y la del punto 11.

### 13. Reporte para imprimir — media
- **Qué pasaba:** en "Formas de Cobro" faltaba la fila "Cheque / Otro": Efectivo + Tarjeta + Transferencia sumaban $16.927.900 y el Total decía $17.064.400 (faltaban $136.500). Decía "18 días" y la sucursal como "PP". Si el teléfono no dejaba abrir la ventana, el botón no hacía nada.
- **Qué se cambió:** se agregó la fila; días reales; nombre de la sucursal; si la ventana no abre, avisa. La fecha de "Reporte generado" es la de Buenos Aires.
- **Prueba:** la del punto 8.

### 14. Cotización del dólar: el segundo cierre del día se guardaba sin cotización — media
- **Qué pasaba:** la cotización solo se traía tocando "Actualizar" o volviendo a la pestaña Carga, no al abrir la página. Y después de guardar se borraba: el cierre de la otra sucursal, cargado a continuación, quedaba con dólar 0.
- **Qué se cambió:** se trae sola al abrir y al volver a la app, y se conserva después de guardar. La actualización automática no pisa un valor escrito a mano (el botón "Actualizar" sí). Si el servicio responde mal ya no muestra "$NaN" ni "Invalid Date", y si no contesta se corta a los 10 segundos (antes el botón quedaba en "Cargando...").
- **Prueba:** la del punto 3 (los dos cierres quedan con 1.420 / 1.490).

### 15. Ventana "Editar registro" en un iPhone chico — baja
- **Qué pasaba:** en una pantalla de 375×667 el título y la línea "fecha · sucursal" quedaban debajo del encabezado, y el botón Guardar medio tapado por la barra inferior.
- **Qué se cambió:** la ventana se dibuja por encima del encabezado y de la barra.
- **Prueba:** la del punto 11 (corre en 375×667).

### 16. Menores, en el código tocado
- Importes negativos: "-$1.200" en vez de "$-1.200" (`SersaleBase.fmtMonto`).
- En el resumen de Carga, al borrar una de las dos cotizaciones quedaba el valor en dólares anterior; ahora muestra "—".
- Reportes → "Personalizado" sin las dos fechas dejaba en pantalla el reporte anterior; ahora pide las fechas.
- Detalle de gastos: un gasto sin importe en un registro viejo ya no rompe la suma.
- "1 día" en singular.

## Descartado

- **Escribir "1234.56" con punto da $123.456:** el campo da formato mientras se escribe y el punto se ve como separador de miles; el teclado del iPhone en Argentina trae coma.
- **Importes negativos en gastos o cobros:** el teclado numérico del iPhone no tiene signo menos; no hay forma de llegar ahí cargando normalmente.
- **Texto de gastos, extras y observaciones metido en la página o en el reporte:** ya pasaba por `esc()` en todos los lugares; revisado uno por uno.
- **Ventana del reporte bloqueada por abrirse después de una espera:** se abre en el mismo toque, sin espera antes.
- **Doble toque mientras guarda:** el botón ya se bloqueaba antes de la primera espera. El problema real era el toque posterior (punto 1).
- **Zoom del iPhone al enfocar campos de 14 px:** la página fija la escala, no hace zoom. Agrandar la letra es rediseño.
- **Último día del mes en el Historial y rango de "Mes anterior":** están bien calculados (verificado también a las 22:30).
- **Tope `-31` en la Comparativa:** es comparación de texto, funciona para cualquier mes.
- **Fechas mezcladas (texto y Timestamp):** `fecha` siempre es texto "AAAA-MM-DD"; `ts` no se usa para filtrar ni ordenar.
- **En Editar, dejar vacía una cotización no la borra:** vacío significa "no cambiar"; para borrarla se escribe 0.

## Pendiente

- **Imprimir desde la app instalada en el iPhone:** el reporte se abre en una ventana nueva. No pude comprobar en un teléfono real si la app instalada la deja abrir; ahora, si no abre, avisa. La alternativa es descargar un PDF como hace el Panel (hay que sumar jsPDF a esta página).
- **Editar muestra los valores de cuando se cargó la lista:** si otro teléfono cambió el Total Z o los cobros en el medio, vale lo último que se guarda. Los totales igual quedan cerrados.
- **Editar no permite corregir gastos, descripciones, fecha ni sucursal, y no se puede eliminar un registro.** Ver "Para decidir".
- **Detalle de gastos agrupa por descripción exacta:** "Flete" y "flete" salen en dos líneas.
- **El gesto "atrás" del teléfono no cierra la ventana de edición:** sale de la página (se puede resolver con `SersaleBase.abrirAtras`).
- **Selector de mes en computadora:** en Safari y Firefox de escritorio es un campo de texto libre.
- **Comparativa:** el mes en curso, incompleto, entra en "Menor mes" y en la variación. Ver "Para decidir".
- **Porcentajes con punto** ("0.7% del total"): cosmético.
- **Letra de 13–14 px en campos y filtros, tabla del Historial apretada:** rediseño.

## Pendiente en otros archivos

1. **`src/js/fb-compat.js`** — Ventas (y Backup) usan Firestore sin copia en el teléfono: sin señal no se puede ver ni guardar nada. Si se quiere que Ventas funcione sin señal como Pedidos, hay que activar ahí la copia local (`enablePersistence`) o pasar `ventas.html` a `js/fb.js`. Si se hace, revisar en `ventas.html` el aviso de "Sin conexión" al guardar y `sinServidor()`, que hoy dan por hecho que no hay copia.
2. **`src/js/shell.js`** — la franja "Sin conexión · se muestran los datos guardados" aparece también en Ventas, donde no hay datos guardados. Propuesta: que en las páginas sin copia local diga solo "Sin conexión".
3. **`docs/auditoria/_pendientes-entre-archivos.md`** — la fila de `src/ventas.html` (fecha propuesta en UTC) ya está resuelta: borrarla.

## Para decidir con el dueño

1. **Registros ya cargados.** Hasta hoy, los cierres cargados después de las 21 hs quedaban con fecha del día siguiente, y un cierre podía pisar a otro sin avisar. ¿Revisamos el Historial de los últimos meses buscando días faltantes, sucursales con importes repetidos o registros en cero? No toqué ningún dato.
2. **Corregir y eliminar.** Hoy los gastos de un día solo se corrigen cargando todo el día de nuevo y aceptando "Reemplazar", y un registro cargado con fecha o sucursal equivocada no se puede borrar. ¿Se agrega editar gastos y eliminar registro?
3. **Fecha futura.** Se puede guardar un cierre con fecha de mañana o de otro año. ¿Se bloquea, o se pregunta antes de guardar?
4. **Cobros contra ventas.** El sistema no avisa si Efectivo + Tarjeta + Transferencia + Otro no coincide con Total Z + Extra-Z. ¿Se muestra la diferencia, o se avisa al guardar?
5. **Promedio por día con las dos sucursales.** Ahora es el total dividido por los días (las dos sucursales sumadas). ¿Es eso, o se quiere el promedio por sucursal?
6. **Comparativa y mes en curso.** El día 10 se comparan 10 días contra el mes anterior entero ("▼73%") y el mes en curso sale como "Menor mes". ¿Se compara contra los mismos días del mes anterior, o se deja afuera el mes en curso? Es la misma pregunta que quedó abierta en el Panel.
7. **Cotización al cargar un día atrasado.** Se guarda la cotización del momento de la carga, no la del día del cierre. ¿Está bien así?
8. **Día sin ventas.** Un registro totalmente vacío ya no se puede guardar (sí con una observación, por ejemplo "Feriado"). ¿Hace falta registrar los días cerrados?
9. **Reporte en PDF.** ¿Lo usan desde la app instalada en el iPhone? Si ahí no abre, conviene pasarlo a descarga de PDF.

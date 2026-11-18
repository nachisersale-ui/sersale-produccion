# Panel (dashboard.html): arreglos

Archivo tocado: `src/dashboard.html`. Pruebas: `tests/arreglos-dashboard.test.mjs` (13 pruebas, pasan tres veces seguidas junto con `smoke.test.mjs`; la tanda completa de 40 también pasa).

El panel solo lee datos: no guarda nada en la base (hay una prueba que lo controla), así que ningún arreglo cambia documentos ni formatos guardados.

Cada prueba se corrió también contra la versión anterior del archivo para confirmar que fallaba por el defecto que dice cubrir.

## Arreglado

### 1. El reporte en PDF no se generaba nunca — alta
- **Qué pasaba:** Reporte → PDF no descargaba nada y no avisaba. La primera línea que dibuja el encabezado (`pdf.rect(0,0,PW,70,1,'F')`) tenía un argumento de más y la librería cortaba con un error.
- **Qué se cambió:** se corrigió la llamada. La generación (PDF y Excel) ahora avisa "Reporte generado" o "No se pudo generar el reporte. Probá de nuevo." Los títulos de sección y el pie quedaron con la misma letra en todas las páginas, y "Generado" usa la fecha de Buenos Aires.
- **Prueba:** "el PDF del reporte se genera y trae los gastos y el neto de cada día".

### 2. La variación "vs mes ant." salía disparatada — alta
- **Qué pasaba:** los pedidos comunes se guardan sin precio; el precio sale del remito. El panel solo buscaba los remitos del mes elegido, así que el mes anterior quedaba casi en $0 (solo las ventas rápidas). Con los datos de ejemplo: noviembre $2.115.366 contra octubre $7.849.760 mostraba "▲ 2130.7% vs mes ant." (tomaba octubre como $94.830). Lo mismo en "Facturación total combinada" y en la línea "Variación vs mes anterior" del reporte.
- **Qué se cambió:** los precios del remito se aplican a los dos meses. Ahora muestra "▼ 73.1%".
- **Prueba:** "la variación contra el mes anterior cuenta los remitos de ese mes, y los días de venta son días".

### 3. Pedido con remito fechado en otro mes: figuraba en $0 y se contaba en el mes equivocado — alta
- **Qué pasaba:** el remito lleva la fecha del día en que se hizo (y en UTC: después de las 21 hs ya es "mañana"); el pedido se cuenta por fecha de entrega. Ejemplos: pedido preparado el viernes 30/10 para entregar el lunes 2/11 por $3.000.000 → noviembre lo mostraba en $0 y octubre se lo acreditaba al cliente en "Top clientes". Entrega del 31/10 con remito guardado a las 22:30 (queda con fecha 1/11) → octubre en $0 y noviembre lo sumaba como venta propia.
- **Qué se cambió:** el remito se busca por pedido, no por mes: se traen los remitos con 45 días de margen y, si a un pedido sin precio igual no le aparece, se lo busca por su número de pedido. El pedido se factura una sola vez, en el mes de su entrega. Si un pedido tiene más de un remito vale el último guardado (antes era al azar).
- **Prueba:** "remito fechado en otro mes: el pedido se factura en el mes de su entrega, una sola vez" (corre a las 22:30; incluye un remito hecho 77 días después de la entrega).

### 4. En el reporte, "Gastos" siempre $0 y "Neto" igual a "Ventas" — alta
- **Qué pasaba:** el reporte leía `gastos`, que es la lista del detalle, como si fuera un número. Noviembre de ejemplo: ventas $17.064.400, gastos $375.600; el reporte decía gastos $0 y neto $17.064.400.
- **Qué se cambió:** se usa `totalGasto` (y si un registro viejo no lo tiene, se suma la lista). Ahora: gastos $375.600, neto $16.688.800.
- **Prueba:** la del PDF (punto 1) y "el Excel (CSV) trae gastos y neto reales, y un nombre con ; o = no rompe las columnas".

### 5. El remito de un pedido cancelado contaba como venta en "Top clientes" — media
- **Qué pasaba:** pedido con remito de $3.000.000 que después se cancela: la facturación del mes no lo contaba, pero "Top clientes" (pantalla, PDF y Excel) le acreditaba los $3.000.000 al cliente.
- **Qué se cambió:** un remito solo cuenta como venta aparte si no tiene pedido (o su pedido ya no existe). Los de pedidos cancelados no cuentan.
- **Prueba:** "el remito de un pedido cancelado no es una venta; el remito sin pedido sí".

### 6. Al cambiar de mes rápido quedaba en pantalla (y en el reporte) otro mes — media
- **Qué pasaba:** si se elegía octubre y enseguida noviembre, y la respuesta de octubre llegaba última, la pantalla mostraba octubre bajo el título "Noviembre 2026". El reporte tomaba el título del selector y los números de lo último que hubiera cargado; tocando Reporte durante la carga salía todo en cero o con el mes anterior.
- **Qué se cambió:** cada carga lleva un número y las respuestas viejas se descartan. Mientras carga no hay reporte (avisa "Los datos todavía no están cargados"). El título del reporte sale del mes de los datos cargados. Mientras carga, los seis indicadores muestran "..." y el botón ↻ queda bloqueado.
- **Prueba:** "al cambiar de mes rápido no queda en pantalla (ni en el reporte) el mes anterior".

### 7. Ranking de rentabilidad: margen y cobertura mal calculados — media
- **Qué pasaba:** el margen dividía la ganancia de los productos con costo por toda la facturación, incluida la de productos sin costo cargado. Cliente con $120.000 de Jamón Sublime (ganancia $59.429) y $60.000 de carré sin costo: mostraba 33,0 % en vez de 49,5 %. Además los ítems todavía sin precio (pedidos pendientes) bajaban la cobertura (33 % en vez de 50 %).
- **Qué se cambió:** margen = ganancia ÷ facturación de los ítems con costo. Los ítems sin facturar no entran en la cobertura. Se agregó la aclaración al pie de la tabla.
- **Prueba:** "rentabilidad: el margen se calcula sobre los ítems con costo y lo pendiente no baja la cobertura".

### 8. Nombres con < > & se cortaban (y podían ejecutar código) — media
- **Qué pasaba:** "Fiambrería <La Esquina> & Cía" se veía como "Fiambrería & Cía". Un nombre de cliente o producto con una etiqueta HTML se ejecutaba en el teléfono del director.
- **Qué se cambió:** todos los nombres pasan por `SersaleBase.esc()` (clientes, cuentas, productos, unidad).
- **Prueba:** "nombres con < > & se muestran completos y no se ejecutan".

### 9. En el iPhone la página era más ancha que la pantalla y "Reporte" quedaba cortado — media
- **Qué pasaba:** a 390 px la página medía 527 px: se movía de costado, el botón Reporte quedaba mitad afuera y el encabezado ocupaba 153 px.
- **Qué se cambió:** en teléfono el encabezado va en dos renglones (título; debajo mes, ↻ y Reporte, de 44 px de alto y letra de 16 px para que iOS no haga zoom). La tabla ancha del ranking se desliza dentro de su tarjeta. El botón de cerrar del reporte pasó a 44 px.
- **Prueba:** "en el iPhone la página no se ensancha y Reporte queda a la vista".

### 10. "Días registrados" contaba registros, no días — media
- **Qué pasaba:** hay un registro por día y por sucursal: con 9 días cargados decía "18 días registrados" (también en el reporte).
- **Qué se cambió:** se cuentan las fechas distintas.
- **Prueba:** la del punto 2.

### 11. Descarga del Excel en iPhone — media (preventivo, no se pudo reproducir acá)
- **Qué pasaba:** la dirección temporal del archivo se liberaba en el mismo instante del toque; Safari lee el archivo después y puede fallar la descarga.
- **Qué se cambió:** se libera un minuto después. Probarlo en un iPhone real.
- **Prueba:** no hay (el navegador de pruebas no tiene ese comportamiento); las pruebas del CSV confirman que la descarga sigue funcionando.

### 12. Errores de carga casi invisibles — baja
- **Qué pasaba:** si fallaba la carga aparecía "Error" con un texto en inglés en una sola tarjeta y el resto seguía mostrando el mes anterior. Si fallaba un gráfico, todas las tablas de abajo quedaban girando.
- **Qué se cambió:** aviso rojo "No se pudieron cargar los datos. Revisá la conexión y tocá ↻." y todas las tarjetas pasan a "No se pudo cargar". Cada tarjeta se arma por separado: si una falla, las demás se muestran y se avisa. En los dos casos no se puede sacar un reporte incompleto.
- **Pruebas:** "si la carga falla se avisa y no queda en pantalla nada del mes anterior" y "si una tarjeta falla, las demás se muestran, se avisa y no se puede sacar un reporte incompleto".

### 13. La facturación de un cliente difería entre tarjetas — baja
- **Qué pasaba:** con kilos reales en 0, el indicador y "Top clientes" usaban la cantidad pedida y el ranking de rentabilidad usaba 0.
- **Qué se cambió:** una sola cuenta para todas las tarjetas (kilos pesados, o cantidad pedida si no se pesó), igual que el remito.
- **Prueba:** no hay una específica para kilos en 0; las de los puntos 2 y 7 pasan por la cuenta nueva.

### 14. Excel: nombres con ";" corrían las columnas, y un nombre que empieza con "=" quedaba como fórmula — baja
- **Qué se cambió:** los textos van entre comillas cuando hace falta y lo que empieza con = + - @ lleva un apóstrofo adelante.
- **Prueba:** la del CSV (punto 4).

### 15. "Total registrados" contaba clientes fusionados — baja
- **Qué se cambió:** no se cuentan los clientes marcados como fusionados por la migración (`activo:false` / `mergedInto`).
- **Prueba:** no hay.

### 16. Montos abreviados — baja
- **Qué pasaba:** $999.600 se mostraba "$1000K"; "$6.3M" usaba punto decimal al lado de "$840.000"; los negativos del reporte salían "$-12.346".
- **Qué se cambió:** "$1,0M", "$6,3M", "-$12.346" (`SersaleBase.fmtMonto`).
- **Prueba:** los importes de las pruebas de "Top clientes" ("$3,0M", "$2,4M").

### Mejoras chicas en el código tocado
- La lista de cuentas corrientes muestra 12; ahora dice cuántas quedan afuera y cuánto suman ("y 3 cuentas más $60.000"). Prueba: "la lista de cuentas corrientes avisa cuántas quedan fuera de las 12 que muestra".
- El selector de meses y la fecha del reporte usan el día de Buenos Aires. Prueba: "el último día del mes a las 22:30 el panel sigue en ese mes".
- La tarjeta del ranking ya no queda pegada a la de abajo.

## Descartado

- **Acceso sin rol por `sersale_auth`** (seguridad 2): todos los ingresos ya guardan el rol; sacar esa línea no agrega protección mientras el control sea solo del navegador.
- **Librerías de terceros sin control de integridad** (seguridad 5): ya no se cargan de internet, se sirven desde `vendor/`.
- **Todo se vuelve a leer en cada carga** (rendimiento 1) y **sin copia local** (rendimiento 3): `js/fb.js` ya responde desde la copia guardada en el teléfono.
- **Recargas entre secciones y volver a ingresar** (uso 10): ya resuelto por `js/sesion.js` y la app instalada.

## Pendiente

- **Planilla de costos con valores raros** (candidato 5, alta): no se tocó; es dato del negocio. Ver "Para decidir".
- **Mes en curso contra mes anterior completo** (candidato 7): es una definición, no un error de cuenta. Ver "Para decidir".
- **Productos más pedidos: piezas sin pesar sumadas como kilos** (candidato 14): 10 piezas sin pesar suman 10 kg. Corregirlo sacaría del ranking a los productos que se venden por unidad. Ver "Para decidir".
- **Saldo de cuentas corrientes de hoy bajo cualquier mes** (candidato 18): ver "Para decidir".
- **Excel con `sep=;` y acentos** (candidato 17): se dice que Excel de Windows puede mostrar mal los acentos con esa primera línea. No se pudo verificar; sacarla puede romper las columnas en una PC configurada en inglés.
- **Ranking de rentabilidad en el teléfono:** para ver "Margen" y "Cobertura" hay que deslizar la tabla de costado. Mostrarlo en filas apiladas es un rediseño.
- **Porcentajes con punto** ("73.1%") en pantalla y reporte: cosmético.
- **Clientes agrupados por nombre exacto:** "Don Pepe" y "don pepe " salen como dos clientes. No se vio en los datos de ejemplo.
- **Tablas que quedan con el mes anterior mientras carga el nuevo:** los indicadores muestran "..." pero las tablas cambian recién cuando llegan los datos.
- **Reporte:** compartir por la hoja de iOS (WhatsApp/Mail) en vez de descargar; fechas dd/mm y nombre de sucursal en vez de "PP"/"CAB"; números alineados a la derecha; cerrar tocando afuera; recordar las secciones elegidas.
- **Uso en teléfono (rediseño):** seis indicadores en una columna ocupan más de una pantalla; cajas con desplazamiento propio dentro de la página; filas que no llevan a la cuenta del cliente; solo 6 meses y sin flechas; ayudas "ℹ" que solo se ven con mouse.
- **Rendimiento (bajo):** jsPDF se carga siempre aunque no se use; todo se recalcula en cada carga; un operario redirigido alcanza a iniciar las consultas antes de salir de la página.

## Pendiente en otros archivos

1. **`src/pedidos/03-pedidos-comercial-remito.jsx` línea 420** — el remito se guarda con `fecha: new Date().toISOString().split("T")[0]` (día en UTC): después de las 21 hs queda con fecha de mañana. Cambiar por `SersaleBase.hoy()`. El panel ya no depende de esa fecha para valorizar pedidos, pero sí para ubicar en un mes los remitos sin pedido.
2. **`src/pedidos/05-venta-rapida-precios.jsx` línea 44** — `const hoy = new Date().toISOString().split("T")[0]` se usa como `fechaEntrega` de la venta rápida: una venta del último día del mes después de las 21 hs cae en el mes siguiente del panel. Cambiar por `SersaleBase.hoy()`.
3. **`src/ventas.html` línea 339** — la fecha propuesta para el registro diario se arma en UTC: cargando después de las 21 hs propone el día siguiente y, si se guarda así, la venta queda en otro día (a fin de mes, en otro mes del panel). Cambiar por `SersaleBase.hoy()`.
4. **`src/js/fb.js`, `copiaAlDia()`** — sin conexión y sin copia previa en el teléfono, `getDocs` devuelve una lista vacía en vez de fallar: el panel muestra todo en $0 como si fuera cierto (solo avisa la franja de "sin conexión"). Propuesta: si no hay conexión y la colección nunca se sincronizó, rechazar la lectura para que la pantalla pueda decir "No se pudo cargar".
5. **Seguridad (reglas de Firestore, ingreso en `index.html`, `js/fb.js`)** — el control de acceso es solo del navegador (`sessionStorage`); sin Firebase Auth y reglas, cualquiera con la dirección puede leer pedidos, saldos y ventas. Los costos y márgenes además viajan dentro de `dashboard.html`, que es un archivo público. Las reglas no están en el repositorio.

## Para decidir con el dueño

1. **Costos de la planilla.** En el código figuran: Panceta Ahumada $30,88 y Pechito Ahumado $30,88 el kilo; Lomo Ahumado $28.638 (se vende a $14.990); Mortadela Bocha $10.362 (se vende a $5.890); Salchichón Primavera $5.499 (se vende a $4.900). Con eso el panel muestra 99,8 % de margen en panceta y pérdida en lomo ahumado y bocha. ¿Cuáles son los costos correctos?
2. **Dónde vive la planilla.** Costos y precios de lista de "Margen por producto" están fijos dentro del programa: cambiar uno requiere tocar el código, y quedan a la vista de cualquiera. ¿Se quiere poder editarlos desde el sistema?
3. **Comparación con el mes anterior.** El día 10 se comparan 10 días contra el mes anterior entero, así que casi todo el mes se ve en rojo ("▼ 73%"). ¿Comparar contra los mismos días del mes anterior, o dejarlo como avance sobre el total?
4. **Qué fecha manda para la facturación del mes:** hoy es la fecha de entrega del pedido (se mantuvo). ¿O debería ser la fecha del remito?
5. **Remitos sin pedido:** suman en "Top clientes" pero no en "Facturación del mes". ¿Deben sumar en la facturación?
6. **Productos por pieza o unidad sin pesar:** ¿se muestran solo en unidades, o se quiere un ranking aparte para lo que no se vende por kilo?
7. **Saldo de cuentas corrientes en meses anteriores:** siempre es el saldo de hoy, también en el reporte de un mes pasado. ¿Aclararlo como "saldo al día de hoy" o sacarlo de esos reportes?
8. **Botón "Excel":** genera un archivo .csv que Excel abre. ¿Alcanza, o se quiere un .xlsx y poder compartirlo por WhatsApp desde el teléfono?

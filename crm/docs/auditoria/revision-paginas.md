# Revisión independiente: Ventas diarias, Panel y Presupuestos

Archivos revisados: `src/ventas.html`, `src/dashboard.html`, `src/presupuestos.html`, contra la versión que está publicada hoy (`1266a92`).
Pruebas nuevas: `tests/revision-paginas.test.mjs` (5 pruebas que pasan + 1 marcada como pendiente, ver "Para corregir en otros archivos").

Cómo se revisó: se leyó cada cambio y el código alrededor, se armaron los casos en la página real (iPhone simulado + base de prueba) y, para el Panel, se recalcularon aparte todos los números de noviembre, octubre y septiembre de la base de ejemplo (facturación con precios de remito, variación, pedidos por día, semanas del gráfico, top de clientes, cuentas corrientes, ranking de productos, rentabilidad, PDF y CSV). Con la base de ejemplo tal como viene, todo coincide; esa comparación quedó como prueba fija ("panel: indicadores, gráficos, top de clientes, cuentas y productos coinciden con la cuenta hecha a mano"). Los defectos aparecieron al cruzar estas páginas con lo que cambiaron los otros arreglos (remitos) y al cortar la señal a mitad de un guardado.

En Presupuestos no encontré defectos: probé precios escritos con punto de miles y con coma, ajuste general, por categoría y por producto mezclados, cambio de modo, artículos varios con centavos, y que el PDF y el CSV digan lo mismo. En Ventas, además del punto 2, probé importes con puntos y comas, registros viejos (sin lista de gastos, sin extras, sin dólar, con el importe de un gasto guardado como texto), edición, reportes por rango y el reporte para imprimir: no encontré nada más para corregir.

Cada prueba nueva se corrió primero contra el código sin corregir para confirmar que fallaba por el defecto.

## Defectos encontrados y corregidos

### 1. Panel: un producto pesado en 0 kg ("no había") se seguía contando como vendido — alta
- **Qué pasaba:** el arreglo de remitos cambió la regla: si el depósito carga 0 kg, ese ítem no se cobra. El Panel se había arreglado antes y quedó con la regla vieja (0 kg = "tomá la cantidad pedida"). Ejemplo con la base de prueba: pedido de la Distribuidora Mayorista del Sur del 10/11 con 40 kg de Jamón Cocido Natural Sublime que no había (0 kg). Se hace el remito desde Comercial: total $1.263.957,50, y a la cuenta corriente se le cargan $1.263.958. El Panel mostraba a ese cliente con $1.667.557,50: $403.600 de más (40 kg × $10.090), y lo mismo de más en "Facturación del mes", en la variación contra el mes anterior, en el gráfico semanal, en el ranking de rentabilidad y en el PDF/Excel.
- **Qué se cambió:** `cantFact` en `dashboard.html` usa la misma regla que el remito: si el ítem se pesó valen los kilos pesados, aunque sean 0. Los remitos hechos con la versión anterior (que en ese caso sí cobraban la cantidad pedida, y así quedó cargado en las cuentas) se siguen contando por lo que cobraron.
- **Prueba:** "panel: un ítem pesado en 0 kg (no había) no se factura; el Panel dice lo mismo que el remito y la cuenta corriente". Hace el remito en la pantalla real de Pedidos y después abre el Panel.

### 2. Ventas: con mala señal, después de guardar preguntaba si "reemplazar" lo que se acababa de cargar — media
- **Qué pasaba:** ahora el guardado mira primero si ya hay un registro de ese día. Si el servidor guarda pero la confirmación no llega al teléfono (señal que va y viene), el sistema reintenta solo, encuentra el registro que él mismo acaba de guardar y pregunta: "Ya hay un registro de ese día — 10/11/2026 · Parque Patricios ya tiene cargado Total Z $1.250.000… Si seguís, se reemplaza por lo que cargaste ahora (Total Z $1.250.000)". Nunca aparecía "Registro guardado" y el formulario quedaba lleno: si se tocaba "Cancelar" (lo lógico ante esa pregunta) no había forma de saber que el cierre ya estaba guardado. No se perdía ningún dato.
- **Qué se cambió:** si lo que está guardado es exactamente lo que se quiere guardar, no pregunta: avisa "Registro guardado" y limpia el formulario, como siempre. Si lo guardado es distinto, sigue preguntando igual que antes.
- **Prueba:** "ventas: con mala señal, si el servidor guardó pero la confirmación no llegó, avisa que quedó guardado…" (deja pasar el guardado al servidor y corta la respuesta).

### 3. Panel: con remitos repetidos de antes, tomaba el remito viejo aunque se hubiera corregido el otro — baja
- **Qué pasaba:** la versión anterior, si se guardaba dos veces un remito, dejaba dos remitos del mismo pedido. El Panel elige "el último guardado" mirando solo la fecha de creación. Pero ahora corregir un remito no crea otro: corrige el primero y le anota la fecha de corrección. Ejemplo: pedido de 10 kg con dos remitos a $10.000; el 9/11 se corrige el precio a $12.000. El remito y la cuenta dicen $120.000 y el Panel seguía mostrando $100.000.
- **Qué se cambió:** "el último guardado" mira la fecha de corrección si la hay, y si no la de creación.
- **Prueba:** "panel: si un pedido tiene remitos repetidos de la versión anterior y uno se corrigió, vale el corregido".

### 4. Panel: en el PDF, un nombre de cliente largo tapaba los importes de su fila — baja
- **Qué pasaba:** el PDF del Panel no se generaba nunca; ahora sí, y es la primera vez que se va a ver. En el ranking de rentabilidad la columna "Cliente" mide 180 pt y el nombre se escribía entero: "Cooperativa de Trabajo Gastronómica La Nueva Esperanza de Villa Soldati Limitada" ocupa 334 pt y quedaba impreso encima de su facturación ($151.098) y su ganancia. Lo mismo en "Top clientes" con nombres de más de unos 55 caracteres.
- **Qué se cambió:** un texto que no entra en su columna se recorta con "..." (como ya hace el PDF de Presupuestos). Los importes no se tocan. En el Excel el nombre sigue saliendo entero.
- **Prueba:** "panel: en el PDF un nombre de cliente largo no tapa los importes de su fila".

No hubo que cambiar ninguna prueba existente: las 34 de estas tres páginas siguen pasando. No cambia ningún formato guardado (el Panel y Presupuestos no escriben; en Ventas se guarda lo mismo que antes).

## Riesgos que no pude probar

Todo esto depende de un iPhone real o de la base real. Cómo comprobarlo a mano:

1. **"Sin conexión. No se guardó" con señal.** Ventas (y otras pantallas) no intentan guardar si el teléfono dice que no tiene conexión. Si el iPhone se queda "creyendo" que no hay señal después de recuperarla, no dejaría guardar. Prueba: con la app instalada, abrir Ventas, cargar un cierre de prueba en una fecha vieja, poner modo avión, tocar Guardar (tiene que avisar "Sin conexión"), sacar el modo avión, esperar 5 segundos y tocar Guardar: tiene que guardar. Repetir bloqueando el teléfono un minuto en el medio. Si sigue diciendo "Sin conexión", avisar: hay que sacar ese control y dejar que falle el guardado mismo.
2. **Mala señal de verdad al guardar el cierre.** Con una sola rayita (cámara de frío, fondo del local), tocar Guardar: el botón puede quedar en "Guardando..." hasta cerca de un minuto antes de avisar. Verificar que termina en "Registro guardado" o en "No se pudo guardar", y que en Historial el día figura una sola vez y con los importes correctos.
3. **Tiempo de carga del Panel con la base real.** El Panel ahora baja colecciones enteras (todos los pedidos, remitos y cierres de caja de años) para guardarlas en el teléfono, y espera hasta 6 segundos antes de consultar solo el mes. Con la base de ejemplo no se nota. Medir en un iPhone con datos móviles cuánto tarda la primera vez y las siguientes; mirar el consumo de lecturas en la consola de Firebase la primera semana. (Es de `src/js/fb.js`.)
4. **Imprimir el reporte de Ventas desde la app instalada.** Se abre en una ventana nueva; no se pudo comprobar si el iPhone la deja abrir desde la app instalada. Prueba: Ventas → Reportes → "Exportar / Imprimir PDF". Si aparece "No se pudo abrir la ventana del reporte", desde la app instalada no se puede imprimir (sí desde Safari) y conviene pasarlo a descarga de PDF.
5. **Descargas en el iPhone.** PDF y Excel del Panel, PDF y CSV de Presupuestos: verificar en la app instalada que el archivo se puede ver, guardar y compartir por WhatsApp.
6. **Teclado numérico.** Los campos de importes esperan coma para los centavos; el punto se toma como separador de miles ("1250000.50" queda $125.000.050 en Ventas; "8990.50" queda $899.050 en Presupuestos; se ve en pantalla mientras se escribe). Verificar que en los teléfonos del negocio el teclado numérico muestra coma (Ajustes → General → Idioma y región → Región: Argentina).
7. **La pregunta de "reemplazar" con dos teléfonos reales** cargando el mismo cierre a la vez (en las pruebas funciona con dos pestañas).

## Para corregir en otros archivos

1. **`src/js/shell.js` — al publicar una versión nueva se puede perder un cierre o un presupuesto a medio cargar (alta).** Cuando hay una versión nueva, la app se recarga sola al salir de ella, salvo que el cursor esté en un campo o haya una ventana abierta (`escribiendo()`, líneas 350-369). Un formulario con cosas escritas pero sin el cursor en un campo no cuenta. Reproducido: en Ventas se carga Total Z $1.250.000, efectivo y observaciones; se publica una versión; el director cierra el teclado y sale un momento a mirar el ticket o la calculadora; al volver, el formulario está vacío. Pasa igual con un presupuesto armado en Presupuestos y con cualquier formulario del sistema. Propuesta: no recargar sola si en la página hay algún campo con algo escrito (o que cada página pueda avisar "tengo cambios sin guardar"); el cartel "Hay una versión nueva — Actualizar" ya queda a la vista. La prueba "ventas: si se publica una versión nueva con un cierre a medio cargar, salir un momento de la app no borra lo escrito" está en `tests/revision-paginas.test.mjs` marcada `todo`: hoy falla (no rompe la tanda); cuando se corrija `shell.js` tiene que pasar y se le saca la marca.
2. **`src/pedidos/03-pedidos-comercial-remito.jsx`, `remitoDePedido` — visto en el código, sin prueba.** Si un pedido tiene remitos repetidos de la versión anterior, la pantalla de remito toma el de número más bajo (el primero) y muestra sus precios como "emitido". Si el segundo era la corrección, se ven los precios viejos. El Panel toma el último guardado. Conviene la misma regla en los dos lados.
3. **`src/js/fb.js`** — ver riesgo 3 (carga de colecciones enteras y espera de 6 segundos).
4. **`navigator.onLine`** (Ventas, venta rápida y otros) — ver riesgo 1: es el mismo control en varios archivos; si en el iPhone real falla, hay que cambiarlo en todos.

## Para decidir con el dueño

1. **Remitos viejos con productos en 0 kg.** Hasta ahora, un producto pesado en 0 se cobraba igual por la cantidad pedida. Esos remitos ya están cargados en las cuentas corrientes y el Panel los cuenta como cobrados. ¿Se revisan los últimos meses para devolver lo cobrado de más?
2. **Remitos repetidos.** Los pedidos que quedaron con dos remitos (y dos cargos) hay que revisarlos a mano. ¿Quién lo hace y desde cuándo?
3. **Pedido entregado todo en 0.** Hoy figura en "Pedidos del mes" con $0. ¿Tiene que contar como pedido?
4. **Punto como decimal.** Hoy solo vale la coma. ¿Alcanza (los precios son en pesos enteros) o se quiere aceptar también el punto para los centavos?
5. **Aumento de más de 100 % en Presupuestos.** Ahora no se acepta un porcentaje mayor a 100. ¿Puede hacer falta alguna vez?
6. **Reporte de Ventas en PDF.** Si desde la app instalada no se puede imprimir (riesgo 4), ¿se pasa a descarga de PDF como en el Panel?
7. **Cierre repetido idéntico.** Si se carga dos veces exactamente el mismo cierre, la segunda vez dice "Registro guardado" sin preguntar (no hay nada que reemplazar). ¿Está bien así?

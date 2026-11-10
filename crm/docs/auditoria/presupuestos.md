# Presupuestos (presupuestos.html): arreglos

Archivo tocado: `src/presupuestos.html`. Pruebas: `tests/arreglos-presupuestos.test.mjs` (10 pruebas, pasan tres veces seguidas junto con `smoke.test.mjs`).

Esta página no lee ni guarda nada en la base: arma un PDF (o un CSV) con lo que hay en pantalla. Ningún arreglo cambia documentos ni formatos guardados; una prueba controla que la base quede igual. Lo que se revisa en las pruebas es lo que le llega al cliente: el texto del PDF y del CSV descargados.

Cada prueba se corrió también contra la versión anterior del archivo: las 10 fallaban. Valores vistos en la versión anterior: artículo vario "8.990" → `$9`; precio borrado → `$6.990`; ajuste oculto → `$5.391`; bonificación 150 % → `$-4.495`; CSV a las 22:30 → `..._2026-11-11.csv`.

## Arreglado

### 1. Artículo vario: el precio "8.990" salía en el PDF como $9 — crítica
- **Qué pasaba:** en "Artículos varios" se agrega Queso Tybo, 4 KG, precio `8.990` (escrito como se ven todos los precios de la página). El PDF del cliente decía Queso Tybo a **$9** el kilo. `12.500` salía $13 y `$ 12.500` salía $0. El campo seguía mostrando "8.990", así que nada avisaba.
- **Qué se cambió:** el precio se lee con `SersaleBase.numero()` y el campo se comporta igual que los precios del catálogo (teclado numérico, punto de miles mientras se escribe). El CSV usa el mismo valor.
- **Prueba:** 'artículo vario: el precio "8.990" sale $8.990 en el PDF (no $9)'.

### 2. Un precio borrado ("Consultar") salía en el PDF con el precio de lista — alta
- **Qué pasaba:** en "Catálogo completo" no se puede sacar un producto; para no cotizarlo se borra el precio y la pantalla muestra "Consultar". El PDF igual imprimía el precio fijo del programa: Jamón Cocido de Pata a $6.990 (y sin el aumento general que sí tenían los demás). El CSV decía "Consultar".
- **Qué se cambió:** si en pantalla no hay precio, el PDF dice "Consultar".
- **Prueba:** 'un precio del catálogo borrado ("Consultar") sale "Consultar" en el PDF, no el precio de lista' (también controla que estén los 45 productos, el precio editado y el aumento general).

### 3. Los ajustes por categoría y por producto seguían aplicándose, ocultos, en "Catálogo completo" — alta
- **Qué pasaba:** se arma un presupuesto por selección para el cliente A con 10 % de bonificación en Paletas Cocidas. Después se pasa a "Catálogo completo", se cambia el nombre y se genera la lista para el cliente B: los campos de ajuste ya no se ven, pero la paleta le salía a B a $5.391 en vez de $5.990.
- **Qué se cambió:** los porcentajes por categoría y por producto solo valen en modo selección (que es donde se ven). En modo selección, el recuadro de "Ajuste de precios" ahora avisa "Ajuste propio en 1 categoría y 1 producto (tiene prioridad sobre el general)", contando solo productos marcados; antes un ajuste dentro de una categoría cerrada no se veía en ningún lado.
- **Prueba:** "los ajustes por categoría y por producto no se cuelan en el catálogo completo del cliente siguiente".

### 4. Artículo vario sin precio salía a $0 — media
- **Qué pasaba:** se agrega "Pechito ahumado" sin precio (a confirmar): el PDF lo ofrecía a $0 el kilo y el CSV ponía 0.
- **Qué se cambió:** sin precio (o con precio 0) sale "Consultar", igual que los productos del catálogo sin precio. Lo mismo para un precio de catálogo escrito en 0.
- **Prueba:** 'artículo vario sin precio sale "Consultar" (no $0)'.

### 5. Lo último que se escribía en "Artículos varios" podía no llegar al PDF — media
- **Qué pasaba:** lo escrito se tomaba recién al salir del campo. En el iPhone tocar un botón no saca el cursor del campo: se escribía la descripción y se tocaba "Generar" con el teclado abierto, y el artículo no salía en el PDF; o se tocaba "+ Agregar artículo" y la fila anterior quedaba vacía. El contador "N agregados" tampoco se actualizaba al escribir.
- **Qué se cambió:** cada tecla se guarda en el momento. Al generar se cierra el teclado antes de leer la pantalla. Al agregar un artículo el cursor queda en su descripción.
- **Prueba:** "lo último que se escribió entra al PDF aunque no se haya salido del campo" (el toque se simula sin sacar el cursor, como en Safari; en la versión anterior el artículo no aparecía en el PDF).

### 6. Un nombre de cliente largo se cortaba en la portada — media
- **Qué pasaba:** "DISTRIBUIDORA LA NUEVA ESPERANZA SRL" mide 657 pt en letra 30 y la hoja tiene 515 pt útiles: salía cortado de los dos lados.
- **Qué se cambió:** la letra se achica hasta que entre (mínimo 16) y, si aún no entra, va en hasta tres renglones; la fecha baja lo necesario. En las filas, una descripción o un peso escritos a mano que no entran en su columna se recortan con "..." en vez de pisar la columna de al lado.
- **Prueba:** "un nombre de cliente largo entra en la portada del PDF".

### 7. Sin nombre de cliente el PDF salía titulado "Cliente", sin avisar — media
- **Qué pasaba:** el campo dice "Nombre del cliente *" pero no se controlaba.
- **Qué se cambió:** pregunta "Falta el nombre del cliente" con "Volver" / "Generar igual". Si se sigue, sale como antes.
- **Prueba:** "sin nombre de cliente pregunta antes de generar, y la página no escribe nada en la base".

### 8. Modo selección ilegible en el iPhone — media (uso)
- **Qué pasaba:** con la casilla, el ajuste y el precio en el mismo renglón, al nombre del producto le quedaban 47 px: una palabra por renglón, tapada por los controles. En "Artículos varios" el botón × se salía de la tarjeta.
- **Qué se cambió:** en modo selección el nombre ocupa su renglón y debajo van el ajuste y el precio. Tocar el nombre marca o desmarca el producto (la casilla sola mide 17 px). La fila de artículos varios va en dos renglones, con letra de 16 px y × de 44 px. "Catálogo completo" se ve igual que antes.
- **Prueba:** "en el iPhone: modo selección legible, la flecha abre la categoría y tocar el nombre marca el producto".

### 9. Un porcentaje imposible generaba precios negativos — baja
- **Qué pasaba:** se quiere 15 % de bonificación y se escribe 150: todos los precios del PDF salían negativos ($8.990 → $-4.495). Un valor negativo se aplicaba sin mostrarse. El aviso decía "un bonificación".
- **Qué se cambió:** con un porcentaje fuera de 0 a 100 (o una bonificación de 100 o más) no se genera ni se exporta: avisa "Revisá los porcentajes de ajuste…", también en el recuadro. Corregido "una bonificación".
- **Prueba:** "un porcentaje imposible (bonificación de 150 %) no genera precios negativos: avisa y no descarga".

### 10. El CSV llevaba la fecha de mañana después de las 21 hs — baja
- **Qué pasaba:** exportando el 10/11 a las 22:30 el archivo se llamaba `..._2026-11-11.csv` (adentro decía 10/11/2026).
- **Qué se cambió:** todas las fechas (nombre del CSV, "Generado", portada y nombre del PDF) salen de `SersaleBase` con el día de Buenos Aires.
- **Prueba:** "a las 22:30 el PDF y el CSV llevan la fecha de hoy en Buenos Aires, no la de mañana".

### 11. La flecha ▼ de la categoría no la abría — baja
- **Qué pasaba:** tocar la flecha no hacía nada; había que tocar el nombre.
- **Qué se cambió:** solo los campos de ajuste de la categoría frenan el toque; la flecha abre y cierra.
- **Prueba:** la del punto 8.

### 12. Las páginas de productos decían "LISTA DE PRECIOS" aunque la portada dijera "PRESUPUESTO" — baja
- **Qué se cambió:** el mismo título en portada y páginas.
- **Prueba:** la del punto 3.

### 13. Avisos y errores — baja
- **Qué pasaba:** los avisos eran `alert()`; un error mostraba el texto técnico; si el logo no cargaba, "Generando PDF..." quedaba para siempre con el botón bloqueado.
- **Qué se cambió:** avisos con `SersaleUI.toast` ("PDF generado", "CSV exportado", "Seleccioná al menos un producto", "No se pudo generar el PDF. Probá de nuevo."). El botón se bloquea desde el toque (un doble toque no arma dos PDF) y se libera siempre, aunque falle. Si la librería del PDF no llegó a cargar, lo dice.
- **Prueba:** los avisos se controlan en las pruebas de los puntos 1, 7, 9 y 10 (la del 7 controla que no se use ningún diálogo del navegador).

### 14. Descarga del CSV y nombres de archivo — baja
- **Qué pasaba:** el enlace del CSV se liberaba en el mismo instante del toque (Safari puede no llegar a bajarlo). El nombre del cliente iba tal cual al nombre del archivo: con "Almacén", en el navegador de pruebas el archivo bajaba llamándose `download`. Un nombre o una descripción que empieza con = + - @ Excel lo toma como fórmula.
- **Qué se cambió:** el enlace se libera 40 segundos después (como hace la librería del PDF). Los nombres de archivo van sin acentos, barras ni comillas (`Presupuesto_Sersale_Almacen_Don_Pepe_10-11-2026.pdf`). Las celdas que empiezan como fórmula llevan apóstrofo.
- **Prueba:** la del punto 10 (nombre del archivo). La descarga en Safari no se pudo probar en un iPhone.

### Mejoras chicas de teléfono en lo que se tocó
Teclado numérico en los tres campos de porcentaje y en el precio de artículos varios; el ajuste por producto actualiza el recuadro al escribirlo.

## Descartado

- **jsPDF desde internet sin control de integridad** (seguridad 3) y **carga bloqueante desde el CDN** (rendimiento 1, en parte): ya se sirve desde `vendor/`.
- **Faltan las etiquetas de app instalada y la página hace zoom al enfocar** (uso 14 y parte de uso 4): el `<head>` ya las tiene, con `maximum-scale=1`.
- **Sin copia local ni uso sin señal** (rendimiento 3): ya lo resuelve la app instalada; la página no necesita red.
- **Acceso sin rol por `sersale_auth`** (seguridad 1): todos los ingresos ya guardan el rol; sacar esa línea no agrega protección mientras el control sea solo del navegador.
- **`innerHTML`** (seguridad 4): lo que escribe la persona ya pasa por `esc()`; el catálogo es fijo.
- **Sin claves ni acceso a la base** (seguridad 2): no es un defecto.
- **Búsqueda de categoría en cada precio** (rendimiento 4): 45 productos, no se nota.

## Pendiente

- **Catálogo y precios fijos dentro del programa** (candidato 6, media): la página tiene 45 productos; Pedidos tiene 66. Según la revisión faltan los 10 quesos, Costillitas, Matambrito, Cinta de Lomo, Ribs, Pollo, Churrasquitos, Chorizo Bombón Puro Cerdo, Pechito Ahumado, Mortadela Familiar y los dos salchichones familiares. Un precio editado se pierde al recargar. Leer el catálogo de la base es un cambio de diseño. Ver "Para decidir".
- **0 % en el ajuste de un producto** (candidato 12): hoy 0 y vacío son lo mismo (toma el ajuste de la categoría o el general). Ver "Para decidir".
- **"Quitar" borra solo el porcentaje general**, no los de categoría ni de producto (parte del candidato 3). Ahora quedan a la vista en el recuadro. Ver "Para decidir".
- **Punto como coma decimal en un precio** (candidato 14): `8990.50` queda `899.050`. Se ve en pantalla mientras se escribe. Tomar el punto como decimal rompería al que escribe `8.990`; los precios se redondean a pesos de todos modos.
- **CSV con `sep=;` y acentos** (candidato 16): no verificado con Excel; el resto del CRM exporta igual.
- **Códigos de artículo repetidos** (candidato 17): ver "Para decidir".
- **El presupuesto en curso se pierde** al cambiar de sección o recargar; no hay historial ni botón "Nuevo presupuesto" (uso 1). Ver "Para decidir".
- **El PDF solo se descarga** (uso 2): mandarlo por WhatsApp son varios pasos. Ver "Para decidir".
- **Controles chicos** (uso 4 y 5): casilla de 17 px, porcentaje por producto de 46×22 px con letra de 11 px, "Seleccionar todos", "Quitar" de 37 px de alto. Agrandarlos es rediseñar la fila.
- **Editar precios** (uso 7): al tocar un precio no se selecciona (hay que borrarlo cifra por cifra); el precio con ajuste no se ve en pantalla, solo en el PDF.
- **Cliente escrito a mano** (uso 9): sin buscador de clientes ni carga de sus precios acordados.
- **Buscar y marcar productos** (uso 10): sin buscador, sin "marcar toda la categoría", el número de la categoría no dice cuántos hay marcados, "Seleccionar todos" no cambia a "Deseleccionar".
- **Botón "Generar" al final de la página** y encabezado alto con "Exportar CSV" en tres renglones (uso 11).
- **Terminación del PDF** (uso 13): una categoría que sigue en otra hoja no repite el título; sin número de página; el rojo del PDF no es el de la marca.
- **Rendimiento (bajo):** jsPDF y el logo se cargan al abrir aunque no se genere nada; el logo se vuelve a codificar en cada PDF.
- **Los precios de lista viajan dentro de `presupuestos.html`**, que es un archivo público: va con la decisión sobre el catálogo y con la seguridad general ya anotada en `dashboard.md`.

## Pendiente en otros archivos

Ninguno. Los arreglos no necesitaron cambios fuera de `src/presupuestos.html`, y `_pendientes-entre-archivos.md` no tenía filas para este archivo.

## Para decidir con el dueño

1. **Lista de precios oficial.** Los precios y los 45 productos están fijos en el programa y no coinciden con el catálogo de Pedidos (66). ¿Se quiere que Presupuestos use el mismo catálogo que Pedidos y que los precios de lista se editen desde el sistema? ¿Y poder cargar los precios ya acordados con un cliente?
2. **Códigos de artículo.** "Art. 621" figura en Salame Chacarero de Campo, Mortadela Bocha y Mortadela Bologna. También se repiten 107 (las dos medias de jamón crudo), 602 (los dos salamines) y 905 (morcilla criolla y rosca). ¿Cuáles son los correctos?
3. **Botón "Quitar".** ¿Tiene que borrar también los ajustes por categoría y por producto, o solo el general (como hoy)?
4. **0 % en un producto.** ¿Significa "este producto queda al precio de lista aunque su categoría o el general tengan ajuste", o "sin ajuste propio" (como hoy)?
5. **Lista sin nombre de cliente.** Hoy pregunta y, si se sigue, la portada dice "Cliente". ¿Qué debe decir una lista general? ¿O el nombre tiene que ser obligatorio?
6. **Precio en 0.** Ahora un precio en 0 sale "Consultar" y una bonificación de 100 % no se acepta. ¿Hay algún caso en que se quiera mostrar $0 (producto de regalo)?
7. **Redondeo.** 10 % de bonificación sobre $5.990 da $5.391. ¿Redondear los precios ajustados a $10, $50 o $100?
8. **Guardar presupuestos.** ¿Se quiere un historial (ver qué se le pasó a cada cliente, duplicar) y que el borrador no se pierda al cambiar de sección?
9. **Enviar por WhatsApp.** ¿Reemplazar la descarga por la hoja de compartir del iPhone? Hay que probarlo en un teléfono real.
10. **Contenido del presupuesto.** Hoy es una lista de precios con otro título. ¿Debe llevar validez, aclaración de IVA, cantidades y totales?

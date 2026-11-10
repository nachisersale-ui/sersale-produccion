# Revisión independiente de Producción (produccion.html)

Qué se revisó: todo lo que cambió en `src/produccion/app.jsx` y `src/produccion.html`
desde lo que está publicado hoy (commit 1266a92), con el informe del arreglo
(`produccion.md`) solo como guía de intención. Archivos tocados en esta revisión:
esos dos y `tests/revision-produccion.test.mjs` (6 pruebas: las 6 fallan con el
código que recibí y pasan con el corregido).

Los formatos guardados no cambian y no se agrega ningún campo.

Resumen para quien decide: las cuentas del stock están bien cuando la señal anda
bien (lo comprobé con números, ver "Qué se verificó"). Los tres defectos que
encontré aparecen con **señal entrecortada**, y los tres dejaban el stock mal
**sin avisar a nadie**.

## Defectos encontrados y corregidos

### 1. Si la señal se cortaba justo al guardar, el stock se movía dos veces — gravedad alta

- Qué pasaba. Todo lo que mueve stock ahora se guarda en una transacción. Cuando
  el servidor guarda pero la respuesta no llega al teléfono (se pasó del wifi a
  los datos, se bloqueó la pantalla, se perdió la señal un segundo), Firestore
  repite la operación entera por su cuenta, y la operación volvía a sumar o a
  descontar sobre lo que ya había quedado guardado.
  - Reporte: Carlos envía "Salame Tipo Milán, 7 piezas". Quedaba **un** reporte de
    7, el stock con **14** más y dos movimientos "ENTRADA +7".
  - Salida: salen 3 Pancetas, el stock bajaba **6** y quedaban dos movimientos
    "SALIDA −3" (y una salida no se puede borrar desde la pantalla).
  - Botón −: un toque bajaba **2**.
  - Variante peor: si después del corte no había señal para ese reintento, la
    pantalla decía "No se pudo enviar el reporte. Probá de nuevo." con el reporte
    **ya guardado**. La persona hacía lo que dice el cartel y quedaban dos reportes
    y el stock sumado dos veces. Lo mismo con "Confirmar salida".
- Con el código publicado hoy esto no pasaba (escribía la cantidad final, no una
  suma): es un efecto de haber pasado a transacciones.
- Qué se cambió. Cada operación se reconoce a sí misma:
  - El reporte y los movimientos de una salida usan el mismo identificador en
    todos los intentos de lo mismo (mismo contenido). Dentro de la transacción,
    antes de tocar nada, se mira si ese documento ya existe: si existe, el intento
    anterior quedó guardado y no se aplica de nuevo; la pantalla muestra
    "¡Reporte enviado!" / "Salida registrada".
  - Los botones + y − no crean ningún documento: el ítem queda con la marca de
    hora (`updatedAt`, el campo de siempre) de esa operación, y al reintentar se
    mira si ya la tiene.
  - Una tanda nueva con los mismos productos y cantidades, cargada después de una
    que se envió bien, sigue siendo otro reporte.
- Pruebas: "reporte: si la señal se corta justo al enviar…", "reporte: dice 'No se
  pudo enviar' pero el servidor lo había guardado…", "salida: con la señal cortada
  al confirmar descuenta una sola vez…", "stock: un toque en − descuenta 1 aunque
  la respuesta del servidor no llegue".

### 2. Corregir o eliminar un reporte podía dejar el stock sin tocar, sin avisar — gravedad alta

- Qué pasaba. Para saber cuánto había sumado un reporte al stock se buscaban sus
  movimientos en la copia guardada en el teléfono. Con la señal entrecortada (el
  canal por el que el teléfono escucha los cambios caído) esa copia puede estar
  vacía o vieja, y la transacción igual se guardaba.
  - El director elimina el reporte de Cocidos de Ramón (14, 10 y 6 piezas) desde
    un teléfono que nunca abrió Movimientos: cartel "Reporte eliminado", el
    reporte desaparece, **el stock queda con las 30 piezas** y los tres movimientos
    quedan apuntando a un reporte que no existe.
  - Corrige 14 → 4: el reporte queda en 4, el stock igual, y aparece "No habían
    sumado al stock cuando se envió el reporte" (falso: sí habían sumado).
- Qué se cambió. Los movimientos del reporte y la lista de stock se piden al
  servidor en el momento de corregir o eliminar. Si el servidor no contesta, sale
  "No se pudo guardar / eliminar. Probá de nuevo." y no se cambia nada: ni el
  reporte, ni el stock, ni los movimientos. Lo escrito queda en pantalla.
- Prueba: "reporte: no se corrige ni se elimina si no se pueden consultar sus
  movimientos en el servidor…" (al volver la señal, elimina y descuenta bien).

### 3. Un reporte se guardaba sin sumar al stock, diciendo que el producto "no figura en Stock" cuando sí figura — gravedad media

- Qué pasaba. El teléfono del encargado normalmente nunca abrió la pestaña Stock,
  así que no tiene copia del stock. Si en ese momento el canal de escucha no
  conecta, la lista llega vacía. Envía "Salame Tipo Milán, 7 piezas": el reporte
  se guarda, **el stock no suma** y aparece "Esos productos no figuran en Stock de
  Producción. Cargalos o corregí el nombre…". El encargado no tiene nada que
  corregir y el director no se entera.
- Por cómo estaba escrito, el código publicado hoy tiene el mismo problema (busca
  el producto de la misma manera); el arreglo no lo había resuelto.
- Qué se cambió. Antes de dar un producto por "no figura" y guardar el reporte
  sin sumarlo, se confirma la lista con el servidor. Si no contesta: "No se pudo
  enviar el reporte. Probá de nuevo." y el formulario queda como estaba. Si de
  verdad no figura, todo sigue igual que antes (se guarda y avisa).
- Prueba: "reporte: con la copia de stock del teléfono vacía no se guarda
  diciendo que el producto 'no figura en Stock'".

## Qué se verificó y está bien

- **Cuentas al corregir y eliminar reportes.** Saqué la función que decide cuánto
  mover (`planDeReporte`) y la corrí contra un modelo simple en 20.000 secuencias
  al azar (alta, hasta tres correcciones cambiando cantidades, productos y
  unidades, productos repetidos en el mismo reporte, productos sin stock, "Otro",
  y eliminación). En todas: stock = inicial + movimientos, movimientos = piezas
  del reporte, y al eliminar todo vuelve al valor inicial.
- **Datos viejos.** Los movimientos que escribió el código anterior tienen los
  mismos campos que los nuevos; un movimiento sin `stockId` se resuelve por
  nombre. Cantidades de stock con "ruido" (2,1999999999999997) se redondean bien.
  Cantidades de reportes guardadas como texto ("12.5") se leen como número.
- **Excel contra la base, fila por fila** (15 ítems de stock, los 3 bajo mínimo,
  las 2 faenas de noviembre, los 13 productos de los lotes): coincide. El PDF usa
  los mismos datos.
- **WhatsApp**: sale una vez, al cruzar el mínimo; texto y teléfono bien
  codificados. **Sin señal** (modo avión): avisa y no guarda nada a medias.
- **Servidor inalcanzable con el teléfono "conectado"**: falla limpio en unos
  segundos, no guarda nada y deja lo escrito.

## Riesgos que no pude probar

1. **El corte de señal real en un iPhone.** Las pruebas simulan el corte en el
   navegador de pruebas. Para verlo a mano: en Producción, vista encargado, cargar
   un reporte de 1 pieza de un producto que esté en Stock; tocar "Enviar" y en el
   mismo instante apagar el wifi desde el Centro de control (o bloquear la
   pantalla). Repetir 5 o 6 veces con productos distintos. Después, en el panel:
   cada reporte tiene que figurar una sola vez, Movimientos tiene que tener una
   sola "ENTRADA" por reporte y el stock tiene que haber subido 1 por reporte.
2. **Botones + y − después de un cartel de error.** Si el cartel "No se pudo
   cambiar el stock" aparece y el servidor en realidad había guardado, el número
   en pantalla queda viejo y un toque nuevo descuenta otra vez (queda −2). Se ve
   en pantalla en el momento. A mano: con mala señal tocar −, y si sale el error
   tocar ↻ (cambiar de pestaña y volver) antes de tocar de nuevo.
3. **Cambiar el reporte después de "No se pudo enviar".** Si el servidor lo había
   guardado y la persona cambia algo (otra cantidad) antes de reintentar, se
   guarda como un reporte más. Queda a la vista en Reportes (dos del mismo
   encargado a la misma hora) y eliminando el que sobra el stock se corrige.
4. **Señal muy lenta.** "Enviando…" dura lo que tarde el servidor; no hay un
   tiempo máximo. Con + y −, cada toque espera al anterior: con señal lenta el
   número se mueve de a uno, con demora. A mano: en la cámara o donde peor llegue
   la señal, enviar un reporte y contar cuánto tarda.
5. **Si `navigator.onLine` del iPhone miente** (wifi conectado sin Internet): no
   sale "Sin conexión…", sale "No se pudo enviar… Probá de nuevo" después de unos
   segundos. No se guarda nada. Probar con el wifi de la planta desenchufado del
   módem.
6. **Que el WhatsApp llegue de verdad.** El pedido a CallMeBot sale, pero el
   navegador no deja leer la respuesta: si la clave está mal no hay forma de
   saberlo desde la pantalla. A mano: bajar un ítem hasta su mínimo y mirar el
   teléfono que recibe. En el caso raro del punto 1 con reintento a mano, la
   salida queda bien pero ese aviso de WhatsApp no sale.
7. **Descarga del PDF y del Excel en el iPhone** (Safari y app instalada): no se
   puede probar acá.

## Para corregir en otros archivos

1. **`src/js/fb.js`, `getDocs()`**: cuando la escucha de una colección no se pone
   al día en 6 segundos, pregunta con el `getDocs` común de Firebase, que con el
   canal caído **contesta con la copia del teléfono (vacía o vieja) sin avisar**.
   Quien llama no puede distinguirlo de una respuesta del servidor. En Producción
   lo esquivé pidiendo al servidor (`getDocsFromServer`) en los dos lugares donde
   una lista incompleta dañaba el stock, pero cualquier página que decida un
   importe o un saldo con una lectura así tiene el mismo problema. Propuesta: que
   `getDocs` de `fb.js` rechace (como ya hace sin conexión y sin copia) cuando la
   respuesta viene de la copia local, la escucha no está al día y la colección
   nunca se bajó completa; o que acepte una opción "tiene que ser del servidor".
2. **`src/js/fb.js`, `runTransaction()`**: conviene dejar escrito en el
   encabezado que una transacción puede ejecutarse y **guardarse** más de una vez
   si se pierde la respuesta (defecto 1), y revisar con ese criterio las
   transacciones que suman en otras páginas (saldos de cuenta corriente, números
   de remito, ventas). Yo solo revisé las de Producción.
3. **`tests/lib/harness.mjs`**: las ayudas `redQueSeCorta` y `cortarEscucha` de
   `tests/revision-produccion.test.mjs` sirven para probar lo mismo en cualquier
   página; convendría moverlas al arnés.
4. **`tests/lib/seed.mjs`**: no tiene datos "raros" de Producción (reporte
   corregido con el código viejo, movimiento sin `stockId`, ítem de stock
   borrado con movimientos). Hoy cada prueba los arma a mano.

## Para decidir con el dueño

1. **Reportes corregidos con el sistema viejo** (tienen "✏️ Editado" anterior a
   esta publicación). En esos, el movimiento dice lo que se sumó de verdad (por
   ejemplo +200) y el reporte dice otra cosa (20). Si hoy se elimina, se descuenta
   lo que dice el reporte (20) y se borra el movimiento: las 180 de más quedan en
   el stock y ya sin rastro. La alternativa es descontar lo que dice el
   movimiento (200), que es correcto salvo que alguien ya haya ajustado el stock
   a mano en su momento. No lo cambié porque no hay forma de saberlo desde el
   código. Recomendación: antes de publicar, hacer un recuento físico y dejar el
   stock al día (es la pregunta 8 del informe anterior, ahora con este detalle).
2. **Reportes que no tocan stock (todo en kg o en ganchos), sin señal.** Hoy
   tampoco se pueden enviar sin señal, aunque no mueven stock. Se podrían guardar
   en el teléfono y enviar solos al volver la señal, como el resto del CRM. ¿Lo
   quieren así? (Los reportes en piezas tienen que seguir pidiendo señal.)
3. **Cuando no se puede confirmar con el servidor, ahora no se guarda** (defectos
   2 y 3): con señal entrecortada va a aparecer más seguido "No se pudo… Probá de
   nuevo". Es a propósito: antes se guardaba mal en silencio.
4. Siguen abiertas las preguntas 1 a 9 del informe anterior (`produccion.md`); en
   particular la 5 (los ajustes con + y − no quedan en Movimientos) hace que un
   stock mal no se pueda reconstruir mirando los movimientos.

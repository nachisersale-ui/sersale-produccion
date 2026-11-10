# Revisión independiente: depósito, alertas, hoja de ruta, vista director y devoluciones

Archivos revisados: `src/pedidos/04-deposito-remitos-historial.jsx`,
`src/pedidos/07-alertas-hoja-ruta.jsx` y `src/pedidos/08-director-devoluciones-app.jsx`,
contra lo que está publicado hoy (commit `1266a92`). Los informes `p4.md`, `p7.md` y
`p8.md` se usaron solo para saber qué quiso hacer cada arreglo.

Pruebas nuevas: `tests/revision-deposito.test.mjs` (13). Cada una se corrió primero
contra el código que recibí y falló por el defecto que describe; con el código
corregido pasan. Archivos tocados: `04`, `08`, ese archivo de pruebas y una prueba
de `tests/arreglos-p8.test.mjs` que ya venía rota (ver punto 10). En `07` no
encontré nada para corregir.

No cambia ningún formato guardado y no se agrega ningún campo.

Corrida completa de `tests/` con el código corregido: 209 pruebas, 207 pasan, 1 queda
marcada como pendiente desde antes (`revision-paginas`) y 1 de `arreglos-p2`
(«nuevo pedido: saldo a favor…») se pasó de tiempo con la máquina cargada por las
otras revisiones; corrida sola, pasa. En una corrida anterior pasó lo mismo con dos
de `arreglos-cruzados` («cuenta nueva…»), que también pasan solas. Ninguna de las
tres toca los archivos de esta revisión.

Resumen para quien decide: con buena señal y un solo teléfono, lo que arreglaron los
tres informes funciona. Los defectos que quedaban aparecen en las dos situaciones
que el depósito vive todos los días: **dos teléfonos sobre el mismo pedido** y
**señal que va y viene**. El más serio (punto 1) podía dejar kilos anotados en el
producto equivocado, o volver atrás un kilo que había corregido otra persona, sin
ningún aviso; esos kilos son los que después se facturan en el remito.

## Defectos encontrados y corregidos

### 1. Depósito: con la lista "en vivo", los kg podían quedar en otro producto o pisar el kg que cargó otro teléfono — gravedad alta

- **Qué pasaba.** El arreglo del depósito hizo que la lista se actualice sola. Pero
  la hoja donde se anotan los kg guarda lo escrito "por renglón" (primer campo,
  segundo campo…) y con los kg que había cuando se abrió. Si el pedido cambia por
  debajo mientras la hoja está abierta, lo escrito queda al lado de otra cosa:
  - *Kilos en otro producto.* Pedido de Fiambrería Don Ángel: Jamón Cocido 12 kg,
    Queso Tybo 8 kg, Salamín, Mortadela. El operario abre «En preparación» y anota
    12,3 (jamón) y 8,1 (queso). En ese momento Comercial le saca el jamón al pedido.
    La hoja pasa a mostrar Queso / Salamín / Mortadela con los mismos números en los
    mismos renglones; al confirmar quedaba **Queso Tybo 12,3 kg y Salamín 8,1 kg**.
  - *Kilo corregido que vuelve atrás.* Pedido listo de Rotisería El Buen Sabor
    (Pollo 20,26 · Pernil 9,76 · Mozzarella 5). El operario abre «⚖️ kg». El
    director, desde su teléfono, corrige el pernil a 11,4. El operario cambia el
    pollo a 21 y guarda: **el pernil volvía a 9,76** sin que nadie lo viera. Lo
    mismo pasaba sin tener la hoja abierta de antes, si la novedad del otro
    teléfono todavía no había llegado a la pantalla (señal lenta).
- **Con el sistema publicado hoy** el depósito pisa el pedido entero con su copia
  vieja (eso es lo que arregló `p4`); estos dos casos son lo que quedaba de ese
  mismo problema, más uno nuevo (los renglones corridos) que apareció al hacer la
  lista en vivo.
- **Qué se cambió** (`VistaDeposito` y `pasarKgAItemsGuardados`, archivo 04):
  - Cuando **otro** teléfono le cambia los productos o los kg a un pedido, su
    tarjeta se arma de nuevo: si tenía la hoja de kg abierta, se cierra y aparece el
    aviso «Otro teléfono cambió el pedido de … mientras anotabas los kg. No se guardó
    lo que estabas escribiendo: abrí la hoja de nuevo, ya trae el pedido al día».
    Lo que guarda el propio teléfono no cierra nada.
  - Al guardar, solo se escriben los kg que la persona **cambió**; los demás quedan
    como están guardados en ese momento (igual que ya hacía Comercial).
- **Pruebas.** «depósito: si Comercial le saca un producto al pedido mientras el
  operario anota los kg…», «depósito: dos teléfonos corrigiendo kg del mismo pedido
  listo…», «depósito con señal lenta: el kg que el director corrigió un momento
  antes…».

### 2. Depósito: la hoja de kg se cerraba aunque no se hubiera guardado nada — gravedad media

- **Qué pasaba.** Dos arreglos hechos por separado no encajaban. El depósito pasó a
  guardar con una transacción (necesita señal y avisa si no pudo), pero la tarjeta
  del pedido seguía creyendo que el depósito "guarda en el teléfono y envía solo":
  esperaba un segundo y medio y cerraba la hoja. Ejemplo: en la cámara, sin señal,
  el operario anota 2,1 / 3,05 / 4,2 kg del pedido de Almacén Doña Rosa y confirma.
  Salía «Sin conexión: el cambio no se guardó…» y **la hoja se cerraba con los tres
  pesos perdidos**. Por cómo estaba escrito, con señal mala (un guardado que tarda
  más de un segundo y medio) también se cerraba, y si después fallaba el error
  aparecía con la hoja ya cerrada.
- **Qué se cambió.** Las tarjetas del depósito esperan el resultado real del
  guardado, como las de Comercial: la hoja se cierra solo si quedó guardado; si no,
  queda abierta con lo escrito y el botón vuelve a «Confirmar». Mientras guarda dice
  «Guardando...». (El cambio está en 04; la tarjeta es del archivo 03, ver "Para
  corregir en otros archivos".)
- **Prueba.** «depósito sin señal: la hoja de kg no se cierra ni pierde lo escrito,
  y al volver la señal se guarda».

### 3. Depósito: si la señal se cortaba justo al confirmar, culpaba a "otro teléfono" y dejaba cosas a medias — gravedad media

- **Qué pasaba.** Cuando el servidor guarda pero la respuesta no vuelve al teléfono,
  Firestore repite la operación sola. La repetición encontraba el pedido ya cambiado
  (por ella misma) y lo tomaba como un cambio ajeno:
  - Al marcar «Listo»: quedaba listo, pero en vez de «Pedido de … listo para
    despachar» salía «Otro teléfono ya cambió este pedido (ahora está listo).
    Revisalo y probá de nuevo».
  - Al cancelar desde el depósito (director): salía «Este pedido fue cancelado desde
    otro teléfono. No se cambió nada» y **el renglón «Pendiente de facturar» ($0)
    quedaba en la cuenta corriente** del cliente, colgado de un pedido cancelado.
  - Al corregir kg de un pedido listo: el cambio quedaba anotado **dos veces** en el
    historial del pedido.
- **Qué se cambió.** Cada cambio de estado lleva su propia marca (la fecha y hora
  que ya se guardaba en el historial). Si la repetición encuentra esa marca, sabe
  que es su propio cambio, no escribe de nuevo y sigue como si hubiera salido bien a
  la primera (incluido sacar el «Pendiente de facturar» al cancelar).
- **Pruebas.** «depósito: si la respuesta del servidor se pierde al marcar
  «Listo»…», «depósito (director): al cancelar con la señal cortada…», «depósito:
  corregir kg con la señal cortada…».

### 4. Depósito: un teléfono sin datos guardados que no lograba conectar decía «No hay pedidos en este estado» — gravedad media

- **Qué pasaba.** La lista en vivo aceptaba como buena una lista vacía que no venía
  del servidor sino de lo guardado en el teléfono. En un teléfono que nunca había
  bajado los pedidos (el primer uso de esta versión, o un iPhone al que se le
  borraron los datos del sitio) y que en ese momento no lograba conectar, a los
  pocos segundos aparecía el tilde verde con **«No hay pedidos en este estado»**,
  con 10 pedidos activos en la base. Por cómo está escrito, el sistema publicado
  hoy hace lo mismo; la capa de datos nueva (`fb.js`) ya lo evita en las lecturas
  comunes («Sin conexión y sin datos guardados»), pero la lista en vivo del
  depósito no pasaba por esa protección.
- **Qué se cambió.** Una lista vacía que no viene del servidor no se muestra como
  cierta: se pide la lista por el camino normal, que en ese caso avisa «No se
  pudieron cargar los pedidos» con el botón «Reintentar». Cuando el teléfono
  conecta, la lista aparece sola.
- **Prueba.** «depósito: un teléfono sin pedidos guardados que no logra conectar no
  afirma «No hay pedidos»…».

### 5. Depósito: con las novedades cortadas, el cambio se guardaba pero la pantalla no decía nada (y al repetirlo culpaba a otro teléfono) — gravedad media

- **Qué pasaba.** El guardado y las novedades viajan por caminos distintos. Con la
  señal entrecortada (típico al salir de la cámara) el guardado puede pasar y la
  lista quedarse como estaba un rato (el teléfono reintenta conectar cada vez más
  espaciado; calculo que hasta un minuto, ver riesgo 1). Ejemplo: el operario anota 2,1 kg en
  el pedido de Almacén Doña Rosa y confirma. En el servidor queda «en preparación»
  con sus kg; en la pantalla la hoja se cierra y **el pedido sigue en
  «Pendientes», sin ningún aviso**. Lo natural es hacerlo de nuevo: ahí salía «Otro
  teléfono ya cambió este pedido (ahora está en preparación). Revisalo y probá de
  nuevo», que no es cierto y manda a probar algo que va a dar siempre lo mismo. No
  se dañaba ningún dato. Por cómo guarda, con el sistema publicado hoy el cambio se
  ve en la pantalla al instante.
- **Qué se cambió.** Después de guardar se mira si la lista del teléfono ya trae el
  cambio. Si no, avisa: «Guardado. La lista de este teléfono todavía no se actualizó
  (señal lenta): el pedido va a cambiar solo, no hace falta repetirlo». Y si igual
  se repite, el mensaje es «Este pedido ya está en preparación: la lista de este
  teléfono todavía no se actualizó (señal lenta). No se cambió nada».
- **Prueba.** «depósito con las novedades cortadas: el cambio se guarda, se avisa
  que la lista está atrasada y repetirlo no culpa a otro teléfono».

### 6. Devolución: después de un «No se pudo registrar» que en realidad sí había guardado, corregir el importe duplicaba la devolución y el crédito — gravedad media

- **Qué pasaba.** Mismo corte de señal del punto 3, pero sin poder reintentar: la
  pantalla dice «No se pudo registrar la devolución» y el servidor ya la tiene. El
  arreglo previó el reintento con los mismos datos (no duplica). Pero si la persona,
  antes de reintentar, **corrige el importe**, se tomaba como una devolución nueva.
  Ejemplo: Fiambrería Don Ángel debe $367.993; devolución con crédito de $15.000,
  sale el error; se corrige a $16.000 y se registra. Quedaban **dos devoluciones
  y dos créditos: el saldo bajaba $31.000** en vez de $16.000.
- **Qué se cambió.** Corregir el importe ya no cambia la identidad de la devolución
  (cambiar el cliente sí, porque es otra cuenta): el reintento corrige la misma
  devolución y el saldo se ajusta solo por la diferencia. En el ejemplo queda una
  devolución de $16.000, un movimiento de $16.000 y saldo $351.993. (Si en el
  reintento se le saca el crédito del todo, se guarda como otra devolución, para
  que el crédito que pudo haber quedado siga a la vista en la suya; esto último no
  tiene prueba propia.)
- **Lo que no cubre.** Si después del error falso se cambia el **cliente**, la
  primera devolución (con su crédito) queda guardada a nombre del primer cliente.
  Se ve en la lista de devoluciones al volver a cargarla.
- **Prueba.** «devolución: dice «No se pudo registrar» pero el servidor la había
  guardado; al corregir el importe y reintentar…».

### 7. Devolución: «no tiene cuenta corriente» salía de la copia del teléfono, que puede estar vieja — gravedad media

- **Qué pasaba.** Para saber si el cliente tiene cuenta se mira la copia guardada en
  el teléfono. Si el canal por el que llegan las novedades está caído (señal
  entrecortada), esa copia no se entera de una cuenta abierta hace un rato desde
  otro teléfono. Ejemplo: a Rotisería El Buen Sabor le abren la cuenta (debe
  $50.000) y el director carga una devolución con crédito de $8.000 desde un
  teléfono que no se enteró: la pantalla afirmaba «Rotisería El Buen Sabor no tiene
  cuenta corriente» y ofrecía «Registrar sin crédito». Si se aceptaba, la devolución
  quedaba guardada como «sin asentar» y **la cuenta seguía en $50.000**.
- **Qué se cambió.** Antes de dar a un cliente por "sin cuenta" se le pregunta al
  servidor. Si tiene cuenta, el crédito se asienta ($42.000 en el ejemplo). Si el
  servidor no contesta, sale «No se pudo registrar la devolución. Revisá la conexión
  y probá de nuevo» y no se guarda nada; el formulario queda cargado.
- **Prueba.** «devolución con crédito: si el teléfono no se enteró de que el cliente
  ya tiene cuenta, no la registra «sin crédito»».

### 8. Alertas: «✓ Contactado» no quedaba marcado en clientes cargados dos veces — gravedad media

- **Qué pasaba.** El arreglo del panel unificó los nombres sin mirar acentos: dos
  fichas «Almacén Güemes Sur» y «Almacen Guemes Sur» ahora son un solo cliente (bien).
  Pero las alertas leen el último contacto de **una** ficha (la primera) y
  «✓ Contactado» lo anota en **la otra** (la última). El cliente desaparecía de la
  lista al tocarlo y **volvía a figurar vencido cada vez que se abría el panel**
  (y entraba en el mail diario). Con el sistema publicado hoy esas dos fichas eran
  dos clientes distintos y el contacto quedaba bien; con fichas repetidas que solo
  difieren en mayúsculas el problema ya existía.
- **Qué se cambió.** Si un cliente tiene más de una ficha, vale el contacto más
  reciente de cualquiera de ellas.
- **Prueba.** «alertas: «✓ Contactado» de un cliente cargado dos veces (con y sin
  acentos) queda marcado…».

### 9. Alertas: si «✓ Contactado» no se podía guardar, el cliente desaparecía igual y sin aviso — gravedad baja

- **Qué pasaba.** El arreglo de Clientes hizo que el guardado del contacto avise si
  falló, pero el panel no miraba esa respuesta: sacaba al cliente de la lista como
  si estuviera hecho. Reaparecía vencido la próxima vez que se abría el panel.
- **Qué se cambió.** Si no se guardó, el cliente vuelve a la lista y sale «No se pudo
  marcar a … como contactado. Probá de nuevo».
- **Prueba.** «alertas: si «✓ Contactado» no se pudo guardar, se avisa y el cliente
  sigue en la lista».

### 10. Una prueba de `arreglos-p8.test.mjs` fallaba desde que se juntaron los arreglos

- La prueba «alertas: los días sin pedir se cuentan con el día argentino…» escribía
  45 en el campo «Días» de un cliente con límite automático. El arreglo de Alertas
  (07) dejó ese campo como «Auto:», sin poder editarlo: la prueba ya no podía
  escribir y fallaba (lo comprobé con el código tal como lo recibí). El
  comportamiento correcto es el de la pantalla; corregí la prueba: ahora verifica
  que el campo no se edita y que al tocarlo explica por qué.

## Qué se revisó y está bien

- **Devolución con crédito:** devolución, movimiento y saldo se guardan juntos; el
  saldo nuevo sale del saldo guardado en ese momento ($367.993 − $15.000 =
  $352.993) y el reintento con los mismos datos no duplica. Lo que guarda lo lee
  bien el sistema viejo (mismos campos de siempre; `creditoAsentado` y
  `devolucionId` son agregados que el viejo ignora).
- **Hoja de ruta:** seguí a mano el armado de los tramos de Maps con 9, 10, 11, 18 y
  19 paradas (ninguna queda afuera y cada tramo arranca donde terminó el anterior).
  Leí contra el código viejo las paradas que el buscador no encuentra, la hoja por
  WhatsApp, la limpieza de direcciones y «31,6 kg» en vez de «31.6 piezas»; las 7
  pruebas de `arreglos-p7` pasan. Si la señal se corta a mitad de la búsqueda, las
  paradas que faltan quedan al final, marcadas (así está escrito; no lo probé con
  un corte real).
- **Remitos guardados y su PDF:** el código lee igual los remitos viejos (sin tipo
  ni fecha de entrega, kg guardado como texto, totales con decimales largos) y los
  que escribe ahora Comercial; las pruebas de `arreglos-p4` pasan.
- **Cálculo de alertas:** comparé línea por línea con el cálculo viejo (días sin
  pedir, frecuencia, límite). Las diferencias son las buscadas (día argentino,
  nombres sin acentos, cargos de remito que no cuentan como pedido aparte) más la
  del punto 8. Lo que se escribe (`diasAlerta`, `freqCalculada`, `ultimoContacto`,
  `ultimoPedidoRegistrado`) tiene el formato de siempre y el sistema viejo lo lee
  igual.
- **Gesto "atrás", cinta NUEVO, cartel de pedidos nuevos y aviso «Nuevo pedido
  cargado»:** leídos contra el código viejo, sin defectos nuevos; sus pruebas
  (`navegacion`, `arreglos-p8`) pasan.
- **Convivencia con el sitio viejo durante la prueba:** nada de lo que escriben
  estos tres archivos cambia de forma; no hay estados ni tipos nuevos.

## Riesgos que no pude probar

Todo esto depende de un iPhone real, de la señal real o de servicios de afuera.

1. **El depósito en la cámara, con el iPhone "conectado" pero sin datos.** Si el
   teléfono dice que tiene conexión y no la tiene, no sale «Sin conexión…» al
   instante: el botón queda en «Guardando...» hasta que Firestore se rinde (en las
   pruebas, unos segundos; con una rayita puede ser bastante más). A mano: en el
   lugar de peor señal, anotar kg de un pedido de prueba y confirmar; medir cuánto
   tarda en decir «No se pudo guardar el cambio» o en guardar, y verificar que la
   hoja sigue abierta con los números.
   Y al revés (punto 5): salir de la cámara, confirmar apenas vuelve la señal y
   mirar si la tarjeta cambia de lugar enseguida o aparece el aviso «Guardado. La
   lista… todavía no se actualizó»; contar cuánto tarda la lista en ponerse al día
   (no debería pasar de un minuto). Si tarda más, avisar: habría que mostrar el
   cambio propio en pantalla sin esperar la novedad.
2. **La hoja de kg que se cierra por un cambio ajeno, con el teclado abierto.** En
   las pruebas el aviso se ve; en el iPhone hay que confirmar que no queda tapado
   por el teclado. A mano, con dos teléfonos: en uno abrir «⚖️ kg» de un pedido
   listo; en el otro (Comercial) cambiarle un kg al mismo pedido y guardar. En el
   primero la hoja tiene que cerrarse sola con el aviso, y al reabrirla traer el kg
   nuevo.
3. **La lista en vivo después de bloquear el teléfono.** iOS suspende la página en
   segundo plano. A mano: dejar el depósito abierto, bloquear 5 minutos, cargar un
   pedido desde otro teléfono, desbloquear: el pedido tiene que aparecer solo (con
   NUEVO) en pocos segundos, sin tocar ↻.
4. **El corte de señal real al confirmar** (puntos 3 y 6). A mano: marcar «Listo» o
   cancelar un pedido de prueba y, en el mismo instante, apagar el wifi desde el
   Centro de control; repetir varias veces. El pedido tiene que quedar con un solo
   cambio en su historial y sin avisos de "otro teléfono".
5. **Gesto atrás en el iPhone** (deslizar desde el borde), en Safari y en la app
   instalada: desde Comercial, Depósito y Director tiene que volver a «¿Quién sos?».
   Por cómo está escrito, después de recargar la página varias veces dentro de una
   vista puede hacer falta deslizar una vez de más para salir de Pedidos (no pierde
   datos); no lo probé.
6. **Maps con 9 paradas en el teléfono del chofer** y **el buscador de direcciones
   real** (admite una consulta por segundo y a veces rechaza): acá están simulados.
7. **Compartir el PDF del remito** desde la app instalada (hoja de compartir del
   iPhone, cerrar sin compartir).
8. **Mail diario de alertas:** el envío está simulado. Con señal entrecortada puede
   salir dos veces en el día o armarse con datos viejos del teléfono (ver "Para
   corregir en otros archivos", punto 4).

## Para corregir en otros archivos

1. **`src/pedidos/03-pedidos-comercial-remito.jsx`, `TarjetaPedido`, función
   `cambiar` (l. 81-103).** La rama «Depósito: el cambio queda en el teléfono y se
   envía solo» (espera 1,5 s y no mira si devolvió `false`) quedó vieja: el depósito
   ahora guarda con transacción y devuelve `true`/`false`. Desde 04 lo resolví
   poniendo la lista del depósito dentro de `ComercialCtx` (con `onRemito: null`)
   para que tome el camino que espera el resultado. Lo prolijo es sacar esa rama en
   03 y esperar siempre `(await guardado) !== false`; cuando se haga, el
   `ComercialCtx.Provider` de `VistaDeposito` se puede quitar.
2. **03, hojas de kg de `TarjetaPedido` (l. 164-222).** Guardan lo escrito por
   posición (`kgValues[i]`) y dibujan los renglones con el pedido "de ahora". Con
   una lista que se actualiza sola eso corre los kg de producto (punto 1). En el
   depósito lo evité rearmando la tarjeta ante un cambio ajeno. La solución de
   fondo es que la hoja tome una foto de los ítems al abrirse y mande solo los kg
   que se tocaron. Si algún día Comercial pasa a lista en vivo, va a tener el mismo
   problema.
3. **`src/pedidos/02-clientes-nuevo-pedido.jsx`, `marcarContacto` (l. 336-368).**
   (a) Con fichas repetidas anota el contacto en la **última** que coincide; las
   alertas leían la primera (ahora 08 toma el más reciente de todas, pero conviene
   que elija siempre la misma). (b) Si no encuentra al cliente en la copia del
   teléfono **crea una ficha nueva**: con la copia vieja o vacía (señal
   entrecortada) eso duplica clientes. Antes de crear, confirmar con el servidor
   (`getDocsFromServer`). Visto en el código, sin prueba.
4. **02, `verificarYEnviarAlertas` (l. 316-328).** Lee `config/ultima_alerta_email`,
   manda el mail y recién después anota la fecha, sin transacción y con una lectura
   que con mala señal sale de la copia del teléfono: dos teléfonos (o uno con la
   copia de ayer) mandan dos mails. Además el mail se arma con lo que tenga el
   teléfono, aunque no esté al día. Propuesta: reservar el día dentro de una
   transacción antes de enviar. (La carrera entre dos teléfonos ya la anotó `p8.md`.)
5. **`src/pedidos/00-cuenta-corriente.jsx`, `ccBuscarCuenta`.** Varias pantallas
   deciden "tiene / no tiene cuenta" con la copia del teléfono. En la devolución lo
   confirmé con el servidor a mano; convendría una variante compartida
   (`ccBuscarCuenta(nombre, { delServidor: true })`) para todos los que deciden una
   escritura con esa respuesta.
6. **`src/js/fb.js`.** `onSnapshot` se usa directo de Firebase y no tiene la
   protección de `getDocs` contra "lista vacía que no es del servidor" (punto 4).
   Hoy las únicas pantallas que escuchan en vivo son el depósito (corregido) y el
   contador de pedidos nuevos (no muestra listas). Si se agregan más, conviene una
   envoltura en `fb.js`.
7. **`src/js/fb.js`, `runTransaction()`.** Después de confirmar vuelve a pedir al
   servidor cada documento escrito para que la copia del teléfono lo tenga, pero ese
   pedido va por el mismo canal de las novedades: si está caído, la copia queda
   vieja y la pantalla que relee muestra el dato de antes (punto 5; por cómo está
   escrito, en Comercial pasaría lo mismo: no lo probé ni lo toqué). Propuesta: que
   `runTransaction` avise a quien llama si no pudo refrescar la copia, para que cada
   pantalla lo diga.

## Para decidir con el dueño

1. **Depósito sin señal.** Sigue sin guardar cuando no hay conexión (decisión 1 de
   `p4.md`); ahora, además, no pierde lo escrito. ¿Alcanza con eso o el depósito
   tiene que poder trabajar sin señal en la cámara?
2. **Hoja de kg que se cierra cuando otro teléfono cambia el pedido.** Es a
   propósito: es la forma segura de no anotar kilos en el producto equivocado. El
   costo es volver a escribir los kg de ese pedido. ¿Está bien así?
3. **Devolución con crédito a un cliente "sin cuenta".** Ahora exige poder
   consultar al servidor; con señal entrecortada va a decir «No se pudo
   registrar… probá de nuevo» en vez de registrarla sin crédito. Sigue abierta la
   pregunta 2 de `p8.md` (¿abrirle la cuenta con saldo a favor?).
4. **Clientes cargados dos veces.** Aparecen como uno solo en el panel, pero siguen
   siendo dos fichas (dos direcciones, dos límites de días). ¿Se hace una limpieza
   de fichas repetidas antes de publicar?
5. **Corregir kg desde el depósito después de emitido el remito.** Hoy se puede: el
   pedido queda con un kg y el remito (y la cuenta corriente) con otro, hasta que
   alguien rehaga el remito. ¿Tiene que avisar, o bloquearse para el operario?
6. **Mandar la hoja de ruta sin "Optimizar".** Los botones de Maps y WhatsApp
   aparecen recién después de optimizar (o si el buscador falla del todo). Con señal
   lenta el buscador puede tardar mucho. ¿Se quieren los botones desde el principio?

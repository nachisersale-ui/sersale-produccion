# Revisión independiente de la capa compartida

Qué se revisó: lo que usan todas las páginas. `src/js/fb.js` (datos y copia en el
teléfono), `src/js/shell.js` y `src/css/shell.css` (avisos, hojas de
confirmación, barra de abajo), `src/js/base.js` (fechas y montos),
`src/js/sesion.js`, `src/js/fb-compat.js`, `src/sw.js` (app instalada),
`build.mjs`, y las páginas `index.html` (ingreso y usuarios), `backup.html` y
`pedidos.html` (el arranque). Los informes de los arreglos se usaron solo para
saber qué se quiso hacer.

Archivos tocados: `src/js/fb.js`, `src/js/shell.js`, `src/css/shell.css` y
`tests/revision-infra.test.mjs` (6 pruebas: las 6 fallan con el código que
recibí y pasan con el corregido). En `tests/revision-paginas.test.mjs` solo se
sacó la marca de "pendiente" de la prueba de actualización con un cierre a medio
cargar: `shell.js` ya lo tenía corregido y la prueba pasa. No cambia ningún
formato guardado ni se agrega ningún campo.

Pruebas: la tanda completa da 188 de 189. La que falla ("alertas: … el límite a
mano se valida", de `arreglos-p8.test.mjs`) falla igual con el código que recibí
y no es de estos archivos (ver "Para corregir en otros archivos", punto 3).

Resumen para quien decide: con buena señal la capa compartida hace lo que dice.
Lo que encontré aparece en cuatro situaciones: **doble toque** en las preguntas
de confirmación, **señal entrecortada** después de guardar, un teléfono que **no
deja guardar datos**, y una **copia muy grande**. En las cuatro el sistema
mostraba algo que no era cierto sin avisar.

## Defectos encontrados y corregidos

### 1. Un doble toque contestaba solo la pregunta de confirmación, o cambiaba de sección con la operación en curso — gravedad alta

Las preguntas ("¿Eliminar este ítem?", "¿Cancelar el pedido?"…) ya no son las del
navegador: son una hoja propia que sube desde abajo. Tenía dos problemas con el
doble toque, que con el dedo es muy común.

- **El segundo toque caía en «Eliminar».** La hoja aparece abajo, y su botón de
  confirmar queda justo arriba de la barra de secciones. Si el botón que abre la
  pregunta está en ese lugar de la pantalla, el segundo toque del doble toque cae
  sobre «Eliminar» antes de que la persona llegue a leer nada. Reproducido en
  Producción → Stock con la lista deslizada hasta dejar un 🗑️ pegado a la barra:
  doble toque y el ítem de stock **se borra sin preguntar** (quedaban 14 de 15).
  En la computadora o la tablet la hoja sale en el centro, así que ahí le pasa a
  cualquier botón que esté en el medio de la pantalla. Con la pregunta del
  navegador que usa el sitio publicado hoy esto no pasaba.
- **El segundo toque caía en la barra de abajo.** Al tocar «Eliminar» o
  «Confirmar» la hoja se va, y debajo de ese botón está la barra de secciones
  (Producción, Ventas, Presup.). Un doble toque sobre «Eliminar» borraba el ítem
  y además **abría Ventas**, con el guardado todavía en curso. En operaciones de
  varios pasos, cambiar de página en ese momento puede dejarlas por la mitad, y
  la persona no ve ni el aviso de que salió bien ni el de que falló.
- Qué se cambió (`shell.js`, `shell.css`):
  - Recién abierta la hoja, sus botones no responden durante 0,4 segundos (los
    toques fuera de la hoja ya se ignoraban en ese instante).
  - Al cerrarse, la hoja sigue tapando la pantalla (ya invisible) otro instante,
    así el segundo toque no llega a lo que hay debajo.
  - De paso: mantener apretado Enter en la computadora ya no contesta la
    pregunta, y al cerrarse la hoja no le saca el cursor a un campo en el que la
    persona ya se puso a escribir.
- Pruebas: "hoja: un doble toque en 🗑️ no confirma solo el borrado…" y "hoja: un
  doble toque en «Eliminar» no cambia de sección…".

### 2. Con señal entrecortada, después de guardar se seguía viendo el dato de antes, sin ningún aviso — gravedad alta

- Qué pasaba. Los pagos, remitos, ventas y movimientos de stock se guardan con
  una operación que va directo al servidor. Lo que se ve en pantalla sale de la
  copia del teléfono, que se pone al día por otro canal (la "escucha"). Cuando la
  señal anda a los saltos, ese canal se cae y Firestore espera cada vez más para
  reconectarlo (hasta un minuto), aunque la señal ya haya vuelto. En ese rato:
  - El director registra un pago de $10.000 de Carnicería El Trébol. El servidor
    lo guarda (saldo $650.925) y sale el cartel "Pago de $10.000 registrado.
    Saldo: $650.925"… pero la lista **sigue mostrando $660.925**. No había
    ningún aviso de que la pantalla estaba atrasada. Lo natural es creer que no
    se guardó y cargarlo de nuevo: **pago duplicado**. Lo mismo puede pasar en
    cualquier pantalla que guarda así y después vuelve a leer de la copia.
  - En general: con el teléfono "con conexión" pero sin respuesta del servidor,
    cualquier pantalla mostraba la copia guardada (de hace minutos u horas) como
    si fuera lo de ahora. La franja "Sin conexión" solo aparece cuando el
    teléfono mismo dice que no tiene red.
- Qué se cambió (`fb.js`, `shell.js`):
  - Cuando una operación de esas se confirma, se sabe que en ese momento hay
    señal: si Firestore dice que no tiene conexión y por eso la copia no pudo
    ponerse al día, se le pide que reconecte ya (como mucho una vez cada 15
    segundos) y se vuelve a intentar. En el caso del ejemplo, la lista muestra
    $650.925 enseguida.
  - Si igual no se puede (el servidor sigue sin contestar), o si una lectura tuvo
    que responderse con la copia guardada, aparece una franja arriba: **"Señal
    débil · lo que se ve puede estar desactualizado"** (con los cambios sin
    enviar, si hay). Se va sola cuando la copia vuelve a estar al día, con el
    cartel "Conexión recuperada".
  - Ese reintento tiene un tope de 6 segundos: la operación ya está guardada y la
    pantalla no se queda esperando.
  - Quedó escrito en el encabezado de `runTransaction` lo que ya encontraron
    otras revisiones: una transacción puede guardarse dos veces si se pierde la
    respuesta, y cómo escribirla para que no sume doble.
  - A propósito NO se insiste con un reloj en reconectar mientras dura el aviso:
    cada reconexión corta lo que se esté bajando, y con señal lenta una bajada
    larga (la primera del día, con miles de documentos) no terminaría nunca.
- Lo que NO cambia: la pantalla que ya estaba abierta no se vuelve a leer sola
  cuando vuelve la señal (igual que al salir del modo avión); hay que tocar ↻ o
  volver a entrar. Ver "Para corregir en otros archivos".
- Pruebas: "señal entrecortada: después de registrar un pago la lista muestra el
  saldo nuevo…" y "señal entrecortada: si el servidor sigue sin contestar, se
  avisa…".

### 3. En un teléfono que no deja guardar datos, "guardado en el teléfono" era mentira — gravedad media (poco frecuente, pero se pierde lo cargado)

- Qué pasaba. Sin señal, guardar termina enseguida y la franja dice "1 cambio
  guardado en el teléfono, se envía al volver la señal". Eso es cierto si la base
  local del teléfono (IndexedDB) funciona. Cuando no abre (es un error conocido
  del iPhone: "Connection to Indexed Database server lost"; también con el
  almacenamiento bloqueado o lleno), Firestore sigue andando sin avisar con todo
  **solo en memoria**. El sistema igual decía "guardado en el teléfono": se
  cerraba la app y el cliente, pedido o cambio cargado **no existía más**.
  Además, las pantallas abiertas sin señal mostraban **listas vacías** (cero
  clientes) con el cartel "se muestran los datos guardados", porque quedaba
  anotado de otro día que ese teléfono tenía la copia.
- Qué se cambió (`fb.js`): al arrancar se prueba la base local. Si no anda, los
  guardados vuelven a esperar la confirmación del servidor (el botón queda en
  "Guardando…" hasta que se envía de verdad, como en el sitio de hoy), no se
  promete nada, y sin señal las lecturas avisan "sin datos guardados" en vez de
  mostrar una lista vacía.
- Prueba: "teléfono que no deja guardar datos (IndexedDB caído)…".

### 4. Con una copia de más de 40 MB, Firestore borraba colecciones del teléfono y sin señal se veían vacías — gravedad media

- Qué pasaba. `fb.js` baja colecciones enteras y anota "este teléfono tiene los
  clientes completos". Pero Firestore, de fábrica, limita la copia a 40 MB:
  cuando se pasa, al minuto de abrir la app y después cada 5 minutos borra lo
  que hace más que no se usa, colecciones enteras incluidas. Con años de pedidos,
  remitos y movimientos, el teléfono del director puede llegar a ese tamaño (no
  pude medir la base real: ver "Riesgos"). Reproducido: copia de 43 MB, con las
  consultas que deja anotadas el uso normal (una por cada documento que guarda
  una transacción), la app abierta 7 minutos en el inicio; después, sin señal,
  Clientes mostraba **0 de 30 clientes** con el cartel "se muestran los datos
  guardados". Con señal no se nota (se vuelve a bajar todo, lo que además gasta
  lecturas cada vez).
- Qué se cambió (`fb.js`): la copia no tiene tope de tamaño, así que no se borra
  nada por su cuenta. Ocupa lo que ocupe la base (ver "Para decidir").
- Prueba: "copia grande (más de 40 MB): dejar la app abierta no borra…".

## Qué se verificó y está bien

- **Lecturas desde la copia**: después de una transacción, de una escritura
  común, de lo que carga otro teléfono y al volver de estar sin red, la lectura
  siguiente trae lo último (pruebas de `datos.test.mjs`, que siguen pasando).
- **Consultas**: todas las del sistema filtran u ordenan por un solo campo, así
  que la copia local las responde igual que el servidor, y ninguna necesita un
  índice compuesto (el emulador de las pruebas no los exige; el servidor real
  sí). No hay colecciones nuevas respecto del sitio publicado.
- **Un cambio dado por guardado sin señal que después el servidor rechaza** (por
  ejemplo, editar un cliente que otro teléfono borró): aparece la hoja "Cambio no
  enviado" y la cuenta de pendientes vuelve a cero.
- **Ingreso y usuarios**: mismos campos que el sitio de hoy; una lista de
  usuarios vacía solo vale si la contestó el servidor.
- **Backup**: lee siempre del servidor y, si falla una sola colección, no genera
  archivo. Incluye las 13 colecciones de datos.
- **App instalada**: todos los archivos que las páginas piden están en la lista
  que se guarda en el teléfono; la versión nueva se instala entera o no se
  instala; una página con algo escrito no se recarga sola.
- **`alert()`**: ya no lo usa ninguna pantalla del sistema (solo `migracion.html`).
- **Fechas**: no hay fechas guardadas en formato día/mes/año con barras (ese
  formato `SersaleBase` lo leería al revés), así que no hay problema con los
  datos viejos.

## Riesgos que no pude probar

Dependen de un iPhone real, de la señal real o de la base real.

1. **La app vuelve del segundo plano con la escucha muerta sin saberlo.** El
   iPhone corta las conexiones de una app que quedó atrás. Hasta que Firestore lo
   nota (unos segundos), las lecturas salen de la copia como si estuviera al día,
   sin franja. A mano, con dos teléfonos: dejar el A en Depósito y bloquearlo 10
   minutos; cargar un pedido con el B; desbloquear el A y tocar ↻ enseguida. Si
   el pedido tarda más de unos segundos en aparecer, avisar: se puede forzar la
   reconexión al volver a la app.
2. **Doble toque con el dedo.** Las pruebas lo simulan. En el iPhone: Producción →
   Stock, doble toque en un 🗑️ que quede abajo de todo (no tiene que borrar) y
   doble toque en «Eliminar» (no tiene que cambiar de sección). Ver también que
   la espera de 0,4 segundos de los botones no moleste.
3. **Señal débil de verdad** (cámara de frío, fondo del local): registrar un pago
   de prueba y mirar que el saldo de la lista cambie o aparezca la franja "Señal
   débil". Mirar cuánto tarda en irse cuando vuelve la señal.
4. **Base local del iPhone.** El caso del defecto 3 no se puede provocar a mano.
   Lo que sí se puede comprobar es el caso normal, con la app instalada: en modo
   avión cargar un cliente de prueba, cerrar la app del todo, sacar el modo
   avión, abrirla y ver que el cliente llegó. Ojo: en una ventana **privada** de
   Safari lo cargado sin señal se pierde al cerrar la pestaña y el sistema no
   tiene forma de saberlo; usar siempre la app instalada o Safari común.
5. **Tamaño de la copia y lecturas con la base real.** Sin tope, la copia ocupa
   toda la base. Después de una semana de uso, mirar en el iPhone del director
   Ajustes → General → Almacenamiento → Safari / Sersale, y en la consola de
   Firebase las lecturas por día.
6. **Dos pestañas en la computadora.** Con dos pestañas del sistema abiertas, una
   sola maneja la conexión para las dos. No probé la reconexión forzada del
   defecto 2 en ese caso: en la pestaña que no maneja la conexión debería
   aparecer la franja "Señal débil" hasta que la otra reconecte. A mano: abrir
   Pedidos en dos pestañas, cortar el wifi diez segundos, volver y registrar un
   pago de prueba en cada una; el saldo tiene que quedar bien en las dos.
7. **Actualización con la app instalada.** Publicar, abrir la app en el iPhone y
   ver que aparece "Hay una versión nueva del sistema — Actualizar" (o que entra
   sola si se acaba de abrir), y que después de actualizar abre sin señal.
8. **Aperturas lentas en las pruebas.** Más o menos una de cada cien pruebas, la
   página tarda más de 30 segundos en recibir los datos al abrir y la prueba
   falla por tiempo (al repetirla pasa). Ocurre igual con el código que recibí.
   Abriendo la página 90 veces seguidas, sin otras pruebas corriendo a la vez,
   no pasó nunca (tardó entre 0,6 y 1,1 segundos): parece del emulador de
   pruebas cuando atiende dos tandas a la vez, no del sistema. Igual conviene
   mirarlo en el teléfono: abrir Pedidos unas veinte veces con wifi y anotar si
   alguna vez queda "Cargando…" más de 10 segundos.

## Para corregir en otros archivos

1. **Todas las pantallas (`src/pedidos/*.jsx`, `src/produccion/app.jsx`,
   `dashboard.html`)**: cuando la copia vuelve a estar al día, `fb.js` avisa con
   el evento `sersale:datos` (`detail.alDia`, `detail.atrasado`). Hoy ninguna
   pantalla lo escucha: lo que quedó dibujado con datos viejos sigue así hasta
   que la persona toca ↻. Conviene que las listas con saldos y stock se vuelvan a
   leer cuando `atrasado` pasa a falso.
2. **Lecturas que deciden una escritura**: `getDocs` de `fb.js` puede responder
   con la copia guardada si el servidor no contesta (ahora con la franja de
   aviso). Donde de esa lectura depende qué se escribe, hay que pedir al servidor
   (`getDocsFromServer`) o leer dentro de la transacción, como ya hicieron las
   revisiones de Producción y de cuentas corrientes.
3. **`tests/arreglos-p8.test.mjs` contra `src/pedidos/07-alertas-hoja-ruta.jsx`**:
   la prueba "alertas: los días sin pedir se cuentan con el día argentino… y el
   límite a mano se valida" falla siempre, también con el código que recibí. El
   campo "Días" de un cliente con frecuencia automática ahora es de solo lectura
   (`P7CampoDias`, `readOnly={auto}`: al tocarlo avisa "se calcula solo"), y la
   prueba intenta escribirle "45". Son dos arreglos hechos por separado: hay que
   decidir cuál vale (creo que el código) y que la prueba toque el campo en vez
   de escribirlo.
4. **`tests/lib/harness.mjs` y las pruebas**: si la preparación de una prueba
   falla después de `launch()` y antes del `try`, el navegador queda abierto y la
   corrida no termina nunca (me pasó dos veces; parece colgada). En
   `tests/revision-infra.test.mjs` está `abrirCon()`, que cierra todo si la
   preparación falla; convendría llevarlo al arnés.
5. **`src/js/base.js`, `numero()`** (visto, sin caso real hoy): "0.250" lo toma
   como 250 (punto de miles). Hoy solo se usa para precios y para pegar importes,
   donde no molesta. Si algún día se usa para kilos, "0.250" tiene que ser un
   cuarto de kilo.
6. **`migracion.html`**: sigue publicada y guardada en el teléfono con el resto
   del sitio, y usa `alert`/`confirm`. Si la migración ya se hizo, sacarla.

## Para decidir con el dueño

1. **"Recordarme" viene tildado.** Si un director entra una vez desde el teléfono
   del depósito y no toca "Salir", ese teléfono queda con acceso de director por
   30 días. ¿Se deja tildado, o destildado por defecto?
2. **Cambiar la contraseña no cierra las sesiones recordadas.** Si se pierde un
   teléfono, hoy hay que **desactivar** al usuario (eso sí lo corta al abrir la
   app). ¿Hace falta que el cambio de contraseña también las cierre?
3. **"Guardado" con mala señal quiere decir "guardado en este teléfono".** El
   depósito no ve el pedido hasta que se envía (la franja azul "Enviando 1
   cambio…" lo indica). Si el teléfono se apaga o no se vuelve a abrir la app,
   no sale. ¿Alcanza con la franja, o los pedidos tienen que esperar siempre la
   confirmación del servidor?
4. **Copia sin tope de tamaño.** Para que sin señal nunca falten datos, el
   teléfono guarda toda la base (pueden ser cientos de MB con los años).
   Alternativa: bajar solo los últimos meses de pedidos y movimientos (es un
   cambio grande en todas las pantallas).
5. **El backup no incluye el catálogo de productos ni los usuarios**
   (`config/productos`, `config/contador_remitos`, `usuarios`). ¿Se agrega una
   hoja con el catálogo y el último número de remito?
6. **Seguridad** (ya anotado en otros informes): el control de acceso es solo del
   navegador. Las reglas de Firestore no están en el repositorio, así que no pude
   verlas; si están abiertas, cualquiera con la dirección del sitio puede leer y
   escribir la base.

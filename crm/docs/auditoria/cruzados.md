# Pedidos: lo que cada auditoría dejó anotado para otro archivo

Cada informe de esta carpeta tiene una sección "Pendiente en otros archivos". Acá
se revisaron todas las notas que apuntan a la página de Pedidos (archivos `00` a
`07` de `src/pedidos/` y `src/pedidos.html`), más lo que se vio roto en
`_recorrida.md`. El archivo `08` lo está trabajando otra persona: sus notas van
al final, sin tocar.

Resultado: **63 notas**. 40 ya estaban arregladas, 14 se arreglaron ahora, 5 no
eran un defecto y 4 quedan pendientes (3 esperan una decisión, 1 depende del
archivo `08`).

Pruebas nuevas: `tests/arreglos-cruzados.test.mjs` (13). Se corrieron primero
contra el código anterior: fallaban 12, cada una por el defecto que describe.

## Todas las notas

| # | Origen | Archivo | Qué decía | Resultado |
|---|---|---|---|---|
| 1 | cc | 02 | Eliminar cliente pregunta con `confirm()` y borra por nombre idéntico | ya estaba arreglado |
| 2 | cc | 02 | Nuevo Pedido busca la cuenta por nombre idéntico y no avisa si falla | ya estaba arreglado |
| 3 | cc | 02 | Nuevo Pedido recalcula el saldo con una regla propia; el "Pendiente de facturar" no queda atado al pedido | ya estaba arreglado |
| 4 | cc | 02 | `today()` toma el día de UTC | ya estaba arreglado |
| 5 | cc | 04 | El Depósito cambia el estado desde la copia que tiene en pantalla | ya estaba arreglado |
| 6 | cc | 04 | El historial de Comercial no recibe `onRemito` como dato | no era un defecto: el botón Remito le llega por otro camino y funciona |
| 7 | cc | 04 | El PDF del remito está dibujado dos veces (en 03 y en 04) | no era un defecto: es código repetido, los dos PDF salen bien |
| 8 | cc | 05 | Venta rápida: fecha de UTC, saldo por nombre idéntico y sin transacción | ya estaba arreglado |
| 9 | cc | pedidos.html | Faltan `writeBatch` y `getDocsFromServer` | ya estaba arreglado |
| 10 | dashboard | 03 | El remito se guarda con el día de UTC | ya estaba arreglado |
| 11 | dashboard | 05 | La venta rápida usa el día de UTC como fecha de entrega | ya estaba arreglado |
| 12 | _pendientes | 05 | Lo mismo que la 11 | ya estaba arreglado (la fila de `_pendientes-entre-archivos.md` se puede borrar) |
| 13 | p1 | 05 | Precios lee la lista de productos escrita en el código | ya estaba arreglado |
| 14 | p1 | 05 | Eliminar un precio borra solo el último renglón y pregunta con `confirm()` | no era un defecto: esa función no la usa ningún botón; la pregunta ya estaba cambiada |
| 15 | p1 | 02 | Cambiar el nombre de un cliente no cambia sus precios | ya estaba arreglado |
| 16 | p1 | 02 y 03 | Nueve clientes de demostración en los selectores | **arreglado ahora** (ver A) |
| 17 | p1 | 03 | Cada remito agrega un renglón de precio aunque el precio no cambie | queda pendiente: es una decisión de uso (ver "Para decidir", 5) |
| 18 | p2 | 03 | Editar Pedido descarta sin avisar las filas a medio cargar | **arreglado ahora** (ver B) |
| 19 | p2 | 03 | Editar Pedido mezcla los clientes de demostración y busca al cliente por nombre idéntico | **arreglado ahora** (ver A y C) |
| 20 | p2 | 03 | Editar Pedido ordena la lista compartida del catálogo | **arreglado ahora**: ordena una copia. No tenía efecto a la vista |
| 21 | p2 | 03 | Al cambiar el cliente de un pedido o cancelarlo, el "Pendiente de facturar" queda donde estaba | **arreglado ahora** (ver D y E) |
| 22 | p2 | 05 | Lo mismo que la 13 | ya estaba arreglado |
| 23 | p2 | 05 | Precios busca por nombre idéntico | ya estaba arreglado |
| 24 | p2 | 01 | Guardar en Productos no actualiza la lista que usa el resto | ya estaba arreglado |
| 25 | p2 | 01 | El historial de precios busca por nombre idéntico | **arreglado ahora** (ver F): estaba a medias |
| 26 | p2 | 06 | Abrir una cuenta desde "+ Nueva" no tilda la ficha del cliente | **arreglado ahora**, de otra forma (ver H) |
| 27 | p2 | 07 | El WhatsApp de recontacto dice "Invalid Date" | ya estaba arreglado |
| 28 | p2 | 07 | La hoja de ruta busca la dirección por nombre idéntico | ya estaba arreglado |
| 29 | p2 | pedidos.html | Lo mismo que la 9 | ya estaba arreglado |
| 30 | p4 | 03 | Comercial cambia el estado desde una copia vieja y sin transacción | ya estaba arreglado |
| 31 | p4 | 03 | El remito no guarda tipo ni fecha de entrega, y usa el día de UTC | ya estaba arreglado |
| 32 | p4 | 03 | Cancelar un pedido con un solo toque | ya estaba arreglado |
| 33 | p4 | 03 | «Despachado» con un solo toque | queda pendiente: es una decisión (ver "Para decidir", 6) |
| 34 | p4 | 03 | Las hojas de kg se cierran sin esperar a que se guarde | ya estaba arreglado |
| 35 | p4 | 03 | Campos de kg sin teclado numérico | ya estaba arreglado |
| 36 | p4 | 03 | "Invalid Date" en tarjetas de pedidos sin fecha | ya estaba arreglado |
| 37 | p4 | 03 | El PDF de un remito largo se sale de la hoja | ya estaba arreglado |
| 38 | p4 | pedidos.html | Faltan los colores `--fondo`, `--borde` y `--sombra` | ya estaba arreglado |
| 39 | p4 | 03 | El remito no guarda por separado la cantidad pedida y los kg | queda pendiente: cambia lo que se guarda y depende de cómo se cobran las piezas (ver "Para decidir", 7) |
| 40 | p5 | 02 | `marcarContacto` usa el día de UTC y busca al cliente sin mirar acentos | ya estaba arreglado |
| 41 | p5 | 02 | La lista de productos queda siempre con la del código | ya estaba arreglado |
| 42 | p5 | 01 | Si falla la lectura del catálogo, Productos muestra la lista del código y guardar la pisaría | ya estaba arreglado |
| 43 | p5 | 00 | La cuenta nueva se abre con un id al azar: dos teléfonos pueden abrir dos | **arreglado ahora** (ver G) |
| 44 | p7 | 02 | El mail de alertas dice "Invalid Date" | ya estaba arreglado |
| 45 | p7 | 02 | El control del mail diario usa el día de UTC | ya estaba arreglado |
| 46 | p7 | 02 | `marcarContacto` no avisa si no pudo guardar | queda pendiente: la parte de 02 está hecha (ahora devuelve si guardó o no); el aviso en pantalla es del archivo 08 |
| 47 | p7 | 05 | El WhatsApp de la lista de precios sale cortado | ya estaba arreglado |
| 48 | recorrida 5 | 07 | La hoja de ruta dice "31.6 piezas" | ya estaba arreglado ("Preparar hoy" es del 08) |
| 49 | recorrida 6 | 06 | Un saldo a favor se ve como "Al día", sin signo | ya estaba arreglado |
| 50 | recorrida 7 | 06 | "Clientes activos" nunca pasa de 8 | ya estaba arreglado |
| 51 | recorrida 9 | 02 y 03 | Lo mismo que la 16 | **arreglado ahora** (ver A) |
| 52 | recorrida 10 | 03 y 04 | Quedan renglones "+$0 Pendiente de facturar" de pedidos cancelados | **arreglado ahora** para lo que se cancele desde hoy (ver E). Los que ya quedaron no se borran solos |
| 53 | recorrida | 05 | Precios usa la lista del código | ya estaba arreglado |
| 54 | recorrida | 03, 05 y 06 | Fechas de remito, pago y venta rápida en UTC | ya estaba arreglado |
| 55 | recorrida | 04 | El remito guardado lee tipo y fecha de entrega que nadie escribía | ya estaba arreglado |
| 56 | revisión por tema | 03 | El remito busca los precios del cliente por nombre idéntico, y una fecha guardada de otra forma rompe la carga | **arreglado ahora** (ver F) |
| 57 | revisión por tema | 06 | Estadísticas cuenta dos veces a un cliente escrito de dos formas | **arreglado ahora** (ver I) |
| 58 | sale de la 21 | 03 | Cambiar el cliente de un pedido que ya tiene remito deja la deuda en la cuenta del cliente anterior | **arreglado ahora**: no deja cambiarlo (ver D) |
| 59 | sale de la 21 | 03 | Si se cambia la fecha de entrega, el cargo del remito queda con la fecha anterior | **arreglado ahora** (ver D) |
| 60 | revisión por tema | 04 | "Hoy" sale del reloj del teléfono | no era un defecto: no es el día de UTC; da bien mientras el teléfono esté en hora argentina |
| 61 | revisión por tema | 01 | Productos usa la lista del código | no era un defecto: solo como punto de partida cuando todavía no hay catálogo guardado |
| 62 | revisión por tema | 00 a 07 | `confirm()` y `prompt()` del navegador | ya estaba arreglado: no queda ninguno |
| 63 | revisión por tema | 05 y 07 | Links de WhatsApp y de Maps sin codificar | ya estaba arreglado |

## Qué se cambió

**A. Clientes de demostración (notas 16, 19 y 51).** "Nuevo Pedido" y "Editar
Pedido" ofrecían siempre nueve nombres escritos en el código (Supermercado Don
Juan, Carnicería El Gaucho, Rotisería La Porteña, Distribuidora Río de la Plata,
Restaurant El Fogón, Carnicería San Martín, Almacén Central, Distribuidora Norte
y Hotel Castelar). Nada más en el sistema dependía de esa lista: se sacó. Ahora
se ofrecen los clientes cargados en Clientes y "Otro". Si un pedido viejo está a
nombre de uno de esos nueve y el cliente no está en Clientes, al editarlo aparece
como "Otro" con el nombre escrito, igual que cualquier cliente sin ficha.
Prueba: "nuevo pedido y editar pedido: se ofrecen solo los clientes cargados…".

**B. Editar Pedido: filas a medio cargar (nota 18).** Se abre un pedido de
Almacén Doña Rosa, se agrega Queso Tybo con el buscador y se guarda sin poner la
cantidad: el pedido se guardaba sin el queso y sin avisar. Ahora frena con "Al
ítem 4 (Queso Tybo) le falta la cantidad" (y no acepta cantidad 0), como ya hacía
Nuevo Pedido. Prueba: "editar pedido: una fila a medio cargar…".

**C. Editar Pedido: el cliente escrito de otra forma (nota 19).** Un pedido a
nombre de "FIAMBRERIA DON ANGEL" abría con el cliente en "Otro" aunque
Fiambrería Don Ángel estuviera en la lista. Ahora queda elegido el cliente de la
ficha y al guardar el pedido toma ese nombre. Si se escribe a mano el nombre de
un cliente que ya existe, también se usa el de la ficha.
Prueba: "editar pedido: reconoce al cliente aunque…".

**D. Editar Pedido y la cuenta corriente (notas 21, 58 y 59).**
- Pasar un pedido de Fiambrería Don Ángel a Carnicería El Trébol dejaba el
  "Pendiente de facturar" de $0 en la cuenta de Don Ángel para siempre. Ahora
  sale de esa cuenta y, si El Trébol tiene cuenta, se anota en la suya. Ningún
  saldo cambia. Prueba: "editar pedido: al pasarlo a otro cliente…".
- Si el pedido ya tiene remito, el cargo ya está en la cuenta del cliente
  anterior. Cambiar el cliente dejaba el remito a un nombre y la deuda a otro (y
  al volver a guardar el remito, el cliente nuevo no quedaba cargado o el
  anterior quedaba cargado igual). Ahora no deja: "Este pedido ya tiene el
  Remito N° 0040 a nombre de …: no se puede pasar a otro cliente".
  Prueba: "pedido con remito: no se puede pasar a otro cliente…".
- Pedido para el 10/11 que se pasa al 12/11: el remito dejaba el cargo con fecha
  10/11. Ahora el cargo toma la fecha de entrega que el pedido tiene al hacer el
  remito. Prueba: "remito: si al pedido le cambiaron la fecha de entrega…".

**E. Cancelar un pedido (notas 21 y 52).** Al cancelar un pedido sin remito
(desde Comercial o desde el Depósito) su "Pendiente de facturar" de $0 sale de
la cuenta corriente. Solo el de ese pedido; los saldos no se tocan. Si el pedido
ya tiene remito, el cargo queda como estaba (ver "Para decidir", 3).
Pruebas: "cancelar un pedido sin remito…" y "cancelar desde el Depósito…".

**F. Precios del cliente escritos de otra forma (notas 25 y 56).** La pestaña
Precios ya juntaba los precios de un cliente sin mirar mayúsculas ni acentos. El
remito y el historial de precios (Clientes → 📈) lo hacían solo si no encontraban
ninguno con el nombre idéntico. Ejemplo: Distribuidora Mayorista del Sur tiene
sus precios y, además, un precio más nuevo guardado como "DISTRIBUIDORA MAYORISTA
DEL SUR S.R.L.": el remito proponía el precio viejo y lo cargaba a la cuenta.
Ahora las tres pantallas usan la misma regla. El remito y el historial muestran
enseguida los precios del nombre idéntico (como antes) y completan con el resto
apenas el teléfono tiene la lista entera. Además, un precio con la fecha guardada
en otro formato hacía que el remito abriera sin ningún precio; ya no.
Prueba: "remito e historial de precios: vale el último precio…".

**G. Cuenta corriente nueva desde dos teléfonos (nota 43).** Dos personas le
cargan una venta rápida a la vez a Fiambrería La Ñata, que no tiene cuenta:
quedaban dos cuentas, cada una con una parte de la deuda. Lo mismo con un remito
y una venta rápida a la vez. Ahora la cuenta nueva se abre siempre con el mismo id
(`cta_<nombre>`, el que ya usaba "+ Nueva"): el segundo teléfono la encuentra y
suma su venta. Las cuentas que ya existen no cambian. Si ese id está ocupado por
una cuenta fusionada o de otro cliente, se abre con otro id.
Pruebas: "cuenta nueva: dos teléfonos…" y "cuenta nueva: si el id fijo está ocupado…".

**H. Marca "Cta Cte" en Clientes (nota 26).** Las cuentas abiertas desde Cuentas
Corrientes, un remito o una venta rápida no tildaban la ficha, y en Clientes el
cliente aparecía sin la marca. En vez de tildar la ficha en cada lugar (y dejar
afuera las cuentas ya abiertas), la lista de Clientes muestra la marca si el
cliente tiene cuenta abierta o si la ficha está tildada. Al editar la ficha el
tilde ya viene puesto. Prueba: "clientes: la marca «Cta Cte»…".

**I. Estadísticas (nota 57).** "Clientes activos" y "Clientes más frecuentes"
contaban dos veces a un cliente escrito con otras mayúsculas o sin acentos.
Prueba: "estadísticas: un cliente escrito con otras mayúsculas…".

No se cambió ningún formato guardado. Lo único nuevo es el id de las cuentas que
se abran desde ahora.

## Para decidir con el dueño

1. **Clientes de demostración.** Se sacaron los nueve nombres. Si alguno era un
   cliente real, hay que cargarlo en Clientes.
2. **"Pendiente de facturar" de pedidos ya cancelados.** Desde ahora se borra al
   cancelar. Los que quedaron de antes (en los datos de ejemplo, Fiambres y
   Quesos San Cayetano, 31/10) siguen ahí. ¿Se limpian una vez, a mano?
3. **Cancelar un pedido que ya tiene remito.** El cargo queda en la cuenta, como
   antes. ¿Se anula el cargo, se hace una nota de crédito, o no se deja cancelar?
4. **Remito hecho a nombre del cliente equivocado.** Ahora no se puede cambiar el
   cliente de un pedido con remito. ¿Hace falta poder pasar el remito y su cargo
   a otro cliente, o anular un remito?
5. **Historial de precios.** Cada remito guarda un renglón por producto aunque el
   precio sea el mismo. ¿Se guarda solo cuando cambia?
6. **«Despachado» con un toque.** Se hace muchas veces por día y no tiene vuelta
   atrás. ¿Confirmación?
7. **Piezas, ganchos, bolsas y unidades sin pesar.** El remito las multiplica por
   el precio por kilo. ¿Se cobran por kilo o por unidad?
8. **Cuentas repetidas que ya existan.** Si por el defecto G algún cliente quedó
   con dos cuentas, hay que juntarlas con `migracion.html`.
9. **Tilde "Tiene cuenta corriente" en la ficha.** Hoy no abre ni cierra cuentas:
   solo propone el tilde en el pedido. ¿Tiene que abrir la cuenta?

## Para quien tome el archivo 08 y los archivos compartidos

No se verificaron: son las notas tal como quedaron en los informes.

- `08`, Devoluciones (cc, p7): el crédito se resta del saldo leído, por nombre
  idéntico y con fecha de UTC; el link de WhatsApp va sin codificar.
- `08`, alertas (cc, p2, p4, p5, p7): nombres y fechas a mano; `diasAlerta` se
  pisa en cada carga; `actualizarDiasAlerta` y `marcarComoContactado` no avisan
  si fallan (`marcarContacto` ahora devuelve `true`/`false`); para no repetir una
  venta conviene mirar `pedidoId` antes que nombre y fecha.
- `08`, pantalla (cc, p4, p7, recorrida 1, 5 y 8): la marca NUEVO nunca aparece;
  "Preparar hoy" suma kg con la unidad del pedido; el botón ⚡ tapa la hoja de
  ruta; Devoluciones es más ancha que el teléfono; Alertas queda en "Cargando..."
  si falla la lectura.
- `js/fb.js`, `dashboard.html`, `migracion.html`, `backup.html`, `js/shell.js`,
  `tests/lib/seed.mjs` y seguridad: ver cada informe.
- `_pendientes-entre-archivos.md`: la fila de `05-venta-rapida-precios.jsx` ya
  está resuelta.
- Pruebas: con la máquina muy cargada (tres corridas completas a la vez) algunas
  páginas tardaron más de 45 segundos en recibir los datos del emulador y la
  prueba se cortó por tiempo. En `arreglos-p5` y `arreglos-p7`, cuando eso pasa
  dentro de la función que abre la página, el archivo de pruebas no termina
  nunca y la corrida completa queda esperando: conviene que esas funciones
  cierren el navegador si fallan (en `arreglos-cruzados` ya lo hacen).

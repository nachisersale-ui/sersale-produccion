# Auditoría de Producción (produccion.html)

Archivos tocados: `src/produccion/app.jsx` y `src/produccion.html` (solo para
exponer `runTransaction`). Pruebas: `tests/arreglos-produccion.test.mjs`
(13 pruebas; las 13 fallan con el código anterior y pasan con el nuevo).
Candidatos revisados: los de `mapas/produccion-1.json` y `mapas/produccion-2.json`.

Los formatos guardados no cambian. Único campo nuevo, opcional: `updatedAt` en
`faenas` cuando se edita un registro.

Cambio de comportamiento para tener presente: todo lo que mueve stock (enviar un
reporte, registrar una salida, los botones + y −, corregir o eliminar un reporte)
ahora se guarda en una sola operación contra el servidor. Sin señal no se guarda:
avisa "Sin conexión…" y deja lo escrito en pantalla para reintentar. Ver la
pregunta 2 al final.

## Arreglado

### Severidad alta

**1. Botones + y − del stock: se perdían toques y se pisaba lo que cargaba otro teléfono**
- Qué pasaba: cada toque guardaba "lo que dice la pantalla ± 1". Panceta Ahumada
  en 40, tres toques rápidos en −: quedaba en 39, no en 37. Peor: pantalla abierta
  desde la mañana con 40, un reporte suma 30 (real: 70), un toque en − guardaba 39
  y desaparecían 30 piezas.
- Qué se cambió: cada toque suma o resta 1 sobre la cantidad que hay en el
  servidor en ese momento (transacción), y los toques seguidos se aplican de a uno
  y en orden. Si falla, avisa y el número no cambia.
- Prueba: "stock: tres toques seguidos en − descuentan tres, y un toque no pisa lo
  que cargó otro teléfono".

**2. Corregir o eliminar un reporte no tocaba el stock ni su movimiento**
- Qué pasaba: un encargado carga "Salame Tipo Milán 200 piezas" queriendo poner
  20. El stock sube 200. El director lo corrige a 20 (o lo elimina): Reportes
  muestra 20, pero Stock sigue con las 180 de más y Movimientos conserva "ENTRADA
  +200".
- Qué se cambió: al guardar la corrección se compara, producto por producto, lo
  cargado en piezas antes y ahora, y la diferencia se aplica al stock en la misma
  operación; el movimiento queda con la cantidad nueva. Al eliminar, se descuenta
  lo que el reporte había sumado y se borran sus movimientos. El cartel de
  confirmación lo avisa y al terminar se muestra qué se corrigió ("Stock
  corregido: Salame Tipo Milán −180"). Tocar solo el nombre del encargado o las
  observaciones no mueve stock. Una línea que nunca había sumado (el producto no
  estaba en Stock cuando se envió) no se toca y se avisa.
- Pruebas: "reporte de las 22:30: suma al stock una sola vez…" y "corregir un
  reporte: tocar el nombre no mueve stock…".
- Límite: los reportes corregidos antes de este arreglo no se recalculan solos
  (pregunta 8).

**3. El PDF y el Excel salían vacíos si no se habían abierto Stock, Faena y Lotes**
- Qué pasaba: entrar al panel (pestaña Reportes), tocar 📄 y PDF: el archivo traía
  solo el encabezado; el Excel, solo la línea `sep=;`. Sin aviso.
- Qué se cambió: al exportar se traen de la base las secciones tildadas, se hayan
  abierto o no, y el botón muestra "Generando…". Una sección sin datos dice "Sin
  registros". Además el stock se carga al entrar al panel, así el número rojo de
  stock bajo en la pestaña Stock aparece de entrada (antes, recién al abrirla).
- Prueba: "exportar sin haber abierto Stock, Faena ni Lotes…".

### Severidad media

**4. Enviar un reporte no era una sola operación (y dos toques mandaban dos reportes)**
- Qué pasaba: se guardaba el reporte, después el stock, después el movimiento. Si
  algo fallaba en el medio decía "Error al enviar" con el reporte ya guardado, y
  al reintentar quedaba duplicado y el stock sumado dos veces. Dos toques rápidos
  en "Enviar reporte" creaban dos reportes (verificado con el código anterior).
  Dos teléfonos cargando el mismo producto a la vez: uno pisaba al otro.
- Qué se cambió: reporte, stock y movimientos se guardan juntos en una
  transacción (todo o nada) y el botón no acepta un segundo toque mientras envía.
- Pruebas: "reporte de las 22:30…" (doble toque) y "sin señal: se avisa, no se
  guarda nada a medias…".

**5. Salida de stock: con un nombre mal escrito descontaba las otras líneas, cerraba el formulario y pedía cargar todo de nuevo**
- Qué pasaba: salida de 4 productos, uno escrito distinto que en Stock. Se
  descontaban 3, aparecía "volvé a registrar la salida", se cerraba y se perdía lo
  escrito. Al cargarla de nuevo, esos 3 se descontaban otra vez.
- Qué se cambió: primero se revisan todas las líneas; si alguna no figura no se
  descuenta nada, el formulario queda abierto y el cartel dice cuáles corregir.
  Stock y movimientos se guardan juntos.
- Prueba: "salida: si un nombre no figura no se descuenta nada…".

**6. Salida: el nombre tenía que estar idéntico, letra por letra**
- Qué pasaba: "Morcilla Vasca " (con el espacio que agrega el teclado del iPhone)
  o "panceta ahumada" en minúsculas: "no figura en Stock".
- Qué se cambió: se compara sin mirar mayúsculas, acentos ni espacios de más, y
  el campo sugiere los nombres cargados en Stock mientras se escribe. Lo mismo
  vale para los reportes de producción que suman al stock.
- Prueba: la misma de 5.

**7. Salida: la unidad elegida no se tenía en cuenta**
- Qué pasaba: Morcilla Criolla se lleva en kg. Salida de 10 con la unidad
  "piezas" (la que viene puesta): bajaba 10 kg y el movimiento decía "−10 piezas".
- Qué se cambió: al completar el nombre, la unidad pasa sola a la del ítem. Si se
  la cambia a mano por otra, no registra y avisa "en Stock se lleva en kg".
- Prueba: "salida: no deja descontar piezas de un ítem que se lleva en kg…".

**8. El WhatsApp de stock bajo se repetía y llegaba con "%0A" escrito**
- Qué pasaba: cada salida, de cualquier producto, reenviaba la lista completa de
  ítems bajos; cada toque en − de un ítem que ya estaba bajo mandaba otro mensaje.
  Los saltos de línea se codificaban dos veces y llegaban como "%0A" en el texto;
  el teléfono y la clave iban sin codificar.
- Qué se cambió: avisa solo por los productos que esa operación deja en el mínimo
  o por debajo (antes arriba, ahora abajo). Texto con saltos de línea reales,
  todo codificado una sola vez.
- Prueba: "stock: el WhatsApp de stock bajo sale una vez…" y las dos de salida.

**9. Editar un ítem de stock volvía a escribir la cantidad vieja**
- Qué pasaba: pantalla abierta con "Panceta 40"; durante el día se cargan 20 más
  (real: 60). El director entra a Editar solo para subir el mínimo y guarda: la
  cantidad volvía a 40.
- Qué se cambió: si en el formulario no se tocó la cantidad, no se reescribe. Al
  abrir Editar se trae la cantidad al día.
- Prueba: "stock: cambiar solo el mínimo de un ítem no pisa la cantidad…".

**10. Después de las 21:00 todo aparecía con fecha de mañana**
- Qué pasaba (10/11 a las 22:30): el filtro de Reportes arrancaba en 11/11 y decía
  "No hay reportes"; el movimiento de stock de un reporte quedaba con fecha 11/11;
  Salida y Faena proponían 11/11; un lote que vencía el 10/11 figuraba "vencido
  hace 1d"; el PDF se llamaba `…2026-11-11.pdf`.
- Qué se cambió: todas las fechas salen de `SersaleBase` (hora de Buenos Aires).
- Pruebas (todas con el reloj en 22:30): "reporte de las 22:30…", "salida: si un
  nombre no figura…", "faena…", "lotes…" y "exportar…".

**11. El cartel de WhatsApp se cerraba solo y perdía lo escrito**
- Qué pasaba: el componente estaba declarado dentro del panel, así que cada cambio
  en la pantalla (un toque en +, cada tecla en "Nuevo ítem") lo destruía y lo
  volvía a crear: se cerraba el panel de configuración a medio completar, la lista
  saltaba y se hacía una lectura a la base por cada tecla.
- Qué se cambió: se movió afuera del panel. Se carga una vez.
- Prueba: "stock: el panel de WhatsApp no se cierra ni pierde lo escrito…".

**12. Faena: el peso promedio no acompañaba a las cabezas**
- Qué pasaba: 10 cabezas, 1.000 kg, promedio 100. Se corrige a 12 cabezas y se
  guarda: quedaba promedio 100 (son 83,3), y así salía en la tarjeta y el PDF.
- Qué se cambió: el promedio se recalcula al cambiar cabezas o peso total.
- Prueba: "faena: el promedio acompaña a las cabezas…".

**13. Lotes: el vencimiento propuesto no seguía a la fecha de elaboración**
- Qué pasaba: se elige el 3 por error (vencimiento 03/12) y se corrige al 5: el
  vencimiento quedaba en 03/12 y así se guardaba. Borrar la fecha de elaboración
  tiraba un error y el campo no se podía vaciar.
- Qué se cambió: el vencimiento (elaboración + 30 días) acompaña a la fecha
  mientras no se haya escrito uno a mano. "Nuevo lote" propone la fecha de hoy. No
  deja guardar un vencimiento anterior a la elaboración.
- Prueba: "lotes: el vencimiento sigue a la fecha de elaboración…".

**14. PDF: títulos ilegibles, faena de todos los meses y nombres encimados**
- Qué pasaba: los títulos de sección llevaban emoji y salían como "Ø=Üæ S T O C
  K…". El bloque "FAENA — 2026-11" listaba todas las faenas de la historia. En
  lotes, un nombre de más de 27 letras se imprimía encima de la cantidad.
- Qué se cambió: títulos sin emoji; la faena se filtra por el mes elegido en la
  pestaña Faena; cada celda se corta al ancho de su columna y la de producto es
  más ancha.
- Prueba: "exportar…" (lee el PDF generado).

**15. Excel (CSV): un ";" en una observación corría las columnas; números con punto**
- Qué pasaba: observación "tropa 4512; frigorífico La Pampa" → una columna de más
  desde ahí. Un texto que empieza con "=" quedaba como fórmula. Stock y faena
  salían con punto decimal ("62.5") y lotes con coma.
- Qué se cambió: los textos van entre comillas cuando hace falta y con apóstrofo
  si empiezan con = + − @; todos los números con coma decimal y sin punto de miles.
- Prueba: "exportar…".

**16. La pestaña Reportes del director quedaba más ancha que el teléfono** (no estaba en los mapas; figura en `_recorrida.md`, punto 2)
- Qué pasaba: la fila de fecha + área + ↻ medía 486 px en una pantalla de 390, y
  el teléfono achicaba toda la página.
- Qué se cambió: esos dos campos ahora pueden achicarse. Medidas todas las
  pantallas y formularios de Producción: 390 px.
- Prueba: "reporte de las 22:30…" (comprueba el ancho).

**17. Un error al cargar se mostraba como "no hay datos"**
- Qué pasaba: si fallaba la lectura, Stock decía "No hay ítems de stock" con el
  botón "+ Agregar primero".
- Qué se cambió: avisa "No se pudo cargar…" y deja en pantalla lo que ya había.
- Sin prueba automática. Arreglo parcial: ver Pendiente 2.

### Severidad baja

18. **Salida mayor que el stock**: bajaba a 0 sin decir nada. Ahora pregunta
    ("hay 3 unidades y salen 5") antes de registrar. Prueba: la de 7.
19. **Filas a medio completar**: una fila con producto y sin cantidad se
    descartaba en silencio; se aceptaban cantidades negativas (−5 piezas restaba
    stock como "entrada"). Ahora frena y dice qué fila falta. "Otro" ya no dispara
    el aviso de stock. Prueba: "reporte: al cambiar de área…".
20. **Cambiar de área arrastraba productos**: Jamón elegido en Cocidos viajaba
    escondido en un reporte de Secos. Ahora se limpia. Misma prueba.
21. **Editar una faena le cambiaba la fecha de carga** (`createdAt`). Ya no; una
    faena nueva queda ordenada por su fecha. Prueba: la de 12.
22. **Dos ítems de stock con el mismo nombre**: no deja crear ni renombrar a un
    nombre que ya existe. Prueba: la de 9.
23. **Número de lote**: se calculaba contando los lotes del día (se repetía si
    faltaba uno). Ahora es el más alto + 1. Prueba: la de 13. Ver Pendiente 1.
24. **Decimales**: 3,3 − 1,1 guardaba 2,1999999999999997. Se redondea a 3
    decimales al guardar.
25. **Cambiar rápido de fecha y de área** podía dejar la lista del filtro anterior.
26. **Sin fecha en el filtro**: "Resumen del día" sumaba toda la historia y las
    tarjetas mostraban solo la hora. Ahora dice "Resumen de todas las fechas" y
    cada tarjeta lleva su fecha.
27. **Un reporte con un área que ya no existe** dejaba el panel en blanco. Ahora
    se muestra igual.
28. **Carteles vacíos**: filtrar por una categoría sin ítems decía "No hay ítems
    de stock"; un mes sin faenas quedaba en blanco.
29. **Descarga del Excel en iPhone**: el enlace se liberaba apenas se tocaba.
    Ahora se espera un minuto. No se probó en un iPhone real.

### Mejoras mecánicas en lo tocado

- `confirm()` y `alert()` del navegador → `SersaleUI.confirmar`, `toast` y `aviso`.
  Las confirmaciones de borrado dicen qué se borra.
- Todos los botones que guardan o eliminan se bloquean mientras trabajan
  (`SersaleBase.useAccion`).
- Aviso de "guardado" en ítem de stock, faena, lote, salida y configuración.
- Campos de cantidad con teclado numérico (`inputMode`).

## Descartado

- "El borrador del lote sobrevive a cerrar el formulario" (parte de 2.b7): se
  deja a propósito; protege de un toque afuera del formulario.
- "Scripts de terceros sin integridad" (1.s4, 2.s3) y "JSX compilado en el
  navegador" (1.p0, 2.p2, 1.u11): ya no aplican; el build compila y sirve las
  librerías desde el propio sitio.
- "Sin inyección en el DOM" (2.s4): no es un defecto.
- "Excel ignora el BOM cuando hay `sep=`" y "Numbers muestra `sep=;` como fila"
  (parte de 2.b13): el revisor no lo probó y acá no se pudo reproducir; no se toca.
- "Sesión en sessionStorage" (1.u0): la sesión la maneja `js/sesion.js`, fuera
  de estos archivos; no se verificó acá.
- "Recarga completa al tocar la barra inferior" (2.u12): es de `shell.js`, no de
  esta página.
- "Se recalcula todo en cada tecla" (1.p9, 2.p4): con 15 ítems y 30 reportes no
  se nota; no justifica reescribir el componente.

## Pendiente

1. **Dos personas registrando un lote del mismo día en el mismo instante** pueden
   recibir el mismo número (1.b15). Hace falta un contador por día en la base.
   Poco probable: los lotes los carga una persona.
2. **Teléfono sin señal y sin datos guardados**: las listas se ven vacías en vez
   de decir "sin conexión" (resto de 1.b10/2.b10). Requiere un estado por lista.
3. **Guardar sin señal un ítem de stock, una faena, un lote o la configuración**:
   el botón queda en "Guardando…" hasta que vuelve la señal (el dato queda en el
   teléfono y se envía solo). Es igual en todo el CRM (1.u2).
4. **Movimientos trae la colección entera** (67 hoy, crece siempre): falta
   paginar o filtrar por fecha (1.p2, 2.p1).
5. **Botones de menos de 44 px y campos con letra de 13–14 px** (1.u6, 1.u13,
   2.u4, 2.u5): es rediseño, no se tocó.
6. **Un toque afuera del formulario** de salida, stock o faena lo cierra y pierde
   lo escrito (2.u6). "Volver" en Editar reporte descarta sin preguntar (1.u12).
7. **El encargado escribe su nombre en cada tanda** (1.u1) y el director cae
   siempre en la vista del encargado (1.u8, 2.u1). Ver pregunta 7.
8. **El botón dice "Excel" y baja un CSV** (2.u11).
9. **La configuración de WhatsApp no valida ni permite probar** (1.u17).
10. **Las pantallas no se actualizan solas** si otro teléfono carga algo (1.u9);
    hay que tocar ↻ o cambiar de pestaña. Los arreglos 1, 4, 5 y 9 evitan que eso
    rompa el stock, pero el número en pantalla puede estar viejo.

## Pendiente en otros archivos

1. **`src/js/shell.js` (`hoja`)**: un doble toque sobre un botón que abre una
   confirmación la abre y la cierra en el acto, porque el segundo toque cae en el
   fondo y vale como "Cancelar". Reproducido con doble toque en 🗑️ de un ítem de
   stock: no queda ninguna hoja abierta. No borra nada, pero parece que el botón
   no anda. Cambio: ignorar los toques en el fondo (`fondo.addEventListener("click", …)`)
   durante los primeros 350 ms desde que se abre la hoja.
2. **`tests/lib/seed.mjs`, función `reporte()`**: el movimiento de stock usa
   `fecha: hoyUTC()`, que copiaba el defecto viejo. Ahora la página guarda
   `SersaleBase.hoy()` (día de Buenos Aires). Cambiar a la fecha local del evento.
   Con los datos actuales (todo antes de las 21:00) el resultado es el mismo.
3. **Reglas de Firestore / inicio de sesión** (1.s0, 1.s1, 2.s0): el acceso se
   decide con un dato en `sessionStorage` y Firestore no usa autenticación, así
   que las reglas no pueden distinguir un director de cualquier otro. No se
   arregla desde esta página.
4. **Clave de CallMeBot** (1.s2, 2.s1): está en `config/whatsapp`, legible desde
   cualquier teléfono con el CRM, y viaja en la dirección del pedido. Para
   esconderla el envío tiene que salir de una función del servidor (Netlify).

## Para decidir con el dueño

1. **Qué unidades suman al stock.** Hoy un reporte suma solo las filas cargadas
   en "piezas", y las suma aunque el ítem se lleve en kg (30 piezas de Chorizo
   convierten 13 kg en "43 kg"); una fila en kg o en ganchos no suma nunca
   (Salamín se lleva en ganchos: los reportes no lo mueven). ¿Tiene que sumar
   cuando la unidad del reporte coincide con la del ítem?
2. **Cargar sin señal.** Reportes, salidas y ajustes de stock ahora necesitan
   conexión (avisan y no pierden lo escrito). ¿Hay señal donde se cargan, o hace
   falta poder cargar sin señal y que se envíe después?
3. **"Lotes activos" en el PDF/Excel**: hoy salen todos los lotes. ¿Solo los no
   vencidos, o los del mes?
4. **Salida mayor que el stock**: hoy se permite con aviso y el stock queda en 0.
   ¿Se bloquea?
5. **Ajustes a mano** (+, −, y cambiar la cantidad en Editar): no quedan en
   Movimientos ni dicen quién los hizo. ¿Tienen que quedar registrados?
6. **Eliminar un ítem de stock** deja sus movimientos sin ítem. ¿Se impide
   eliminarlo si tiene movimientos, o se borran con él?
7. **Vencimiento a 30 días para todos los lotes**: ¿corresponde uno por tipo de
   producto (frescos, cocidos, secos)?
8. **Reportes corregidos antes de este arreglo**: el stock no se ajustó en su
   momento. ¿Se hace un recuento para dejarlo al día?
9. **Quién puede entrar al panel del director en Producción**: cualquier sesión
   que abre la página puede editar y eliminar; no hay PIN ni registro de quién.
   ¿El director debería entrar directo al panel y el resto no verlo?

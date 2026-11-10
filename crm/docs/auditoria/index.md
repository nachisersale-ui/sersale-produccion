# Ingreso, panel, usuarios (index.html) y backup (backup.html): arreglos

Archivos tocados: `src/index.html` y `src/backup.html`. Pruebas: `tests/arreglos-index.test.mjs` (10 pruebas; pasan junto con `smoke.test.mjs`).

Nadie había revisado estos archivos antes: los defectos salen de leerlos enteros. Los críticos, altos y medios se reprodujeron primero en la versión anterior con la página real (el resultado está en cada punto), y las pruebas se corrieron contra esa versión para confirmar que fallaban.

No cambia ningún formato guardado. La colección `usuarios` sigue igual (`usuario`, `passwordHash`, `nombre`, `activo`, `creado`) y la sesión recordada en el teléfono también. El backup solo lee.

Usuarios de los ejemplos: los de la base de ejemplo de las pruebas (nacho, romina y claudio, que está desactivado). Hoy = martes 10/11/2026.

## Arreglado

### 1. Con mala señal, el ingreso creaba un Director nuevo o le cambiaba la clave a uno existente — crítica
- **Qué pasaba:** si la lista de usuarios venía vacía, el ingreso entendía "base recién instalada" y creaba el primer Director con lo que se hubiera escrito. Pero en un teléfono sin datos guardados (nuevo, o al que se le borraron los datos del sitio) y con señal floja, la lista viene vacía porque el servidor no contestó. Reproducido: escribir `nacho` con la clave mal → queda en "Creando primer usuario Director..." → cuando vuelve la señal entra al panel y **la clave de nacho queda reemplazada por la mal escrita** (la de siempre deja de andar). Con un usuario inventado (`intruso` / `clave1234`) queda creado un Director nuevo con acceso a todo.
- **Qué se cambió:** una lista vacía solo se acepta si la contestó el servidor. Si no hay respuesta: "Sin conexión con el servidor. Probá de nuevo cuando haya señal", sin crear ni tocar nada, y el formulario queda como estaba. De paso, el primer usuario de una base vacía tiene que tener un nombre válido (minúsculas, números, `_ . -`) y clave de 4 o más, igual que los demás.
- **Pruebas:** "ingreso con mala señal en un teléfono sin datos guardados: no crea ni pisa un Director" y "base sin usuarios: el primer ingreso crea al primer Director (y solo con un usuario válido)".

### 2. Sin señal, el backup descargaba un Excel vacío y decía "Backup generado" — alta
- **Qué pasaba:** esta página no guarda copia en el teléfono; si el servidor no contesta, la lectura devuelve listas vacías en vez de un error. Reproducido: con el servidor cortado se descargó `Backup_CRM_Sersale_….xlsx` con 0 pedidos y 0 movimientos de cuenta corriente, con el cartel "✅ Backup generado". Es la nota que dejó Ventas en `_pendientes-entre-archivos.md`.
- **Qué se cambió:** todo se lee del servidor (`get({ source: "server" })`) y antes de armar el archivo. Si algo no se pudo leer: "No se pudo leer la base. No se generó ningún archivo: probá de nuevo cuando haya señal", y no se descarga nada. Sin conexión avisa en el momento. Cada intento vuelve a probar la conexión de cero, así apenas vuelve la señal funciona.
- **Prueba:** "backup sin señal: avisa y no descarga un Excel vacío; cuando vuelve la señal se genera completo".

### 3. El backup salteaba una hoja entera sin avisar — alta
- **Qué pasaba:** cada hoja estaba envuelta en un `catch` vacío. Si una colección fallaba al leerse, o un solo registro tenía un formato inesperado, esa hoja no se generaba y el cartel igual decía "Backup generado". Reproducido: un remito con un ítem vacío → el Excel sale **sin la hoja Remitos** (los otros 39 remitos también quedan afuera) y el Resumen dice "Remitos: 0".
- **Qué se cambió:** un error de lectura corta el backup con aviso (punto 2). Un registro que no se puede convertir ya no tira la hoja: queda su fila con "⚠ No se pudo leer este registro" y al terminar se avisa cuántos hubo ("1 registro con formato inesperado: figuran con ⚠ en su hoja"). Las listas que no son listas y las fechas guardadas como Timestamp se toleran.
- **Prueba:** "backup a las 22:30: archivo y fechas con el día de Buenos Aires, todas las colecciones, y un registro raro no deja una hoja afuera".

### 4. Desactivar o eliminar un usuario no le cortaba el acceso — alta
- **Qué pasaba:** con "Recordarme" la sesión queda guardada 30 días en el teléfono y nadie la volvía a controlar. Reproducido: Romina entra con "Recordarme"; otro director la desactiva; Romina cierra y abre la app y sigue en el panel con acceso a todo. Lo mismo si se la elimina.
- **Qué se cambió:** al abrir el inicio (y al volver a la app) se controla la sesión contra la lista de usuarios. Si el usuario está desactivado o ya no existe, se cierra la sesión, se olvida la recordada y se avisa ("Tu usuario fue desactivado. Pedile a otro director que lo active"). Sin señal, o si todavía no hay usuarios cargados, no se cierra nada. La app instalada arranca por el inicio, así que el corte llega la próxima vez que la abre o que pasa por Inicio. Límite: ver "Pendiente en otros archivos" 1.
- **Pruebas:** "un director desactivado desde otro teléfono pierde la sesión recordada al volver a abrir la app" y "una sesión de un usuario que fue eliminado se cierra; la de un usuario activo sigue".

### 5. Usuarios: después de "Volver" o de crear un usuario, "Nuevo Director" dejaba de responder — media
- **Qué pasaba:** "Volver", la × del formulario y "Crear usuario" abrían una ventana nueva encima de la anterior sin sacarla. Los botones buscaban "la ventana de usuarios" y encontraban la de abajo, tapada. Reproducido: Usuarios → Nuevo Director → Volver → Nuevo Director: no pasa nada (el formulario se abre en la ventana tapada). Para crear un segundo usuario había que cerrar todo y volver a entrar, y "Cerrar" había que tocarlo una vez por cada ventana apilada.
- **Qué se cambió:** siempre hay una sola ventana: al volver a la lista se saca la anterior.
- **Prueba:** "usuarios: «Nuevo Director» sigue andando después de «Volver», se crean dos seguidos y queda una sola ventana".

### 6. Usuarios: cambiar clave, desactivar y eliminar apuntaban al documento equivocado — media
- **Qué pasaba:** los botones 🔑 🚫 🗑️ buscaban el documento por el nombre de usuario, pero el ingreso acepta usuarios cuyo documento tiene otro id (o el nombre con mayúsculas). Reproducido con un usuario `Fernando` guardado con id `usr_viejo_01`: 🔑 da "Error al actualizar" y la clave no cambia; 🗑️ pregunta, no borra nada y **no avisa**. Además el nombre iba pegado dentro de un `onclick`: con una comilla (`o'brien`) el botón directamente no hacía nada (error de sintaxis en la consola).
- **Qué se cambió:** los botones llevan el id real del documento como dato y un solo manejador los atiende; no se arma más código con nombres adentro. Si la operación falla, se avisa.
- **Prueba:** "usuarios: cambiar clave, desactivar y eliminar actúan sobre el documento correcto (id distinto del usuario, nombres con comilla)".

### 7. Backup con fechas del día siguiente después de las 21 hs — media
- **Qué pasaba:** el nombre del archivo y la columna "Fecha Pedido" se armaban con el día UTC. Reproducido el 10/11 a las 22:30: el archivo se llama `Backup_CRM_Sersale_2026-11-11.xlsx` y un pedido cargado a las 22:10 figura con fecha 11/11. Una faena con la fecha guardada como Timestamp tenía el mismo corrimiento.
- **Qué se cambió:** día de Buenos Aires con `SersaleBase` (`hoy()`, `diaDe()`), también en "Generado: 10/11/2026 22:30".
- **Prueba:** la del punto 3 (nombre del archivo, "Generado", fecha de cada pedido y de las faenas).

### 8. El backup dejaba afuera los pedidos sin `fechaPedido` — media
- **Qué pasaba:** los pedidos se pedían ordenados por `fechaPedido`, y Firestore no devuelve los documentos que no tienen ese campo. Reproducido: con un pedido viejo sin ese campo, la hoja trae 65 de 66 pedidos.
- **Qué se cambió:** se leen todos y se ordenan en la página (del más nuevo al más viejo, usando `fechaPedidoISO`, `fechaPedido` o `fechaEntrega`).
- **Prueba:** la del punto 3 (`ped_sin_fecha` está y el más nuevo va primero).

### 9. El backup no incluía devoluciones, movimientos de stock ni reportes de producción — media
- **Qué pasaba:** la página promete "toda la información del CRM" pero esas tres colecciones no se exportaban. Las devoluciones generan créditos en cuenta corriente: sin ellas no se puede reconstruir un saldo.
- **Qué se cambió:** tres hojas nuevas al final (Devoluciones, Stock Movimientos, Reportes Producción, una fila por ítem) y sus renglones en el Resumen. Las hojas que ya existían no cambian de nombre, de orden ni de columnas.
- **Prueba:** la del punto 3 (cantidad de filas, montos, fechas y que el Resumen coincida con las hojas).

### 10. El backup podía quedar leyendo para siempre — media
- **Qué pasaba:** si se toca "Generar" justo cuando vuelve la conexión, Firestore a veces deja la lectura de una colección sin contestar nunca. Se vio en 4 de unos 300 intentos al probar el corte y la vuelta de la señal, con y sin el reinicio de conexión del punto 2. Sin este arreglo la pantalla queda en "⏳ Leyendo…" sin fin, con el botón bloqueado (no llegué a probarlo con la lectura de la versión anterior).
- **Qué se cambió:** se muestra el avance ("Leyendo los datos del servidor... (9 de 13)"). Si pasan 45 segundos sin que termine ninguna colección, la página reinicia la conexión y vuelve a leer todo; ese segundo intento no tiene límite, por si se trata de una conexión lenta.
- **Prueba:** "backup: si la lectura de una colección queda colgada, reintenta solo y el archivo sale completo" (la falla se imita haciendo que la primera lectura de pedidos no conteste).

### 11. Cambiar contraseña y eliminar usaban las ventanas del navegador — baja
- **Qué pasaba:** `prompt()` y `confirm()` nativos, y `alert()` para los errores. En el teléfono el teclado puede poner mayúscula inicial o "corregir" la clave escrita.
- **Qué se cambió:** hoja propia para la clave nueva (sin mayúscula automática ni autocorrector), confirmación propia para eliminar ("¿Eliminar al usuario @romina?" con botón rojo), y avisos de resultado ("Contraseña de @romina actualizada", "No se pudo… Probá de nuevo"). Sin conexión avisa en vez de quedar esperando en silencio. Botones de la lista de 44 px.
- **Prueba:** la del punto 6 (no aparece ningún diálogo del navegador; clave corta y cancelar no cambian nada).

### 12. Crear usuario: doble toque, usuario repetido y sin señal — baja
- **Qué pasaba:** "Crear usuario" no se bloqueaba (dos toques = dos altas y dos ventanas). El control de "ya existe" solo miraba el id: se podía crear `fernando` existiendo ya `Fernando` con otro id, y el ingreso quedaba ambiguo entre los dos.
- **Qué se cambió:** el botón se bloquea mientras crea ("Creando..."); el repetido se busca con el mismo criterio que el ingreso (id o campo `usuario`, sin mayúsculas); sin conexión avisa; al terminar dice "Usuario @fernando creado".
- **Prueba:** la del punto 5 (`NACHO` se rechaza y no pisa a `nacho`).

### 13. Ingreso: detalles — baja
- "Cancelar" mientras decía "Verificando..." igual terminaba iniciando la sesión. Ahora cancela.
- Si la conexión con la base no llegaba a cargar, quedaba en "Conectando con la base de datos..." para siempre. Ahora espera 10 segundos y avisa.
- "Usuario desactivado" se informaba aunque la clave estuviera mal (servía para saber qué usuarios existen). Ahora primero se valida la clave.
- Un segundo toque en "Ingresar" durante la verificación no lanza otro intento.
- La ventana ponía el cursor en "Usuario" una décima de segundo después de abrirse, aunque ya se estuviera completando la contraseña: lo escrito iba a parar al campo Usuario y salía "Completá usuario y contraseña". Solo pasa completando muy rápido (apareció de forma intermitente en las pruebas automáticas); ahora no le saca el cursor al campo en uso.
- **Prueba:** cubierto de paso por las de los puntos 1 y 4.

### 14. Panel: saludo y fecha — baja
- **Qué pasaba:** se calculaban con la hora del teléfono y una sola vez. La app que quedaba abierta de un día para otro seguía diciendo "Buenas noches · martes, 10 de noviembre" a la mañana siguiente. Al volver con el gesto "atrás", la pantalla podía mostrar una sesión que ya no era la vigente.
- **Qué se cambió:** hora de Buenos Aires, y al volver a la pantalla se vuelve a leer la sesión y se actualizan saludo y fecha.
- **Prueba:** "panel: saludo y fecha de Buenos Aires, y al volver a la app al otro día se actualizan".

### 15. Doble toque — baja
- En "Director" o "Usuarios" el segundo toque caía en el fondo de la ventana recién abierta y la cerraba. Ahora el fondo ignora los toques del primer instante, y "Director" no abre dos ventanas.
- En "Generar Backup Excel" dos toques descargaban dos archivos. Ahora el botón se bloquea mientras genera.
- **Prueba:** la del punto 2 (dos toques, un archivo).

### 16. Backup: detalles — baja
- Estado "BAJO / OK" del stock: comparaba como texto si la cantidad estaba guardada como texto ("5" contra "10"). Ahora compara números.
- Total de un pedido: usa los kg pesados aunque sean 0, igual que el remito.
- Los mensajes de estado se escriben como texto (antes iban como HTML con el mensaje de error adentro).
- El cartel final dice cuántos registros se exportaron.

## Descartado

- **Dos teléfonos creando el primer Director a la vez:** solo puede pasar el día de la instalación; ya hay usuarios.
- **Nombres de usuario o de persona metidos en la página:** pasan por `escapeHtml` en todos los lugares; el único caso malo era el `onclick` del punto 6.
- **Fórmulas en el Excel (un cliente llamado "=…"):** la librería escribe el texto como texto, no como fórmula.
- **"Días Alerta" sale 14 cuando el cliente no lo tiene:** es el mismo valor por defecto que usa el sistema.
- **Importes de Ventas leídos con `parseFloat`:** en `ventas_diarias` se guardan como número; no hay texto con coma.
- **Operario que entra a `backup.html`:** la página lo manda a Pedidos; correcto.
- **Descarga bloqueada por generarse después de una espera:** lo que Safari bloquea después de una espera son las ventanas nuevas, y acá no se abre ninguna: es una descarga, igual que antes de estos arreglos. Falta probarla en la app instalada (ver "Pendiente").
- **Ingreso sin señal con usuarios ya guardados en el teléfono:** entra con la copia guardada; es lo esperado para poder trabajar sin señal.
- **Zoom del iPhone al enfocar campos de 15 px:** la página fija la escala, no hace zoom.
- **"Salir" sin confirmación:** un toque de más contra el riesgo de dejar la sesión abierta; se deja como está.

## Pendiente

- **Descarga del Excel en la app instalada en el iPhone:** no se pudo probar en un teléfono real. En Safari funciona; en la app instalada conviene confirmarlo (alternativa: hoja de compartir del iPhone).
- **El Excel no es una copia completa:** cada hoja trae solo algunas columnas (por ejemplo, no trae la forma de pago de los movimientos, el historial de estados de los pedidos ni las cotizaciones del día) y no se exportan `config` (contador de remitos, catálogo) ni `usuarios`. Sirve para consultar, no para restaurar la base. Ver "Para decidir" 4.
- **Alta de usuario con dos teléfonos a la vez:** si dos directores crean el mismo usuario en el mismo segundo, queda el último. Muy improbable.
- **Si la señal se corta justo mientras se guarda un cambio de usuario,** el botón queda en "Creando..." (o el aviso "todavía se está guardando") hasta que vuelve; el cambio se aplica solo al volver la señal.
- **Dos directores que se eliminan uno al otro a la vez** dejarían la base sin usuarios, y el próximo ingreso crearía un "primer Director". Muy improbable; se resuelve con el punto 1 de "Para decidir".
- **El cartel "✅ Conectado a Firebase" del backup** aparece al abrir aunque no haya señal (solo indica que la página cargó). Cosmético.
- **La clave nueva se pide una sola vez y a la vista** (igual que antes). Si se quiere oculta, hay que pedirla dos veces.

## Pendiente en otros archivos

1. **`src/js/sesion.js` y el control de acceso de cada página** (`pedidos.html`, `dashboard.html`, `ventas.html`, `produccion.html`, `presupuestos.html`, `backup.html`): la sesión de un usuario desactivado o eliminado solo se corta al pasar por `index.html`. Una pestaña que queda abierta en otra página sigue entrando hasta que se cierra. Para cortarlo en todos lados hace falta un control compartido (por ejemplo en `js/shell.js`, que ya se carga en todas) que lea `usuarios/<usuario>` y cierre la sesión si `activo === false` o no existe.
2. **Reglas de Firestore / ingreso real** (ya anotado por Producción y Pedidos): el ingreso se resuelve en el teléfono. La colección `usuarios`, con el resumen (SHA-256, sin sal) de cada clave, la puede leer y escribir cualquiera que tenga la dirección del sitio. No se arregla desde `index.html`: hace falta Firebase Authentication y reglas.
3. **`src/js/shell.js` (`pedirTexto`)**: no permite pedir un campo sin mayúscula automática ni autocorrector; `index.html` lo ajusta desde afuera al pedir la clave. Sumar opciones `autocapitalize` / `autocorrect`.
4. **`docs/auditoria/_pendientes-entre-archivos.md`**: la fila de `src/backup.html` (leer siempre del servidor) ya está resuelta: borrarla.
5. **`src/js/fb-compat.js`** (nota de Ventas): si se activa la copia local para Ventas, el backup no cambia: ya pide todo con `source: "server"`.
6. **`src/ventas.html`** (mismo SDK que el backup): la lectura colgada del punto 10 no depende del backup. Si alguna vez Ventas queda en "Cargando…" justo al volver la señal, es eso; no lo probé en esa página.

## Para decidir con el dueño

1. **Seguridad del ingreso.** Hoy la clave se controla en el teléfono y la base acepta lecturas y escrituras de cualquiera que conozca la dirección. ¿Se avanza con usuarios de Firebase y reglas? Es el único arreglo de fondo; lo de este informe evita accidentes, no a alguien con mala intención.
2. **Revisar la lista de usuarios.** Por el punto 1, cualquier intento de ingreso con mala señal en un teléfono sin datos pudo crear un Director o cambiarle la clave a uno. ¿Hay en Usuarios alguien que nadie dio de alta? ¿A algún director le dejó de andar la clave de un día para el otro? Conviene revisar la lista, eliminar lo que sobre y cambiar las claves.
3. **Backups ya guardados.** Los generados sin señal pueden estar vacíos o sin alguna hoja aunque dijeran "Backup generado", y los generados después de las 21 hs llevan en el nombre la fecha del día siguiente. ¿Se revisan los archivos guardados?
4. **Qué tiene que ser el backup.** ¿Alcanza con el Excel para consultar, o se quiere además una copia completa que permita restaurar la base (todas las colecciones con todos sus campos)? ¿Se quiere que se haga sola cada cierto tiempo en vez de depender de que alguien toque el botón? ¿Dónde se guardan?
5. **Sesión recordada 30 días.** ¿Está bien ese plazo en teléfonos que usan varias personas?
6. **Claves.** El mínimo es de 4 caracteres. ¿Se sube?
7. **Acceso de Operario sin clave.** Cualquiera con la dirección entra a Depósito y puede cambiar estados de pedidos. ¿Se quiere un PIN?
8. **Último director.** Hoy un director no puede eliminarse ni desactivarse a sí mismo, pero sí a todos los demás. ¿Hace falta alguna regla más (por ejemplo, que siempre queden dos activos)?

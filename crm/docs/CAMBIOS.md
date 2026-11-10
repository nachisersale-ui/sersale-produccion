# Qué cambió en el CRM — noviembre 2026

Primera versión del sistema con código versionado. Hasta ahora el sitio se
publicaba arrastrando archivos a Netlify y la única copia del código era la que
estaba publicada.

## En números

- Cerca de **285 errores corregidos**, entre ellos 11 críticos (datos o saldos
  mal guardados) y 41 altos.
- **232 pruebas automáticas** que abren las pantallas reales como en un iPhone,
  contra una base de datos de prueba idéntica a la real.
- La pantalla de Pedidos pasa de tardar **10,8 s a 0,56 s** en aparecer
  (medido simulando un teléfono).

## Lo que vas a notar al usarlo

- **Abre casi al instante.** El código ya viene preparado (antes el teléfono
  bajaba un compilador de 3 MB y procesaba 5.500 líneas cada vez) y no depende
  de servidores externos.
- **Cambiar de pantalla no vuelve a descargar todo.** Los datos quedan en el
  teléfono y se mantienen al día solos; lo que carga otro teléfono aparece sin
  recargar.
- **Se instala como app**: "Agregar a pantalla de inicio" en Safari. Ícono
  propio, sin barra del navegador, y se actualiza sola cuando hay versión nueva.
- **Funciona sin señal** para consultar y para cargar pedidos, clientes y
  precios: quedan guardados en el teléfono y se envían solos al volver la
  conexión. Arriba se ve cuántos cambios faltan enviar.
- **"Recordarme en este dispositivo"** al ingresar (30 días), con
  autocompletado de usuario y clave del iPhone.
- **Avisos propios** en lugar de los carteles del navegador, y preguntas de
  confirmación a prueba de doble toque.
- **El gesto de volver** del iPhone regresa al inicio de Pedidos en vez de
  sacarte de la página.
- **Una sola barra de navegación** igual en todas las secciones.

## Cambios de comportamiento a tener en cuenta

- **Piden conexión** (avisan y no guardan si no hay): remitos, pagos, venta
  rápida, devoluciones, cambios de estado y kg del depósito, stock de
  producción y cierre de ventas. Se guardan en una sola operación para que el
  saldo o el stock no queden a medias.
- **Renombrar un cliente** ahora cambia el nombre en su cuenta, movimientos,
  precios, pedidos y dirección (antes quedaba desconectado de todo).
- **Los días de recontacto escritos a mano quedan fijos.** Antes el cálculo
  automático los pisaba cada vez que se abría el panel. "↺" vuelve al
  automático.
- **Ya no aparecen los 9 clientes de demostración** en Nuevo y Editar pedido.
- **Renglones incompletos** de un pedido (producto sin cantidad o al revés)
  frenan el guardado; antes se descartaban sin avisar.
- **Ventas** pregunta antes de reemplazar un cierre ya cargado para ese día y
  sucursal.
- **Backup** exige sesión de Director, no genera nada si no hay señal y ahora
  incluye devoluciones, movimientos de stock y reportes de producción.
- **Desactivar o eliminar un usuario** le corta el acceso también si tenía la
  sesión recordada.
- **Saldo a favor del cliente** se muestra con signo y en azul (antes figuraba
  como "Al día" con el importe en positivo).

## Errores corregidos, por módulo

| Módulo | Corregidos | Los más graves |
|---|---|---|
| Cuentas corrientes y remitos | 47 | Remito guardado dos veces cobraba doble. Registrar un pago podía borrar cargos del saldo. Un ítem pesado en 0 kg se cobraba por lo pedido. |
| Vista Director y devoluciones | 26 | El crédito de una devolución se restaba sin transacción y no llegaba a la cuenta si el nombre estaba escrito distinto. Dos toques cargaban dos devoluciones. |
| Venta rápida y precios | 20 | La venta rápida pisaba el saldo del cliente con una suma mal hecha. Pedido y cargo se guardaban por separado. |
| Clientes y nuevo pedido | 25 | Renombrar un cliente lo desconectaba de su cuenta. Borrar un duplicado borraba la cuenta del cliente real. |
| Depósito | 18 | El depósito pisaba el pedido con una copia vieja: borraba ítems agregados desde Comercial y revivía pedidos cancelados. |
| Producción | 32 | Los botones + / − de stock perdían toques. Editar o borrar un reporte no ajustaba el stock. El PDF salía vacío. |
| Ventas diarias | 17 | Un segundo toque en Guardar reemplazaba el cierre por uno en cero. Después de las 21 hs proponía la fecha de mañana. |
| Dashboard | 19 | El PDF nunca se generaba. La variación contra el mes anterior estaba mal (mostraba ▲2130,7% en vez de ▼73,1%). Gastos siempre en $0. |
| Presupuestos | 14 | Un precio escrito "8.990" salía como $9 en el PDF. Los descuentos de un cliente quedaban activos para el siguiente. |
| Productos e historial de precios | 17 | Si fallaba la lectura del catálogo, el siguiente guardado lo reemplazaba por la lista vieja escrita en el código. |
| Alertas y hoja de ruta | 12 | La hoja de ruta por WhatsApp llegaba cortada si un nombre tenía "&", "#" o "%". Las paradas que el mapa no ubicaba desaparecían. |
| Ingreso, usuarios y backup | 16 | Con mala señal, el ingreso podía crear un Director o pisar una clave. El backup sin señal bajaba un Excel vacío. |
| Notas cruzadas entre pantallas de Pedidos | 14 | Cambiar el cliente de un pedido dejaba su renglón pendiente en la cuenta del cliente anterior. |
| Capa compartida | 11 | Si se cortaba la señal justo al confirmar, un cargo o un movimiento de stock podía asentarse dos veces. Sin señal, los botones quedaban en "Guardando…" para siempre. |

El detalle de cada arreglo, con su prueba, está en `docs/auditoria/`.

## Cómo se probó

- Cada corrección tiene una prueba que falla con el código anterior y pasa con
  el nuevo.
- Después, revisores independientes atacaron cada área buscando lo que los
  arreglos hubieran roto: copia local atrasada, señal cortada al confirmar, dos
  teléfonos a la vez, documentos viejos de la base, doble toque.
- Se verificó que el código compilado es idéntico byte a byte al que compilaba
  el navegador antes de empezar a corregir.

## Lo que hay que probar en un iPhone real

No se puede simular acá:

- Instalar la app en la pantalla de inicio y ver la barra de estado y el borde
  inferior.
- Descargas y "compartir" de PDF, Excel y CSV desde la app instalada.
- Imprimir el reporte de Ventas desde la app instalada.
- Cortes de señal reales (pasar de wifi a datos, bloquear la pantalla mientras
  guarda).
- Abrir la hoja de ruta en Google Maps con muchas paradas.
- Que el aviso de WhatsApp de Producción llegue.

## Pendiente

- Decisiones del negocio: `docs/PARA-DECIDIR.md`.
- Errores reales que quedaron sin corregir por necesitar una decisión o un
  cambio de formato: sección "Pendiente" de cada informe en `docs/auditoria/`.
- **Seguridad del acceso** (punto 44 de `PARA-DECIDIR.md`): es lo más
  importante que queda.

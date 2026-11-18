# Para decidir

Cosas que aparecieron al corregir el sistema y que no son un error de código
sino una decisión del negocio. En cada una está cómo quedó por ahora. El detalle
de cada módulo está en `docs/auditoria/`.

## Revisar ya en la base real (posibles efectos de errores viejos)

1. **Usuarios.** Con mala señal, el ingreso podía crear un Director nuevo o pisar
   la clave de uno existente con lo que se hubiera tipeado. Revisar en Usuarios
   que no haya directores que nadie creó y que las claves sigan funcionando.
2. **Backups guardados.** Sin señal se descargaba un Excel vacío diciendo "Backup
   generado", y un registro mal formado dejaba afuera una hoja entera. Alguno de
   los backups viejos puede estar vacío o incompleto.
3. **Saldos de cuenta corriente.** Había varias formas de que un saldo quedara
   mal (remito guardado dos veces, pago que borraba cargos, venta rápida que
   pisaba el saldo, devolución que no llegaba a la cuenta). El código nuevo no
   toca los saldos viejos: conviene comparar saldo contra movimientos de las
   cuentas grandes. Si no coinciden, ¿cuál vale, el saldo guardado o la suma de
   movimientos?
4. **Stock de producción.** Los reportes editados o borrados con el sistema
   viejo no ajustaban el stock. Conviene un recuento físico.
5. **Ventas diarias.** Un doble toque en "Guardar" podía reemplazar el cierre
   recién cargado por uno en cero; después de las 21 hs la fecha propuesta era
   la del día siguiente. Revisar cierres en cero o con fecha corrida.
6. **Costos del dashboard.** La tabla de costos está escrita en el código y tiene
   valores que no pueden ser reales (Panceta y Pechito Ahumado a $30,88/kg;
   Lomo Ahumado, Mortadela Bocha y Salchichón Primavera con costo mayor al
   precio). El ranking de rentabilidad sale de ahí. ¿Cuáles son los correctos?
   ¿Los cargamos desde la planilla de costos?

## Cuentas corrientes y remitos

7. Cuando se **cancela un pedido que ya tiene remito**, ¿qué pasa con el cargo?
   Hoy queda.
8. ¿Hace falta poder **anular o corregir un pago**, o cargarlo con otra fecha?
9. ¿Hace falta **mover o anular un remito** emitido al cliente equivocado? Hoy un
   pedido con remito no se puede pasar a otro cliente.
10. Pedido marcado "cuenta corriente" de un cliente **sin cuenta**: hoy la abre
    solo. ¿O preferís que pregunte?
11. Venta rápida a un cliente sin cuenta: hoy pregunta y la abre. ¿O se bloquea?
12. **Piezas, ganchos, bolsas y unidades**: ¿se cobran por kilo pesado o por
    unidad? Hoy el remito cobra por kg pesado; lo no pesado sale en $0.
13. ¿Se puede **compartir el PDF del remito antes de guardarlo**?
14. Quedan renglones viejos "+$0 Pendiente de facturar" de pedidos cancelados
    antes de este cambio. ¿Los limpiamos?
15. En cada remito se guarda un renglón en el historial de precios aunque el
    precio no haya cambiado. ¿Lo dejamos solo cuando cambia?

## Pedidos y depósito

16. **"Despachado" y "Cancelar"** se aplican con un toque. ¿Pedimos confirmación?
17. ¿Se puede **reabrir** un pedido despachado o cancelado? ¿Quién?
18. Depósito, remitos, pagos, venta rápida, devoluciones y stock ahora **piden
    señal** (se guardan en una sola operación para que saldo y stock no queden a
    medias). ¿Hay señal en el depósito y donde se cargan los reportes? Si no,
    hay que pensar otra forma para esas pantallas.
19. La cinta **NUEVO**: ¿"entró desde la última vez que este teléfono miró" o
    "pendiente que nadie empezó"?
20. ¿Registramos **quién** cambió cada estado?
21. Fecha de entrega: ¿se permiten **fechas pasadas**? ¿Cuál es la fecha y el tipo
    de pedido por defecto?

## Clientes

22. Se quitaron del selector los **9 clientes de demostración** escritos en el
    código (Hotel Castelar, Supermercado Don Juan y otros). ¿Alguno era real?
23. **Eliminar un cliente con saldo**: ¿se bloquea, o se desactiva en vez de
    borrar?
24. Al renombrar un cliente, los **remitos ya emitidos**: ¿conservan el nombre
    viejo? Hoy sí.
25. ¿Qué monto es **"deuda elevada"**? Hoy $50.000.

## Precios y presupuestos

26. ¿**Presupuestos** tiene que usar el mismo catálogo que Pedidos? Hoy tiene 45
    productos escritos en el código contra 66 en Pedidos, y no toma los precios
    acordados con cada cliente.
27. Hay **códigos de artículo repetidos**: "Art. 621" está en tres productos;
    107, 602 y 905 también se repiten. ¿Cuáles son los correctos?
28. Precios con descuento: ¿se **redondean** a $10 / $50 / $100? (10% de $5.990
    da $5.391.)
29. Editar un precio a mano: ¿agrega un renglón al historial o reemplaza el
    último? Hoy reemplaza.
30. ¿Un presupuesto tiene que llevar **validez, aclaración de IVA, cantidades y
    totales**? ¿Se guardan para reusar?

## Alertas de recontacto

31. "N días sin pedir" hoy cuenta desde la **última actividad** (también pagos y
    contactos), no desde el último pedido. ¿Lo dejamos?
32. "Avisar por WA" escribe al número de la empresa. ¿Tendría que escribirle al
    **cliente**?
33. El mail de alertas solo sale si alguien abre el panel del Director. ¿Alcanza?
34. ¿Hace falta **pausar** las alertas de clientes que ya no compran?

## Ventas y dashboard

35. Mes en curso: ¿se compara contra **los mismos días** del mes anterior o
    contra el mes entero?
36. Facturación mensual: ¿por **fecha de entrega** (como está) o por fecha de
    remito?
37. Ventas: ¿hace falta **editar gastos y borrar un cierre**? Hoy no se puede.
    ¿Avisamos cuando los medios de pago no suman el total?
38. Los días **cerrados**: ya no se puede guardar un cierre totalmente vacío.
    ¿Necesitan quedar registrados?

## Producción

39. Reportes en kg o ganchos: ¿suman al stock cuando el artículo usa esa unidad?
    Hoy solo suman las filas en "piezas".
40. ¿Se **bloquea una salida mayor al stock**, o se permite con aviso?
41. ¿Los ajustes manuales de stock quedan en Movimientos?
42. Vencimiento de lotes: ¿30 días para todos o por tipo de producto?
43. ¿Quién puede abrir el panel Director de Producción? Hoy no pide nada.

## Acceso y seguridad

44. **El acceso no está protegido en la base de datos.** El usuario y la clave
    se controlan solo en el navegador: quien conozca la dirección del sistema y
    algo de programación puede leer y modificar todo, incluidas las claves
    (guardadas con una protección débil). Lo correcto es pasar a inicio de
    sesión de Firebase con reglas en la base. Es un trabajo aparte y necesita
    acceso a la consola de Firebase. **Recomendado.**
45. La clave de CallMeBot (avisos de WhatsApp de Producción) está guardada en la
    base y la usa el navegador. Conviene moverla a una función del servidor.
46. Sesión recordada 30 días: ¿está bien en teléfonos compartidos? ¿Clave mínima
    más larga que 4 caracteres? ¿PIN para Operario?
47. Backup: ¿alcanza el Excel a mano, o lo hacemos automático a Drive?

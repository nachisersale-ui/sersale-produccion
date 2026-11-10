# Recorrida de pantallas con datos de ejemplo (antes de los arreglos)

Capturas en `tests/screenshots/antes/` (41 pantallas, tamaño iPhone). Sin errores
de consola. Lo que se vio roto o inconsistente:

1. **Director → Devoluciones**: la página mide 696px de ancho en una pantalla de
   390px porque el selector de cliente crece hasta el nombre más largo; el botón
   ⚡ queda fuera de pantalla.
2. **Producción → Vista Director → Reportes**: 486px de ancho (fila de fecha +
   selector de área + ↻).
3. **Dashboard**: 527px de ancho.
4. **Dashboard**: "Facturación ▲ 2130,7% vs mes ant." con 34 pedidos el mes
   anterior. "18 días registrados" son 9 días × 2 sucursales.
5. **Resumen "Preparar hoy" y Hoja de Ruta**: muestran los kg pesados con la
   unidad del pedido: "Jamón Crudo c/ Hueso 31.6 piezas" (eran 4 piezas, 31,6 kg).
6. **Lista de cuentas corrientes**: un saldo a favor del cliente de −$25.258 se
   muestra como "✅ Al día $25.258", sin signo.
7. **Stats** dice "Clientes activos 8"; el dashboard dice 15 para el mismo mes.
8. **Inicio** dice "3 pedidos nuevos", pero ninguna tarjeta queda marcada NUEVO
   al entrar a una vista.
9. **Nuevo / Editar pedido** listan clientes de demostración escritos en el
   código (Hotel Castelar y otros) que no están en la base.
10. **Cuenta corriente**: quedan renglones "+$0 Pendiente de facturar", incluso
    de pedidos cancelados.

## Formatos que no coinciden entre partes del código

- `items[].cantidad` es texto en los pedidos normales y número en la venta
  rápida, que además agrega `precio`/`kgReal`, no guarda `categoria` y usa las
  unidades kg/pzas/bolsas/u.
- `clientes.creadoEn` es Timestamp desde el formulario de clientes y texto ISO
  desde `marcarContacto`.
- `remitos.items[].kg` es número cuando se pesó y si no, el texto de cantidad.
  `VerRemitoGuardado` lee `fechaEntrega` y `tipo`, que nunca se escriben.
- Devoluciones escribe `saldo − monto` sin recalcular y guarda una foto del
  `saldo` en el movimiento; el resto recalcula y redondea.
- Catálogo: Nuevo Pedido y Gestión de Productos usan `config/productos`; la
  pestaña Precios usa la lista escrita en el código (un producto agregado desde
  Gestión de Productos se puede pedir pero no se le puede poner precio ahí).
- `fechaEntrega` es fecha local; las fechas de remito, pago y venta rápida se
  calculan en UTC (después de las 21:00 quedan con el día siguiente).

No recorrido: migracion.html, Comparativa de ventas, contenido de los PDF,
modales de pago y de stock.

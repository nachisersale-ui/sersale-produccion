# Pendientes que un arreglo dejó para otro archivo

Cada agente arregla solo sus archivos. Lo que encontró en archivos ajenos queda
anotado acá para quien los tome después.

| Archivo | Qué | De dónde salió |
|---|---|---|
| `src/pedidos/03-pedidos-comercial-remito.jsx` | La `fecha` del remito se guarda con el día UTC (después de las 21:00 queda con el día siguiente). Usar `SersaleBase.hoy()`. | dashboard |
| `src/pedidos/05-venta-rapida-precios.jsx` | La venta rápida usa el día UTC como `fechaEntrega`. Usar `SersaleBase.hoy()`. | dashboard |
| `src/ventas.html` | La fecha propuesta por defecto es el día UTC. Usar `SersaleBase.hoy()`. | dashboard |

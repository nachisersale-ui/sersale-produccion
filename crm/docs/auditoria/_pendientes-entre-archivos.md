# Pendientes que un arreglo dejó para otro archivo

Cada agente arregla solo sus archivos. Lo que encontró en archivos ajenos queda
anotado acá para quien los tome después.

| Archivo | Qué | De dónde salió |
|---|---|---|
| `src/backup.html` | El backup tiene que leerse siempre del servidor (`get({ source: "server" })`): sin señal debe avisar y no generar un Excel con datos viejos o vacíos. | ventas |
| `src/pedidos/05-venta-rapida-precios.jsx` | La venta rápida usa el día UTC como `fechaEntrega`. Usar `SersaleBase.hoy()`. | dashboard |

Además, cada informe de `docs/auditoria/*.md` tiene una sección "Pendiente en
otros archivos". Antes de empezar con un archivo, buscar ahí lo que lo nombra:

```
grep -n -A40 "Pendiente en otros archivos" docs/auditoria/*.md
```

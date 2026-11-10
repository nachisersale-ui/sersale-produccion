# Pendientes que un arreglo dejó para otro archivo

Cada agente arregla solo sus archivos. Lo que encontró en archivos ajenos queda
anotado acá para quien los tome después.

| Archivo | Qué | De dónde salió |
|---|---|---|

Además, cada informe de `docs/auditoria/*.md` tiene una sección "Pendiente en
otros archivos". Antes de empezar con un archivo, buscar ahí lo que lo nombra:

```
grep -n -A40 "Pendiente en otros archivos" docs/auditoria/*.md
```

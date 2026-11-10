# CRM — Frigorífico Sersale

Sistema interno de pedidos, clientes, cuentas corrientes, producción y ventas.
Sitio estático publicado en Netlify (`crm-frigorifico-sersale.netlify.app`);
los datos están en Firestore (proyecto `sersale-produccion`).

## Uso rápido

```
cd crm
npm install          # una sola vez
node build.mjs       # arma crm/dist, que es lo que se publica
node tests/run.mjs   # pruebas (Chromium + emulador de Firestore, no tocan la base real)
```

Para verlo en la computadora: `node tests/lib/server.mjs dist 8080` y abrir
`http://localhost:8080`. Ojo: así abierto trabaja contra la base **real**.

## Qué hay en cada carpeta

| Carpeta | Contenido |
|---|---|
| `src/` | Código fuente: una página `.html` por módulo, el React de pedidos y producción en `pedidos/` y `produccion/`, y lo compartido en `js/` y `css/`. |
| `dist/` | Sitio listo para publicar. Lo genera `build.mjs`; no se edita ni se versiona. |
| `tests/` | Pruebas de punta a punta y datos de ejemplo. |
| `docs/` | Guía de cambios, modelo de datos y resultados de la auditoría. |
| `tools/` | Utilidades sueltas (generar los íconos de la app). |

## Publicar

- **Automático (recomendado):** con el sitio de Netlify conectado a este
  repositorio, cada cambio que entra a la rama principal se publica solo
  (`netlify.toml` en la raíz ya indica cómo armarlo).
- **A mano:** correr `node build.mjs` y arrastrar la carpeta `crm/dist` a Netlify.

El teléfono guarda una copia del sistema para abrir al instante y funcionar
sin señal. Cuando se publica una versión nueva, la app la descarga sola y
avisa "Hay una versión nueva del sistema".

## Antes de tocar código

Leer `docs/GUIA-DE-CAMBIOS.md`.

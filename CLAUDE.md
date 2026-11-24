# CRM Frigorífico Sersale — contexto para trabajar en este repositorio

Sistema interno de pedidos, clientes, cuentas corrientes, reservas, producción y
ventas. Se usa todo el día desde iPhones (Safari o instalado en la pantalla de
inicio). Es un sitio estático en Netlify que habla directo con Firestore.

El código vive en `crm/`. Antes de tocar nada: `crm/README.md` y
`crm/docs/GUIA-DE-CAMBIOS.md` (sus reglas son obligatorias). Los archivos sueltos
de la raíz (`App.js`, `firebase.js`, `index.html`) son anteriores y no se usan.

## Reglas que no se negocian

- **El sitio real (`crm-frigorifico-sersale.netlify.app`) no se publica sin el OK
  explícito del dueño.** Todo se prueba antes en
  `sersale-crm-prueba.netlify.app`.
- **El sitio de prueba usa la base de datos REAL.** Lo que se cargue ahí queda
  en producción. Las pruebas automáticas no: corren contra un emulador.
- **Babel queda fijo en 7.26.4** (`@babel/standalone`). La versión 8 rompió el
  sitio.
- **No se cambian nombres ni formatos de campos ya guardados** en Firestore. Los
  campos nuevos son opcionales y los documentos viejos tienen que seguir andando.
- **Cada arreglo lleva su prueba**: que falle con el código anterior y pase con
  el nuevo.
- Se trabaja en la rama `claude/bold-hypatia-asn7p9`. No se abre un pull request
  salvo que lo pidan.
- Este repositorio es público: acá no van claves, tokens ni datos de clientes.

## Cómo le sirve al dueño

- Español rioplatense, directo y corto. Trabaja casi siempre desde el iPhone.
- Montos como `$8.990`; kilos con coma (`30,4 kg`).
- Primero diseño y plan, después código. La IA sugiere; decide una persona.
- Avisar con claridad qué quedó publicado y dónde, y qué no se pudo verificar.

## Armar, probar, publicar

```
cd crm
npm install
node build.mjs                         # src → dist (lo que se publica)
node tests/run.mjs                     # toda la suite (unos 15 minutos)
node tests/run.mjs tests/reservas.test.mjs
```

- Las pruebas necesitan Node 22, Java 21 (emulador de Firestore, se baja solo a
  `crm/.cache`) y Playwright con Chromium. Playwright no está en
  `package.json`: en la nube viene instalado; en una PC hay que instalarlo.
- `src/pedidos/*.jsx` y `src/produccion/*.jsx` se concatenan y se compilan como
  UN solo script: los nombres de nivel superior son globales compartidos y no
  se pueden repetir (usar un prefijo propio por archivo).
- Publicar en el sitio de prueba: `node build.mjs` y subir `crm/dist` al sitio
  `sersale-crm-prueba` de Netlify. Después verificar que
  `https://sersale-crm-prueba.netlify.app/version.json` muestre la versión que
  imprimió el build. El teléfono avisa "Hay una versión nueva del sistema".

## Estado al 18/11/2026

Hecho y publicado en el sitio de prueba (versión `86c5debb0f34`); el sitio real
sigue con la versión anterior a todo este trabajo:

- Cerca de 285 errores corregidos y 275 pruebas automáticas (detalle en
  `crm/docs/CAMBIOS.md` y `crm/docs/auditoria/`).
- App instalable, funciona sin señal, abre al instante (JSX precompilado).
- Kilos con decimales en todos los campos de kg.
- **Reservas de fin de año** (`crm/src/pedidos/07-reservas.jsx`, colección
  `reservas`): fecha del pedido, nombre (texto libre: son particulares, no los
  clientes del CRM), ítem, kilos o rango de kilos (`kg` y `kgHasta`), precio por
  kg, seña, fecha de retiro, contacto. Hoja "Reservas" en el backup.

**Publicado en el sitio real y en el de prueba el 24/11/2026, versión
`1c00eda3253a`** (con OK del dueño, después de probarlo en el de prueba). Se
publica con `netlify deploy --no-build --dir crm/dist --site <id> --prod`
(Netlify CLI autorizado en la PC del dueño); el armado en Netlify falla por su
control de claves, que detecta la clave web pública de Firebase. Volver atrás:
en Netlify → Deploys, republicar el deploy anterior. Incluye:

- **Seguridad del acceso, etapa 1** (`crm/docs/SEGURIDAD.md`): cada teléfono
  ingresa con una cuenta de Firebase (`crm/src/js/cuenta.js`), PIN del depósito
  para el Operario y reglas listas en `crm/firestore.rules`. Las reglas NO
  están aplicadas: la base real sigue abierta hasta que el dueño lo decida.
- **Muestras** (`crm/src/pedidos/07-muestras.jsx`, colección `muestras`):
  certificado de entrega numerado (M-0001), firma con el dedo, PDF con original
  y duplicado, seguimiento de cada muestra por cliente, hoja en el backup.
- En esta PC (Windows) la suite completa se cuelga si corren varios archivos a
  la vez: correr los archivos de a uno (`node tests/run.mjs tests/x.test.mjs`).

Pendiente de que el dueño confirme desde su iPhone:

- Que guardar una reserva funcione contra la base real (las reglas de Firestore
  para la colección nueva `reservas` no se pudieron verificar desde la nube).
- Que los campos de fecha de Reservas se vean alineados y que el teclado de los
  campos de kilos muestre la coma.

Pendiente de decisión (ver `crm/docs/PARA-DECIDIR.md`, 47 puntos):

- Publicar todo esto en el sitio real.
- **Seguridad del acceso** (punto 44): es lo más importante que queda. Necesita
  la consola de Firebase (Auth y reglas).
- Si hay señal en el depósito y la cámara; si piezas, ganchos y bolsas se cobran
  por kilo o por unidad; si "Despachado" y "Cancelar" piden confirmación; si
  alguno de los 9 clientes de demostración era real.
- Ideas ofrecidas y sin respuesta: una pantalla de "Diagnóstico" de solo
  lectura; pedir el peso real al marcar una reserva como entregada.

Conocido: la prueba "remito: un ítem pesado en 0 kg…" a veces falla cuando la
máquina está muy cargada y pasa sola al repetirla.

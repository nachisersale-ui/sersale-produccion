# Guía para cambiar el CRM

Reglas para cualquiera (persona o agente) que toque el código. El sistema está
en producción, lo usan varias personas a la vez desde el teléfono y maneja
saldos de clientes: un cambio descuidado puede romper datos reales.

## Cómo está armado

```
crm/
  src/                 código fuente (lo que se edita)
    *.html             una página por módulo
    pedidos/*.jsx      React de pedidos.html, en 8 archivos que se unen en orden alfabético
    produccion/app.jsx React de produccion.html
    js/base.js         fechas, montos y texto        -> window.SersaleBase
    js/shell.js        avisos, hojas, barra inferior  -> window.SersaleUI
    js/fb.js           conexión a Firestore con copia local
    js/sesion.js       sesión recordada
    css/shell.css      estilos compartidos
  build.mjs            src -> dist (compila el JSX; dist es lo que se publica)
  tests/               pruebas con Chromium + emulador de Firestore
  docs/                modelo de datos, auditoría, esta guía
```

`dist/` no se edita ni se versiona: se genera con `node build.mjs`.

Los archivos de `src/pedidos/` se compilan juntos como un solo script: las
funciones y constantes de nivel superior son globales entre ellos. No repetir
nombres ya usados en otro archivo.

## Probar

```
cd crm
node build.mjs                       # siempre después de tocar src
node tests/run.mjs                   # todas las pruebas (levanta el emulador)
node tests/run.mjs tests/smoke.test.mjs
```

Las pruebas abren las páginas reales de `dist` simulando un iPhone, con el SDK
real de Firebase contra un emulador local: nunca tocan la base real. Ver
`tests/lib/harness.mjs` (`launch`) y `tests/lib/seed.mjs` (`buildSeed`).

## Reglas

1. **Los datos guardados mandan.** No renombrar campos ni cambiar su formato
   (fecha en texto vs. Timestamp, número vs. texto). Los documentos que ya
   existen en Firestore tienen que seguir funcionando sin migración. Un campo
   nuevo tiene que ser opcional y el código debe tolerar que falte.

2. **Arreglo mínimo.** Corregir el defecto, no reescribir el componente. Sin
   cambios de estilo ni de textos que no hagan al arreglo.

3. **Saldos, stock y contadores: nunca leer-modificar-escribir.** Si el valor
   nuevo depende del anterior, usar `runTransaction` o `increment()`. Dos
   teléfonos pueden estar tocando lo mismo.

4. **Guardar una sola vez.** Todo botón que guarda, cobra o elimina tiene que
   bloquearse mientras la operación está en curso
   (`const [guardar, guardando] = SersaleBase.useAccion(async () => {...})`).

5. **Si falla, se avisa.** Nada de `catch(e){}` que deje creer que se guardó.
   Ante un error: `SersaleUI.toast("No se pudo guardar. Probá de nuevo.", { tipo: "error" })`,
   se registra con `console.error` y el formulario queda como estaba, con lo
   que la persona escribió.

6. **Fechas** siempre con `SersaleBase` (`hoy()`, `diaDe()`, `fmtFecha()`,
   `sumarDias()`, `diasEntre()`). No usar `new Date().toISOString().slice(0,10)`
   ni `new Date("AAAA-MM-DD")`: dan el día equivocado en horario argentino.

7. **Montos** con `SersaleBase.numero()` para leer lo que se escribe y
   `SersaleBase.fmtMonto()` para mostrar. Redondear con `SersaleBase.redondear()`
   antes de guardar un importe calculado.

8. **Avisos y preguntas** con `SersaleUI`:
   - `SersaleUI.toast(texto, { tipo: "ok" | "error" | "info" })`
   - `await SersaleUI.confirmar({ titulo, cuerpo, aceptar, cancelar, peligro })` → `true` / `false`
   - `await SersaleUI.pedirTexto({ titulo, etiqueta, valor, inputMode })` → texto o `null`
   - `await SersaleUI.aviso(texto, { titulo })` para algo que hay que leer sí o sí.

   No usar `confirm()` ni `prompt()` del navegador. `alert()` sigue
   funcionando (se muestra como aviso propio), pero en código nuevo o tocado
   usar `SersaleUI.toast` con el tipo correcto.

9. **Texto de clientes en HTML o en links**: `SersaleBase.esc()` al armar HTML
   a mano, `encodeURIComponent` / `SersaleBase.waLink()` en links.

10. **Nombres de clientes**: comparar con `SersaleBase.mismoNombre(a, b)`
    (ignora mayúsculas, acentos y espacios de más). Buscar con
    `SersaleBase.coincide(texto, busqueda)`.

11. **Teléfono primero.** Campos numéricos con `inputMode="decimal"` o
    `"numeric"`, texto de 16px o más en los campos, botones de al menos 44px
    de alto, nada que dependa de pasar el mouse por encima.

12. **Babel queda en 7.26.4.** No actualizarlo (la versión 8 rompió el sitio).

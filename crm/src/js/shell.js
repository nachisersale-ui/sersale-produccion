// Capa compartida de interfaz del CRM Sersale: avisos, hojas de confirmación,
// barra de navegación, aviso de "sin conexión" e instalación como app.
// Se carga en todas las páginas, antes que el código de cada una.
(function () {
  "use strict";

  var enLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var PRUEBA = enLocal ? window.__SERSALE_TEST__ || null : null;

  function listo(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  function el(tag, attrs, hijos) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (hijos || []).forEach(function (h) {
      if (h) n.appendChild(h);
    });
    return n;
  }

  // ── Avisos breves (toasts) ───────────────────────────────────────────────

  var pila = null;
  function contenedorToasts() {
    if (!pila) {
      pila = el("div", { class: "ss-toasts", "aria-live": "polite", role: "status" });
      document.body.appendChild(pila);
    }
    return pila;
  }

  /**
   * Aviso breve que no interrumpe.
   * opts: { tipo: "ok" | "error" | "info", ms, accion: { texto, alTocar } }
   */
  function toast(mensaje, opts) {
    opts = opts || {};
    var tipo = opts.tipo || "info";
    var ms = opts.ms != null ? opts.ms : tipo === "error" ? 5200 : 2800;
    var nodo = el("div", { class: "ss-toast ss-toast-" + tipo });
    nodo.appendChild(el("span", { class: "ss-toast-txt", text: String(mensaje) }));
    var cerrar = function () {
      if (!nodo.parentNode) return;
      nodo.classList.add("ss-sale");
      setTimeout(function () {
        if (nodo.parentNode) nodo.parentNode.removeChild(nodo);
      }, 180);
    };
    if (opts.accion) {
      nodo.appendChild(
        el("button", {
          class: "ss-toast-btn",
          type: "button",
          text: opts.accion.texto,
          onclick: function (e) {
            e.stopPropagation();
            cerrar();
            opts.accion.alTocar();
          },
        })
      );
    }
    nodo.addEventListener("click", cerrar);
    listo(function () {
      var c = contenedorToasts();
      while (c.children.length >= 3) c.removeChild(c.firstChild);
      c.appendChild(nodo);
      if (ms > 0) setTimeout(cerrar, ms);
    });
    return cerrar;
  }

  // ── Hojas (reemplazan a alert / confirm / prompt del navegador) ──────────

  function hoja(cfg) {
    // cfg: { titulo, cuerpo, campo: {...}, botones: [{ texto, valor, estilo }], valorAlCancelar }
    return new Promise(function (resolver) {
      listo(function () {
        var previo = document.activeElement;
        var input = null;
        var cerrado = false;
        var fondo = el("div", { class: "ss-fondo" });
        var caja = el("div", { class: "ss-hoja", role: "dialog", "aria-modal": "true", tabindex: "-1" });

        function cerrar(valor) {
          if (cerrado) return;
          cerrado = true;
          document.removeEventListener("keydown", tecla, true);
          fondo.classList.add("ss-sale");
          setTimeout(function () {
            if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
            if (previo && previo.focus)
              try {
                previo.focus({ preventScroll: true });
              } catch (e) {}
          }, 170);
          resolver(valor);
        }
        function aceptar(b) {
          if (input) return cerrar(b.valor === true ? input.value : b.valor);
          cerrar(b.valor);
        }
        function tecla(e) {
          if (e.key === "Escape") {
            e.preventDefault();
            cerrar(cfg.valorAlCancelar);
          } else if (e.key === "Enter" && (input ? document.activeElement === input : document.activeElement === caja)) {
            e.preventDefault();
            var principal = cfg.botones[cfg.botones.length - 1];
            aceptar(principal);
          }
        }

        caja.appendChild(el("div", { class: "ss-asa" }));
        if (cfg.titulo) caja.appendChild(el("h2", { class: "ss-titulo", text: cfg.titulo }));
        if (cfg.cuerpo) caja.appendChild(el("p", { class: "ss-cuerpo", text: cfg.cuerpo }));
        if (cfg.campo) {
          if (cfg.campo.etiqueta) caja.appendChild(el("label", { class: "ss-etiqueta", text: cfg.campo.etiqueta }));
          input = el("input", {
            class: "ss-campo",
            type: cfg.campo.tipo || "text",
            inputmode: cfg.campo.inputMode || null,
            placeholder: cfg.campo.placeholder || "",
            autocomplete: cfg.campo.autocomplete || "off",
            enterkeyhint: "done",
          });
          input.value = cfg.campo.valor != null ? cfg.campo.valor : "";
          caja.appendChild(input);
        }
        var fila = el("div", { class: "ss-botones" + (cfg.botones.length === 1 ? " ss-uno" : "") });
        cfg.botones.forEach(function (b) {
          fila.appendChild(
            el("button", {
              type: "button",
              class: "ss-btn ss-btn-" + (b.estilo || "neutro"),
              text: b.texto,
              onclick: function () {
                aceptar(b);
              },
            })
          );
        });
        caja.appendChild(fila);
        fondo.appendChild(caja);
        fondo.addEventListener("click", function (e) {
          if (e.target === fondo) cerrar(cfg.valorAlCancelar);
        });
        document.addEventListener("keydown", tecla, true);
        document.body.appendChild(fondo);
        // Con un campo, el cursor va al campo; si no, a la hoja (sin marcar un botón).
        var foco = input || caja;
        setTimeout(function () {
          try {
            foco.focus({ preventScroll: true });
            if (input && input.select) input.select();
          } catch (e) {}
        }, 60);
      });
    });
  }

  /** Mensaje que hay que leer y aceptar. Devuelve una promesa. */
  function aviso(mensaje, opts) {
    opts = opts || {};
    return hoja({
      titulo: opts.titulo || null,
      cuerpo: String(mensaje),
      botones: [{ texto: opts.aceptar || "Entendido", valor: true, estilo: "principal" }],
      valorAlCancelar: true,
    });
  }

  /**
   * Pregunta de sí o no. Devuelve una promesa que resuelve true o false.
   * confirmar("¿Eliminar el pedido?") o confirmar({ titulo, cuerpo, aceptar, cancelar, peligro })
   */
  function confirmar(opts) {
    if (typeof opts === "string") opts = { cuerpo: opts };
    return hoja({
      titulo: opts.titulo || null,
      cuerpo: opts.cuerpo || null,
      botones: [
        { texto: opts.cancelar || "Cancelar", valor: false, estilo: "neutro" },
        { texto: opts.aceptar || "Confirmar", valor: true, estilo: opts.peligro ? "peligro" : "principal" },
      ],
      valorAlCancelar: false,
    });
  }

  /** Pide un texto. Devuelve una promesa con el texto, o null si se cancela. */
  function pedirTexto(opts) {
    if (typeof opts === "string") opts = { titulo: opts };
    return hoja({
      titulo: opts.titulo || null,
      cuerpo: opts.cuerpo || null,
      campo: {
        etiqueta: opts.etiqueta,
        valor: opts.valor,
        tipo: opts.tipo,
        inputMode: opts.inputMode,
        placeholder: opts.placeholder,
        autocomplete: opts.autocomplete,
      },
      botones: [
        { texto: opts.cancelar || "Cancelar", valor: null, estilo: "neutro" },
        { texto: opts.aceptar || "Aceptar", valor: true, estilo: "principal" },
      ],
      valorAlCancelar: null,
    });
  }

  // alert() del navegador: bloquea la pantalla y en la app instalada muestra la
  // dirección web. Se reemplaza por un aviso propio; los mensajes largos o de
  // varias líneas se muestran en una hoja para poder leerlos.
  var ES_ERROR = /^\s*(❌|⚠️|⚠|🚫|⛔)|\berror\b|no se pudo|no se puede|fall[oó]|inválid|invalid/i;
  var ES_OK = /^\s*(✅|✔️|✔|👍|🎉)|guardad[oa]|registrad[oa]|actualizad[oa]|eliminad[oa]|enviad[oa]|copiad[oa]|cread[oa]|list[oa]\b|correctamente/i;
  function avisar(mensaje) {
    var texto = mensaje == null ? "" : String(mensaje);
    if (!texto.trim()) return;
    var tipo = ES_ERROR.test(texto) ? "error" : ES_OK.test(texto) ? "ok" : "info";
    if (texto.length > 110 || texto.indexOf("\n") !== -1) aviso(texto);
    else toast(texto, { tipo: tipo });
  }
  var alertNativo = window.alert;
  window.alert = function (m) {
    try {
      avisar(m);
    } catch (e) {
      alertNativo.call(window, m);
    }
  };

  // ── Barra de navegación (solo Director) ──────────────────────────────────

  var SECCIONES = [
    { id: "index", texto: "Inicio", href: "index.html", icono: '<path d="M3 10.4 12 3.2l9 7.2"/><path d="M5.6 9.4V20.8h12.8V9.4"/>' },
    { id: "dashboard", texto: "Panel", href: "dashboard.html", icono: '<path d="M4 20h16"/><path d="M6.5 20v-6M11 20V8m4.5 12v-9M20 20V5"/>' },
    { id: "pedidos", texto: "Pedidos", href: "pedidos.html", icono: '<path d="M3 7.6 12 3l9 4.6v8.8L12 21l-9-4.6z"/><path d="m3 7.6 9 4.6 9-4.6M12 12.2V21"/>' },
    { id: "produccion", texto: "Producción", href: "produccion.html", icono: '<path d="M3 21h18"/><path d="M4.5 21V11l5 3V11l5 3V7.5l5 3V21"/><path d="M8 17.5h.01M13 17.5h.01M18 17.5h.01"/>' },
    { id: "ventas", texto: "Ventas", href: "ventas.html", icono: '<rect x="2.8" y="6.2" width="18.4" height="11.6" rx="2"/><circle cx="12" cy="12" r="2.4"/>' },
    { id: "presupuestos", texto: "Presup.", href: "presupuestos.html", icono: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12.5h5M10 16h3.5"/>' },
  ];
  function paginaActual() {
    var p = location.pathname.split("/").pop().replace(/\.html$/, "");
    return p || "index";
  }
  var navEl = null;
  function crearNav() {
    if (navEl) return navEl;
    var actual = paginaActual();
    navEl = el("nav", { id: "sersale_nav", class: "ss-nav", "aria-label": "Secciones" });
    SECCIONES.forEach(function (s) {
      var a = el("a", { href: s.href, class: "ss-nav-it" + (s.id === actual ? " ss-activo" : "") });
      if (s.id === actual) a.setAttribute("aria-current", "page");
      a.innerHTML =
        '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        s.icono +
        "</svg><span></span>";
      a.lastChild.textContent = s.texto;
      navEl.appendChild(a);
    });
    document.body.appendChild(navEl);
    return navEl;
  }
  /** Muestra u oculta la barra inferior. Sin argumento: visible si la sesión es de Director. */
  function nav(visible) {
    listo(function () {
      if (visible == null) {
        try {
          visible = sessionStorage.getItem("sersale_role") === "director";
        } catch (e) {
          visible = false;
        }
      }
      crearNav().style.display = visible ? "flex" : "none";
      document.documentElement.classList.toggle("ss-con-nav", !!visible);
    });
  }
  if (!document.documentElement.hasAttribute("data-sin-nav")) nav();

  // ── Sin conexión ─────────────────────────────────────────────────────────

  var cartel = null;
  function conexion() {
    listo(function () {
      var sin = navigator.onLine === false;
      if (sin && !cartel) {
        cartel = el("div", { class: "ss-sin-conexion", role: "status", text: "Sin conexión · se muestran los datos guardados" });
        document.body.appendChild(cartel);
      } else if (!sin && cartel) {
        cartel.parentNode.removeChild(cartel);
        cartel = null;
        toast("Conexión recuperada", { tipo: "ok", ms: 1800 });
      }
      document.documentElement.classList.toggle("ss-offline", sin);
    });
  }
  window.addEventListener("online", conexion);
  window.addEventListener("offline", conexion);
  if (navigator.onLine === false) conexion();

  // ── App instalada: archivos guardados en el teléfono y actualizaciones ───

  function escribiendo() {
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || !!document.querySelector(".ss-fondo");
  }
  function registrarSW() {
    if (!("serviceWorker" in navigator)) return;
    if (PRUEBA && !PRUEBA.sw) return;
    var teniaControl = !!navigator.serviceWorker.controller;
    var inicio = Date.now();
    var pendiente = false;
    navigator.serviceWorker
      .register("sw.js")
      .then(function (reg) {
        var buscar = function () {
          reg.update().catch(function () {});
        };
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") buscar();
          else if (pendiente && !escribiendo()) location.reload();
        });
      })
      .catch(function (e) {
        console.warn("No se pudo registrar el service worker:", e);
      });
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!teniaControl) {
        teniaControl = true; // primera instalación: nada que actualizar
        return;
      }
      if (pendiente) return;
      // Recién abierta y sin nada escrito: actualizar sin preguntar.
      if (Date.now() - inicio < 4000 && !escribiendo()) return location.reload();
      pendiente = true;
      toast("Hay una versión nueva del sistema", {
        tipo: "info",
        ms: 0,
        accion: {
          texto: "Actualizar",
          alTocar: function () {
            location.reload();
          },
        },
      });
    });
  }
  if (document.readyState === "complete") registrarSW();
  else window.addEventListener("load", registrarSW);

  window.SersaleUI = {
    toast: toast,
    aviso: aviso,
    avisar: avisar,
    confirmar: confirmar,
    pedirTexto: pedirTexto,
    nav: nav,
  };
})();

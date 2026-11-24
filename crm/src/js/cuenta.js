// Cuenta de Firebase de este teléfono (window.SersaleCuenta).
//
// Para que la base de datos pueda exigir "solo entra quien tiene permiso",
// cada teléfono inicia sesión con una cuenta de Firebase Authentication y
// Firestore manda el pase de esa cuenta en cada pedido (ver crm/firestore.rules
// y crm/docs/SEGURIDAD.md).
//
// No se usa la librería de Auth de Firebase: al abrir cada página consulta al
// servidor y, con mala señal, deja todo esperando hasta un minuto (incluso lo
// que está guardado en el teléfono). Acá la sesión se lee del teléfono al
// instante y el pase se renueva recién cuando hace falta. Se habla con el
// servicio oficial de cuentas de Firebase (Identity Toolkit, API REST pública).
//
// Va antes de js/fb.js y js/fb-compat.js, que le pasan el pase a Firestore.
(function () {
  var enLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var PRUEBA = enLocal ? window.__SERSALE_TEST__ || null : null;
  var API_KEY = "AIzaSyDyijnox-MMjZTefC3LpT-KApfcU6uev8g";
  var PROYECTO = PRUEBA ? PRUEBA.projectId : "sersale-produccion";
  var DOMINIO = "sersale-produccion.firebaseapp.com";
  var CLAVE = "sersale_cuenta_" + PROYECTO;
  var ESPERA_MS = 12000;
  var MARGEN_MS = 60 * 1000; // un pase al que le queda menos de un minuto se renueva antes de usarlo

  var URL_CUENTAS = (PRUEBA && PRUEBA.authUrl ? PRUEBA.authUrl + "/identitytoolkit.googleapis.com" : "https://identitytoolkit.googleapis.com") + "/v1/accounts:";
  var URL_PASE = (PRUEBA && PRUEBA.authUrl ? PRUEBA.authUrl + "/securetoken.googleapis.com" : "https://securetoken.googleapis.com") + "/v1/token";
  // En pruebas sin servidor de cuentas simulado no se llama a nadie.
  var HAY_SERVICIO = !PRUEBA || !!PRUEBA.authUrl;

  function leer() {
    try {
      var s = JSON.parse(localStorage.getItem(CLAVE) || "null");
      return s && s.uid && s.idToken && s.refreshToken ? s : null;
    } catch (e) {
      return null;
    }
  }
  function guardar(s) {
    try {
      if (s) localStorage.setItem(CLAVE, JSON.stringify(s));
      else localStorage.removeItem(CLAVE);
    } catch (e) {}
  }

  var sesion = leer();
  var oyentes = [];
  function avisar() {
    oyentes.slice().forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
  }
  function poner(s) {
    var antes = sesion ? sesion.uid : null;
    sesion = s;
    guardar(s);
    if ((s ? s.uid : null) !== antes) avisar(); // Firestore reabre sus conexiones con la cuenta nueva
  }

  function fallo(code, detalle) {
    var e = new Error("Cuenta: " + code + (detalle ? " (" + detalle + ")" : ""));
    e.code = code;
    return e;
  }
  // Traduce la respuesta del servicio de cuentas a pocos casos.
  function codigoDe(mensaje) {
    var m = String(mensaje || "");
    if (/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_EMAIL/.test(m)) return "clave";
    if (/EMAIL_EXISTS/.test(m)) return "existe";
    if (/USER_DISABLED/.test(m)) return "deshabilitada";
    if (/TOO_MANY_ATTEMPTS/.test(m)) return "intentos";
    if (/TOKEN_EXPIRED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN|INVALID_GRANT_TYPE|MISSING_REFRESH_TOKEN/.test(m)) return "vencida";
    if (/WEAK_PASSWORD/.test(m)) return "debil";
    return "error";
  }
  async function pedir(url, cuerpo, formulario) {
    if (!HAY_SERVICIO) throw fallo("red", "sin servicio de cuentas");
    var corte = typeof AbortController !== "undefined" ? new AbortController() : null;
    var reloj = setTimeout(function () {
      if (corte) corte.abort();
    }, ESPERA_MS);
    var res, datos;
    try {
      res = await fetch(url + "?key=" + API_KEY, {
        method: "POST",
        headers: { "Content-Type": formulario ? "application/x-www-form-urlencoded" : "application/json" },
        body: formulario ? new URLSearchParams(cuerpo).toString() : JSON.stringify(cuerpo),
        signal: corte ? corte.signal : undefined,
      });
      datos = await res.json().catch(function () {
        return null;
      });
    } catch (e) {
      throw fallo("red", e && e.message);
    } finally {
      clearTimeout(reloj);
    }
    if (res.ok && datos) return datos;
    var mensaje = datos && datos.error && datos.error.message;
    if (res.status >= 500 || !mensaje) throw fallo("red", "HTTP " + res.status);
    throw fallo(codigoDe(mensaje), mensaje);
  }

  function armar(d, extra) {
    return {
      uid: d.localId,
      email: d.email || "",
      idToken: d.idToken,
      refreshToken: d.refreshToken,
      vence: Date.now() + (Number(d.expiresIn) || 3600) * 1000,
      usuario: (extra && extra.usuario) || "",
      rol: (extra && extra.rol) || "",
    };
  }

  // Varias partes de la página pueden pedir el pase a la vez: una sola renovación.
  var renovando = null;
  function renovar() {
    if (renovando) return renovando;
    var de = sesion;
    renovando = pedir(URL_PASE, { grant_type: "refresh_token", refresh_token: de.refreshToken }, true)
      .then(
        function (d) {
          if (sesion && sesion.uid === de.uid) {
            sesion = Object.assign({}, sesion, { idToken: d.id_token, refreshToken: d.refresh_token || de.refreshToken, vence: Date.now() + (Number(d.expires_in) || 3600) * 1000 });
            guardar(sesion);
          }
          return sesion ? sesion.idToken : null;
        },
        function (e) {
          // La cuenta ya no vale (se borró o se deshabilitó): este teléfono queda sin sesión.
          if (e.code === "vencida" || e.code === "deshabilitada") {
            if (sesion && sesion.uid === de.uid) poner(null);
            return null;
          }
          throw e;
        }
      )
      .finally(function () {
        renovando = null;
      });
    return renovando;
  }

  /** Pase vigente de la cuenta (o null si este teléfono no tiene sesión). */
  async function pase(forzar) {
    if (!sesion) return null;
    if (!forzar && sesion.vence - Date.now() > MARGEN_MS) return sesion.idToken;
    try {
      return await renovar();
    } catch (e) {
      // Sin señal: si el pase todavía no venció, se sigue con ese.
      if (!forzar && sesion && sesion.vence > Date.now()) return sesion.idToken;
      throw e;
    }
  }

  function hex(texto) {
    var bytes = new TextEncoder().encode(texto);
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }
  /** Identificador de un usuario para la cuenta y para ingreso/{id}. */
  function idDe(usuario) {
    var u = String(usuario || "").toLowerCase();
    return /^[a-z0-9]{1,40}$/.test(u) ? "d-" + u : "x-" + hex(u).slice(0, 56);
  }

  window.SersaleCuenta = {
    ID_OPERARIO: "operario",
    /** { uid, usuario, rol } de la cuenta con la que este teléfono tiene sesión, o null. */
    actual: function () {
      return sesion ? { uid: sesion.uid, usuario: sesion.usuario, rol: sesion.rol } : null;
    },
    idDe: idDe,
    /** Cuenta que le corresponde a un usuario. `gen` sube cada vez que se le cambia la clave. */
    correo: function (usuario, gen) {
      return idDe(usuario) + "-g" + (gen || 1) + "@" + DOMINIO;
    },
    correoOperario: function (gen) {
      return "operario-g" + (gen || 1) + "@" + DOMINIO;
    },
    /** La clave de la cuenta sale de la clave del sistema (Firebase exige 6 caracteres o más). */
    claveCuenta: function (clave) {
      return "sersale:" + clave;
    },
    /**
     * Inicia sesión en este teléfono. Errores con .code: "clave" (no existe o clave
     * incorrecta), "red" (sin respuesta), "intentos", "deshabilitada", "error".
     */
    ingresar: async function (email, clave, extra) {
      var d = await pedir(URL_CUENTAS + "signInWithPassword", { email: email, password: clave, returnSecureToken: true });
      poner(armar(d, extra));
      return this.actual();
    },
    /**
     * Crea una cuenta. No cambia la sesión de este teléfono salvo extra.ingresar
     * (un Director le crea la cuenta a otro sin dejar de ser él).
     * Errores con .code: "existe", "red", "debil", "error".
     */
    crear: async function (email, clave, extra) {
      var d = await pedir(URL_CUENTAS + "signUp", { email: email, password: clave, returnSecureToken: true });
      if (extra && extra.ingresar) poner(armar(d, extra));
      return { uid: d.localId };
    },
    salir: function () {
      poner(null);
    },
    pase: pase,
    /** Lo que Firestore necesita para mandar el pase (lo registran js/fb.js y js/fb-compat.js). */
    proveedor: {
      getToken: function (forzar) {
        return pase(!!forzar).then(function (t) {
          return t ? { accessToken: t } : null;
        });
      },
      getUid: function () {
        return sesion ? sesion.uid : null;
      },
      addAuthTokenListener: function (fn) {
        if (oyentes.indexOf(fn) < 0) oyentes.push(fn);
        // Firestore espera el primer aviso para arrancar: va enseguida, sin consultar a nadie.
        setTimeout(function () {
          if (oyentes.indexOf(fn) >= 0) fn();
        }, 0);
      },
      removeAuthTokenListener: function (fn) {
        var i = oyentes.indexOf(fn);
        if (i >= 0) oyentes.splice(i, 1);
      },
    },
    /** Componente "auth-internal" para registrar en la app de Firebase. */
    componente: function () {
      var self = this;
      return {
        name: "auth-internal",
        instanceFactory: function () {
          return self.proveedor;
        },
        multipleInstances: false,
        serviceProps: {},
        instantiationMode: "LAZY",
        onInstanceCreated: null,
        type: "PRIVATE",
      };
    },
  };

  // Otra pestaña (o la pantalla de ingreso) cambió la sesión.
  window.addEventListener("storage", function (ev) {
    if (ev.key !== CLAVE) return;
    var antes = sesion ? sesion.uid : null;
    sesion = leer();
    if ((sesion ? sesion.uid : null) !== antes) avisar();
  });
})();

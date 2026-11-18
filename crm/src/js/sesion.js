// Sesión recordada en este dispositivo.
//
// El acceso se guardaba solo en sessionStorage, que el iPhone borra cada vez
// que se cierra la app de la pantalla de inicio: había que volver a entrar
// todas las veces. Si al ingresar se eligió "Recordarme", acá se restaura la
// sesión antes de que corra el control de acceso de cada página.
(function () {
  var CLAVE = "sersale_sesion";
  var DURACION_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

  function leer() {
    try {
      var s = JSON.parse(localStorage.getItem(CLAVE) || "null");
      if (!s || !s.role || !s.hasta || s.hasta < Date.now()) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  window.SersaleSesion = {
    /** Guarda la sesión actual para los próximos ingresos. */
    recordar: function () {
      try {
        var role = sessionStorage.getItem("sersale_role");
        if (!role) return;
        localStorage.setItem(
          CLAVE,
          JSON.stringify({
            role: role,
            usuario: sessionStorage.getItem("sersale_usuario") || "",
            nombre: sessionStorage.getItem("sersale_nombre") || "",
            hasta: Date.now() + DURACION_MS,
          })
        );
      } catch (e) {}
    },
    /** Olvida la sesión recordada (al salir). */
    olvidar: function () {
      try {
        localStorage.removeItem(CLAVE);
      } catch (e) {}
    },
    recordada: leer,
  };

  try {
    if (!sessionStorage.getItem("sersale_role")) {
      var s = leer();
      if (s) {
        sessionStorage.setItem("sersale_role", s.role);
        sessionStorage.setItem("sersale_auth", "ok");
        if (s.usuario) sessionStorage.setItem("sersale_usuario", s.usuario);
        if (s.nombre) sessionStorage.setItem("sersale_nombre", s.nombre);
      }
    }
  } catch (e) {}
})();

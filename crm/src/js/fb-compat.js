// Conexión a Firestore para las páginas que usan la API "compat" (ventas, backup).
// Misma configuración que js/fb.js. En pruebas (solo localhost) usa el emulador.
(function () {
  var enLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var PRUEBA = enLocal ? window.__SERSALE_TEST__ || null : null;
  var config = {
    apiKey: "AIzaSyDyijnox-MMjZTefC3LpT-KApfcU6uev8g",
    authDomain: "sersale-produccion.firebaseapp.com",
    projectId: PRUEBA ? PRUEBA.projectId : "sersale-produccion",
    storageBucket: "sersale-produccion.firebasestorage.app",
    messagingSenderId: "925974326060",
    appId: "1:925974326060:web:12143f2ebb812d19dfda89",
  };
  var db = null;
  window.sersaleDbCompat = function () {
    if (db) return db;
    var app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
    db = firebase.firestore(app);
    if (PRUEBA) db.useEmulator(PRUEBA.emulatorHost, PRUEBA.emulatorPort);
    return db;
  };
})();

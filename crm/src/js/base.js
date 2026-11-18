// Funciones compartidas del CRM Sersale: fechas, montos y texto.
//
// Fechas: el negocio trabaja en hora de Buenos Aires. `new Date().toISOString()`
// da la fecha en UTC (después de las 21:00 ya es "mañana"), y `new Date("2026-11-10")`
// se interpreta como medianoche UTC (se muestra como el día anterior). Todo lo
// que sea "qué día es" o "mostrar una fecha" pasa por acá.
(function () {
  "use strict";

  var ZONA = "America/Argentina/Buenos_Aires";
  var SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
  var fmtYMD = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });
  var fmtHM = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false });

  function dos(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /**
   * Convierte a Date cualquier fecha de las que guarda el sistema: "AAAA-MM-DD"
   * (se toma como ese día en Buenos Aires, al mediodía), texto ISO con hora,
   * Timestamp de Firestore, milisegundos o Date. Devuelve null si no es válida.
   */
  function aFecha(v) {
    if (v == null || v === "") return null;
    var d;
    if (v instanceof Date) d = v;
    else if (typeof v === "object" && typeof v.toDate === "function") d = v.toDate();
    else if (typeof v === "object" && typeof v.seconds === "number") d = new Date(v.seconds * 1000);
    else if (typeof v === "number") d = new Date(v);
    else if (typeof v === "string") {
      var m = SOLO_FECHA.exec(v.trim());
      d = m ? new Date(m[1] + "-" + m[2] + "-" + m[3] + "T12:00:00-03:00") : new Date(v);
    } else return null;
    return isNaN(d.getTime()) ? null : d;
  }

  /** "AAAA-MM-DD" del día en Buenos Aires de una fecha. Sin argumento: hoy. Fecha inválida o vacía: "". */
  function diaDe(v) {
    if (arguments.length === 0) return fmtYMD.format(new Date());
    if (typeof v === "string" && SOLO_FECHA.test(v.trim())) return v.trim();
    var d = aFecha(v);
    return d ? fmtYMD.format(d) : "";
  }

  /** Hoy en Buenos Aires, "AAAA-MM-DD". */
  function hoy() {
    return fmtYMD.format(new Date());
  }

  /** Suma (o resta) días a un "AAAA-MM-DD" y devuelve "AAAA-MM-DD". */
  function sumarDias(dia, n) {
    var m = SOLO_FECHA.exec(diaDe(dia));
    if (!m) return "";
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return d.getUTCFullYear() + "-" + dos(d.getUTCMonth() + 1) + "-" + dos(d.getUTCDate());
  }

  /** Días de calendario desde `desde` hasta `hasta` (por defecto hoy). Negativo si `desde` es futuro. */
  function diasEntre(desde, hasta) {
    var a = SOLO_FECHA.exec(diaDe(desde));
    var b = SOLO_FECHA.exec(hasta == null ? hoy() : diaDe(hasta));
    if (!a || !b) return NaN;
    return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
  }

  /** "dd/mm/aaaa". Texto vacío si la fecha no es válida. */
  function fmtFecha(v) {
    var m = SOLO_FECHA.exec(diaDe(v));
    return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
  }
  /** "dd/mm". */
  function fmtFechaCorta(v) {
    var m = SOLO_FECHA.exec(diaDe(v));
    return m ? m[3] + "/" + m[2] : "";
  }
  /** "HH:MM" en Buenos Aires. */
  function fmtHora(v) {
    var d = aFecha(v);
    return d ? fmtHM.format(d) : "";
  }
  /** Día de la semana de un "AAAA-MM-DD": 0 domingo … 6 sábado. */
  function diaSemana(v) {
    var m = SOLO_FECHA.exec(diaDe(v));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : NaN;
  }

  /**
   * Número escrito a la argentina -> number. "8.990" -> 8990, "1.234,56" -> 1234.56,
   * "1,5" -> 1.5, "$ 12.500" -> 12500, "1500.50" -> 1500.5 (un solo punto que no
   * separa de a tres cifras es decimal). Vacío o inválido -> 0.
   */
  function numero(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    if (v == null) return 0;
    var s = String(v).replace(/[^\d.,-]/g, "");
    var negativo = /^-/.test(s);
    s = s.replace(/-/g, "");
    if (!s) return 0;
    if (s.indexOf(",") !== -1) {
      var ultima = s.lastIndexOf(",");
      s = s.slice(0, ultima).replace(/[.,]/g, "") + "." + s.slice(ultima + 1).replace(/[.,]/g, "");
    } else {
      var partes = s.split(".");
      var esMiles = partes.length > 1 && partes[0].length <= 3 && partes[0] !== "" && partes.slice(1).every(function (p) { return p.length === 3; });
      if (esMiles || partes.length > 2) s = partes.join("");
    }
    var n = parseFloat(s);
    if (!isFinite(n)) return 0;
    return negativo ? -n : n;
  }

  /** Redondeo a `dec` decimales sin los errores de coma flotante (1.005 -> 1.01). */
  function redondear(n, dec) {
    var f = Math.pow(10, dec == null ? 2 : dec);
    var x = Number(n);
    if (!isFinite(x)) return 0;
    return Math.round((x + Math.sign(x) * Number.EPSILON) * f) / f;
  }

  /** "$8.990". Con signo: "-$1.200". `dec` decimales (0 por defecto). */
  function fmtMonto(n, dec) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    dec = dec || 0;
    var abs = Math.abs(redondear(x, dec));
    var txt = abs.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return (x < 0 && abs !== 0 ? "-$" : "$") + txt;
  }
  /** Número con separador de miles y hasta `dec` decimales: "1.234,5". */
  function fmtNumero(n, dec) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return x.toLocaleString("es-AR", { maximumFractionDigits: dec == null ? 2 : dec });
  }

  /** Para comparar o buscar nombres: minúsculas, sin acentos, sin espacios de más. */
  function norm(s) {
    return String(s == null ? "" : s)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }
  function mismoNombre(a, b) {
    return norm(a) === norm(b);
  }
  /** ¿`texto` contiene todas las palabras de `busqueda`? (sin acentos ni mayúsculas) */
  function coincide(texto, busqueda) {
    var t = norm(texto);
    return norm(busqueda).split(" ").every(function (p) { return t.indexOf(p) !== -1; });
  }

  /** Link de WhatsApp con el texto bien codificado. `telefono` opcional (solo dígitos). */
  function waLink(texto, telefono) {
    var tel = String(telefono || "").replace(/\D/g, "");
    return "https://wa.me/" + tel + "?text=" + encodeURIComponent(String(texto == null ? "" : texto));
  }

  /** Escapa texto para meterlo dentro de HTML armado a mano. */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /**
   * Para React: envuelve una acción asíncrona (guardar, eliminar…) para que no
   * pueda dispararse dos veces por un doble toque.
   *   const [guardar, guardando] = SersaleBase.useAccion(async () => { ... });
   *   <button disabled={guardando} onClick={guardar}>
   */
  function useAccion(fn) {
    var R = window.React;
    var enCurso = R.useRef(false);
    var estado = R.useState(false);
    var ultima = R.useRef(fn);
    ultima.current = fn;
    var ejecutar = R.useCallback(async function () {
      if (enCurso.current) return undefined;
      enCurso.current = true;
      estado[1](true);
      try {
        return await ultima.current.apply(null, arguments);
      } finally {
        enCurso.current = false;
        estado[1](false);
      }
    }, []);
    return [ejecutar, estado[0]];
  }

  // ── Campo para kilos y cantidades con decimales ──────────────────────────
  // El campo "número" del navegador se lleva mal con la coma decimal en el
  // iPhone. Este campo es de texto con teclado numérico: acepta coma o punto
  // (30,4 o 30.4), muestra coma y entrega el valor como siempre se guardó, con
  // punto ("30.4"). En kilos el punto nunca es separador de miles.

  /** Lo que se va escribiendo: solo dígitos y una coma; como mucho `dec` decimales. */
  function decimalLimpiar(texto, dec) {
    var t = String(texto == null ? "" : texto).replace(/\./g, ",").replace(/[^\d,]/g, "");
    var i = t.indexOf(",");
    if (i === -1) return t;
    return t.slice(0, i) + "," + t.slice(i + 1).replace(/,/g, "").slice(0, dec);
  }
  /** Texto del campo -> valor guardado: "30,4" -> "30.4", "30," -> "30", ",5" -> "0.5". */
  function decimalValor(texto) {
    var t = String(texto == null ? "" : texto).replace(",", ".");
    if (t === "" || t === ".") return "";
    if (t.charAt(0) === ".") t = "0" + t;
    if (t.charAt(t.length - 1) === ".") t = t.slice(0, -1);
    return t;
  }
  /** Valor guardado -> texto del campo: "30.4" o 30.4 -> "30,4". */
  function decimalVista(valor) {
    if (valor == null || valor === "") return "";
    return String(valor).replace(".", ",");
  }
  /**
   * Para React. Se usa como un <input>: `value` con punto decimal (texto o número)
   * y `onChange` recibe { target: { value } } con punto decimal.
   *   <SersaleBase.InputDecimal placeholder="kg" value={kg} onChange={e => setKg(e.target.value)} />
   * `decimales`: máximo de decimales (3 por defecto: hasta gramos).
   */
  function InputDecimal(props) {
    var R = window.React;
    var dec = props.decimales == null ? 3 : props.decimales;
    var afuera = props.value == null ? "" : String(props.value);
    var estado = R.useState(decimalVista(afuera));
    var texto = estado[0];
    var setTexto = estado[1];
    // Si el valor cambia desde afuera (otra hoja, formulario limpiado), se refleja;
    // mientras la persona escribe ("30,") no se le pisa lo que lleva puesto.
    R.useEffect(
      function () {
        var mio = decimalValor(texto);
        var igual = mio === afuera || (mio !== "" && afuera !== "" && Number(mio) === Number(afuera));
        if (!igual) setTexto(decimalVista(afuera));
      },
      [afuera]
    );
    var resto = {};
    for (var k in props) if (k !== "value" && k !== "onChange" && k !== "decimales") resto[k] = props[k];
    return R.createElement(
      "input",
      Object.assign({ type: "text", inputMode: "decimal", autoComplete: "off", enterKeyHint: "done" }, resto, {
        value: texto,
        onChange: function (e) {
          var t = decimalLimpiar(e.target.value, dec);
          setTexto(t);
          if (props.onChange) props.onChange({ target: { value: decimalValor(t) } });
        },
      })
    );
  }

  // ── Gesto "atrás" del teléfono ───────────────────────────────────────────
  // Cada vista o ventana que se abre dentro de una página anota una entrada en
  // el historial. Así el gesto de volver (deslizar desde el borde en el iPhone,
  // botón atrás en Android) cierra lo último que se abrió en vez de salir de
  // la página.
  var pilaAtras = [];
  var ignorar = []; // vencimientos de los "atrás" que disparamos nosotros
  window.addEventListener("popstate", function () {
    var ahora = Date.now();
    ignorar = ignorar.filter(function (t) { return t > ahora; });
    if (ignorar.length) {
      ignorar.shift();
      return;
    }
    var tope = pilaAtras.pop();
    if (tope) {
      try {
        tope.cb();
      } catch (e) {
        console.error(e);
      }
    }
  });
  /**
   * Avisa que se abrió algo que el gesto "atrás" debe cerrar. `alVolver` se
   * llama si la persona vuelve con el gesto. Devuelve una función para llamar
   * cuando se cierra desde la pantalla (botón, guardar, etc.).
   */
  function abrirAtras(alVolver) {
    var entrada = { cb: alVolver };
    pilaAtras.push(entrada);
    try {
      history.pushState({ ssAtras: pilaAtras.length }, "");
    } catch (e) {}
    return function cerrar() {
      var i = pilaAtras.indexOf(entrada);
      if (i === -1) return; // ya se cerró con el gesto
      var cuantas = pilaAtras.length - i; // también lo que haya quedado abierto encima
      pilaAtras.splice(i);
      ignorar.push(Date.now() + 1500);
      try {
        history.go(-cuantas);
      } catch (e) {}
    };
  }
  /**
   * Para React: mientras `activo` sea verdadero, el gesto "atrás" llama a `alVolver`.
   *   SersaleBase.useAtras(!!pedidoEditando, () => setPedidoEditando(null));
   */
  function useAtras(activo, alVolver) {
    var R = window.React;
    var ultima = R.useRef(alVolver);
    ultima.current = alVolver;
    R.useEffect(
      function () {
        if (!activo) return undefined;
        return abrirAtras(function () {
          ultima.current();
        });
      },
      [!!activo]
    );
  }

  window.SersaleBase = {
    ZONA: ZONA,
    aFecha: aFecha,
    diaDe: diaDe,
    hoy: hoy,
    sumarDias: sumarDias,
    diasEntre: diasEntre,
    fmtFecha: fmtFecha,
    fmtFechaCorta: fmtFechaCorta,
    fmtHora: fmtHora,
    diaSemana: diaSemana,
    numero: numero,
    redondear: redondear,
    fmtMonto: fmtMonto,
    fmtNumero: fmtNumero,
    norm: norm,
    mismoNombre: mismoNombre,
    coincide: coincide,
    waLink: waLink,
    esc: esc,
    useAccion: useAccion,
    InputDecimal: InputDecimal,
    decimalLimpiar: decimalLimpiar,
    decimalValor: decimalValor,
    decimalVista: decimalVista,
    abrirAtras: abrirAtras,
    useAtras: useAtras,
  };
})();

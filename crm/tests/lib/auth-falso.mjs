// Servidor de cuentas simulado para las pruebas: contesta lo que el SDK de
// Firebase Auth le pide al emulador de Authentication (crear cuenta, ingresar
// con mail y clave, renovar la sesión, cambiar la clave), sin firebase-tools.
//
// Los tokens que entrega no están firmados (alg "none"): el emulador de
// Firestore los acepta y con eso evalúa las reglas de seguridad igual que el
// servidor real. Nunca sirven contra la base real.
import http from "node:http";
import crypto from "node:crypto";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** Token de sesión (sin firma) para un uid, como el que arma Firebase Auth. */
export function tokenFalso(projectId, uid, email = uid + "@prueba.test") {
  const ahora = Math.floor(Date.now() / 1000);
  return (
    b64({ alg: "none", typ: "JWT" }) +
    "." +
    b64({
      iss: "https://securetoken.google.com/" + projectId,
      aud: projectId,
      auth_time: ahora,
      user_id: uid,
      sub: uid,
      iat: ahora,
      exp: ahora + 3600,
      email,
      email_verified: false,
      firebase: { identities: { email: [email] }, sign_in_provider: "password" },
    }) +
    "."
  );
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "600",
};

/**
 * startAuth({ projectId }) -> { url, host, port, cuentas, pedidos, crear(email, clave), caido, close() }
 *   cuentas   Map email -> { uid, email, clave, creada }
 *   pedidos   lista de { ruta } recibidos (para comprobar qué pidió la página)
 *   caido     poner en true para que conteste 503 (servidor de cuentas sin respuesta)
 */
export async function startAuth({ projectId, host = "127.0.0.1" } = {}) {
  const cuentas = new Map();
  const porUid = new Map();
  const sesiones = new Map(); // refreshToken -> uid
  const pedidos = [];
  const estado = { caido: false };

  function crear(email, clave) {
    const c = { uid: crypto.randomBytes(14).toString("base64url"), email: String(email).toLowerCase(), clave, creada: Date.now() };
    cuentas.set(c.email, c);
    porUid.set(c.uid, c);
    return c;
  }
  function entrega(c, extra = {}) {
    const refreshToken = crypto.randomBytes(24).toString("base64url");
    sesiones.set(refreshToken, c.uid);
    return { kind: "identitytoolkit#Respuesta", localId: c.uid, email: c.email, idToken: tokenFalso(projectId, c.uid, c.email), refreshToken, expiresIn: "3600", ...extra };
  }
  function uidDe(idToken) {
    try {
      return JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString("utf8")).user_id;
    } catch {
      return null;
    }
  }
  const error = (mensaje) => ({ status: 400, body: { error: { code: 400, message: mensaje, errors: [{ message: mensaje, reason: "invalid", domain: "global" }] } } });

  function atender(ruta, datos) {
    if (ruta.endsWith("/accounts:signUp")) {
      const email = String(datos.email || "").toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return error("INVALID_EMAIL");
      if (cuentas.has(email)) return error("EMAIL_EXISTS");
      if (String(datos.password || "").length < 6) return error("WEAK_PASSWORD : Password should be at least 6 characters");
      return { status: 200, body: entrega(crear(email, datos.password)) };
    }
    if (ruta.endsWith("/accounts:signInWithPassword")) {
      const c = cuentas.get(String(datos.email || "").toLowerCase());
      if (!c || c.clave !== datos.password) return error("INVALID_LOGIN_CREDENTIALS");
      return { status: 200, body: entrega(c, { registered: true, displayName: "" }) };
    }
    if (ruta.endsWith("/accounts:lookup")) {
      const c = porUid.get(uidDe(datos.idToken));
      if (!c) return error("USER_NOT_FOUND");
      return {
        status: 200,
        body: {
          kind: "identitytoolkit#GetAccountInfoResponse",
          users: [
            {
              localId: c.uid,
              email: c.email,
              emailVerified: false,
              passwordHash: "x",
              passwordUpdatedAt: c.creada,
              validSince: String(Math.floor(c.creada / 1000)),
              lastLoginAt: String(Date.now()),
              createdAt: String(c.creada),
              providerUserInfo: [{ providerId: "password", federatedId: c.email, email: c.email, rawId: c.email }],
            },
          ],
        },
      };
    }
    if (ruta.endsWith("/accounts:update")) {
      const c = porUid.get(uidDe(datos.idToken));
      if (!c) return error("USER_NOT_FOUND");
      if (datos.password !== undefined) {
        if (String(datos.password).length < 6) return error("WEAK_PASSWORD : Password should be at least 6 characters");
        c.clave = datos.password;
      }
      return { status: 200, body: entrega(c, { passwordHash: "x", providerUserInfo: [{ providerId: "password", federatedId: c.email }] }) };
    }
    if (ruta.endsWith("/accounts:delete")) {
      const c = porUid.get(uidDe(datos.idToken));
      if (c) {
        cuentas.delete(c.email);
        porUid.delete(c.uid);
      }
      return { status: 200, body: { kind: "identitytoolkit#DeleteAccountResponse" } };
    }
    if (ruta.endsWith("/v1/token")) {
      const uid = sesiones.get(datos.refresh_token);
      const c = uid && porUid.get(uid);
      if (!c) return error("TOKEN_EXPIRED");
      const idToken = tokenFalso(projectId, c.uid, c.email);
      return { status: 200, body: { access_token: idToken, id_token: idToken, refresh_token: datos.refresh_token, expires_in: "3600", token_type: "Bearer", user_id: c.uid, project_id: projectId } };
    }
    return { status: 404, body: { error: { code: 404, message: "NO_SIMULADO " + ruta } } };
  }

  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    const ruta = new URL(req.url, "http://x").pathname;
    let cuerpo = "";
    req.on("data", (d) => (cuerpo += d));
    req.on("end", () => {
      pedidos.push({ ruta });
      let r;
      if (estado.caido) r = { status: 503, body: { error: { code: 503, message: "UNAVAILABLE" } } };
      else {
        let datos = {};
        try {
          datos = /json/.test(req.headers["content-type"] || "") ? JSON.parse(cuerpo || "{}") : Object.fromEntries(new URLSearchParams(cuerpo));
        } catch {}
        r = atender(ruta, datos);
      }
      res.writeHead(r.status, { ...CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((ok, mal) => {
    server.once("error", mal);
    server.listen(0, host, ok);
  });
  const port = server.address().port;
  return {
    url: `http://${host}:${port}`,
    host,
    port,
    cuentas,
    pedidos,
    crear,
    get caido() {
      return estado.caido;
    },
    set caido(v) {
      estado.caido = !!v;
    },
    close: () =>
      new Promise((ok) => {
        server.closeAllConnections?.();
        server.close(() => ok());
      }),
  };
}

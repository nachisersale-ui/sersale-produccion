// Firestore emulator: jar management, process lifecycle and REST helpers
// (seed / dump / clear) used by the tests.
//
// The emulator runs standalone (no firebase-tools): java -jar <jar> --host --port.
// Without a rules file it applies OPEN_RULES (allow read, write: if true), so the
// unauthenticated SDK in the pages can read and write, exactly as the pages need.
// Rules are stored PER PROJECT ID, and every test uses its own "demo-*" project,
// so tests are isolated from each other while sharing one emulator process.
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CRM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CACHE_DIR = process.env.SERSALE_CACHE_DIR || path.join(CRM_DIR, ".cache");

export const EMULATOR_VERSION = "1.22.0";
export const JAR_NAME = `cloud-firestore-emulator-v${EMULATOR_VERSION}.jar`;
export const JAR_SHA256 = "9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c";
export const JAR_URL = `https://storage.googleapis.com/firebase-preview-drop/emulator/${JAR_NAME}`;

// Places where the jar may already be on disk (checked before downloading).
function localJarCandidates() {
  return [
    process.env.SERSALE_EMULATOR_JAR,
    // firebase-tools cache, if the Firebase CLI was ever used on this machine.
    path.join(os.homedir(), ".cache", "firebase", "emulators", JAR_NAME),
  ].filter(Boolean);
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

async function download(url, dest) {
  // curl honours HTTPS_PROXY / CA settings of the machine; fall back to fetch.
  try {
    execFileSync("curl", ["-fsSL", "--retry", "3", "-o", dest, url], { stdio: ["ignore", "ignore", "pipe"] });
    return;
  } catch (e) {
    if (e.code !== "ENOENT") throw new Error(`No se pudo descargar ${url}: ${String(e.stderr || e.message).trim()}`);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar ${url}: HTTP ${res.status}`);
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/**
 * Makes the emulator jar available in CACHE_DIR (outside git) and returns its path.
 * Copies a local copy when there is one, otherwise downloads it. The sha256 is
 * always verified; the result of the verification is remembered in a sidecar
 * file so the 130 MB jar is not re-hashed on every run.
 */
export async function ensureEmulator() {
  const jar = path.join(CACHE_DIR, JAR_NAME);
  const stamp = jar + ".verified";
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });

  const verified = async (file) => {
    const st = await fs.promises.stat(file).catch(() => null);
    if (!st) return false;
    const key = `${st.size}:${Math.round(st.mtimeMs)}:${JAR_SHA256}`;
    if (file === jar && (await fs.promises.readFile(stamp, "utf8").catch(() => "")) === key) return true;
    if ((await sha256File(file)) !== JAR_SHA256) return false;
    if (file === jar) await fs.promises.writeFile(stamp, key);
    return true;
  };

  if (await verified(jar)) return jar;
  await fs.promises.rm(jar, { force: true });
  await fs.promises.rm(stamp, { force: true });

  const tmp = `${jar}.${process.pid}.tmp`;
  try {
    for (const candidate of localJarCandidates()) {
      if (!fs.existsSync(candidate)) continue;
      await fs.promises.copyFile(candidate, tmp);
      if ((await sha256File(tmp)) === JAR_SHA256) break;
      await fs.promises.rm(tmp, { force: true });
    }
    if (!fs.existsSync(tmp)) {
      await download(JAR_URL, tmp);
      const got = await sha256File(tmp);
      if (got !== JAR_SHA256) {
        throw new Error(`El jar descargado de ${JAR_URL} no coincide con el sha256 esperado (${got} != ${JAR_SHA256}).`);
      }
    }
    await fs.promises.rename(tmp, jar); // atomic: parallel processes never see a partial jar
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
  if (!(await verified(jar))) throw new Error(`No se pudo verificar ${jar}`);
  return jar;
}

function freePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function answers(hostPort) {
  try {
    const res = await fetch(`http://${hostPort}/`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUntilUp(hostPort, { timeoutMs, child, logFile }) {
  const t0 = Date.now();
  for (;;) {
    if (await answers(hostPort)) return;
    if (child && child.exitCode !== null) {
      const tail = logFile ? fs.readFileSync(logFile, "utf8").split("\n").slice(-15).join("\n") : "";
      throw new Error(`El emulador de Firestore terminó al arrancar (código ${child.exitCode}).\n${tail}`);
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`El emulador de Firestore no respondió en ${hostPort} tras ${timeoutMs} ms.`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

let started = null;

/**
 * Starts ONE emulator for this process (or reuses the one announced in
 * FIRESTORE_EMULATOR_HOST) and resolves once it answers.
 * Returns { host, port, hostPort, reused, startMs, stop() }.
 * The spawned emulator is stopped automatically when this process exits.
 */
export function startEmulator(opts = {}) {
  if (!started) {
    started = start(opts).catch((e) => {
      started = null;
      throw e;
    });
  }
  return started;
}

async function start({ host = "127.0.0.1", port, timeoutMs = 60_000 } = {}) {
  const t0 = Date.now();
  const existing = process.env.FIRESTORE_EMULATOR_HOST;
  if (existing) {
    await waitUntilUp(existing, { timeoutMs: 10_000 }).catch(() => {
      throw new Error(`FIRESTORE_EMULATOR_HOST=${existing} está definida pero ahí no responde ningún emulador.`);
    });
    const i = existing.lastIndexOf(":");
    return { host: existing.slice(0, i), port: Number(existing.slice(i + 1)), hostPort: existing, reused: true, startMs: Date.now() - t0, stop: async () => {} };
  }

  const jar = await ensureEmulator();
  const thePort = port || (await freePort(host));
  const hostPort = `${host}:${thePort}`;
  const logFile = path.join(CACHE_DIR, `firestore-emulator-${thePort}.log`);
  const log = fs.openSync(logFile, "w");

  let child;
  try {
    child = spawn("java", ["-jar", jar, `--host=${host}`, `--port=${thePort}`], { stdio: ["ignore", log, log], cwd: CACHE_DIR });
  } finally {
    fs.closeSync(log);
  }
  const spawnError = new Promise((_, reject) =>
    child.once("error", (e) =>
      reject(new Error(e.code === "ENOENT" ? "No se encontró `java`. El emulador de Firestore necesita Java 11 o superior." : `No se pudo iniciar java: ${e.message}`))
    )
  );
  child.unref(); // do not keep this process alive just because the emulator is running
  const kill = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  process.once("exit", kill);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(sig, () => {
      kill();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }

  try {
    await Promise.race([waitUntilUp(hostPort, { timeoutMs, child, logFile }), spawnError]);
  } catch (e) {
    kill();
    throw e;
  }
  process.env.FIRESTORE_EMULATOR_HOST = hostPort; // inherited by child processes (node --test)

  return {
    host,
    port: thePort,
    hostPort,
    reused: false,
    startMs: Date.now() - t0,
    logFile,
    stop: () =>
      new Promise((resolve) => {
        if (process.env.FIRESTORE_EMULATOR_HOST === hostPort) delete process.env.FIRESTORE_EMULATOR_HOST;
        started = null;
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => {
          fs.rm(logFile, { force: true }, () => resolve());
        });
        kill();
      }),
  };
}

// ───────────────────────── value encoding ─────────────────────────

const pad = (s, n) => String(s).padEnd(n, "0");

/** Canonical timestamp string: UTC, milliseconds; microseconds only when present. */
export function canonicalTs(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Fecha inválida en el seed");
    return value.toISOString();
  }
  const str = String(value);
  const ms = Date.parse(str);
  if (Number.isNaN(ms)) throw new Error(`Timestamp inválido: ${JSON.stringify(value)}`);
  const iso = new Date(ms).toISOString(); // 2026-11-10T13:30:00.000Z
  const frac = /T\d\d:\d\d:\d\d\.(\d+)/.exec(str);
  const digits = frac ? frac[1].slice(0, 9) : "";
  if (digits.length > 3 && /[1-9]/.test(digits.slice(3))) {
    return `${iso.slice(0, 19)}.${pad(digits, 6).replace(/0+$/, "").padEnd(6, "0")}Z`;
  }
  return iso;
}

/** Marker for a Firestore timestamp in seeds and dumps: ts("2026-11-10T10:30:00-03:00"). */
export function ts(value) {
  return { __ts: canonicalTs(value) };
}

const isPlainObject = (v) => v !== null && typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const onlyKey = (v, k) => isPlainObject(v) && Object.keys(v).length === 1 && k in v;

export function encodeValue(v, projectId, where = "") {
  if (v === null) return { nullValue: null };
  switch (typeof v) {
    case "boolean":
      return { booleanValue: v };
    case "string":
      return { stringValue: v };
    case "number":
      // Same rule as the JS SDK: safe integers are stored as integers, the rest as doubles.
      return Number.isSafeInteger(v) && !Object.is(v, -0) ? { integerValue: String(v) } : { doubleValue: Number.isFinite(v) ? v : String(v) };
    case "bigint":
      return { integerValue: v.toString() };
    case "undefined":
      throw new Error(`Valor undefined en el seed (${where}). Firestore no lo admite.`);
  }
  if (v instanceof Date) return { timestampValue: canonicalTs(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map((x, i) => encodeValue(x, projectId, `${where}[${i}]`)) } };
  if (isPlainObject(v)) {
    if (onlyKey(v, "__ts")) return { timestampValue: canonicalTs(v.__ts) };
    if (onlyKey(v, "__double")) return { doubleValue: typeof v.__double === "number" && Number.isFinite(v.__double) ? v.__double : String(v.__double) };
    if (onlyKey(v, "__int")) return { integerValue: String(v.__int) };
    if (onlyKey(v, "__ref")) return { referenceValue: `projects/${projectId}/databases/(default)/documents/${v.__ref}` };
    if (onlyKey(v, "__geo")) return { geoPointValue: { latitude: v.__geo[0], longitude: v.__geo[1] } };
    if (onlyKey(v, "__bytes")) return { bytesValue: v.__bytes };
    return { mapValue: { fields: encodeFields(v, projectId, where) } };
  }
  throw new Error(`Tipo no soportado en el seed (${where}): ${Object.prototype.toString.call(v)}`);
}

export function encodeFields(obj, projectId, where = "") {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue; // same as ignoreUndefinedProperties
    fields[k] = encodeValue(v, projectId, where ? `${where}.${k}` : k);
  }
  return fields;
}

export function decodeValue(v, { exact = false } = {}) {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) {
    const n = Number(v.integerValue);
    return Number.isSafeInteger(n) ? n : { __int: String(v.integerValue) };
  }
  if ("doubleValue" in v) {
    const d = v.doubleValue;
    if (typeof d !== "number") return exact ? { __double: d } : Number(d); // "NaN" | "Infinity" | "-Infinity"
    return exact && Number.isInteger(d) ? { __double: d } : d;
  }
  if ("timestampValue" in v) return { __ts: canonicalTs(v.timestampValue) };
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {}, { exact });
  if ("arrayValue" in v) return (v.arrayValue.values || []).map((x) => decodeValue(x, { exact }));
  if ("referenceValue" in v) return { __ref: v.referenceValue.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, "") };
  if ("geoPointValue" in v) return { __geo: [v.geoPointValue.latitude || 0, v.geoPointValue.longitude || 0] };
  if ("bytesValue" in v) return { __bytes: v.bytesValue };
  throw new Error(`Valor de Firestore desconocido: ${JSON.stringify(v)}`);
}

export function decodeFields(fields, opts) {
  const out = {};
  for (const k of Object.keys(fields).sort()) out[k] = decodeValue(fields[k], opts);
  return out;
}

// ───────────────────────── REST helpers ─────────────────────────

async function hostPort() {
  return (await startEmulator()).hostPort;
}

async function rest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Emulador ${method} ${url} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function assertProject(projectId) {
  if (!/^demo-[a-z0-9-]+$/.test(projectId || "")) {
    throw new Error(`projectId inválido: ${JSON.stringify(projectId)}. Los tests solo usan proyectos "demo-*" (nunca el de producción).`);
  }
}

const docsRoot = (projectId) => `projects/${projectId}/databases/(default)/documents`;
const docsUrl = async (projectId) => `http://${await hostPort()}/v1/${docsRoot(projectId)}`;

/**
 * Writes { collection: { docId: { ...fields } } } into the project. Existing documents with the
 * same id are replaced; the rest of the database is left untouched. Collection keys may be
 * paths ("clientes/c1/notas") for subcollections.
 * Values: null, booleans, strings, numbers (safe integers -> integer, otherwise double),
 * arrays, nested maps, Date and { __ts: ISO } (timestamp). Also { __double: n }, { __int: "n" },
 * { __ref: "col/doc" }, { __geo: [lat, lng] }, { __bytes: base64 }.
 * Returns the number of documents written.
 */
export async function seedDb(projectId, data) {
  assertProject(projectId);
  if (!data) return 0;
  const writes = [];
  for (const [collectionPath, docs] of Object.entries(data)) {
    if (!isPlainObject(docs)) throw new Error(`seedDb: "${collectionPath}" debe ser un objeto { docId: {campos} }`);
    for (const [id, fields] of Object.entries(docs)) {
      if (!isPlainObject(fields)) throw new Error(`seedDb: ${collectionPath}/${id} debe ser un objeto de campos`);
      if (!id || id.includes("/")) throw new Error(`seedDb: id de documento inválido en ${collectionPath}: ${JSON.stringify(id)}`);
      writes.push({ update: { name: `${docsRoot(projectId)}/${collectionPath}/${id}`, fields: encodeFields(fields, projectId, `${collectionPath}/${id}`) } });
    }
  }
  const url = `${await docsUrl(projectId)}:commit`;
  let batch = [];
  let bytes = 0;
  const flush = async () => {
    if (batch.length) await rest("POST", url, { writes: batch });
    batch = [];
    bytes = 0;
  };
  for (const w of writes) {
    const size = JSON.stringify(w).length;
    if (batch.length >= 400 || bytes + size > 4_000_000) await flush();
    batch.push(w);
    bytes += size;
  }
  await flush();
  return writes.length;
}

async function listCollectionIds(projectId, parentPath = "") {
  const url = `${await docsUrl(projectId)}${parentPath ? "/" + parentPath : ""}:listCollectionIds`;
  const ids = [];
  let pageToken;
  do {
    const res = await rest("POST", url, { pageSize: 1000, pageToken });
    ids.push(...(res.collectionIds || []));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return ids;
}

async function listDocuments(projectId, collectionPath, opts) {
  const base = `${await docsUrl(projectId)}/${collectionPath}`;
  const out = {};
  let pageToken;
  do {
    const res = await rest("GET", `${base}?pageSize=1000${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`);
    for (const d of res.documents || []) out[d.name.slice(d.name.lastIndexOf("/") + 1)] = decodeFields(d.fields || {}, opts);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Reads EVERY collection of the project back into { collection: { docId: {...} } } (sorted keys),
 * with timestamps as { __ts: ISO-UTC }. Subcollections appear under their full path
 * ("clientes/c1/notas"). Options: exact (keep integer-valued doubles as { __double: n }).
 */
export async function dumpDb(projectId, { exact = false } = {}) {
  assertProject(projectId);
  const out = {};
  const top = (await listCollectionIds(projectId)).sort();
  for (const id of top) out[id] = await listDocuments(projectId, id, { exact });

  // Subcollections: one cheap name-only query over the whole database tells us if there are any.
  const all = await rest("POST", `${await docsUrl(projectId)}:runQuery`, {
    structuredQuery: { from: [{ allDescendants: true }], select: { fields: [{ fieldPath: "__name__" }] } },
  });
  const prefix = docsRoot(projectId) + "/";
  const nested = new Set();
  for (const row of all) {
    if (!row.document) continue;
    const segs = row.document.name.slice(prefix.length).split("/");
    if (segs.length > 2) nested.add(segs.slice(0, -1).join("/"));
  }
  for (const collectionPath of [...nested].sort()) out[collectionPath] = await listDocuments(projectId, collectionPath, { exact });
  return out;
}

/** Reads one document ("clientes/c1") as plain fields, or null when it does not exist. */
export async function getDocument(projectId, docPath, opts) {
  assertProject(projectId);
  const res = await fetch(`${await docsUrl(projectId)}/${docPath}`, { headers: { Authorization: "Bearer owner" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Emulador GET ${docPath} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return decodeFields((await res.json()).fields || {}, opts);
}

/** Deletes every document of the project. */
export async function clearDb(projectId) {
  assertProject(projectId);
  await rest("DELETE", `http://${await hostPort()}/emulator/v1/${docsRoot(projectId)}`);
}

/** Security rules currently applied to the project (OPEN_RULES unless setRules was called). */
export async function getRules(projectId) {
  assertProject(projectId);
  const res = await rest("GET", `http://${await hostPort()}/emulator/v1/projects/${projectId}:securityRules`);
  return res.rules?.files?.[0] || null;
}

/** Loads a rules source for this project only (other projects keep their own rules). */
export async function setRules(projectId, source) {
  assertProject(projectId);
  await rest("PUT", `http://${await hostPort()}/emulator/v1/projects/${projectId}:securityRules`, {
    rules: { files: [{ name: "firestore.rules", content: source }] },
  });
}

let counter = 0;
/** A fresh, unique project id: demo-<label>-<random>. */
export function newProjectId(label = "t") {
  // Project ids allow 6-30 chars: lowercase letters, digits and hyphens.
  const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12).replace(/-+$/, "") || "t";
  return `demo-${slug}-${(counter++ % 1296).toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

// CLI: `node tests/lib/emulator.mjs` keeps an emulator running (npm run emulator).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const emu = await startEmulator({ port: process.env.PORT ? Number(process.env.PORT) : undefined });
  console.log(`Emulador de Firestore ${EMULATOR_VERSION} listo en ${emu.hostPort} (${emu.startMs} ms${emu.reused ? ", reutilizado" : ""}).`);
  console.log(`  export FIRESTORE_EMULATOR_HOST=${emu.hostPort}`);
  if (!emu.reused) setInterval(() => {}, 1 << 30); // stay alive until Ctrl+C
}

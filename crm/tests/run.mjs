// Corre las pruebas con UN emulador de Firestore compartido.
//   node tests/run.mjs [archivos o --test-name-pattern "..."]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startEmulator } from "./lib/emulator.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const emu = await startEmulator();
const args = process.argv.slice(2);
const archivos = args.filter((a) => a.endsWith(".mjs"));
const resto = args.filter((a) => !a.endsWith(".mjs"));
const lista = archivos.length ? archivos : fs.readdirSync(AQUI).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => path.join(AQUI, f));
const hijo = spawn(process.execPath, ["--test", "--test-concurrency=3", ...resto, ...lista], {
  stdio: "inherit",
  env: { ...process.env, FIRESTORE_EMULATOR_HOST: emu.hostPort },
});
hijo.on("exit", async (codigo) => {
  await emu.stop?.();
  process.exit(codigo ?? 1);
});

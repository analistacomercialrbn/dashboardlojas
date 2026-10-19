import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const [pako, worker] = await Promise.all([
  fs.readFile(path.join(dir, "vendor/pako.min.js"), "utf8"),
  fs.readFile(path.join(dir, "worker.js"), "utf8")
]);
const bundle = [
  "var module={exports:{}};var exports=module.exports;",
  pako,
  "const pako=module.exports;",
  worker
].join("\n");
const output = path.join(dir, "worker.bundle.js");
await fs.writeFile(output, bundle);
console.log(`Bundle gerado: ${bundle.length.toLocaleString("pt-BR")} caracteres em ${output}`);

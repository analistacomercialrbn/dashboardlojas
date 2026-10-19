import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(dir, "worker.js");
const output = path.join(dir, "worker.bundle.js");
await fs.copyFile(source, output);
console.log(`Bundle gerado em ${output}`);

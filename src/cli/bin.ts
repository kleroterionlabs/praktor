#!/usr/bin/env node
// src/cli/bin.ts — the bin target; keeps process wiring out of the testable program builder.
import { existsSync, readFileSync } from "node:fs";
import { buildProgram, exitCodeFor } from "./index.js";

/** Load a local .env for dev convenience. Real environment variables ALWAYS win. */
function loadDotenv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    process.exitCode = exitCodeFor(err);
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`praktor: ${msg}\n`);
  }
}

void main();

// src/cli/index.ts — build the commander program (testable; bin.ts wires it to argv/process).
import { Command } from "commander";
import { registerDoctor } from "./commands/doctor.js";
import { registerHeal } from "./commands/heal.js";
import { registerImplement } from "./commands/implement.js";
import { registerNext } from "./commands/next.js";
import { registerStatus } from "./commands/status.js";

/** Map a thrown error to a process exit code (UsageError ⇒ 2, budget ⇒ 4, else 1). */
export function exitCodeFor(err: unknown): number {
  const name = err instanceof Error ? err.name : "";
  if (name === "UsageError") return 2;
  if (name === "BudgetError") return 4;
  return 1;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("praktor")
    .description("Autonomous engineer that implements Boule's Tasks and opens PRs.")
    .option("--repo <owner/repo>", "target repository")
    .option("--project <number>", "Projects v2 number", (v) => Number(v))
    .option("--budget <usd>", "hard cost cap (USD)", (v) => Number(v))
    .option("--max-turns <n>", "max agentic turns", (v) => Number(v))
    .option("--dry-run", "plan only; write nothing", false)
    .option("--json", "machine-readable output", false)
    .option("-v, --verbose", "verbose logging", false);

  for (const register of [registerDoctor, registerNext, registerStatus, registerImplement, registerHeal]) {
    register(program);
  }
  return program;
}

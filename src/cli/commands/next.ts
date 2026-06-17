// src/cli/commands/next.ts — show the Tasks that are READY to implement (read-only).
import type { Command } from "commander";
import { ulid } from "ulid";
import { listReadyTasks } from "../../github/tasks.js";
import { context, globals } from "./_shared.js";

export function registerNext(program: Command): void {
  program
    .command("next")
    .description("List Boule Tasks that are ready to implement (accepted + all prerequisites done).")
    .action(async (_local: unknown, cmd: Command) => {
      const ctx = await context(globals(cmd), ulid());
      const ready = await listReadyTasks(ctx.gh, ctx.owner, ctx.name);

      if (ctx.json) {
        process.stdout.write(`${JSON.stringify({ ready })}\n`);
        return;
      }
      if (ready.length === 0) {
        process.stdout.write("No ready tasks. (Either none accepted, or all are blocked.)\n");
        return;
      }
      const lines = [`${ready.length} ready task(s):`];
      for (const t of ready) {
        const verifies = t.verifies.length ? ` verifies ${t.verifies.map((n) => `#${n}`).join(",")}` : "";
        lines.push(`  #${t.number}  ${t.title}${verifies}`);
      }
      lines.push("\nImplement the first: praktor implement");
      process.stdout.write(`${lines.join("\n")}\n`);
    });
}

import { PRAKTOR_LABELS } from "@kleroterion/koine";
// src/cli/commands/status.ts — read-only snapshot: accepted vs ready vs in-flight, plus active claims.
import type { Command } from "commander";
import { ulid } from "ulid";
import { findCategoryId, listClaims } from "../../github/discussions.js";
import { listAcceptedTasks, listReadyTasks } from "../../github/tasks.js";
import { context, globals } from "./_shared.js";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Snapshot of Boule Tasks: accepted, ready, in-progress, and active Praktor claims.")
    .action(async (_local: unknown, cmd: Command) => {
      const ctx = await context(globals(cmd), ulid());
      const [accepted, ready] = await Promise.all([
        listAcceptedTasks(ctx.gh, ctx.owner, ctx.name),
        listReadyTasks(ctx.gh, ctx.owner, ctx.name),
      ]);
      const inProgress = accepted.filter((t) => t.labels.includes(PRAKTOR_LABELS.inProgress)).length;

      const cat = await findCategoryId(ctx.gh, ctx.owner, ctx.name, ctx.cfg.coordination.category);
      const claims = cat ? await listClaims(ctx.gh, ctx.owner, ctx.name, cat) : [];

      const snapshot = {
        accepted: accepted.length,
        ready: ready.length,
        inProgress,
        blocked: accepted.length - ready.length - inProgress,
        activeClaims: claims.length,
      };

      if (ctx.json) {
        process.stdout.write(`${JSON.stringify(snapshot)}\n`);
        return;
      }
      const lines = [
        `Tasks: ${snapshot.accepted} accepted · ${snapshot.ready} ready · ${snapshot.inProgress} in-progress · ${snapshot.blocked} blocked`,
        `Claims in "${ctx.cfg.coordination.category}": ${snapshot.activeClaims}`,
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
    });
}

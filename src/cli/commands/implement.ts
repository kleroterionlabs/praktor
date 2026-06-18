// src/cli/commands/implement.ts — claim one ready Task (cooperative lock via Discussions), drive the
// coder to implement it and open a PR, then post a handoff. The full Praktor loop for one task.
import type { Command } from "commander";
import { ulid } from "ulid";
import { implementTask } from "../../agents/implementer.js";
import {
  claimMarker,
  findCategoryId,
  hasActiveClaim,
  listClaims,
  postDiscussion,
} from "../../github/discussions.js";
import { comment, markDone, markInProgress } from "../../github/progress.js";
import { type ReadyTask, isHalted, listReadyTasks } from "../../github/tasks.js";
import { context, globals } from "./_shared.js";

/** Match a CLI target ("12", "#12", or a boule-id) against the ready list. */
function pickTarget(ready: ReadyTask[], target?: string): ReadyTask | undefined {
  if (!target) return ready[0];
  const num = Number(target.replace(/^#/, ""));
  if (Number.isInteger(num)) return ready.find((t) => t.number === num);
  return ready.find((t) => t.bouleId === target);
}

export function registerImplement(program: Command): void {
  program
    .command("implement [task]")
    .description("Implement a ready Task (by #number or boule-id; default: the first ready) and open a PR.")
    .action(async (target: string | undefined, _local: unknown, cmd: Command) => {
      const runId = ulid();
      const ctx = await context(globals(cmd), runId);
      const dryRun = Boolean(ctx.cfg.flags.dryRun ?? globals(cmd).dryRun);
      const emit = (text: string, exit?: number) => {
        process.stdout.write(`${text}\n`);
        if (exit) process.exitCode = exit;
      };

      if (await isHalted(ctx.gh, ctx.owner, ctx.name)) {
        return emit("boule:halt is active — refusing to start work.", 1);
      }

      const ready = await listReadyTasks(ctx.gh, ctx.owner, ctx.name);
      const task = pickTarget(ready, target);
      if (!task) {
        return emit(target ? `No ready task matches "${target}".` : "No ready tasks to implement.", 2);
      }
      const taskKey = task.bouleId ?? `#${task.number}`;

      // Cooperative lock: don't grab a task another fresh run already claimed.
      const categoryId = await findCategoryId(ctx.gh, ctx.owner, ctx.name, ctx.cfg.coordination.category);
      if (!categoryId) {
        return emit(`coordination category "${ctx.cfg.coordination.category}" not found.`, 2);
      }
      const claims = await listClaims(ctx.gh, ctx.owner, ctx.name, categoryId);
      if (hasActiveClaim(taskKey, runId, claims, Date.now(), ctx.cfg.coordination.claimTtlMinutes)) {
        return emit(`Task ${taskKey} is already claimed by another run — skipping.`, 0);
      }

      emit(`Implementing #${task.number} ${task.title} (${taskKey})${dryRun ? " [dry-run]" : ""}`);

      if (!dryRun) {
        const ts = new Date().toISOString();
        await postDiscussion(
          ctx.gh,
          ctx.owner,
          ctx.name,
          categoryId,
          `Praktor claim: #${task.number} ${task.title}`,
          `🤖 Praktor run \`${runId}\` is implementing #${task.number}.\n\n${claimMarker(taskKey, runId, ts)}`,
        );
        await markInProgress(ctx.gh, ctx.owner, ctx.name, task.number);
        // Re-check after claiming: if a peer's earlier claim appeared, yield to avoid double work.
        const after = await listClaims(ctx.gh, ctx.owner, ctx.name, categoryId);
        if (hasActiveClaim(taskKey, runId, after, Date.now(), ctx.cfg.coordination.claimTtlMinutes)) {
          return emit(`Lost the claim race for ${taskKey} — yielding.`, 0);
        }
      }

      // Fetch the requirement bodies this task Verifies (traceability context for the coder).
      const requirements = [];
      for (const n of task.verifies) {
        try {
          const r = await ctx.gh.withRest("read", (o) =>
            o.issues.get({ owner: ctx.owner, repo: ctx.name, issue_number: n }),
          );
          requirements.push({ number: n, title: r.data.title, body: r.data.body ?? "" });
        } catch {
          ctx.log.warn({ requirement: n }, "could not fetch linked requirement");
        }
      }

      const result = await implementTask({ cfg: ctx.cfg, task, requirements, log: ctx.log });

      if (!dryRun) {
        const verb = result.ok ? "completed" : `stopped (${result.stopReason})`;
        const errs = result.errors.length ? `\n\nErrors:\n- ${result.errors.join("\n- ")}` : "";
        await comment(
          ctx.gh,
          ctx.owner,
          ctx.name,
          task.number,
          `🤖 Praktor run \`${runId}\` ${verb}. Cost $${result.costUsd.toFixed(4)}, ${result.numTurns} turns.${errs}`,
        );
        // A PR is open for this Task — swap praktor:in-progress for praktor:done. The Task stays OPEN
        // until the PR merges and auto-closes it via `Closes #<task>`.
        if (result.ok) await markDone(ctx.gh, ctx.owner, ctx.name, task.number);
      }

      emit(
        `${result.ok ? "✓" : "✗"} ${result.stopReason} · $${result.costUsd.toFixed(4)} · ${result.numTurns} turns`,
        result.ok ? undefined : result.stopReason === "error_max_budget_usd" ? 4 : 1,
      );
    });
}

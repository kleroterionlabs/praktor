// src/cli/commands/implement.ts — claim one ready Task (cooperative lock via Discussions), drive the
// coder to implement it and open a PR, then post a handoff. The full Praktor loop for one task.
import type { RunOutcome } from "@kleroterion/koine";
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

/** A minimal view of koine's RunOutcome — just what the success/exit decision needs. */
type OutcomeView = Pick<RunOutcome, "ok" | "stopReason" | "costUsd">;

/** The decision the command makes from an agent outcome: did real work happen, what to report, how to exit. */
export interface OutcomeVerdict {
  /** True only for a real implementation: the agent succeeded AND billed for model work. */
  success: boolean;
  /** Process exit code: 0 on real success, non-zero otherwise. */
  exitCode: number;
}

/**
 * Decide whether an implement run actually did work.
 *
 * A `costUsd === 0` run means no tokens were billed ⇒ the model never ran (e.g. the Claude Agent SDK
 * subprocess crashed at startup over a missing/invalid CLAUDE_CODE_OAUTH_TOKEN). koine's `runQuery`
 * currently keeps a `success` outcome even when that subprocess exits non-zero (it only warns), so
 * `ok === true, costUsd === 0` reaches us as a silent false-success. Guard against it here: a no-work
 * run is a failure — no completion comment, no "done", and a non-zero exit.
 */
export function classifyOutcome(result: OutcomeView): OutcomeVerdict {
  const noWork = result.costUsd === 0;
  const success = result.ok && !noWork;
  if (success) return { success: true, exitCode: 0 };
  const exitCode = result.stopReason === "error_max_budget_usd" ? 4 : 1;
  return { success: false, exitCode };
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
      const verdict = classifyOutcome(result);

      if (!dryRun) {
        // A no-work run (costUsd === 0) is NOT a completion: report it stopped, not "completed".
        const verb = verdict.success ? "completed" : `stopped (${result.stopReason})`;
        const errs = result.errors.length ? `\n\nErrors:\n- ${result.errors.join("\n- ")}` : "";
        await comment(
          ctx.gh,
          ctx.owner,
          ctx.name,
          task.number,
          `🤖 Praktor run \`${runId}\` ${verb}. Cost $${result.costUsd.toFixed(4)}, ${result.numTurns} turns.${errs}`,
        );
        // A PR is open for this Task — swap praktor:in-progress for praktor:done. The Task stays OPEN
        // until the PR merges and auto-closes it via `Closes #<task>`. Mark done ONLY on a real success
        // (verdict.success), never on a no-work false-success.
        if (verdict.success) await markDone(ctx.gh, ctx.owner, ctx.name, task.number);
      }

      emit(
        `${verdict.success ? "✓" : "✗"} ${result.stopReason} · $${result.costUsd.toFixed(4)} · ${result.numTurns} turns`,
        verdict.success ? undefined : verdict.exitCode,
      );
    });
}

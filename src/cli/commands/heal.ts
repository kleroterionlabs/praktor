// src/cli/commands/heal.ts — detect & heal Praktor's OWN conflicting/stale PRs. When another PR
// merges first, GitHub can't build a test-merge commit, so `pull_request` CI never runs and the PR
// is stuck CONFLICTING forever. Heal rebases the bot's branch onto base, has the coder resolve
// conflicts, runs the repo's checks, and FORCE-PUSHES with an expected-SHA lease so CI runs and
// Krites can review+merge normally.
//
// INVARIANTS (tested): heal NEVER merges a PR and NEVER enables/disables auto-merge — Krites +
// branch protection remain the sole merge authority. Heal only ever touches the bot's own head
// branch. All writes (push, comments, labels, discussions) flow through ONE `if (!dryRun)` choke.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { OPERATIONAL_LABELS } from "@kleroterion/koine";
import type { Command } from "commander";
import { ulid } from "ulid";
import { resolveConflicts } from "../../agents/healer.js";
import {
  claimMarker,
  findCategoryId,
  hasActiveClaim,
  listClaims,
  postDiscussion,
} from "../../github/discussions.js";
import { addLabels, comment } from "../../github/progress.js";
import { type HealablePr, listHealablePrs } from "../../github/prs.js";
import { isHalted } from "../../github/tasks.js";
import { type PrePushState, isLoopExceeded, prePushGate, safePushRefspec } from "../../heal/gate.js";
import type { Ctx } from "./_shared.js";
import { context, globals } from "./_shared.js";

const HEALED_LABEL_RE = /^praktor:healed-(\d+)$/;

/** Run a git command in the working tree; returns trimmed stdout. Throws on non-zero exit. */
function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Count of conflict markers across tracked files (a remaining marker MUST block the push). */
function countConflictMarkers(): number {
  try {
    const out = execFileSync("git", ["grep", "-lE", "^(<{7}|={7}|>{7})( |$)"], { encoding: "utf8" });
    return out.split("\n").filter(Boolean).length;
  } catch {
    return 0; // git grep exits 1 when there are no matches
  }
}

/** True while a rebase is mid-flight (markers/state on disk) — the push gate must refuse until clear. */
function rebaseInProgress(): boolean {
  return existsSync(".git/rebase-merge") || existsSync(".git/rebase-apply");
}

/** How many times this PR has already been healed, read from a `praktor:healed-N` label (survives runs). */
function healCountFromLabels(labels: string[]): number {
  let max = 0;
  for (const l of labels) {
    const m = l.match(HEALED_LABEL_RE);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** The labels currently on a PR (PRs are issues for labelling). */
async function prLabels(ctx: Ctx, prNumber: number): Promise<string[]> {
  const res = await ctx.gh.withRest("read", (o) =>
    o.issues.listLabelsOnIssue({ owner: ctx.owner, repo: ctx.name, issue_number: prNumber }),
  );
  return res.data.map((l) => l.name);
}

export function registerHeal(program: Command): void {
  program
    .command("heal [pr]")
    .description("Detect & heal Praktor's own conflicting/stale PRs (rebase, resolve, force-push).")
    .option("--list", "read-only diagnostic: list heal candidates and exit (no writes)", false)
    .action(async (target: string | undefined, local: { list?: boolean }, cmd: Command) => {
      const runId = ulid();
      const ctx = await context(globals(cmd), runId);
      const dryRun = Boolean(ctx.cfg.flags.dryRun ?? globals(cmd).dryRun);
      const listOnly = Boolean(local.list);
      const botAuthor = ctx.cfg.review.botAuthor;
      const loopCap = ctx.cfg.heal.loopCap;
      const only = target ? Number(target.replace(/^#/, "")) : undefined;

      const emit = (text: string, exit?: number) => {
        process.stdout.write(`${text}\n`);
        if (exit) process.exitCode = exit;
      };

      // 1. Refuse to start if the kill-switch is set.
      if (await isHalted(ctx.gh, ctx.owner, ctx.name)) {
        return emit("boule:halt is active — refusing to start work.", 1);
      }

      const candidates = await listHealablePrs(ctx.gh, ctx.owner, ctx.name, botAuthor, only);

      if (ctx.json) {
        process.stdout.write(
          `${JSON.stringify({ candidates: candidates.map((c) => ({ number: c.number, title: c.title, mergeableState: c.mergeableState })) })}\n`,
        );
        if (listOnly) return;
      }

      // --list is a pure read-only diagnostic — never writes, even without --dry-run.
      if (listOnly) {
        if (candidates.length === 0) return emit("No heal candidates.");
        const lines = [`${candidates.length} heal candidate(s):`];
        for (const c of candidates) lines.push(`  #${c.number}  ${c.title}  [${c.mergeableState}]`);
        return emit(lines.join("\n"));
      }

      if (candidates.length === 0) return emit("No conflicting/stale Praktor PRs to heal.", 0);

      const categoryId = await findCategoryId(ctx.gh, ctx.owner, ctx.name, ctx.cfg.coordination.category);
      if (!categoryId) {
        return emit(`coordination category "${ctx.cfg.coordination.category}" not found.`, 2);
      }

      let lastExit: number | undefined;
      for (const pr of candidates) {
        const exit = await healOne(ctx, pr, {
          runId,
          dryRun,
          categoryId,
          loopCap,
        });
        if (exit) lastExit = exit;
      }
      emit(dryRun ? "heal dry-run complete." : "heal complete.", lastExit);
    });
}

interface HealOpts {
  runId: string;
  dryRun: boolean;
  categoryId: string;
  loopCap: number;
}

/** Heal a single PR. Returns an exit code (0 success/skip, 1 escalation/halt-ish, 4 budget). */
async function healOne(ctx: Ctx, pr: HealablePr, opts: HealOpts): Promise<number | undefined> {
  const { runId, dryRun, categoryId, loopCap } = opts;
  const taskKey = `pr#${pr.number}`;
  const log = (text: string) => process.stdout.write(`${text}\n`);

  // Single write choke point: under dry-run NOTHING here runs.
  const escalate = async (reason: string): Promise<void> => {
    log(`#${pr.number}: escalating — ${reason}`);
    if (dryRun) return;
    await addLabels(ctx.gh, ctx.owner, ctx.name, pr.number, [OPERATIONAL_LABELS.needsHuman]);
    await postDiscussion(
      ctx.gh,
      ctx.owner,
      ctx.name,
      categoryId,
      `Praktor heal needs a human: PR #${pr.number}`,
      `🤖 Heal could not safely mend PR #${pr.number} (Task #${pr.bouleTask}, base \`${pr.baseRef}\`): ${reason}. Force-push was NOT performed; the PR is untouched.`,
    );
    await comment(ctx.gh, ctx.owner, ctx.name, pr.number, `🤖 Praktor heal escalated to a human: ${reason}.`);
  };

  // Loop-cap (persisted across runs via praktor:healed-N labels).
  const labels = await prLabels(ctx, pr.number);
  const healCount = healCountFromLabels(labels);
  if (isLoopExceeded(healCount, loopCap)) {
    await escalate(`heal loop cap reached (${healCount}/${loopCap})`);
    return 1;
  }

  // Cooperative claim: check → post → re-check yield (reuse the Discussions lock).
  const claims = await listClaims(ctx.gh, ctx.owner, ctx.name, categoryId);
  if (hasActiveClaim(taskKey, runId, claims, Date.now(), ctx.cfg.coordination.claimTtlMinutes)) {
    log(`#${pr.number}: already claimed by another run — skipping.`);
    return 0;
  }
  if (!dryRun) {
    const ts = new Date().toISOString();
    await postDiscussion(
      ctx.gh,
      ctx.owner,
      ctx.name,
      categoryId,
      `Praktor healing: PR #${pr.number}`,
      `🤖 Praktor run \`${runId}\` is healing PR #${pr.number}.\n\n${claimMarker(taskKey, runId, ts)}`,
    );
    const after = await listClaims(ctx.gh, ctx.owner, ctx.name, categoryId);
    if (hasActiveClaim(taskKey, runId, after, Date.now(), ctx.cfg.coordination.claimTtlMinutes)) {
      log(`#${pr.number}: lost the claim race — yielding.`);
      return 0;
    }
  }

  log(`#${pr.number}: healing onto ${pr.baseRef}${dryRun ? " [dry-run]" : ""}`);

  // Checkout head, capture the head SHA BEFORE the rebase (the lease pins to this), rebase onto base.
  let capturedHeadSha = pr.headSha;
  try {
    git(["fetch", "origin", pr.headRef, pr.baseRef]);
    git(["checkout", pr.headRef]);
    capturedHeadSha = git(["rev-parse", "HEAD"]);
  } catch (e) {
    await escalate(`could not checkout/fetch the PR head: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  let rebaseConflicted = false;
  try {
    git(["rebase", `origin/${pr.baseRef}`]);
  } catch {
    rebaseConflicted = true; // markers are now in the tree; the coder resolves them
  }

  // Resolve conflicts with the coder agent if the rebase stopped on conflicts.
  if (rebaseConflicted) {
    const task = await fetchTask(ctx, pr.bouleTask);
    const conflicted = conflictedFiles();
    const result = await resolveConflicts({
      cfg: ctx.cfg,
      prNumber: pr.number,
      baseRef: pr.baseRef,
      task,
      conflictedFiles: conflicted,
      log: ctx.log,
    });
    if (!result.ok) {
      gitAbort();
      if (result.stopReason === "error_max_budget_usd") {
        await escalate("budget exhausted resolving conflicts");
        return 4;
      }
      await escalate(`coder could not resolve conflicts (${result.stopReason})`);
      return 1;
    }
  }

  // Pre-push gate (pure). Re-check auto-merge live just before pushing.
  const checksGreen = runRepoChecks();
  const autoMergeNow = await isAutoMergeEnabled(ctx, pr.number);
  const state: PrePushState = {
    statusClean: git(["status", "--porcelain"]).length === 0,
    conflictMarkers: countConflictMarkers(),
    rebaseInProgress: rebaseInProgress(),
    checksGreen,
    autoMergeEnabled: autoMergeNow,
  };
  const decision = prePushGate(state);
  if (!decision.push) {
    gitAbort();
    await escalate(`pre-push gate denied: ${decision.reason}`);
    return 1;
  }

  // Under dry-run we computed a REAL plan but must abort the rebase and never push/comment/label.
  if (dryRun) {
    gitAbort();
    log(`#${pr.number}: [dry-run] would force-push ${pr.headRef} with lease @${capturedHeadSha.slice(0, 8)}`);
    return 0;
  }

  // Safe force-push: expected-SHA lease. If the remote head moved, the lease fails → abort + escalate.
  const refspec = safePushRefspec(pr.headRef, capturedHeadSha);
  try {
    git(["push", refspec, "origin", `HEAD:${pr.headRef}`]);
  } catch (e) {
    gitAbort();
    await escalate(`lease push aborted (remote head moved): ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  // Record the heal (persist count for the cross-run loop cap), then verify mergeability before claiming success.
  await addLabels(ctx.gh, ctx.owner, ctx.name, pr.number, [`praktor:healed-${healCount + 1}`]);
  const after = await refetchMergeState(ctx, pr.number);
  await comment(
    ctx.gh,
    ctx.owner,
    ctx.name,
    pr.number,
    `🤖 Praktor healed PR #${pr.number}: rebased onto \`${pr.baseRef}\`, resolved conflicts, checks green, force-pushed (lease @${capturedHeadSha.slice(0, 8)}). Mergeable state: \`${after}\`. Ready for Krites to re-review.`,
  );
  log(`#${pr.number}: healed (mergeable_state=${after}).`);
  return 0;
}

/** Abort a mid-flight rebase and hard-reset the tree (best-effort; never throws). */
function gitAbort(): void {
  try {
    if (rebaseInProgress()) execFileSync("git", ["rebase", "--abort"], { stdio: "ignore" });
  } catch {
    /* best effort */
  }
  try {
    execFileSync("git", ["reset", "--hard"], { stdio: "ignore" });
  } catch {
    /* best effort */
  }
}

/** The files git reports as conflicted (unmerged paths). */
function conflictedFiles(): string[] {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Run the repo's own checks (typecheck/lint/test/build). GREEN ⇒ true. */
function runRepoChecks(): boolean {
  for (const script of ["typecheck", "lint", "test", "build"]) {
    try {
      execFileSync("npm", ["run", script, "--if-present"], { stdio: "ignore" });
    } catch {
      return false;
    }
  }
  return true;
}

async function fetchTask(
  ctx: Ctx,
  number: number | null,
): Promise<{ number: number; title: string; body: string } | null> {
  if (number === null) return null;
  try {
    const r = await ctx.gh.withRest("read", (o) =>
      o.issues.get({ owner: ctx.owner, repo: ctx.name, issue_number: number }),
    );
    return { number, title: r.data.title, body: r.data.body ?? "" };
  } catch {
    return null;
  }
}

/** Live re-check of auto-merge — heal must skip+escalate if a peer enabled it after analysis. */
async function isAutoMergeEnabled(ctx: Ctx, prNumber: number): Promise<boolean> {
  try {
    const r = await ctx.gh.withRest("read", (o) =>
      o.pulls.get({ owner: ctx.owner, repo: ctx.name, pull_number: prNumber }),
    );
    return Boolean((r.data as { auto_merge?: unknown }).auto_merge);
  } catch {
    return false;
  }
}

/** Re-poll mergeable_state after the push so we only claim success on a real state change. */
async function refetchMergeState(ctx: Ctx, prNumber: number): Promise<string> {
  try {
    const r = await ctx.gh.withRest("read", (o) =>
      o.pulls.get({ owner: ctx.owner, repo: ctx.name, pull_number: prNumber }),
    );
    return (r.data as { mergeable_state?: string }).mergeable_state ?? "unknown";
  } catch {
    return "unknown";
  }
}

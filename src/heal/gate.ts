// src/heal/gate.ts — PURE, unit-tested safety functions for `praktor heal`. Healing force-pushes a
// resolved branch, so every dangerous decision (is this PR ours? may we push? has the head moved?
// have we looped too many times?) is a pure predicate here, tested in isolation, with NO I/O. The
// orchestration in cli/commands/heal.ts only ever ACTS on a `true` from these gates.

/** The PR shape `heal` reasons about — a structural subset of GitHub's pull-request payload. */
export interface HealPrView {
  number: number;
  draft: boolean;
  state: string; // "open" | "closed"
  /** GitHub's computed mergeability: "dirty"/"conflicting" ⇒ heal candidate; "unknown" ⇒ never act. */
  mergeableState: string;
  authorType: string; // user.type — must be "Bot"
  authorLogin: string; // user.login — must equal cfg.review.botAuthor
  bouleTask: number | null; // parsed `Closes #N` from the PR body (null ⇒ not Boule-linked)
  autoMergeEnabled: boolean; // if true, heal MUST NOT touch it (Krites owns merge)
}

/** Normalize a mergeable_state to lowercase; treat null/undefined as "unknown" (never act). */
function normState(s: string): string {
  return (s ?? "unknown").toLowerCase();
}

/**
 * The single author-gated heal predicate. A PR is a heal candidate ONLY if ALL hold:
 *  - open, not draft
 *  - mergeable_state is `dirty`/`conflicting` (optionally `behind`) — NEVER `unknown`
 *  - authored by a Bot whose login == the configured bot author
 *  - body links a Boule Task (`Closes #N`)
 *  - auto-merge is NOT enabled (Krites owns merge; heal never races it)
 * This is the most important safety invariant: refuse to touch anything not provably bot-authored
 * AND Boule-linked.
 */
export function shouldHeal(pr: HealPrView, botAuthor: string): boolean {
  if (pr.state !== "open") return false;
  if (pr.draft) return false;
  const st = normState(pr.mergeableState);
  if (st !== "dirty" && st !== "conflicting" && st !== "behind") return false;
  if (pr.authorType !== "Bot") return false;
  if (pr.authorLogin !== botAuthor) return false;
  if (pr.bouleTask === null) return false;
  if (pr.autoMergeEnabled) return false;
  return true;
}

/**
 * The expected-SHA lease refspec for a safe force-push. We pin the lease to the head SHA captured
 * BEFORE the rebase: if the remote head moved (a peer pushed), the lease fails and git refuses to
 * clobber. We NEVER produce a bare `--force-with-lease` (which leases against our own tracking ref
 * and can still clobber a concurrent push) and NEVER `--force`.
 */
export function safePushRefspec(branch: string, expectedSha: string): string {
  if (!branch) throw new Error("safePushRefspec: branch is required");
  if (!/^[0-9a-f]{7,40}$/i.test(expectedSha)) {
    throw new Error(`safePushRefspec: expectedSha must be a git SHA, got "${expectedSha}"`);
  }
  return `--force-with-lease=${branch}:${expectedSha}`;
}

/** The local working-tree state inspected by the pre-push gate (all derived from real git output). */
export interface PrePushState {
  statusClean: boolean; // `git status --porcelain` empty
  conflictMarkers: number; // count of <<<<<<< / ======= / >>>>>>> across tracked files (must be 0)
  rebaseInProgress: boolean; // `.git/rebase-merge` (or -apply) still present (rebase not concluded)
  checksGreen: boolean; // the repo's own typecheck/lint/test/build all passed
  autoMergeEnabled: boolean; // re-checked just before push; if enabled, skip + escalate
}

export interface PrePushDecision {
  push: boolean;
  reason: string; // human-readable why-not (empty when push===true)
}

/**
 * Pre-push gate: push ONLY if the working tree is clean, there are ZERO conflict markers, the rebase
 * fully concluded, the repo's checks are GREEN, and auto-merge is NOT enabled. On ANY failure the
 * caller aborts the rebase, hard-resets, and escalates — it must NEVER push.
 */
export function prePushGate(state: PrePushState): PrePushDecision {
  if (!state.statusClean) return { push: false, reason: "working tree not clean" };
  if (state.conflictMarkers > 0) {
    return { push: false, reason: `${state.conflictMarkers} conflict marker(s) remain` };
  }
  if (state.rebaseInProgress) return { push: false, reason: "rebase not concluded" };
  if (!state.checksGreen) return { push: false, reason: "repo checks are red" };
  if (state.autoMergeEnabled) return { push: false, reason: "auto-merge is enabled — Krites owns merge" };
  return { push: true, reason: "" };
}

/** True when this PR has already been healed `count` times and `count` has reached the global cap. */
export function isLoopExceeded(count: number, max: number): boolean {
  return count >= max;
}

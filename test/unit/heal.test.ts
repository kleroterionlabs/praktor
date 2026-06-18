// test/unit/heal.test.ts — the DANGEROUS heal paths exercised as PURE functions: refuse a non-bot /
// non-Boule / UNKNOWN PR, refuse when auto-merge is enabled, lease aborts when the head moved, the
// pre-push gate denies on remaining markers / red checks / unconcluded rebase, and the loop cap. The
// dry-run "suppress all writes" invariant is structurally guaranteed by routing every write through
// the single `if (!dryRun)` choke in heal.ts; here we lock down the pure decisions it depends on.
import { describe, expect, it } from "vitest";
import { parseCloses } from "../../src/github/prs.js";
import {
  type HealPrView,
  isLoopExceeded,
  prePushGate,
  safePushRefspec,
  shouldHeal,
} from "../../src/heal/gate.js";

const BOT = "praktorai[bot]";
const okPr = (over: Partial<HealPrView> = {}): HealPrView => ({
  number: 14,
  draft: false,
  state: "open",
  mergeableState: "dirty",
  authorType: "Bot",
  authorLogin: BOT,
  bouleTask: 7,
  autoMergeEnabled: false,
  ...over,
});

describe("shouldHeal — author/Boule/state gate", () => {
  it("heals an open, non-draft, dirty, bot-authored, Boule-linked PR with no auto-merge", () => {
    expect(shouldHeal(okPr(), BOT)).toBe(true);
    expect(shouldHeal(okPr({ mergeableState: "CONFLICTING" }), BOT)).toBe(true);
    expect(shouldHeal(okPr({ mergeableState: "behind" }), BOT)).toBe(true);
  });

  it("REFUSES a PR not authored by the bot", () => {
    expect(shouldHeal(okPr({ authorType: "User", authorLogin: "alice" }), BOT)).toBe(false);
    expect(shouldHeal(okPr({ authorType: "Bot", authorLogin: "other[bot]" }), BOT)).toBe(false);
  });

  it("REFUSES a PR with no Boule Task link", () => {
    expect(shouldHeal(okPr({ bouleTask: null }), BOT)).toBe(false);
  });

  it("REFUSES an UNKNOWN mergeable_state (GitHub still computing — never act)", () => {
    expect(shouldHeal(okPr({ mergeableState: "UNKNOWN" }), BOT)).toBe(false);
    expect(shouldHeal(okPr({ mergeableState: "clean" }), BOT)).toBe(false);
    expect(shouldHeal(okPr({ mergeableState: "blocked" }), BOT)).toBe(false);
  });

  it("REFUSES a draft or closed PR", () => {
    expect(shouldHeal(okPr({ draft: true }), BOT)).toBe(false);
    expect(shouldHeal(okPr({ state: "closed" }), BOT)).toBe(false);
  });

  it("REFUSES when auto-merge is enabled (Krites owns merge)", () => {
    expect(shouldHeal(okPr({ autoMergeEnabled: true }), BOT)).toBe(false);
  });
});

describe("parseCloses", () => {
  it("parses the Boule Task from `Closes #N`", () => {
    expect(parseCloses("fixes things\n\nCloses #42\n")).toBe(42);
    expect(parseCloses("closes #7")).toBe(7);
  });
  it("returns null when there is no Closes link", () => {
    expect(parseCloses("just a body, Verifies #9")).toBe(null);
  });
});

describe("safePushRefspec — expected-SHA lease", () => {
  it("pins the lease to the captured head SHA (never a bare lease, never --force)", () => {
    const sha = "a".repeat(40);
    expect(safePushRefspec("praktor/x", sha)).toBe(`--force-with-lease=praktor/x:${sha}`);
  });
  it("rejects a non-SHA expected value (refuses to build an unsafe push)", () => {
    expect(() => safePushRefspec("praktor/x", "")).toThrow();
    expect(() => safePushRefspec("praktor/x", "HEAD")).toThrow();
  });
  it("requires a branch", () => {
    expect(() => safePushRefspec("", "a".repeat(40))).toThrow();
  });
});

describe("prePushGate — push only when fully safe", () => {
  const green = {
    statusClean: true,
    conflictMarkers: 0,
    rebaseInProgress: false,
    checksGreen: true,
    autoMergeEnabled: false,
  };

  it("pushes when the tree is clean, no markers, rebase concluded, checks green, no auto-merge", () => {
    expect(prePushGate(green)).toEqual({ push: true, reason: "" });
  });

  it("DENIES when a conflict marker remains", () => {
    expect(prePushGate({ ...green, conflictMarkers: 1 }).push).toBe(false);
  });

  it("DENIES when checks are red", () => {
    expect(prePushGate({ ...green, checksGreen: false }).push).toBe(false);
  });

  it("DENIES when the rebase has not concluded", () => {
    expect(prePushGate({ ...green, rebaseInProgress: true }).push).toBe(false);
  });

  it("DENIES when the working tree is dirty", () => {
    expect(prePushGate({ ...green, statusClean: false }).push).toBe(false);
  });

  it("DENIES when auto-merge is enabled (heal never races Krites's merge)", () => {
    expect(prePushGate({ ...green, autoMergeEnabled: true }).push).toBe(false);
  });
});

describe("isLoopExceeded — cross-run loop cap", () => {
  it("escalates once N heals are already recorded", () => {
    expect(isLoopExceeded(3, 3)).toBe(true);
    expect(isLoopExceeded(4, 3)).toBe(true);
  });
  it("allows healing below the cap", () => {
    expect(isLoopExceeded(0, 3)).toBe(false);
    expect(isLoopExceeded(2, 3)).toBe(false);
  });
});

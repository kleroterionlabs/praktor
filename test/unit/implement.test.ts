// test/unit/implement.test.ts — two concerns of the implement flow:
//  1. classifyOutcome (Task #6): a no-work run (costUsd === 0) is a failure, never a false success.
//  2. The flow marks a Task done once its PR is open (Task #3): markDone runs ONLY on a real success,
//     and is skipped on dry-run / non-ok / halt / lost-claim / no-task / no-work paths.
import type { RunOutcome } from "@kleroterion/koine";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- module mocks (vi.mock is hoisted, so the fns live in a hoisted block) ----------------------
const {
  implementTask,
  markInProgress,
  markDone,
  comment,
  postDiscussion,
  findCategoryId,
  listClaims,
  hasActiveClaim,
  claimMarker,
  isHalted,
  listReadyTasks,
  context,
} = vi.hoisted(() => ({
  implementTask: vi.fn(),
  markInProgress: vi.fn(async () => {}),
  markDone: vi.fn(async () => {}),
  comment: vi.fn(async () => {}),
  postDiscussion: vi.fn(async () => {}),
  findCategoryId: vi.fn(async () => "cat-1"),
  listClaims: vi.fn(async () => []),
  hasActiveClaim: vi.fn(() => false),
  claimMarker: vi.fn(() => "<!-- marker -->"),
  isHalted: vi.fn(async () => false),
  listReadyTasks: vi.fn(),
  context: vi.fn(),
}));

vi.mock("../../src/agents/implementer.js", () => ({ implementTask }));
vi.mock("../../src/github/progress.js", () => ({ comment, markDone, markInProgress }));
vi.mock("../../src/github/discussions.js", () => ({
  claimMarker,
  findCategoryId,
  hasActiveClaim,
  listClaims,
  postDiscussion,
}));
vi.mock("../../src/github/tasks.js", () => ({ isHalted, listReadyTasks }));
vi.mock("../../src/cli/commands/_shared.js", () => ({
  context,
  globals: () => ({ dryRun: false }),
}));

import { classifyOutcome, registerImplement } from "../../src/cli/commands/implement.js";

const TASK = { number: 31, title: "Do the thing", bouleId: "T-31", verifies: [], body: "" };

function makeCtx(dryRun: boolean) {
  return {
    cfg: {
      flags: { dryRun },
      coordination: { category: "coord", claimTtlMinutes: 60 },
    },
    gh: { withRest: vi.fn(async () => ({ data: {} })) },
    owner: "kleroterionlabs",
    name: "boule",
    log: { warn: vi.fn(), info: vi.fn() },
  };
}

/** Build a run outcome; defaults to a REAL success (costUsd > 0). Assignable to classifyOutcome's view. */
function outcome(over: Partial<RunOutcome>): RunOutcome {
  return {
    ok: true,
    stopReason: "success",
    sessionId: "s",
    numTurns: 1,
    costUsd: 0.5,
    modelUsage: {},
    errors: [],
    ...over,
  };
}

async function run(): Promise<void> {
  const program = new Command();
  program.option("--dry-run").option("--json").option("-v, --verbose");
  registerImplement(program);
  await program.parseAsync(["node", "praktor", "implement"]);
}

describe("classifyOutcome", () => {
  it("fails a no-work run (costUsd === 0) even when ok/stopReason say success", () => {
    const v = classifyOutcome(outcome({ ok: true, stopReason: "success", costUsd: 0 }));
    expect(v.success).toBe(false);
    expect(v.exitCode).not.toBe(0);
  });

  it("succeeds a real run that did work (costUsd > 0)", () => {
    const v = classifyOutcome(outcome({ ok: true, stopReason: "success", costUsd: 0.0001 }));
    expect(v.success).toBe(true);
    expect(v.exitCode).toBe(0);
  });

  it("fails a genuine error stop with exit code 1", () => {
    const v = classifyOutcome(outcome({ ok: false, stopReason: "error_during_execution", costUsd: 0.5 }));
    expect(v.success).toBe(false);
    expect(v.exitCode).toBe(1);
  });

  it("maps a budget stop to exit code 4", () => {
    const v = classifyOutcome(outcome({ ok: false, stopReason: "error_max_budget_usd", costUsd: 9.99 }));
    expect(v.success).toBe(false);
    expect(v.exitCode).toBe(4);
  });
});

describe("implement: mark Task done on PR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.exitCode = undefined;
    listReadyTasks.mockResolvedValue([TASK]);
    hasActiveClaim.mockReturnValue(false);
    isHalted.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("marks the Task done when the run really succeeds and it is not a dry-run", async () => {
    context.mockResolvedValue(makeCtx(false));
    implementTask.mockResolvedValue(outcome({ ok: true, costUsd: 0.5 }));

    await run();

    expect(markInProgress).toHaveBeenCalledWith(expect.anything(), "kleroterionlabs", "boule", 31);
    expect(markDone).toHaveBeenCalledWith(expect.anything(), "kleroterionlabs", "boule", 31);
  });

  it("does NOT mark the Task done on a no-work run (costUsd === 0)", async () => {
    context.mockResolvedValue(makeCtx(false));
    implementTask.mockResolvedValue(outcome({ ok: true, costUsd: 0 }));

    await run();

    expect(comment).toHaveBeenCalled(); // audit comment still posted (reporting it stopped)
    expect(markDone).not.toHaveBeenCalled();
  });

  it("does NOT mark the Task done when the run fails (non-ok)", async () => {
    context.mockResolvedValue(makeCtx(false));
    implementTask.mockResolvedValue(outcome({ ok: false, stopReason: "error_during_execution" }));

    await run();

    expect(comment).toHaveBeenCalled(); // audit comment still posted
    expect(markDone).not.toHaveBeenCalled();
  });

  it("writes no labels at all on a dry-run", async () => {
    context.mockResolvedValue(makeCtx(true));
    implementTask.mockResolvedValue(outcome({ ok: true }));

    await run();

    expect(markInProgress).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
    expect(comment).not.toHaveBeenCalled();
  });

  it("does NOT mark the Task done when no ready task exists", async () => {
    context.mockResolvedValue(makeCtx(false));
    listReadyTasks.mockResolvedValue([]);

    await run();

    expect(implementTask).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });

  it("does NOT mark the Task done when boule:halt is active", async () => {
    context.mockResolvedValue(makeCtx(false));
    isHalted.mockResolvedValue(true);

    await run();

    expect(implementTask).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });

  it("does NOT mark the Task done when the claim race is lost", async () => {
    context.mockResolvedValue(makeCtx(false));
    // First check (pre-claim) clear, second check (post-claim) shows a peer's claim ⇒ yield.
    hasActiveClaim.mockReturnValueOnce(false).mockReturnValueOnce(true);

    await run();

    expect(implementTask).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { claimMarker, hasActiveClaim } from "../../src/github/discussions.js";

const NOW = Date.parse("2026-06-17T12:00:00Z");
const claim = (taskKey: string, runId: string, minutesAgo: number) => ({
  taskKey,
  runId,
  ts: new Date(NOW - minutesAgo * 60_000).toISOString(),
  url: "u",
});

describe("hasActiveClaim", () => {
  it("is true when a different run holds a fresh claim for the task", () => {
    expect(hasActiveClaim("task:a", "me", [claim("task:a", "other", 10)], NOW, 60)).toBe(true);
  });

  it("ignores my own claim (re-running the same task is fine)", () => {
    expect(hasActiveClaim("task:a", "me", [claim("task:a", "me", 10)], NOW, 60)).toBe(false);
  });

  it("ignores stale claims past the TTL", () => {
    expect(hasActiveClaim("task:a", "me", [claim("task:a", "other", 90)], NOW, 60)).toBe(false);
  });

  it("ignores claims for other tasks", () => {
    expect(hasActiveClaim("task:a", "me", [claim("task:b", "other", 5)], NOW, 60)).toBe(false);
  });
});

describe("claimMarker", () => {
  it("round-trips through the claim parser regex", () => {
    const marker = claimMarker("task:foo", "run123", "2026-06-17T12:00:00Z");
    expect(marker).toBe("<!-- praktor:claim task=task:foo run=run123 ts=2026-06-17T12:00:00Z -->");
  });
});

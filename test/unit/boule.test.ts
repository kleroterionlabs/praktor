import { parseBouleBlock, parseVerifies } from "@kleroterion/koine";
import { describe, expect, it } from "vitest";

describe("parseBouleBlock", () => {
  it("extracts kind, boule-id, and parent from the identity block", () => {
    const body = [
      "Some task body.",
      "<!-- boule:v1",
      "kind: task",
      "boule-id: task:ci-health-fetch",
      "content-hash: sha256:abc123",
      "parent: feature:ci-health",
      "-->",
    ].join("\n");
    expect(parseBouleBlock(body)).toMatchObject({
      kind: "task",
      bouleId: "task:ci-health-fetch",
      parent: "feature:ci-health",
    });
  });

  it("returns null for a non-Boule issue", () => {
    expect(parseBouleBlock("just a human-authored issue")).toBeNull();
  });
});

describe("parseVerifies", () => {
  it("pulls requirement numbers from a Verifies link line", () => {
    expect(parseVerifies("blah\nVerifies: #110, #112\nmore")).toEqual([110, 112]);
  });

  it("returns [] when there is no Verifies line", () => {
    expect(parseVerifies("no link here")).toEqual([]);
  });
});

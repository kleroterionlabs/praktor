import type { GitHubClient } from "@kleroterion/koine";
import { describe, expect, it } from "vitest";
import { listAcceptedTasks } from "../../src/github/tasks.js";

interface Issue {
  number: number;
  labels: string[];
  pull_request?: object;
}

/** Minimal fake client: capture the listForRepo params and return canned issues. */
function fakeGh(issues: Issue[]): { gh: GitHubClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const octokit = {
    issues: {
      listForRepo: async (params: Record<string, unknown>) => {
        calls.push(params);
        return {
          data: issues.map((i) => ({
            number: i.number,
            id: i.number,
            node_id: `n${i.number}`,
            html_url: `https://x/${i.number}`,
            title: `Task ${i.number}`,
            body: "",
            labels: i.labels.map((name) => ({ name })),
            ...(i.pull_request ? { pull_request: i.pull_request } : {}),
          })),
        };
      },
    },
  };
  const gh = {
    withRest: (_lane: string, fn: (o: typeof octokit) => unknown) => fn(octokit),
  } as unknown as GitHubClient;
  return { gh, calls };
}

const MANAGED = ["boule:managed", "kind:task", "status:accepted"];

describe("listAcceptedTasks", () => {
  it("scopes the query to boule:managed, kind:task, and status:accepted", async () => {
    const { gh, calls } = fakeGh([{ number: 1, labels: MANAGED }]);
    await listAcceptedTasks(gh, "o", "r");
    expect(calls[0]?.labels).toBe("boule:managed,kind:task,status:accepted");
    expect(calls[0]?.state).toBe("open");
  });

  it("drops an issue that lacks boule:managed even if the API returns it", async () => {
    const { gh } = fakeGh([
      { number: 1, labels: MANAGED },
      { number: 2, labels: ["kind:task", "status:accepted"] }, // not Boule-managed
    ]);
    const out = await listAcceptedTasks(gh, "o", "r");
    expect(out.map((t) => t.number)).toEqual([1]);
  });

  it("skips pull requests and Praktor-claimed tasks", async () => {
    const { gh } = fakeGh([
      { number: 1, labels: MANAGED },
      { number: 2, labels: [...MANAGED], pull_request: {} },
      { number: 3, labels: [...MANAGED, "praktor:in-progress"] },
      { number: 4, labels: [...MANAGED, "praktor:done"] },
    ]);
    const out = await listAcceptedTasks(gh, "o", "r");
    expect(out.map((t) => t.number)).toEqual([1]);
  });
});

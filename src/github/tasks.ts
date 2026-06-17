// src/github/tasks.ts — read Boule's Task backlog and decide what's READY to implement.
// A Task is ready iff: open, kind:task, status:accepted, not already in-progress/done by Praktor,
// and every native "blocked by" dependency is closed (its prerequisites are done).
import {
  type GitHubClient,
  OPERATIONAL_LABELS,
  PRAKTOR_LABELS,
  kindLabel,
  parseBouleBlock,
  parseVerifies,
} from "@kleroterion/koine";

const TASK_LABEL = kindLabel("task");
const STATUS_ACCEPTED = "status:accepted";

export interface TaskRef {
  number: number;
  id: number; // REST database id
  nodeId: string;
  url: string;
  title: string;
  bouleId: string | null;
  labels: string[];
  verifies: number[]; // requirement issue numbers this task verifies (traceability)
  body: string;
}

export interface ReadyTask extends TaskRef {
  openBlockers: number[]; // blocked_by issues still open (empty ⇒ ready)
}

const labelNames = (labels: unknown[]): string[] =>
  labels.map((l) => (typeof l === "string" ? l : ((l as { name?: string }).name ?? ""))).filter(Boolean);

/** Kill-switch: true if any OPEN issue carries `boule:halt` — Praktor halts, like Boule. */
export async function isHalted(gh: GitHubClient, owner: string, name: string): Promise<boolean> {
  const res = await gh.withRest("read", (o) =>
    o.issues.listForRepo({ owner, repo: name, labels: OPERATIONAL_LABELS.halt, state: "open", per_page: 1 }),
  );
  return res.data.length > 0;
}

/** All open, accepted Boule Tasks (not yet taken by Praktor). */
export async function listAcceptedTasks(gh: GitHubClient, owner: string, name: string): Promise<TaskRef[]> {
  const res = await gh.withRest("read", (o) =>
    o.issues.listForRepo({
      owner,
      repo: name,
      labels: `${TASK_LABEL},${STATUS_ACCEPTED}`, // AND semantics
      state: "open",
      per_page: 100,
    }),
  );
  const out: TaskRef[] = [];
  for (const i of res.data) {
    if (i.pull_request) continue;
    const labels = labelNames(i.labels ?? []);
    if (labels.includes(PRAKTOR_LABELS.inProgress) || labels.includes(PRAKTOR_LABELS.done)) continue;
    const body = i.body ?? "";
    out.push({
      number: i.number,
      id: i.id,
      nodeId: i.node_id,
      url: i.html_url,
      title: i.title,
      bouleId: parseBouleBlock(body)?.bouleId ?? null,
      labels,
      verifies: parseVerifies(body),
      body,
    });
  }
  return out;
}

/** The blocked_by issues of a task that are still open (a non-empty result ⇒ NOT ready). */
async function openBlockersOf(
  gh: GitHubClient,
  owner: string,
  name: string,
  taskNumber: number,
): Promise<number[]> {
  const res = await gh.withRest("read", (o) =>
    o.request("GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by", {
      owner,
      repo: name,
      issue_number: taskNumber,
      per_page: 100,
    }),
  );
  return (res.data as Array<{ number: number; state: string }>)
    .filter((d) => d.state !== "closed")
    .map((d) => d.number);
}

/** Accepted tasks whose prerequisites are all done, lowest issue number first. */
export async function listReadyTasks(gh: GitHubClient, owner: string, name: string): Promise<ReadyTask[]> {
  const accepted = await listAcceptedTasks(gh, owner, name);
  const ready: ReadyTask[] = [];
  for (const t of accepted) {
    const openBlockers = await openBlockersOf(gh, owner, name, t.number);
    if (openBlockers.length === 0) ready.push({ ...t, openBlockers });
  }
  return ready.sort((a, b) => a.number - b.number);
}

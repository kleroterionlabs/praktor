// src/github/progress.ts — Praktor's marks on a Boule Task. Praktor signals progress with its OWN
// `praktor:*` labels + an audit comment, never touching Boule's `status:*` lifecycle (Boule owns that).
import { type GitHubClient, PRAKTOR_LABELS } from "@kleroterion/koine";

export async function addLabels(
  gh: GitHubClient,
  owner: string,
  name: string,
  number: number,
  labels: string[],
): Promise<void> {
  await gh.withRest("write", (o) => o.issues.addLabels({ owner, repo: name, issue_number: number, labels }));
}

export async function removeLabel(
  gh: GitHubClient,
  owner: string,
  name: string,
  number: number,
  label: string,
): Promise<void> {
  try {
    await gh.withRest("write", (o) =>
      o.issues.removeLabel({ owner, repo: name, issue_number: number, name: label }),
    );
  } catch {
    // label not present — fine
  }
}

export async function comment(
  gh: GitHubClient,
  owner: string,
  name: string,
  number: number,
  body: string,
): Promise<void> {
  await gh.withRest("write", (o) =>
    o.issues.createComment({ owner, repo: name, issue_number: number, body }),
  );
}

export const markInProgress = (gh: GitHubClient, owner: string, name: string, n: number) =>
  addLabels(gh, owner, name, n, [PRAKTOR_LABELS.inProgress]);

export async function markDone(gh: GitHubClient, owner: string, name: string, n: number): Promise<void> {
  await removeLabel(gh, owner, name, n, PRAKTOR_LABELS.inProgress);
  await addLabels(gh, owner, name, n, [PRAKTOR_LABELS.done]);
}

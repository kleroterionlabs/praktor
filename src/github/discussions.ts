// src/github/discussions.ts — peer coordination via GitHub Discussions. Praktor posts a CLAIM before
// implementing a task so independent runners don't grab the same one, and a HANDOFF when it opens a PR.
// Claims are best-effort cooperative locks (Discussions have no transaction): check → post → re-check.
import type { GitHubClient } from "./client.js";

/** Machine-readable marker embedded in a claim discussion body (HTML comment, invisible in the UI). */
const CLAIM_RE = /<!--\s*praktor:claim\s+task=(\S+)\s+run=(\S+)\s+ts=(\S+)\s*-->/g;

export interface Claim {
  taskKey: string; // boule-id or "#<number>"
  runId: string;
  ts: string; // ISO-8601
  url: string;
}

export function claimMarker(taskKey: string, runId: string, ts: string): string {
  return `<!-- praktor:claim task=${taskKey} run=${runId} ts=${ts} -->`;
}

/** Is there a FRESH claim for this task held by a DIFFERENT run? (pure — testable) */
export function hasActiveClaim(
  taskKey: string,
  runId: string,
  claims: Claim[],
  now: number,
  ttlMinutes: number,
): boolean {
  const ttlMs = ttlMinutes * 60_000;
  return claims.some(
    (c) => c.taskKey === taskKey && c.runId !== runId && now - new Date(c.ts).getTime() < ttlMs,
  );
}

async function repositoryId(gh: GitHubClient, owner: string, name: string): Promise<string> {
  const data = await gh.graphql<{ repository: { id: string } }>(
    "read",
    "query($o:String!,$n:String!){ repository(owner:$o,name:$n){ id } }",
    { o: owner, n: name },
  );
  return data.repository.id;
}

export async function findCategoryId(
  gh: GitHubClient,
  owner: string,
  name: string,
  category: string,
): Promise<string | null> {
  const data = await gh.graphql<{
    repository: { discussionCategories: { nodes: Array<{ id: string; name: string }> } };
  }>(
    "read",
    "query($o:String!,$n:String!){ repository(owner:$o,name:$n){ discussionCategories(first:25){ nodes{ id name } } } }",
    { o: owner, n: name },
  );
  const found = data.repository.discussionCategories.nodes.find(
    (c) => c.name.toLowerCase() === category.toLowerCase(),
  );
  return found?.id ?? null;
}

/** Parse recent claim markers from the coordination category. */
export async function listClaims(
  gh: GitHubClient,
  owner: string,
  name: string,
  categoryId: string,
): Promise<Claim[]> {
  const data = await gh.graphql<{
    repository: { discussions: { nodes: Array<{ url: string; body: string }> } };
  }>(
    "read",
    `query($o:String!,$n:String!,$c:ID!){ repository(owner:$o,name:$n){
        discussions(first:50, categoryId:$c, orderBy:{field:UPDATED_AT,direction:DESC}){ nodes{ url body } } } }`,
    { o: owner, n: name, c: categoryId },
  );
  const claims: Claim[] = [];
  for (const d of data.repository.discussions.nodes) {
    for (const m of d.body.matchAll(CLAIM_RE)) {
      claims.push({ taskKey: m[1] as string, runId: m[2] as string, ts: m[3] as string, url: d.url });
    }
  }
  return claims;
}

export async function postDiscussion(
  gh: GitHubClient,
  owner: string,
  name: string,
  categoryId: string,
  title: string,
  body: string,
): Promise<{ number: number; url: string }> {
  const repoId = await repositoryId(gh, owner, name);
  const data = await gh.graphql<{ createDiscussion: { discussion: { number: number; url: string } } }>(
    "write",
    `mutation($r:ID!,$c:ID!,$t:String!,$b:String!){
       createDiscussion(input:{repositoryId:$r,categoryId:$c,title:$t,body:$b}){ discussion{ number url } } }`,
    { r: repoId, c: categoryId, t: title, b: body },
  );
  return data.createDiscussion.discussion;
}

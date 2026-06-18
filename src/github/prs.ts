// src/github/prs.ts — find Praktor's OWN conflicting/stale PRs for `heal` to mend. The REST Pulls
// list endpoint has no `creator` filter, so we list open PRs then author-gate in code via shouldHeal.
// We enrich each PR with the graphql mergeStateStatus + autoMergeRequest (the REST list omits both)
// and the Boule Task it Closes — the inputs the pure gate in heal/gate.ts needs to make a decision.
import type { GitHubClient } from "@kleroterion/koine";
import { type HealPrView, shouldHeal } from "../heal/gate.js";

/** Parse the Boule Task a PR Closes (`Closes #N`, case-insensitive). null ⇒ not Boule-linked. */
export function parseCloses(body: string): number | null {
  const m = body.match(/\bcloses\s+#(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

export interface HealablePr extends HealPrView {
  title: string;
  headRef: string; // the branch name (head.ref) we may force-push
  headSha: string; // current head commit
  baseRef: string; // the branch we rebase onto (base.ref)
  url: string;
  body: string;
}

interface PrNode {
  number: number;
  title: string;
  url: string;
  body: string | null;
  isDraft: boolean;
  state: string; // OPEN | CLOSED | MERGED
  mergeStateStatus: string; // CLEAN | DIRTY | BEHIND | BLOCKED | UNKNOWN | …
  headRefName: string;
  baseRefName: string;
  headRefOid: string;
  author: { __typename: string; login: string } | null;
  autoMergeRequest: { enabledAt: string | null } | null;
}

/**
 * List open PRs that are HEAL CANDIDATES: authored by the configured bot, Boule-linked (`Closes #N`),
 * conflicting/behind (never UNKNOWN), not draft, and without auto-merge enabled. The author+Boule+state
 * gate is enforced by `shouldHeal` — this function only fetches + maps; it never decides on its own.
 * Optionally restrict to a single PR `#only`.
 */
export async function listHealablePrs(
  gh: GitHubClient,
  owner: string,
  name: string,
  botAuthor: string,
  only?: number,
): Promise<HealablePr[]> {
  const data = await gh.graphql<{
    repository: { pullRequests: { nodes: PrNode[] } };
  }>(
    "read",
    `query($o:String!,$n:String!){ repository(owner:$o,name:$n){
        pullRequests(first:100, states:OPEN, orderBy:{field:UPDATED_AT,direction:DESC}){
          nodes{
            number title url body isDraft state mergeStateStatus
            headRefName baseRefName headRefOid
            author{ __typename login }
            autoMergeRequest{ enabledAt }
          } } } }`,
    { o: owner, n: name },
  );

  const out: HealablePr[] = [];
  for (const p of data.repository.pullRequests.nodes) {
    if (only !== undefined && p.number !== only) continue;
    const body = p.body ?? "";
    const view: HealablePr = {
      number: p.number,
      title: p.title,
      url: p.url,
      body,
      draft: p.isDraft,
      state: p.state.toLowerCase(),
      mergeableState: p.mergeStateStatus,
      authorType: p.author?.__typename === "Bot" ? "Bot" : (p.author?.__typename ?? ""),
      authorLogin: p.author?.login ?? "",
      bouleTask: parseCloses(body),
      autoMergeEnabled: Boolean(p.autoMergeRequest?.enabledAt),
      headRef: p.headRefName,
      headSha: p.headRefOid,
      baseRef: p.baseRefName,
    };
    if (shouldHeal(view, botAuthor)) out.push(view);
  }
  return out;
}

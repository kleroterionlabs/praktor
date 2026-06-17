// src/github/client.ts — the only path to the GitHub API. Backoff + auth live here.
import { createAppAuth } from "@octokit/auth-app";
import { graphql as octokitGraphql } from "@octokit/graphql";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import pRetry, { AbortError } from "p-retry";
import type { AuthConfig } from "../config/auth.js";
import type { Logger } from "../observability/logger.js";

const ThrottledOctokit = Octokit.plugin(throttling);
type OpKind = "read" | "write";

export interface GitHubClient {
  rest: Octokit;
  withRest<T>(op: OpKind, fn: (o: Octokit) => Promise<T>): Promise<T>;
  graphql<T = unknown>(op: OpKind, query: string, vars?: Record<string, unknown>): Promise<T>;
}

async function mintToken(auth: AuthConfig["github"]): Promise<string> {
  if (auth.kind === "pat") return auth.token;
  const appAuth = createAppAuth({
    appId: auth.appId,
    privateKey: auth.privateKey,
    installationId: Number(auth.installationId),
  });
  const { token } = await appAuth({ type: "installation" });
  return token;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function waitFor(err: unknown, attempt: number): number {
  const e = err as { status?: number; response?: { status?: number; headers?: Record<string, string> } };
  const status = e.status ?? e.response?.status;
  const headers = e.response?.headers ?? {};
  if (status === 403 || status === 429) {
    const ra = Number(headers["retry-after"]);
    if (Number.isFinite(ra)) return ra * 1000;
    const reset = Number(headers["x-ratelimit-reset"]);
    if (Number.isFinite(reset)) return Math.max(0, reset * 1000 - Date.now());
    return Math.max(60_000, 2 ** attempt * 1000);
  }
  if (status && status >= 500) return 2 ** attempt * 500;
  throw new AbortError(err as Error); // 4xx (non-rate) ⇒ don't retry
}

export async function createGitHubClient(auth: AuthConfig, log: Logger): Promise<GitHubClient> {
  const token = await mintToken(auth.github);
  const rest = new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (after, _o, _ok, retryCount) => {
        log.warn({ after, retryCount }, "primary rate limit");
        return retryCount < 3;
      },
      onSecondaryRateLimit: (after) => {
        log.warn({ after }, "secondary rate limit; honoring retry-after");
        return true;
      },
    },
  });
  const gql = octokitGraphql.defaults({
    headers: {
      authorization: `token ${token}`,
      "GraphQL-Features": "issue_types,sub_issues",
    },
  });

  const run = <T>(_op: OpKind, task: () => Promise<T>): Promise<T> =>
    pRetry(
      async (attempt) => {
        try {
          return await task();
        } catch (err) {
          await sleep(waitFor(err, attempt));
          throw err;
        }
      },
      { retries: 6, minTimeout: 1000, factor: 2 },
    );

  return {
    rest,
    withRest: (op, fn) => run(op, () => fn(rest)),
    graphql: <T>(op: OpKind, query: string, vars?: Record<string, unknown>) =>
      run<T>(op, () => gql(query, vars) as Promise<T>),
  };
}

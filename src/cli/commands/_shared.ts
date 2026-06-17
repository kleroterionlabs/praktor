// src/cli/commands/_shared.ts — common wiring so each command stays a thin handler.
import { type GitHubClient, createGitHubClient, createLogger } from "@kleroterion/koine";
import type { Command } from "commander";
import { resolveAuth } from "../../config/auth.js";
import { type CliFlags, loadConfig } from "../../config/load.js";
import type { Config } from "../../config/schema.js";

export interface GlobalFlags extends CliFlags {
  json?: boolean;
  verbose?: boolean;
}

export function globals(cmd: Command): GlobalFlags {
  const g = cmd.optsWithGlobals() as Record<string, unknown>;
  return {
    repo: g.repo as string | undefined,
    project: g.project as number | undefined,
    budget: g.budget as number | undefined,
    maxTurns: g.maxTurns as number | undefined,
    dryRun: g.dryRun as boolean | undefined,
    json: Boolean(g.json),
    verbose: Boolean(g.verbose),
    logLevel: g.verbose ? "debug" : undefined,
  };
}

export interface Ctx {
  cfg: Config;
  gh: GitHubClient;
  owner: string;
  name: string;
  json: boolean;
  runId: string;
  log: ReturnType<typeof createLogger>;
}

/** Load config + auth + a GitHub client; split owner/name. Throws UsageError on bad config. */
export async function context(global: GlobalFlags, runId: string): Promise<Ctx> {
  let cfg: Config;
  try {
    cfg = loadConfig({ env: process.env, cli: global });
  } catch (e) {
    throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { name: "UsageError" });
  }
  const log = createLogger({ level: cfg.log.level, service: "praktor", runId });
  const gh = await createGitHubClient(resolveAuth(process.env), log);
  const [owner, name] = cfg.repo.split("/") as [string, string];
  return { cfg, gh, owner, name, json: Boolean(global.json), runId, log };
}

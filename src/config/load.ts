// src/config/load.ts — merge defaults ← env ← CLI flags into a validated Config.
import { type Config, ConfigSchema } from "./schema.js";

export interface CliFlags {
  repo?: string;
  project?: number;
  budget?: number;
  maxTurns?: number;
  dryRun?: boolean;
  logLevel?: string;
}

interface LoadArgs {
  env: NodeJS.ProcessEnv;
  cli: CliFlags;
}

function fromEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const repo = env.PRAKTOR_REPO || env.BOULE_REPO || env.GITHUB_REPOSITORY;
  if (repo) out.repo = repo;
  if (env.PRAKTOR_PROJECT) out.projectNumber = Number(env.PRAKTOR_PROJECT);
  if (env.PRAKTOR_LOG_LEVEL) out.log = { level: env.PRAKTOR_LOG_LEVEL };
  return out;
}

function fromCli(cli: CliFlags): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (cli.repo) out.repo = cli.repo;
  if (cli.project !== undefined) out.projectNumber = cli.project;
  if (cli.budget !== undefined || cli.maxTurns !== undefined) {
    out.budgets = {
      ...(cli.budget !== undefined && { usdPerRun: cli.budget }),
      ...(cli.maxTurns !== undefined && { maxTurns: cli.maxTurns }),
    };
  }
  if (cli.dryRun !== undefined) out.flags = { dryRun: cli.dryRun };
  if (cli.logLevel) out.log = { level: cli.logLevel };
  return out;
}

/** Shallow-by-section merge (right wins); each top-level object section is merged one level deep. */
function merge(...layers: Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object") {
        out[k] = { ...(out[k] as object), ...(v as object) };
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

export function loadConfig({ env, cli }: LoadArgs): Config {
  const merged = merge(fromEnv(env), fromCli(cli));
  return ConfigSchema.parse(merged);
}

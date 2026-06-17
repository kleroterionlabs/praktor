// src/config/schema.ts — zod schema for Praktor config (env + CLI flags merged in load.ts).
import { z } from "zod";
import { DEFAULT_COORDINATION_CATEGORY } from "../core/taxonomy.js";

export const ConfigSchema = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "repo must be 'owner/name'"),
  projectNumber: z.number().int().positive().optional(),
  models: z
    .object({
      // The coder. Opus for hard implementation reasoning; drop to sonnet for cheaper runs.
      implementer: z.string().default("claude-opus-4-8"),
      fast: z.string().default("claude-haiku-4-5"),
      effort: z.enum(["low", "medium", "high", "xhigh"]).default("high"),
    })
    .default({}),
  budgets: z
    .object({
      usdPerRun: z.number().positive().default(10),
      maxTurns: z.number().int().positive().default(300),
    })
    .default({}),
  coordination: z
    .object({
      // Discussion category Praktor posts claims/handoffs to. Must already exist in the repo.
      category: z.string().default(DEFAULT_COORDINATION_CATEGORY),
      // A claim older than this (minutes) is considered stale and the task may be re-grabbed.
      claimTtlMinutes: z.number().int().positive().default(60),
    })
    .default({}),
  flags: z
    .object({
      dryRun: z.boolean().default(false),
    })
    .default({}),
  log: z.object({ level: z.string().default("info") }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

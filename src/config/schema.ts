// src/config/schema.ts — zod schema for Praktor config (env + CLI flags merged in load.ts).
import { DISCUSSION_CATEGORIES } from "@kleroterion/koine";
import { z } from "zod";

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
      category: z.string().default(DISCUSSION_CATEGORIES.handoff),
      // A claim older than this (minutes) is considered stale and the task may be re-grabbed.
      claimTtlMinutes: z.number().int().positive().default(60),
    })
    .default({}),
  review: z
    .object({
      // The bot login Praktor authors its PRs as. `heal` ONLY ever touches PRs authored by this
      // bot — a hard safety gate so Praktor never rebases a human's (or another bot's) PR.
      botAuthor: z.string().default("praktorai[bot]"),
    })
    .default({}),
  heal: z
    .object({
      // Refuse to heal any single PR more than this many times (globally, across runs) → escalate.
      loopCap: z.number().int().positive().default(3),
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

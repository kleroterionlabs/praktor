// src/agents/run.ts — owns the query() loop. Resilient to SDK transport noise: a subprocess error
// AFTER a terminal result must not override a run whose outcome is already known.
import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "../observability/logger.js";

export type StopReason = "success" | "error_max_turns" | "error_max_budget_usd" | "error_during_execution";

export interface RunResult {
  ok: boolean;
  stopReason: StopReason;
  sessionId: string;
  numTurns: number;
  costUsd: number;
  errors: string[];
}

function stopReasonOf(subtype: string): StopReason {
  if (subtype === "success") return "success";
  if (subtype === "error_max_turns") return "error_max_turns";
  if (subtype === "error_max_budget_usd") return "error_max_budget_usd";
  return "error_during_execution";
}

export async function runAgent(prompt: string, options: Options, log: Logger): Promise<RunResult> {
  let stopReason: StopReason = "error_during_execution";
  let numTurns = 0;
  let costUsd = 0;
  let sessionId = "";
  const errors: string[] = [];
  let gotResult = false;

  try {
    for await (const msg of query({ prompt, options })) {
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id;
        log.info({ sessionId }, "agent run started");
      }
      if (msg.type === "result") {
        stopReason = stopReasonOf(msg.subtype);
        numTurns = msg.num_turns;
        costUsd = msg.total_cost_usd;
        if (msg.subtype !== "success") errors.push(...(msg.errors ?? []));
        gotResult = true;
        log.info({ stopReason, costUsd, numTurns }, "agent run finished");
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (gotResult) {
      log.warn({ err: message }, "agent transport error after result; keeping captured outcome");
    } else {
      log.error({ err: message }, "agent run failed before producing a result");
      errors.push(message);
      stopReason = "error_during_execution";
    }
  }

  return { ok: stopReason === "success", stopReason, sessionId, numTurns, costUsd, errors };
}

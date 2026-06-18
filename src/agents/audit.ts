// src/agents/audit.ts — a logging-only PreToolUse hook so a coder run's tool calls are traceable.
// Praktor's coder runs with bypassPermissions: this hook only OBSERVES, it never denies. Unlike
// Boule's write-gate, it exists purely for visibility — one log line per tool invocation, so a
// long agentic run is no longer a black box between "started" and "finished".
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "@kleroterion/koine";

/** PreToolUse hook that logs every tool invocation and always continues. */
export function makeAuditHook(log: Logger): HookCallback {
  return async (input) => {
    const tool = "tool_name" in input ? input.tool_name : input.hook_event_name;
    log.info({ event: "pre_tool_use", tool }, "tool invocation");
    return { continue: true };
  };
}

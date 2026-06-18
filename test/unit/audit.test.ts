import type { Logger } from "@kleroterion/koine";
import { describe, expect, it, vi } from "vitest";
import { makeAuditHook } from "../../src/agents/audit.js";

// Minimal fake logger: only .info is exercised by the hook.
function fakeLog(): { log: Logger; info: ReturnType<typeof vi.fn> } {
  const info = vi.fn();
  return { log: { info } as unknown as Logger, info };
}

describe("makeAuditHook", () => {
  const hookCtx = { signal: new AbortController().signal };

  it("logs a tool invocation and always continues", async () => {
    const { log, info } = fakeLog();
    const result = await makeAuditHook(log)({ tool_name: "Bash" } as never, undefined, hookCtx);

    expect(info).toHaveBeenCalledWith({ event: "pre_tool_use", tool: "Bash" }, "tool invocation");
    expect(result).toEqual({ continue: true });
  });

  it("falls back to the hook event name when there is no tool_name", async () => {
    const { log, info } = fakeLog();
    await makeAuditHook(log)({ hook_event_name: "PreToolUse" } as never, undefined, hookCtx);

    expect(info).toHaveBeenCalledWith({ event: "pre_tool_use", tool: "PreToolUse" }, "tool invocation");
  });
});

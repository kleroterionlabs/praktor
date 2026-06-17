// src/index.ts — programmatic API surface (mirrors what the CLI drives).
export { loadConfig } from "./config/load.js";
export type { Config } from "./config/schema.js";
export { resolveAuth } from "./config/auth.js";
export { createGitHubClient } from "@kleroterion/koine";
export { listReadyTasks, listAcceptedTasks, isHalted } from "./github/tasks.js";
export type { ReadyTask, TaskRef } from "./github/tasks.js";
export { implementTask } from "./agents/implementer.js";
export { hasActiveClaim, claimMarker } from "./github/discussions.js";

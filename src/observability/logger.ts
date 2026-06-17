// src/observability/logger.ts — structured pino logger; one child per run carries the runId.
import pino, { type Logger } from "pino";

export type { Logger };

export function createLogger(level: string, runId?: string): Logger {
  const base = pino({
    level,
    redact: {
      paths: ["token", "privateKey", "*.token", "*.privateKey", "headers.authorization"],
      censor: "[redacted]",
    },
  });
  return runId ? base.child({ service: "praktor", runId }) : base.child({ service: "praktor" });
}

// src/core/taxonomy.ts — Praktor READS Boule's artifacts, so it mirrors the labels/fields Boule writes.
// Keep these in lockstep with @kleroterion/cli's taxonomy; Praktor never invents new kinds.

/** Boule kind labels (fallback when native Issue Types are unavailable). */
export const kindLabel = (kind: string): string => `kind:${kind}`;

export const TASK_KIND = "task";
export const TASK_LABEL = kindLabel(TASK_KIND);

export const OPERATIONAL_LABELS = {
  managed: "boule:managed",
  needsHuman: "boule:needs-human",
  halt: "boule:halt",
} as const;

/** Acceptance lifecycle label an artifact carries (set by Boule's IPM). */
export const STATUS = {
  draft: "status:draft",
  needsReview: "status:needs-review",
  accepted: "status:accepted",
  superseded: "status:superseded",
} as const;

/** Praktor's own progress labels — namespaced so Boule never confuses them with its lifecycle. */
export const PRAKTOR_LABELS = {
  inProgress: "praktor:in-progress",
  done: "praktor:done",
  blocked: "praktor:blocked",
} as const;

/** Projects v2 Status column options Boule provisions (board is the source of truth for where work sits). */
export const BOARD_STATUS = {
  triage: "Triage",
  inDesign: "In Design",
  inReview: "In Review",
  ready: "Ready",
  inProgress: "In Progress",
  blocked: "Blocked",
  done: "Done",
} as const;

/** Discussion category Praktor uses to coordinate (must be pre-provisioned by Boule's bootstrap). */
export const DEFAULT_COORDINATION_CATEGORY = "Agent Handoffs";

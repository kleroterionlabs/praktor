// src/core/boule.ts — parse the `boule:v1` identity block Boule appends to every artifact body.
// Pure & network-free. Mirrors @kleroterion/cli's idempotency block so Praktor reads the same identity.

const BOULE_BEGIN = "<!-- boule:v1";
const BOULE_END = "-->";

export interface BouleBlock {
  kind: string;
  bouleId: string;
  contentHash?: string;
  parent?: string;
  runId?: string;
}

/** Extract Boule's identity block from an issue body, or null if absent (a non-Boule issue). */
export function parseBouleBlock(body: string): BouleBlock | null {
  const start = body.indexOf(BOULE_BEGIN);
  if (start === -1) return null;
  const end = body.indexOf(BOULE_END, start);
  if (end === -1) return null;
  const inner = body.slice(start + BOULE_BEGIN.length, end);
  const get = (k: string): string | undefined => {
    const m = inner.match(new RegExp(`^${k}:\\s*(.+)$`, "m"));
    return m?.[1]?.trim() || undefined;
  };
  const kind = get("kind");
  const bouleId = get("boule-id");
  if (!kind || !bouleId) return null;
  return {
    kind,
    bouleId,
    contentHash: get("content-hash"),
    parent: get("parent"),
    runId: get("run-id"),
  };
}

/** Issue numbers referenced by a `Verifies: #110, #112` link line (the Task → Requirement trace). */
export function parseVerifies(body: string): number[] {
  const m = body.match(/^\s*Verifies:\s*(.+)$/im);
  if (!m?.[1]) return [];
  return [...m[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1])).filter((n) => Number.isInteger(n));
}

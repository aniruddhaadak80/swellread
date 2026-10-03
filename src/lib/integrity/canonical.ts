import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted recursively by UTF-16 code unit, arrays
 * kept in order, `undefined` members dropped, no insignificant whitespace.
 * Numbers are emitted through JSON.stringify, so `-0` becomes `0`.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    if (value === undefined) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    if (entry === undefined) continue;
    out[key] = canonicalize(entry);
  }
  return out;
}

export const GENESIS_SEAL = "0".repeat(96); // 96 hex chars = 384 bits

/**
 * Per-entity tamper-evident chain.
 *
 *   seal_n = SHA-384( UTF-8( prevSeal ) || UTF-8( canonicalJson( event_n ) ) )
 *
 * The event payload passed in must already contain its own `seq`, `entityId`,
 * `action` and `createdAt`; those are the fields a replay recomputes.
 */
export function sealEvent(
  prevSeal: string,
  event: Record<string, unknown>,
): string {
  return createHash("sha384")
    .update(prevSeal, "utf8")
    .update(canonicalJson(event), "utf8")
    .digest("hex");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Verifies one link. Returns null when intact, otherwise the reason.
 *
 * `seal` and `prevSeal` are columns beside the event body, not part of it, so
 * they are stripped before re-hashing. The writer hashes exactly the remaining
 * keys, which keeps this check independent of storage order.
 */
export function verifyLink(
  prevSeal: string,
  event: Record<string, unknown>,
): string | null {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === "seal" || key === "prevSeal") continue;
    body[key] = value;
  }
  const expected = sealEvent(prevSeal, body);
  const actual = typeof event.seal === "string" ? event.seal : "";
  if (expected === actual) return null;
  return `seal mismatch at seq ${String(event.seq)}: expected ${expected.slice(0, 12)}, found ${actual.slice(0, 12)}`;
}
import { fnv1a } from "../arbiter/CommandArbiter";
import type { AuditEntry } from "../domain/types";

/**
 * System audit-trail linker — the site-level counterpart to the operator
 * `auditChain.ts`. Both use the same `fnv1a` linker as the command arbiter so
 * every chained surface speaks one language.
 *
 * `fnv1a` is a fast, non-cryptographic hash: it makes accidental edits, drops,
 * and reordering visible (tamper-evident), it is not a security guarantee.
 * Pure + deterministic — entries are ordered by timestamp (then `id` to break
 * ties), then each links off the previous hash starting from the literal
 * "GENESIS".
 */

const GENESIS_HASH = "GENESIS";

/**
 * Everything that gets hashed, in a fixed key order for a stable link. The
 * `before`/`after` payload fields are intentionally NOT hashed — they are
 * non-signed metadata. Note this trail is a derived projection recomputed per
 * build (in `buildCurrentSiteRecord`), not a persisted append-only log.
 */
function canonicalEntry(entry: AuditEntry): string {
  return JSON.stringify([
    entry.id,
    entry.timestamp,
    entry.actor,
    entry.action,
    entry.subjectRef,
    entry.detail
  ]);
}

/** Order a site's audit entries and link them into a tamper-evident chain. */
export function chainAuditTrail(entries: readonly AuditEntry[]): AuditEntry[] {
  const ordered = [...entries].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)
  );
  let prevHash = GENESIS_HASH;
  return ordered.map((entry) => {
    const prev = prevHash;
    const hash = fnv1a(prev + canonicalEntry(entry));
    prevHash = hash;
    return { ...entry, prevHash: prev, hash };
  });
}

/**
 * Result of verifying a hash-chain link-for-link. Shared by both the system
 * audit trail (here) and the operator chain (`src/console/auditChain.ts`),
 * which imports this same interface.
 */
export interface ChainIntegrity {
  ok: boolean;
  count: number;
  /** Entry id where the chain first fails to verify, if any. */
  brokenAt?: string;
  /** Hash the chain terminates on (the head), or GENESIS for an empty trail. */
  head: string;
}

/** Verify a chained trail recomputes link-for-link from GENESIS. */
export function verifyAuditTrail(entries: readonly AuditEntry[]): ChainIntegrity {
  let expectedPrev = GENESIS_HASH;
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) return { ok: false, count: entries.length, brokenAt: entry.id, head: expectedPrev };
    const recomputed = fnv1a(entry.prevHash + canonicalEntry(entry));
    if (recomputed !== entry.hash) return { ok: false, count: entries.length, brokenAt: entry.id, head: expectedPrev };
    expectedPrev = entry.hash;
  }
  return { ok: true, count: entries.length, head: expectedPrev };
}

import { fnv1a } from "../arbiter/CommandArbiter";
import type { ChainIntegrity } from "../kernel/auditTrailChain";

export type { ChainIntegrity };

/**
 * Operator audit chain — an append-only, FNV-1a hash-chained log of every operator
 * action taken in the console (confirm, dismiss, dispatch, escalate, and the
 * arbiter decision behind a dispatch).
 *
 * Reuses the same `fnv1a` linker as the CommandArbiter so the operator surface and
 * the safety arbiter speak the same tamper-evident language. Pure + deterministic:
 * timestamps are passed in (CLAUDE.md invariant 3); the chain itself is the only
 * state. The first record chains off the literal "GENESIS".
 */

const GENESIS_HASH = "GENESIS";

export type OperatorAction =
  | "confirm"
  | "dismiss_false_positive"
  | "dispatch_unit"
  | "escalate_customer"
  | "recall_unit"
  | "estop_engaged"
  | "incident_closeout"
  | "arbiter_decision";

export interface OperatorAuditRecord {
  id: string;
  /** ISO timestamp the action was taken (passed in, never read from the clock). */
  timestamp: string;
  actor: string;
  action: OperatorAction;
  /** Decision / subject this action resolved (e.g. a DecisionItem id). */
  subjectRef: string;
  detail: string;
  /** True for an allow, false for a deny, undefined for non-gate actions. */
  allowed?: boolean;
  /** When a dispatch was denied, the named gate that denied it. */
  deniedByGate?: string;
  prevHash: string;
  hash: string;
}

/** Everything except prevHash/hash, in a fixed key order for a stable hash. */
function canonicalCore(rec: Omit<OperatorAuditRecord, "prevHash" | "hash">): string {
  return JSON.stringify([
    rec.id,
    rec.timestamp,
    rec.actor,
    rec.action,
    rec.subjectRef,
    rec.detail,
    rec.allowed ?? null,
    rec.deniedByGate ?? null
  ]);
}

export class OperatorAuditChain {
  private readonly records: OperatorAuditRecord[] = [];
  private prevHash = GENESIS_HASH;

  constructor(seed: readonly OperatorAuditRecord[] = []) {
    for (const rec of seed) {
      this.records.push(rec);
      this.prevHash = rec.hash;
    }
  }

  /** Append a signed, hash-chained operator action. Returns the new record. */
  append(core: {
    id: string;
    timestamp: string;
    actor: string;
    action: OperatorAction;
    subjectRef: string;
    detail: string;
    allowed?: boolean;
    deniedByGate?: string;
  }): OperatorAuditRecord {
    const prevHash = this.prevHash;
    const partial: Omit<OperatorAuditRecord, "prevHash" | "hash"> = {
      id: core.id,
      timestamp: core.timestamp,
      actor: core.actor,
      action: core.action,
      subjectRef: core.subjectRef,
      detail: core.detail,
      allowed: core.allowed,
      deniedByGate: core.deniedByGate
    };
    const hash = fnv1a(prevHash + canonicalCore(partial));
    const record: OperatorAuditRecord = { ...partial, prevHash, hash };
    this.records.push(record);
    this.prevHash = hash;
    return record;
  }

  /** Read-only view of the chain (oldest first). */
  list(): readonly OperatorAuditRecord[] {
    return this.records;
  }

  /** Verify the chain is contiguous and untampered. */
  verify(): boolean {
    return verifyAuditChain(this.records).ok;
  }
}

/**
 * Pure chain verification over a list of records in append order — the same check
 * `OperatorAuditChain.verify()` runs, exposed as a free function so a read-only
 * surface (e.g. the Proof view) can prove tamper-evidence without holding the
 * chain instance. Deterministic: recomputes every link from GENESIS.
 */
export function verifyAuditChain(records: readonly OperatorAuditRecord[]): ChainIntegrity {
  let expectedPrev = GENESIS_HASH;
  for (const rec of records) {
    if (rec.prevHash !== expectedPrev) return { ok: false, count: records.length, brokenAt: rec.id, head: expectedPrev };
    const recomputed = fnv1a(rec.prevHash + canonicalCore(rec));
    if (recomputed !== rec.hash) return { ok: false, count: records.length, brokenAt: rec.id, head: expectedPrev };
    expectedPrev = rec.hash;
  }
  return { ok: true, count: records.length, head: expectedPrev };
}

import { ORDERED_GATES } from "./gates";
import type {
  ArbiterAuditRecord,
  CommandDecision,
  CommandIntent,
  EstopAuthority,
  EstopScopeKind,
  Gate,
  GateContext
} from "./types";

/**
 * Phase 3 Command Arbiter — the deterministic, edge-resident safety gate between
 * an operator action and a moving robot.
 *
 * Properties (CLAUDE.md invariants):
 *  - Deterministic: all time enters as an ISO string; no Date.now() in decisions.
 *  - Audit everything: every decision (allow OR deny) emits a signed, hash-chained
 *    ArbiterAuditRecord. The chain is append-only.
 *  - Idempotent by intent.id: re-evaluating the same intent returns the cached
 *    decision and does NOT append a second link to the chain.
 *
 * Hash chain: hash = fnv1a(prevHash + canonical(decision core)). The first record
 * chains off the literal "GENESIS". No external crypto dependency.
 */

const GENESIS_HASH = "GENESIS";

/**
 * FNV-1a 32-bit, returned as a fixed-width 8-char hex string. Tiny, deterministic,
 * dependency-free. Not a security primitive — it is a tamper-evident chain linker:
 * any edit to a record breaks every downstream hash.
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, kept in 32-bit unsigned range via Math.imul + >>> 0.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Authority precedence: physical (highest) > site-local operator > cloud operator. */
const AUTHORITY_RANK: Record<EstopAuthority, number> = {
  physical: 3,
  site_local_operator: 2,
  cloud_operator: 1
};

interface EstopLedger {
  siteEngaged: boolean;
  siteEngagedBy?: EstopAuthority;
  engagedUnits: Record<string, EstopAuthority>;
}

export interface EstopOutcome {
  applied: boolean;
  reason: string;
  audit: ArbiterAuditRecord;
}

export class CommandArbiter {
  private readonly gates: readonly Gate[];
  private readonly auditChain: ArbiterAuditRecord[] = [];
  private readonly decisionsByIntent = new Map<string, CommandDecision>();
  private prevHash = GENESIS_HASH;

  private readonly estop: EstopLedger = {
    siteEngaged: false,
    engagedUnits: {}
  };

  constructor(gates: readonly Gate[] = ORDERED_GATES) {
    this.gates = gates;
  }

  /**
   * Evaluate an intent against the ordered gates. Stops at the first failing gate.
   * Idempotent by intent.id — a repeated intent returns the original decision and
   * appends nothing new to the audit chain.
   */
  evaluate(intent: CommandIntent, ctx: GateContext, nowIso: string): CommandDecision {
    const existing = this.decisionsByIntent.get(intent.id);
    if (existing) return existing;

    // Merge the arbiter's authoritative e-stop ledger into the context the gates see.
    const evalCtx: GateContext = {
      ...ctx,
      estop: {
        siteEngaged: this.estop.siteEngaged,
        siteEngagedBy: this.estop.siteEngagedBy,
        engagedUnits: { ...this.estop.engagedUnits }
      }
    };

    const reasons: string[] = [];
    let allowed = true;
    let deniedByGate: string | undefined;

    for (const gate of this.gates) {
      const result = gate.evaluate(intent, evalCtx, nowIso);
      if (!result.pass) {
        allowed = false;
        deniedByGate = gate.id;
        reasons.push(`[${gate.id}] ${result.reason}`);
        break; // stop at first failing gate
      }
    }

    // LOST-LINK policy backstop: if the link to the unit (or the site->cloud link
    // for a cloud operator) is partitioned, deny dispatch/route but allow
    // recall/hold/stop. This is enforced even if earlier gates passed in a context
    // where link looked acceptable, because lost-link is a hard motion inhibit.
    if (allowed && this.isMotionInhibitedByLostLink(intent, evalCtx)) {
      allowed = false;
      deniedByGate = "lost_link";
      reasons.push(
        "[lost_link] link partitioned; dispatch/route inhibited (recall/hold allowed)"
      );
    }

    if (allowed) reasons.push("all gates passed");

    const audit = this.record({
      intentId: intent.id,
      commandType: intent.type,
      targetMachineId: intent.targetMachineId,
      operatorId: intent.issuedBy.operatorId,
      allowed,
      deniedByGate,
      reasons,
      decidedAt: nowIso
    });
    const decision: CommandDecision = {
      allowed: audit.allowed,
      deniedByGate: audit.deniedByGate,
      reasons: audit.reasons,
      auditId: audit.auditId,
      prevHash: audit.prevHash,
      hash: audit.hash
    };
    this.decisionsByIntent.set(intent.id, decision);
    return decision;
  }

  /**
   * Engage an e-stop on a scope. Authority precedence governs overrides: a higher
   * authority can always set/keep the stop; the engagedBy is upgraded to the highest
   * authority seen. Physical e-stop is the top of the chain.
   */
  estopEngage(params: {
    scope: EstopScopeKind;
    targetId: string; // siteId for scope=site, machineId for scope=unit
    authority: EstopAuthority;
    intentId: string;
    nowIso: string;
  }): EstopOutcome {
    const { scope, targetId, authority, intentId, nowIso } = params;
    if (scope === "site") {
      this.estop.siteEngaged = true;
      this.estop.siteEngagedBy = this.maxAuthority(this.estop.siteEngagedBy, authority);
    } else {
      this.estop.engagedUnits[targetId] = this.maxAuthority(
        this.estop.engagedUnits[targetId],
        authority
      );
    }
    const audit = this.record({
      intentId,
      commandType: "estop",
      targetMachineId: scope === "unit" ? targetId : `site:${targetId}`,
      operatorId: `${authority}`,
      allowed: true,
      reasons: [`e-stop engaged on ${scope} ${targetId} by ${authority}`],
      decidedAt: nowIso
    });
    return { applied: true, reason: `e-stop engaged (${authority})`, audit };
  }

  /**
   * Clear an e-stop. Authority precedence: an operator may only clear a stop set by
   * EQUAL or LOWER authority. A cloud operator cannot clear a physical e-stop; only
   * a physical reset (authority=physical) can. The clear attempt is always audited.
   */
  clearEstop(params: {
    scope: EstopScopeKind;
    targetId: string;
    authority: EstopAuthority;
    intentId: string;
    nowIso: string;
  }): EstopOutcome {
    const { scope, targetId, authority, intentId, nowIso } = params;
    const setBy =
      scope === "site" ? this.estop.siteEngagedBy : this.estop.engagedUnits[targetId];

    const engaged =
      scope === "site" ? this.estop.siteEngaged : Boolean(this.estop.engagedUnits[targetId]);

    if (!engaged) {
      const audit = this.record({
        intentId,
        commandType: "clear_estop",
        targetMachineId: scope === "unit" ? targetId : `site:${targetId}`,
        operatorId: `${authority}`,
        allowed: false,
        deniedByGate: "estop_clear",
        reasons: [`no e-stop engaged on ${scope} ${targetId}`],
        decidedAt: nowIso
      });
      return { applied: false, reason: "no e-stop engaged", audit };
    }

    if (setBy && AUTHORITY_RANK[authority] < AUTHORITY_RANK[setBy]) {
      const audit = this.record({
        intentId,
        commandType: "clear_estop",
        targetMachineId: scope === "unit" ? targetId : `site:${targetId}`,
        operatorId: `${authority}`,
        allowed: false,
        deniedByGate: "estop_clear",
        reasons: [
          `authority ${authority} cannot clear e-stop set by higher authority ${setBy}`
        ],
        decidedAt: nowIso
      });
      return {
        applied: false,
        reason: `insufficient authority to clear (set by ${setBy})`,
        audit
      };
    }

    if (scope === "site") {
      this.estop.siteEngaged = false;
      this.estop.siteEngagedBy = undefined;
    } else {
      delete this.estop.engagedUnits[targetId];
    }
    const audit = this.record({
      intentId,
      commandType: "clear_estop",
      targetMachineId: scope === "unit" ? targetId : `site:${targetId}`,
      operatorId: `${authority}`,
      allowed: true,
      reasons: [`e-stop cleared on ${scope} ${targetId} by ${authority}`],
      decidedAt: nowIso
    });
    return { applied: true, reason: `e-stop cleared (${authority})`, audit };
  }

  /** Read-only view of the hash-chained audit ledger. */
  getAuditChain(): readonly ArbiterAuditRecord[] {
    return this.auditChain;
  }

  /** Verify the chain is contiguous: each record's prevHash == prior record's hash. */
  verifyChain(): boolean {
    let expectedPrev = GENESIS_HASH;
    for (const rec of this.auditChain) {
      if (rec.prevHash !== expectedPrev) return false;
      const recomputed = fnv1a(rec.prevHash + this.canonicalCore(rec));
      if (recomputed !== rec.hash) return false;
      expectedPrev = rec.hash;
    }
    return true;
  }

  isSiteEstopEngaged(): boolean {
    return this.estop.siteEngaged;
  }

  isUnitEstopEngaged(machineId: string): boolean {
    return Boolean(this.estop.engagedUnits[machineId]);
  }

  // --- internals -----------------------------------------------------------

  private isMotionInhibitedByLostLink(intent: CommandIntent, ctx: GateContext): boolean {
    const isMotion = intent.type === "dispatch_machine" || intent.type === "upload_route";
    if (!isMotion) return false;
    const unit = ctx.units.find((u) => u.machineId === intent.targetMachineId);
    const unitPartitioned = unit?.link === "partitioned";
    const cloudOriginPartitioned =
      intent.issuedBy.authority === "cloud_operator" && ctx.siteLinkToCloud === "partitioned";
    return unitPartitioned || cloudOriginPartitioned;
  }

  private maxAuthority(
    current: EstopAuthority | undefined,
    incoming: EstopAuthority
  ): EstopAuthority {
    if (!current) return incoming;
    return AUTHORITY_RANK[incoming] >= AUTHORITY_RANK[current] ? incoming : current;
  }

  /**
   * Canonical serialization of the decision core (everything EXCEPT prevHash/hash),
   * with object keys in a fixed order so the hash is stable across runs.
   */
  private canonicalCore(rec: Omit<ArbiterAuditRecord, "prevHash" | "hash">): string {
    return JSON.stringify([
      rec.auditId,
      rec.intentId,
      rec.commandType,
      rec.targetMachineId,
      rec.operatorId,
      rec.allowed,
      rec.deniedByGate ?? null,
      rec.reasons,
      rec.decidedAt
    ]);
  }

  private record(core: {
    intentId: string;
    commandType: ArbiterAuditRecord["commandType"];
    targetMachineId: string;
    operatorId: string;
    allowed: boolean;
    deniedByGate?: string;
    reasons: string[];
    decidedAt: string;
  }): ArbiterAuditRecord {
    const auditId = `audit-arbiter-${core.intentId}`;
    const prevHash = this.prevHash;
    const partial: Omit<ArbiterAuditRecord, "prevHash" | "hash"> = {
      auditId,
      intentId: core.intentId,
      commandType: core.commandType,
      targetMachineId: core.targetMachineId,
      operatorId: core.operatorId,
      allowed: core.allowed,
      deniedByGate: core.deniedByGate,
      reasons: core.reasons,
      decidedAt: core.decidedAt
    };
    const hash = fnv1a(prevHash + this.canonicalCore(partial));

    const auditRecord: ArbiterAuditRecord = { ...partial, prevHash, hash };
    this.auditChain.push(auditRecord);
    this.prevHash = hash;
    return auditRecord;
  }
}

import type {
  Machine,
  SiteGeometry,
  SitePoint
} from "../domain/types";

export type { SitePoint } from "../domain/types";

/**
 * Phase 3 Command Arbiter — local types.
 *
 * Co-located per CLAUDE.md ("New cross-module types live in domain/types.ts only
 * if widely shared; otherwise co-locate in the owning module"). Shared spine types
 * (Machine, SiteGeometry, SitePoint, AuditEntry) are imported from ../domain/types.
 *
 * The arbiter is the safety gate between an operator action and a moving robot.
 * Nothing here calls Date.now()/new Date(): all time enters as an ISO string input
 * so every decision is deterministic and reproducible (invariant 3).
 */

/** The control level a command requires from the target adapter. */
export type CommandControlLevel = "observe" | "guarded" | "autonomous";

export type CommandType =
  | "dispatch_machine"
  | "upload_route"
  | "recall_machine"
  | "hold_machine"
  | "estop"
  | "clear_estop";

export type OperatorRole =
  | "viewer"
  | "site_operator"
  | "fleet_operator"
  | "safety_officer";

/** Authority tiers for who may engage/clear an e-stop (physical wins). */
export type EstopAuthority = "physical" | "site_local_operator" | "cloud_operator";

export type EstopScopeKind = "site" | "unit";

/** Link state between the edge gateway and the unit / between site and cloud. */
export type LinkState = "up" | "degraded" | "partitioned";

export interface CommandIssuer {
  operatorId: string;
  role: OperatorRole;
  /** Where the operator sits — used for e-stop authority precedence. */
  authority: EstopAuthority;
  /** Site the operator is scoped to. A command for another site is denied. */
  scopedSiteId: string;
}

export interface CommandParams {
  /** Required for dispatch / upload_route: destination / first waypoint in site-local-ENU. */
  destination?: SitePoint;
  /** Optional explicit zone the destination is expected to fall in. */
  targetZoneId?: string;
  /** Route waypoints for upload_route (all must clear the geofence). */
  waypoints?: SitePoint[];
  /** Minimum control level this command needs from the adapter. */
  requiredControlLevel?: CommandControlLevel;
  reason?: string;
}

export interface CommandIntent {
  id: string;
  type: CommandType;
  targetMachineId: string;
  issuedBy: CommandIssuer;
  params: CommandParams;
  /** ISO timestamp the command was issued by the operator. */
  issuedAt: string;
  /**
   * Max age (ms) the command may have at evaluation time before it is rejected
   * as stale. The freshness gate compares (nowIso - issuedAt) against this.
   */
  freshnessDeadlineMs: number;
}

/** Per-unit runtime state the arbiter reads to decide. */
export interface UnitRuntimeState {
  machineId: string;
  /** Link from the edge gateway to this unit. */
  link: LinkState;
  /** True if this unit is locked out for maintenance. */
  maintenanceLockout: boolean;
  /** Id of an active mission on this unit, if any. */
  activeMissionId?: string;
  /** Battery floor below which dispatch is unsafe (percent). */
  batteryFloorPct: number;
}

/**
 * Snapshot of everything a gate may read. Pure input — gates never mutate it.
 * The arbiter assembles e-stop state from its own internal ledger and merges it
 * in before evaluating.
 */
export interface GateContext {
  siteId: string;
  machines: Machine[];
  units: UnitRuntimeState[];
  geometry: SiteGeometry;
  /** Adapter command surface for the target unit, if a guarded adapter is registered. */
  adapter?: {
    adapterId: string;
    commandHardware: boolean;
    supportedControlLevels: CommandControlLevel[];
  };
  /** Link from this site/edge gateway up to the cloud control plane. */
  siteLinkToCloud: LinkState;
  /**
   * Optional weather hold. When `hold` is true, the weather gate denies dispatch /
   * route for a UAV (e.g. high wind exceeds the airframe envelope). Absent weather
   * means "no hold known" and the gate passes — so existing contexts stay green.
   */
  weather?: { hold: boolean; reason?: string };
  /** E-stop state injected by the arbiter (engaged scopes + authority that set them). */
  estop: {
    siteEngaged: boolean;
    siteEngagedBy?: EstopAuthority;
    engagedUnits: Record<string, EstopAuthority>;
  };
}

export interface GateResult {
  pass: boolean;
  reason: string;
}

export interface Gate {
  id: string;
  evaluate(intent: CommandIntent, ctx: GateContext, nowIso: string): GateResult;
}

export interface CommandDecision {
  allowed: boolean;
  /** Id of the first gate that failed, when denied. */
  deniedByGate?: string;
  reasons: string[];
  /** Deterministic audit id derived from the intent id. */
  auditId: string;
  /** Hash of the previous record in the chain ("GENESIS" for the first). */
  prevHash: string;
  /** Hash of this record = hash(prevHash + canonical(decision core)). */
  hash: string;
}

/** Signed, hash-chained audit record emitted for every decision (allow OR deny). */
export interface ArbiterAuditRecord {
  auditId: string;
  intentId: string;
  commandType: CommandType;
  targetMachineId: string;
  operatorId: string;
  allowed: boolean;
  deniedByGate?: string;
  reasons: string[];
  /** ISO time the decision was evaluated (the nowIso passed in). */
  decidedAt: string;
  prevHash: string;
  hash: string;
}

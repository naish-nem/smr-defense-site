import type { AuditEntry, CoverageZone, Machine, Site } from "../domain/types";

/**
 * Mission lifecycle types for FleetBrain Phase 1.
 *
 * All mission-owned types are co-located here. Shared spine types
 * (Site, Machine, AuditEntry, CoverageZone) are imported from domain/types
 * and never redefined.
 */

/** The kinds of inspection work a mission can carry out. */
export type MissionTaskType =
  | "perimeter_patrol"
  | "thermal_inspection"
  | "asset_walkdown"
  | "intrusion_verify";

/**
 * Mission lifecycle states.
 *
 *   draft → validated → authorized → dispatched → accepted → executing
 *   executing → { completed | paused | canceled | rejected | failed }
 *   paused → executing  (resume)
 */
export type MissionState =
  | "draft"
  | "validated"
  | "authorized"
  | "dispatched"
  | "accepted"
  | "executing"
  | "paused"
  | "completed"
  | "canceled"
  | "rejected"
  | "failed";

/** Who can drive a mission transition. Mirrors AuditEntry.actor roles. */
export type MissionActor = "operator" | "system" | "FleetBrainKernel";

/**
 * A single recorded step in a mission's lifecycle. Each transition produces
 * exactly one MissionTransition and exactly one matching AuditEntry.
 * `transitionId` is the idempotency key: re-issuing the same id is a no-op.
 */
export interface MissionTransition {
  transitionId: string;
  from: MissionState;
  to: MissionState;
  actor: MissionActor;
  at: string;
  detail: string;
  auditId: string;
}

/** The mission entity persisted in the in-memory store. */
export interface Mission {
  id: string;
  siteId: string;
  taskType: MissionTaskType;
  targetZoneIds: string[];
  assignedMachineIds: string[];
  state: MissionState;
  createdAt: string;
  history: MissionTransition[];
}

/** Parameters accepted by MissionService.create. Timestamps are passed in. */
export interface CreateMissionParams {
  id: string;
  siteId: string;
  taskType: MissionTaskType;
  targetZoneIds: string[];
  assignedMachineIds: string[];
  createdAt: string;
  actor?: MissionActor;
}

/**
 * Context for validate(): the site geometry's zones and the machine roster to
 * check assigned machines against. Supplied by the caller so validation stays
 * deterministic and decoupled from any live data source.
 */
export interface MissionValidationContext {
  site: Site;
  zones: CoverageZone[];
  machines: Machine[];
  at: string;
  transitionId?: string;
  actor?: MissionActor;
}

/** Result type for fallible operations. Errors are returned, never thrown. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Convenience constructors for Result. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}

export type { AuditEntry, CoverageZone, Machine, Site };

import type { AuditEntry } from "../domain/types";
import { canTransition, legalNextStates } from "./missionStateMachine";
import {
  err,
  ok,
  type CreateMissionParams,
  type Mission,
  type MissionActor,
  type MissionState,
  type MissionTaskType,
  type MissionTransition,
  type MissionValidationContext,
  type Result
} from "./types";

const SUPPORTED_TASK_TYPES: ReadonlySet<MissionTaskType> = new Set<MissionTaskType>([
  "perimeter_patrol",
  "thermal_inspection",
  "asset_walkdown",
  "intrusion_verify"
]);

/** A machine in one of these statuses cannot be assigned to a live mission. */
const UNAVAILABLE_MACHINE_STATUSES = new Set(["offline", "recalled"]);

/**
 * In-memory mission store, mirroring FleetBrainStore style: a plain Map keyed
 * by mission id, with audit entries kept per-site so they slot into the same
 * audit surface as the rest of the kernel.
 */
class MissionStore {
  private missions = new Map<string, Mission>();
  private auditBySite = new Map<string, AuditEntry[]>();

  get(missionId: string): Mission | undefined {
    return this.missions.get(missionId);
  }

  has(missionId: string): boolean {
    return this.missions.has(missionId);
  }

  save(mission: Mission): void {
    this.missions.set(mission.id, mission);
  }

  list(): Mission[] {
    return [...this.missions.values()];
  }

  appendAuditEntry(siteId: string, entry: AuditEntry): void {
    this.auditBySite.set(siteId, [entry, ...(this.auditBySite.get(siteId) ?? [])]);
  }

  listAuditTrail(siteId: string): AuditEntry[] {
    return [...(this.auditBySite.get(siteId) ?? [])];
  }
}

/**
 * MissionService owns the mission lifecycle. Every fallible operation returns a
 * Result<T> rather than throwing. Every successful transition appends a
 * deterministic AuditEntry and a MissionTransition to mission.history. Re-issuing
 * a transition with the same transitionId is an idempotent no-op.
 *
 * Determinism: all timestamps are passed in by callers; this class never reads
 * the clock.
 */
export class MissionService {
  private store = new MissionStore();

  /** Create a fresh mission in `draft`. Fails on duplicate id, empty targets, or unsupported task type. */
  create(params: CreateMissionParams): Result<Mission> {
    if (this.store.has(params.id)) {
      return err(`Mission "${params.id}" already exists.`);
    }
    if (!SUPPORTED_TASK_TYPES.has(params.taskType)) {
      return err(`Unsupported task type "${params.taskType}".`);
    }
    if (params.targetZoneIds.length === 0) {
      return err("A mission must target at least one zone.");
    }
    if (params.assignedMachineIds.length === 0) {
      return err("A mission must have at least one assigned machine.");
    }

    const mission: Mission = {
      id: params.id,
      siteId: params.siteId,
      taskType: params.taskType,
      targetZoneIds: [...params.targetZoneIds],
      assignedMachineIds: [...params.assignedMachineIds],
      state: "draft",
      createdAt: params.createdAt,
      history: []
    };

    this.store.save(mission);
    this.store.appendAuditEntry(mission.siteId, {
      id: `audit-mission_created-${mission.id}-${mission.createdAt}`,
      timestamp: mission.createdAt,
      actor: this.auditActor(params.actor),
      action: "mission_created",
      subjectRef: mission.id,
      detail: `Mission ${mission.id} created for site ${mission.siteId} (${mission.taskType}).`,
      after: { state: mission.state }
    });

    return ok(mission);
  }

  /**
   * Validate a draft mission against site geometry and the machine roster, then
   * transition draft → validated. Checks: every target zone exists in geometry,
   * every assigned machine exists and is not offline/recalled, task type supported.
   */
  validate(missionId: string, ctx: MissionValidationContext): Result<Mission> {
    const mission = this.store.get(missionId);
    if (!mission) return err(`Mission "${missionId}" not found.`);

    if (!SUPPORTED_TASK_TYPES.has(mission.taskType)) {
      return err(`Unsupported task type "${mission.taskType}".`);
    }

    const knownZoneIds = new Set(ctx.zones.map((zone) => zone.id));
    const missingZones = mission.targetZoneIds.filter((zoneId) => !knownZoneIds.has(zoneId));
    if (missingZones.length > 0) {
      return err(`Target zone(s) not in site geometry: ${missingZones.join(", ")}.`);
    }

    const machinesById = new Map(ctx.machines.map((machine) => [machine.id, machine]));
    const missingMachines = mission.assignedMachineIds.filter((id) => !machinesById.has(id));
    if (missingMachines.length > 0) {
      return err(`Assigned machine(s) not found: ${missingMachines.join(", ")}.`);
    }

    const offlineMachines = mission.assignedMachineIds.filter((id) =>
      UNAVAILABLE_MACHINE_STATUSES.has(machinesById.get(id)!.status)
    );
    if (offlineMachines.length > 0) {
      return err(`Assigned machine(s) offline or recalled: ${offlineMachines.join(", ")}.`);
    }

    return this.transition(
      missionId,
      "validated",
      ctx.actor ?? "FleetBrainKernel",
      `Validated against site ${ctx.site.id}: ${mission.targetZoneIds.length} zone(s), ${mission.assignedMachineIds.length} machine(s).`,
      ctx.at,
      ctx.transitionId
    );
  }

  /** Authorize a validated mission for dispatch. validated → authorized. */
  authorize(missionId: string, actor: MissionActor, at: string, transitionId?: string): Result<Mission> {
    return this.transition(
      missionId,
      "authorized",
      actor,
      `Authorized by ${actor}.`,
      at,
      transitionId
    );
  }

  /**
   * Move a mission to `toState`, enforcing only legal transitions. Illegal
   * transitions return an error Result (never throw). Idempotent: re-issuing a
   * transition whose transitionId is already in history is a no-op that returns
   * the current mission.
   */
  transition(
    missionId: string,
    toState: MissionState,
    actor: MissionActor,
    detail: string,
    at: string,
    transitionId?: string
  ): Result<Mission> {
    const mission = this.store.get(missionId);
    if (!mission) return err(`Mission "${missionId}" not found.`);

    const id = transitionId ?? this.defaultTransitionId(mission.state, toState, missionId, at);

    const alreadyApplied = mission.history.find((step) => step.transitionId === id);
    if (alreadyApplied) {
      // Idempotent replay: same transition id already recorded — no-op.
      return ok(mission);
    }

    const from = mission.state;
    if (!canTransition(from, toState)) {
      const legal = legalNextStates(from);
      const legalText = legal.length > 0 ? legal.join(", ") : "(none — terminal state)";
      return err(`Illegal transition ${from} → ${toState}. Legal next state(s) from ${from}: ${legalText}.`);
    }

    const auditId = `audit-mission_${from}_to_${toState}-${missionId}-${at}`;
    const step: MissionTransition = {
      transitionId: id,
      from,
      to: toState,
      actor,
      at,
      detail,
      auditId
    };

    const updated: Mission = {
      ...mission,
      state: toState,
      history: [...mission.history, step]
    };
    this.store.save(updated);

    this.store.appendAuditEntry(mission.siteId, {
      id: auditId,
      timestamp: at,
      actor: this.auditActor(actor),
      action: `mission_${from}_to_${toState}`,
      subjectRef: missionId,
      detail,
      before: { state: from },
      after: { state: toState }
    });

    return ok(updated);
  }

  /** Fetch a mission by id. */
  get(missionId: string): Mission | undefined {
    return this.store.get(missionId);
  }

  /** List all missions, optionally filtered by site. */
  list(siteId?: string): Mission[] {
    const all = this.store.list();
    return siteId ? all.filter((mission) => mission.siteId === siteId) : all;
  }

  /** Read the audit trail for a site (newest first), mirroring FleetBrainStore. */
  listAuditTrail(siteId: string): AuditEntry[] {
    return this.store.listAuditTrail(siteId);
  }

  private defaultTransitionId(from: MissionState, to: MissionState, missionId: string, at: string): string {
    return `mission_${from}_to_${to}-${missionId}-${at}`;
  }

  private auditActor(actor: MissionActor | undefined): AuditEntry["actor"] {
    return actor ?? "FleetBrainKernel";
  }
}

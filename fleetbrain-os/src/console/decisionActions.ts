import { baselineMachines, coverageZones, site } from "../data/site";
import { siteGeometry } from "../data/geometry";
import { dockForKind } from "../data/docks";
import { CommandArbiter } from "../arbiter/CommandArbiter";
import { GuardedSimulatorAdapter } from "../arbiter/GuardedSimulatorAdapter";
import type {
  CommandIntent,
  CommandType,
  GateContext,
  UnitRuntimeState
} from "../arbiter/types";
import type { Machine } from "../domain/types";
import { MissionService } from "../mission/MissionService";
import type { Mission } from "../mission/types";
import { OperatorAuditChain } from "./auditChain";
import type { OperatorAuditRecord } from "./auditChain";
import type { DecisionItem } from "./queue";
import { toArbiterRole, type OperatorRole } from "./roles";
import { COMMAND_UNIT_ID, destinationForDecision, type DispatchDestination } from "./dispatchDestination";

/**
 * Decision action router — turns an operator's choice on a DecisionCard into:
 *  - a real CommandArbiter decision (for Dispatch),
 *  - a Mission create/advance (when dispatch is allowed),
 *  - and ALWAYS a signed, hash-chained operator audit entry.
 *
 * Deterministic per CLAUDE.md invariant 3: every timestamp is passed in by the
 * caller (`nowIso`). Nothing here reads the wall clock or randomness. The arbiter
 * is the single safe path to motion (invariant 1).
 */

export type DecisionActionKind =
  | "confirm"
  | "dismiss"
  | "dispatch"
  | "escalate"
  | "recall"
  | "estop";

export interface DispatchResult {
  allowed: boolean;
  deniedByGate?: string;
  /** Human-readable reasons straight from the arbiter. */
  reasons: string[];
  /** The arbiter's signed audit hash for this decision. */
  arbiterHash: string;
  /** The unit and configured waypoint the command targeted. */
  targetMachineId: string;
  targetZoneId?: string;
  waypointLabel?: string;
  /** The mission id created/advanced when allowed, if any. */
  missionId?: string;
  missionState?: Mission["state"];
}

export interface DecisionActionResult {
  /** The decision id that was acted on. */
  decisionId: string;
  action: DecisionActionKind;
  /** The operator audit record(s) appended by this action (oldest first). */
  audit: OperatorAuditRecord[];
  /** Present for any motion / safety command (dispatch / recall / estop). */
  dispatch?: DispatchResult;
}

/** Live context for a motion command: who is seated, and the weather hold. */
export interface ActOptions {
  role?: OperatorRole;
  weather?: { hold: boolean; reason?: string };
  /** Override the unit a recall/estop targets (defaults to the command unit). */
  targetMachineId?: string;
}

/** Operator identity used for every console action (single-operator demo). */
const OPERATOR = "op-console-1";

/**
 * Stateful session that owns the arbiter, mission service, guarded adapter, and the
 * operator audit chain for one console session. Construct once; call act() per
 * operator action. Pure with respect to time: caller passes nowIso each call.
 */
export class DecisionActionRouter {
  private readonly arbiter = new CommandArbiter();
  private readonly missions = new MissionService();
  private readonly guarded: GuardedSimulatorAdapter;
  private readonly audit: OperatorAuditChain;
  /** Machine roster per situation; defaults to the baseline roster. */
  private readonly machines: Machine[];

  constructor(params: { machines?: Machine[]; seedAudit?: readonly OperatorAuditRecord[] } = {}) {
    this.machines = params.machines ?? baselineMachines;
    this.guarded = new GuardedSimulatorAdapter({
      siteId: site.id,
      machines: this.machines
    });
    this.audit = new OperatorAuditChain(params.seedAudit ?? []);
  }

  /** Read-only view of the operator audit chain. */
  auditChain(): readonly OperatorAuditRecord[] {
    return this.audit.list();
  }

  auditVerified(): boolean {
    return this.audit.verify();
  }

  /**
   * Route one operator action against one decision at time `nowIso`. Pass the
   * situation's actual machine roster (`machines`) so a dispatch reflects that
   * situation's real unit health — e.g. a recalled UGV produces an honest denial.
   *
   * `opts.role` is the seated console operator's role and `opts.weather` the live
   * weather hold; both flow into the arbiter context for motion commands so the
   * arbiter independently re-checks role and weather (defence in depth).
   */
  act(
    action: DecisionActionKind,
    decision: DecisionItem,
    nowIso: string,
    machines?: Machine[],
    opts: ActOptions = {}
  ): DecisionActionResult {
    const roster = machines ?? this.machines;
    if (action === "dispatch") {
      return this.dispatch(decision, nowIso, roster, opts);
    }
    if (action === "recall") {
      return this.motionOverride("recall", decision, nowIso, roster, opts);
    }
    if (action === "estop") {
      return this.motionOverride("estop", decision, nowIso, roster, opts);
    }
    return this.resolve(action, decision, nowIso);
  }

  // --- non-motion resolutions (confirm / dismiss / escalate) ---------------

  private resolve(
    action: "confirm" | "dismiss" | "escalate",
    decision: DecisionItem,
    nowIso: string
  ): DecisionActionResult {
    const map = {
      confirm: {
        op: "confirm" as const,
        detail: `Confirmed decision ${decision.id} (${decision.whatHappened}) at ${decision.zoneName}.`
      },
      dismiss: {
        op: "dismiss_false_positive" as const,
        detail: `Dismissed decision ${decision.id} as a false positive at ${decision.zoneName}.`
      },
      escalate: {
        op: "escalate_customer" as const,
        detail: `Escalated decision ${decision.id} to customer (${decision.situationLabel}).`
      }
    };
    const entry = this.audit.append({
      id: `op-${action}-${decision.id}-${nowIso}`,
      timestamp: nowIso,
      actor: OPERATOR,
      action: map[action].op,
      subjectRef: decision.id,
      detail: map[action].detail
    });
    return { decisionId: decision.id, action, audit: [entry] };
  }

  // --- dispatch (the real arbiter path) ------------------------------------

  /**
   * Build the arbiter GateContext from a machine roster and the live console
   * options (seated role + weather hold). The console role maps into the arbiter's
   * CommandIssuer role downstream; weather is surfaced here so the weather gate sees it.
   */
  private buildContext(machines: Machine[], opts: ActOptions): GateContext {
    const units: UnitRuntimeState[] = machines.map((machine) => ({
      machineId: machine.id,
      link: "up",
      maintenanceLockout: false,
      batteryFloorPct: 20
    }));
    return {
      siteId: site.id,
      machines,
      units,
      geometry: siteGeometry,
      adapter: {
        adapterId: this.guarded.adapterId,
        commandHardware: this.guarded.capabilities.commandHardware,
        supportedControlLevels: this.guarded.capabilities.supportedControlLevels
      },
      siteLinkToCloud: "up",
      weather: opts.weather,
      estop: { siteEngaged: false, engagedUnits: {} }
    };
  }

  private dispatch(
    decision: DecisionItem,
    nowIso: string,
    machines: Machine[],
    opts: ActOptions = {}
  ): DecisionActionResult {
    const ctx = this.buildContext(machines, opts);
    const arbiterRole = toArbiterRole(opts.role ?? "operator");

    const dest = destinationForDecision(decision);
    const intent: CommandIntent = {
      id: `intent-verify-${decision.id}-${nowIso}`,
      type: "dispatch_machine",
      targetMachineId: COMMAND_UNIT_ID,
      issuedBy: {
        operatorId: OPERATOR,
        role: arbiterRole,
        authority: "site_local_operator",
        scopedSiteId: site.id
      },
      params: {
        destination: dest.point,
        targetZoneId: dest.targetZoneId,
        reason: `Dispatch unit to verify: ${decision.whatHappened} at ${decision.zoneName}`
      },
      issuedAt: nowIso,
      freshnessDeadlineMs: 60_000
    };

    const decisionResult = this.arbiter.evaluate(intent, ctx, nowIso);

    const dispatch: DispatchResult = {
      allowed: decisionResult.allowed,
      deniedByGate: decisionResult.deniedByGate,
      reasons: decisionResult.reasons,
      arbiterHash: decisionResult.hash,
      targetMachineId: COMMAND_UNIT_ID,
      targetZoneId: dest.targetZoneId,
      waypointLabel: dest.waypointLabel
    };

    const auditEntries: OperatorAuditRecord[] = [];

    // 1. Audit the arbiter decision itself (allow OR deny).
    auditEntries.push(
      this.audit.append({
        id: `op-arbiter-${decision.id}-${nowIso}`,
        timestamp: nowIso,
        actor: OPERATOR,
        action: "arbiter_decision",
        subjectRef: decision.id,
        detail: decisionResult.allowed
          ? `Arbiter ALLOWED dispatch of ${COMMAND_UNIT_ID} to verify (${dispatch.reasons.join("; ")}).`
          : `Arbiter DENIED dispatch of ${COMMAND_UNIT_ID}: ${dispatch.reasons.join("; ")}.`,
        allowed: decisionResult.allowed,
        deniedByGate: decisionResult.deniedByGate
      })
    );

    // 2. On allow: record the guarded motion + create and advance a mission.
    if (decisionResult.allowed) {
      this.guarded.dispatch(COMMAND_UNIT_ID, dest.point, nowIso);
      const mission = this.createVerifyMission(decision, dest, nowIso, machines);
      dispatch.missionId = mission?.id;
      dispatch.missionState = mission?.state;
    }

    // 3. Always audit the operator's dispatch action.
    auditEntries.push(
      this.audit.append({
        id: `op-dispatch-${decision.id}-${nowIso}`,
        timestamp: nowIso,
        actor: OPERATOR,
        action: "dispatch_unit",
        subjectRef: decision.id,
        detail: decisionResult.allowed
          ? `Dispatched ${COMMAND_UNIT_ID} to verify ${decision.whatHappened}${dispatch.missionId ? ` (mission ${dispatch.missionId} ${dispatch.missionState}).` : "."}`
          : `Dispatch blocked by ${decisionResult.deniedByGate} gate; no unit moved.`,
        allowed: decisionResult.allowed,
        deniedByGate: decisionResult.deniedByGate
      })
    );

    return { decisionId: decision.id, action: "dispatch", audit: auditEntries, dispatch };
  }

  // --- recall / estop (safety overrides through the arbiter) ----------------

  /**
   * Recall sends the targeted unit to ITS OWN dock (by kind — dual docks); e-stop
   * engages a unit-scoped stop. Both are SAFETY OVERRIDES: the arbiter permits them
   * even when a dispatch would be denied (recalled / low battery / weather hold).
   */
  private motionOverride(
    kind: "recall" | "estop",
    decision: DecisionItem,
    nowIso: string,
    machines: Machine[],
    opts: ActOptions
  ): DecisionActionResult {
    const targetId = opts.targetMachineId ?? COMMAND_UNIT_ID;
    const ctx = this.buildContext(machines, opts);
    const arbiterRole = toArbiterRole(opts.role ?? "operator");
    const machine = machines.find((m) => m.id === targetId);
    const dock = machine ? dockForKind(machine.kind) : undefined;

    const commandType: CommandType = kind === "recall" ? "recall_machine" : "estop";
    const intent: CommandIntent = {
      id: `intent-${kind}-${decision.id}-${nowIso}`,
      type: commandType,
      targetMachineId: targetId,
      issuedBy: {
        operatorId: OPERATOR,
        role: arbiterRole,
        authority: "site_local_operator",
        scopedSiteId: site.id
      },
      params: {
        reason:
          kind === "recall"
            ? `Recall ${machine?.label ?? targetId} → ${dock?.name ?? "home dock"}`
            : `Engage e-stop on ${machine?.label ?? targetId}`
      },
      issuedAt: nowIso,
      freshnessDeadlineMs: 60_000
    };

    const decisionResult = this.arbiter.evaluate(intent, ctx, nowIso);
    const dispatch: DispatchResult = {
      allowed: decisionResult.allowed,
      deniedByGate: decisionResult.deniedByGate,
      reasons: decisionResult.reasons,
      arbiterHash: decisionResult.hash,
      targetMachineId: targetId
    };

    const auditEntries: OperatorAuditRecord[] = [];
    auditEntries.push(
      this.audit.append({
        id: `op-arbiter-${kind}-${decision.id}-${nowIso}`,
        timestamp: nowIso,
        actor: OPERATOR,
        action: "arbiter_decision",
        subjectRef: decision.id,
        detail: decisionResult.allowed
          ? `Arbiter ALLOWED ${kind} of ${targetId} (${dispatch.reasons.join("; ")}).`
          : `Arbiter DENIED ${kind} of ${targetId}: ${dispatch.reasons.join("; ")}.`,
        allowed: decisionResult.allowed,
        deniedByGate: decisionResult.deniedByGate
      })
    );

    if (decisionResult.allowed) {
      if (kind === "recall") {
        // Dual-dock: recall to the unit's OWN dock, never the wrong one.
        this.guarded.recall(targetId, nowIso);
      } else {
        this.guarded.safeState(targetId, nowIso);
        this.arbiter.estopEngage({
          scope: "unit",
          targetId,
          authority: "site_local_operator",
          intentId: `estop-engage-${decision.id}-${nowIso}`,
          nowIso
        });
      }
    }

    auditEntries.push(
      this.audit.append({
        id: `op-${kind}-${decision.id}-${nowIso}`,
        timestamp: nowIso,
        actor: OPERATOR,
        action: kind === "recall" ? "recall_unit" : "estop_engaged",
        subjectRef: decision.id,
        detail: decisionResult.allowed
          ? kind === "recall"
            ? `Recalled ${machine?.label ?? targetId} → ${dock?.name ?? "home dock"} (${dock?.id ?? "—"}).`
            : `E-stop engaged on ${machine?.label ?? targetId}; motors held.`
          : `${kind} blocked by ${decisionResult.deniedByGate} gate; no command delivered.`,
        allowed: decisionResult.allowed,
        deniedByGate: decisionResult.deniedByGate
      })
    );

    return { decisionId: decision.id, action: kind, audit: auditEntries, dispatch };
  }

  /** Append a signed incident-closeout entry and return it. */
  closeout(decision: DecisionItem, nowIso: string, detail: string): OperatorAuditRecord {
    return this.audit.append({
      id: `op-closeout-${decision.id}-${nowIso}`,
      timestamp: nowIso,
      actor: OPERATOR,
      action: "incident_closeout",
      subjectRef: decision.id,
      detail
    });
  }

  /** Create a verify mission and advance it through its legal lifecycle. */
  private createVerifyMission(
    decision: DecisionItem,
    destination: DispatchDestination,
    nowIso: string,
    machines: Machine[]
  ): Mission | undefined {
    const missionId = `MSN-verify-${decision.id}-${nowIso}`;
    const baseMs = Date.parse(nowIso);
    const at = (offsetSeconds: number) => new Date(baseMs + offsetSeconds * 1000).toISOString();
    const created = this.missions.create({
      id: missionId,
      siteId: site.id,
      taskType: "intrusion_verify",
      targetZoneIds: [destination.targetZoneId],
      assignedMachineIds: [COMMAND_UNIT_ID],
      createdAt: nowIso,
      actor: "operator"
    });
    if (!created.ok) return undefined;

    this.missions.validate(missionId, {
      site,
      zones: coverageZones,
      machines,
      at: at(1),
      actor: "FleetBrainKernel"
    });
    this.missions.authorize(missionId, "operator", at(2));
    this.missions.transition(missionId, "dispatched", "FleetBrainKernel", "Dispatched to edge.", at(3));
    this.missions.transition(missionId, "accepted", "system", "Edge accepted.", at(4));
    this.missions.transition(missionId, "executing", "system", "Verify run started.", at(5));

    return this.missions.get(missionId);
  }
}

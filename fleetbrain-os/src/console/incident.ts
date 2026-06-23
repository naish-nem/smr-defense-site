import { coverageZones, site } from "../data/site";
import { siteGeometry } from "../data/geometry";
import { ORDERED_GATES } from "../arbiter/gates";
import type {
  CommandIntent,
  CommandType,
  GateContext,
  UnitRuntimeState
} from "../arbiter/types";
import type { ExceptionSeverity, Machine } from "../domain/types";
import { dockForKind } from "../data/docks";
import { toArbiterRole, type OperatorRole } from "./roles";
import type { DecisionItem } from "./queue";
import type { DecisionActionKind } from "./decisionActions";
import type { SourceKind } from "./SourceTag";
import { COMMAND_UNIT_ID, destinationForDecision } from "./dispatchDestination";

/**
 * incident.ts — PURE logic for the golden incident workflow.
 *
 * Every value the workflow surfaces is derived here by a deterministic rule from
 * the DecisionItem's own real fields (zone, event status, model score) — or, where
 * a number is dramatized for the demo, it is derived from the event's own seed and
 * tagged "simulated" so it can never read as measured truth. NO literals like
 * "2.1×" or "+12.4°C" live here. No Date.now()/Math.random() (CLAUDE.md invariant 3).
 */

/** How the detection arrived — drives the Detect-step honesty tag. */
export type DetectKind = "telemetry" | "model";

/** A single value-with-provenance shown in the stepper. */
export interface TaggedValue {
  label: string;
  value: string;
  source: SourceKind;
  /** Optional secondary note (e.g. why a value is simulated). */
  note?: string;
}

export interface IncidentDetect {
  kind: DetectKind;
  /** Plain-language statement of what happened. */
  what: string;
  /** Raw status token from the event. */
  rawStatus: string;
  /** The detection signal: telemetry status or a model score (never "measured"). */
  signal: TaggedValue;
}

export interface IncidentEvidence {
  /** A real inspection frame, or undefined → honest "no visual frame" state. */
  imageUri?: string;
  /** Source machine that produced the artifact. */
  sourceMachine: string;
  /** ISO timestamp of the artifact. */
  timestamp: string;
  /** Pose label (configured/derived) for the artifact. */
  pose: TaggedValue;
  /**
   * Optional SIMULATED thermal delta, derived deterministically from the event's
   * own confidence — present ONLY for thermal/heat detections, always tagged
   * "simulated". Undefined otherwise (we never fabricate a delta).
   */
  thermalDelta?: TaggedValue;
}

export interface IncidentAssess {
  severity: ExceptionSeverity;
  /** Why this severity — the rule's inputs, in plain language. */
  rationale: string;
}

export interface IncidentRecommend {
  action: DecisionActionKind;
  rationale: string;
}

/** The pure, derived spine of an incident. UI/arbiter steps are layered on top. */
export interface IncidentModel {
  decisionId: string;
  detect: IncidentDetect;
  evidence: IncidentEvidence;
  assess: IncidentAssess;
  recommend: IncidentRecommend;
}

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

const MODEL_STATUS_FRAGMENTS = [
  "thermal",
  "heat",
  "person",
  "motion",
  "soiling",
  "seal",
  "crack",
  "damage"
];

/**
 * Telemetry vs model: a threshold/telemetry event (SCADA delta, dock status) is
 * "telemetry"; a CV / thermal detection (person, heat signature, soiling) is a
 * "model" score. We read the raw status to decide, never a literal.
 */
export function detectKind(rawStatus: string): DetectKind {
  const s = rawStatus.toLowerCase();
  return MODEL_STATUS_FRAGMENTS.some((f) => s.includes(f)) ? "model" : "telemetry";
}

export function buildDetect(decision: DecisionItem): IncidentDetect {
  const raw = decision.evidence.confidence;
  const kind = detectKind(decision.whatHappened);

  const signal: TaggedValue =
    kind === "model"
      ? {
          label: "Detection confidence",
          value: typeof raw === "number" ? `${Math.round(raw * 100)}%` : "n/a",
          source: "model",
          note: "Model score, not a physical measurement."
        }
      : {
          label: "Telemetry signal",
          value: decision.whatHappened,
          source: "telemetry",
          note: "Threshold / status field from the device."
        };

  return {
    kind,
    what: decision.whatHappened,
    rawStatus: decision.whatHappened,
    signal
  };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * Deterministic simulated thermal delta for thermal/heat detections, derived from
 * the event's own model confidence. NOT measured — tagged "simulated" so it can
 * never be mistaken for a real ΔT. Returns undefined for non-thermal detections.
 */
export function simulatedThermalDelta(decision: DecisionItem): TaggedValue | undefined {
  const isThermal = /thermal|heat/i.test(decision.whatHappened);
  if (!isThermal) return undefined;
  const conf = decision.evidence.confidence;
  if (typeof conf !== "number") return undefined;
  // Map confidence (0..1) to a plausible-looking delta band, deterministically.
  // This is a DEMO illustration only — labelled simulated.
  const delta = (conf * 10).toFixed(1);
  return {
    label: "Thermal delta (illustrative)",
    value: `simulated +${delta}°C vs baseline`,
    source: "simulated",
    note: "Derived deterministically from the model score for the demo — not a measured ΔT."
  };
}

export function buildEvidence(decision: DecisionItem): IncidentEvidence {
  return {
    imageUri: decision.evidence.imageUri,
    sourceMachine: decision.sourceMachine,
    timestamp: decision.timestamp,
    pose: {
      label: "Capture pose",
      value: `${decision.zoneName} (site-local-ENU)`,
      source: "artifact",
      note: "Frame metadata from the stored artifact."
    },
    thermalDelta: simulatedThermalDelta(decision)
  };
}

// ---------------------------------------------------------------------------
// Assess — severity = zone criticality × event type × model score (pure rule)
// ---------------------------------------------------------------------------

/** Higher = more critical infrastructure. Configured per zone. */
const ZONE_CRITICALITY: Record<string, number> = {
  "Z-BESS": 3,
  "Z-SWITCHGEAR": 3,
  "Z-PERIMETER": 2,
  "Z-LOAD-DOCK": 2,
  "Z-SOLAR": 1
};

function zoneCriticality(decision: DecisionItem): number {
  if (decision.zoneId && ZONE_CRITICALITY[decision.zoneId] !== undefined) {
    return ZONE_CRITICALITY[decision.zoneId];
  }
  // Fall back via the zone name (exceptions carry a location string, not an id).
  const byName = coverageZones.find((z) => z.name === decision.zoneName);
  if (byName && ZONE_CRITICALITY[byName.id] !== undefined) return ZONE_CRITICALITY[byName.id];
  // Security wording → treat as elevated criticality.
  if (/perimeter|gate|intrusion/i.test(decision.zoneName + decision.whatHappened)) return 2;
  return 1;
}

/** Event-type weight from the plain-language status. */
function eventWeight(decision: DecisionItem): number {
  const s = decision.whatHappened.toLowerCase();
  if (/unauthorized|person|intrusion/.test(s)) return 3;
  if (/thermal|heat|seal|damage|delta/.test(s)) return 2;
  if (/missing coverage|blocked/.test(s)) return 2;
  return 1;
}

/**
 * Assess severity by a pure rule: criticality × eventWeight × scoreFactor.
 * scoreFactor lifts a high-confidence model detection by one band. Deterministic.
 */
export function assessSeverity(decision: DecisionItem): IncidentAssess {
  const crit = zoneCriticality(decision);
  const weight = eventWeight(decision);
  const conf = decision.evidence.confidence ?? 0;
  const scoreFactor = conf > 0.9 ? 1 : 0;
  const score = crit * weight + scoreFactor;

  let severity: ExceptionSeverity;
  if (score >= 7) severity = "critical";
  else if (score >= 4) severity = "high";
  else if (score >= 2) severity = "medium";
  else severity = "low";

  return {
    severity,
    rationale: `zone criticality ${crit} × event weight ${weight}${
      scoreFactor ? ` +1 (model score >90%)` : ""
    } = ${score} → ${severity}`
  };
}

// ---------------------------------------------------------------------------
// Recommend — deterministic policy from severity + detection kind
// ---------------------------------------------------------------------------

export function recommendAction(decision: DecisionItem, assess: IncidentAssess): IncidentRecommend {
  const detect = detectKind(decision.whatHappened);
  // Security-class events at high severity → dispatch a ground unit to verify.
  if (/unauthorized|person|intrusion/i.test(decision.whatHappened)) {
    if (assess.severity === "critical" || assess.severity === "high") {
      return {
        action: "dispatch",
        rationale: "Security-class detection at elevated severity → dispatch ground unit to verify before escalating."
      };
    }
  }
  if (assess.severity === "critical") {
    return {
      action: "dispatch",
      rationale: "Critical severity → dispatch a unit to gather confirming evidence."
    };
  }
  if (assess.severity === "high" && detect === "model") {
    return {
      action: "dispatch",
      rationale: "High-severity model detection → dispatch to confirm before customer escalation."
    };
  }
  if (assess.severity === "high") {
    return {
      action: "escalate",
      rationale: "High-severity telemetry exception → escalate to customer for asset decision."
    };
  }
  if (assess.severity === "low" && detect === "model") {
    return {
      action: "dismiss",
      rationale: "Low-severity model detection → likely false positive; dismiss after review."
    };
  }
  return {
    action: "confirm",
    rationale: "Medium severity → confirm the finding and log it to the shift record."
  };
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

export function buildIncidentModel(decision: DecisionItem): IncidentModel {
  const detect = buildDetect(decision);
  const evidence = buildEvidence(decision);
  const assess = assessSeverity(decision);
  const recommend = recommendAction(decision, assess);
  return { decisionId: decision.id, detect, evidence, assess, recommend };
}

// ---------------------------------------------------------------------------
// Eligibility preview — run EVERY gate (not stop-at-first) for the stepper.
// ---------------------------------------------------------------------------

/** The command unit the workflow can move (the Unitree-class quadruped). */
export const INCIDENT_COMMAND_UNIT_ID = COMMAND_UNIT_ID;

export interface GatePreview {
  gateId: string;
  pass: boolean;
  reason: string;
}

export interface EligibilityPreview {
  /** True only if every gate passes. */
  allowed: boolean;
  /** Per-gate verdicts, in arbiter order — EVERY gate, not stop-at-first. */
  gates: GatePreview[];
  /** First failing gate id, if any. */
  deniedByGate?: string;
  /** Whether the recommended action is a motion action that runs the arbiter. */
  motion: boolean;
}

const MOTION_ACTIONS: ReadonlySet<DecisionActionKind> = new Set(["dispatch", "recall", "estop"]);

function actionToCommandType(action: DecisionActionKind): CommandType | undefined {
  switch (action) {
    case "dispatch":
      return "dispatch_machine";
    case "recall":
      return "recall_machine";
    case "estop":
      return "estop";
    default:
      return undefined;
  }
}

/**
 * Build the eligibility preview for an action against live machine/site/role/weather
 * state by running EVERY ordered gate (so the stepper can show the full checklist).
 * Pure: nowIso is passed in. Non-motion actions return motion=false (no arbiter).
 */
export function previewEligibility(params: {
  action: DecisionActionKind;
  decision: DecisionItem;
  machines: Machine[];
  role: OperatorRole;
  weather?: { hold: boolean; reason?: string };
  nowIso: string;
}): EligibilityPreview {
  const { action, decision, machines, role, weather, nowIso } = params;
  const commandType = actionToCommandType(action);
  if (!commandType || !MOTION_ACTIONS.has(action)) {
    return { allowed: true, gates: [], motion: false };
  }

  const units: UnitRuntimeState[] = machines.map((machine) => ({
    machineId: machine.id,
    link: "up",
    maintenanceLockout: false,
    batteryFloorPct: 20
  }));

  const ctx: GateContext = {
    siteId: site.id,
    machines,
    units,
    geometry: siteGeometry,
    adapter: {
      adapterId: "adapter-guarded-sim",
      commandHardware: true,
      supportedControlLevels: ["observe", "guarded"]
    },
    siteLinkToCloud: "up",
    weather,
    estop: { siteEngaged: false, engagedUnits: {} }
  };

  const destination = destinationForDecision(decision);
  const intent: CommandIntent = {
    id: `preview-${action}-${decision.id}-${nowIso}`,
    type: commandType,
    targetMachineId: INCIDENT_COMMAND_UNIT_ID,
    issuedBy: {
      operatorId: "op-console-1",
      role: toArbiterRole(role),
      authority: "site_local_operator",
      scopedSiteId: site.id
    },
    params:
      commandType === "dispatch_machine"
        ? { destination: destination.point, targetZoneId: destination.targetZoneId }
        : {},
    issuedAt: nowIso,
    freshnessDeadlineMs: 60_000
  };

  const gates: GatePreview[] = [];
  let allowed = true;
  let deniedByGate: string | undefined;
  for (const gate of ORDERED_GATES) {
    const result = gate.evaluate(intent, ctx, nowIso);
    gates.push({ gateId: gate.id, pass: result.pass, reason: result.reason });
    if (!result.pass) {
      allowed = false;
      if (!deniedByGate) deniedByGate = gate.id;
    }
  }

  return { allowed, gates, deniedByGate, motion: true };
}

/**
 * Resolve the dock a recall would target for the command unit, by kind (dual docks).
 * Returns a human label like "Quad Kennel" for UGV, "DJI Dock 3" for UAV.
 */
export function recallDockLabel(machines: Machine[], machineId = INCIDENT_COMMAND_UNIT_ID): string {
  const machine = machines.find((m) => m.id === machineId);
  const dock = machine ? dockForKind(machine.kind) : undefined;
  return dock ? `${dock.name} (${dock.id})` : "home dock";
}

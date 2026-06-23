import type { MachineEvent } from "../domain/types";

/**
 * Phase 0 — July 21 Xerox demo.
 *
 * The honest design constraint: the NOC must *look* live without lying about
 * autonomy. We run ONE near-real telemetry signal (simulated as if live) and
 * replay everything else from a recorded scenario. Every visible item carries a
 * source label, and every frame carries a disclosure banner. There is a
 * fully-recorded fallback so the demo survives a dropped live signal.
 */

/**
 * Top-level run mode.
 * - `live_plus_recorded`: one LIVE telemetry source + recorded events around it.
 * - `recorded_fallback`: the LIVE source is unavailable; its equivalent is
 *   served from the recording so the story still completes seamlessly.
 */
export type DemoMode = "live_plus_recorded" | "recorded_fallback";

/**
 * Provenance of a single step's data, surfaced verbatim in the operator UI.
 * This is the honesty primitive: the operator always knows whether what they
 * see came off a live wire or off the recording.
 */
export type DemoSourceLabel = "LIVE" | "RECORDED";

/**
 * What a step does on the NOC surface.
 * - `telemetry`: a battery/pose/sensor sample (the one LIVE-eligible kind).
 * - `alert`: a recorded perimeter/thermal finding raised to the operator.
 * - `dispatch_scripted`: a movement/dispatch action that is operator-driven
 *   teleop — never autonomous. Always labeled "TELEOP — operator-driven".
 * - `narration`: a presenter beat with no machine data (always RECORDED).
 */
export type DemoStepKind = "telemetry" | "alert" | "dispatch_scripted" | "narration";

/** Live battery + pose sample from the one quadruped tagged LIVE. */
export interface TelemetryPayload {
  machineId: string;
  batteryPct: number;
  pose: { x: number; y: number; yaw: number };
  note: string;
}

/** A recorded perimeter/thermal finding surfaced to the operator. */
export interface AlertPayload {
  /** References a recorded MachineEvent id from the scenario. */
  eventId: string;
  zoneId: string;
  locationLabel: string;
  finding: string;
  severity: "low" | "medium" | "high";
}

/**
 * A scripted, operator-driven dispatch. This is NOT autonomy: the demo asserts
 * teleop explicitly via `teleopLabel`, which the UI must render unmodified.
 */
export interface DispatchScriptedPayload {
  machineId: string;
  targetZoneId: string;
  intent: string;
  /** Honesty invariant: movement is teleop, never autonomous. */
  teleopLabel: "TELEOP — operator-driven";
}

/** A presenter narration beat. */
export interface NarrationPayload {
  headline: string;
  detail: string;
}

export type DemoStepPayload =
  | TelemetryPayload
  | AlertPayload
  | DispatchScriptedPayload
  | NarrationPayload;

/** One timed beat of the NOC script. */
export interface DemoStep {
  /** Discrete tick at which this step becomes visible. Deterministic. */
  atTick: number;
  kind: DemoStepKind;
  payload: DemoStepPayload;
  /** Provenance shown to operators. Telemetry may be LIVE; everything else RECORDED. */
  sourceLabel: DemoSourceLabel;
  /** Stable id for ordering and UI keys. */
  id: string;
}

/** The full deterministic demo script. */
export interface DemoScript {
  scriptId: string;
  siteId: string;
  /** The single machine whose telemetry is presented as LIVE. */
  liveMachineId: string;
  /** Total ticks the run spans (inclusive lower bound 0). */
  totalTicks: number;
  steps: DemoStep[];
  /** Recorded events the script references (for alerts / fallback equivalents). */
  recordedEvents: MachineEvent[];
}

/** A rendered, ordered visible step (the step plus its effective source label). */
export interface DemoVisibleEvent {
  step: DemoStep;
  /** Effective label after mode resolution (fallback rewrites LIVE -> RECORDED). */
  effectiveSourceLabel: DemoSourceLabel;
}

/** One tick of output the operator UI consumes. */
export interface DemoRunFrame {
  tick: number;
  mode: DemoMode;
  /** Steps that fire on this tick, in script order, with resolved labels. */
  visibleEvents: DemoVisibleEvent[];
  /** Always-on disclosure banner. Never empty (honesty invariant). */
  banner: string;
}

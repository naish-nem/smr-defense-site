import type { MachineEvent } from "../domain/types";
import type {
  AlertPayload,
  DemoScript,
  DemoStep,
  DispatchScriptedPayload,
  NarrationPayload,
  TelemetryPayload
} from "./types";

/**
 * The July 21 Xerox NOC script.
 *
 * Story arc (perimeter patrol -> thermal anomaly -> operator review):
 *  1. NOC comes online; the one LIVE quadruped reports battery + pose.
 *  2. Scripted teleop dispatch sends the quadruped on a perimeter patrol leg.
 *  3. LIVE telemetry continues as it walks the south fence line.
 *  4. A RECORDED fixed-camera perimeter alert fires (after-hours motion).
 *  5. Operator teleops the quadruped to the south gate to corroborate.
 *  6. A RECORDED thermal anomaly at the BESS yard escalates the shift.
 *  7. LIVE telemetry shows the quadruped repositioning toward BESS row C.
 *  8. Operator reviews evidence; shift closes with an explicit audit beat.
 *
 * Determinism: no Date.now / Math.random. All ticks and values are literals.
 * Honesty: only `telemetry` steps from the live machine are tagged LIVE;
 * perimeter/thermal findings are RECORDED; dispatch steps are TELEOP.
 */

const SITE_ID = "SITE-FPR-01";
const LIVE_MACHINE_ID = "M-UGV-01"; // Ground Unit WOLF (Unitree quadruped)

const TELEOP_LABEL = "TELEOP — operator-driven" as const;

function telemetry(
  id: string,
  atTick: number,
  batteryPct: number,
  pose: TelemetryPayload["pose"],
  note: string
): DemoStep {
  const payload: TelemetryPayload = { machineId: LIVE_MACHINE_ID, batteryPct, pose, note };
  return { id, atTick, kind: "telemetry", payload, sourceLabel: "LIVE" };
}

function alert(id: string, atTick: number, payload: AlertPayload): DemoStep {
  return { id, atTick, kind: "alert", payload, sourceLabel: "RECORDED" };
}

function dispatch(
  id: string,
  atTick: number,
  machineId: string,
  targetZoneId: string,
  intent: string
): DemoStep {
  const payload: DispatchScriptedPayload = {
    machineId,
    targetZoneId,
    intent,
    teleopLabel: TELEOP_LABEL
  };
  // Dispatch is operator-driven teleop, surfaced as a RECORDED scripted action.
  return { id, atTick, kind: "dispatch_scripted", payload, sourceLabel: "RECORDED" };
}

function narration(id: string, atTick: number, headline: string, detail: string): DemoStep {
  const payload: NarrationPayload = { headline, detail };
  return { id, atTick, kind: "narration", payload, sourceLabel: "RECORDED" };
}

/**
 * Recorded events the script leans on. These mirror the perimeter/thermal
 * findings in the recorded scenarios and double as the fallback equivalents
 * when the LIVE telemetry source drops.
 */
const recordedEvents: MachineEvent[] = [
  {
    id: "demo-rec-perim-01",
    sourceMachineId: "M-FIXED-01",
    siteId: SITE_ID,
    timestamp: "2026-07-21T22:13:00-07:00",
    eventType: "fixed_camera_trigger",
    zoneId: "Z-PERIMETER",
    locationLabel: "south gate",
    payloadRef: "/uploads/smr-remote-operations.png",
    rawStatus: "unauthorized_motion",
    confidence: 0.82
  },
  {
    id: "demo-rec-thermal-01",
    sourceMachineId: "M-FIXED-01",
    siteId: SITE_ID,
    timestamp: "2026-07-21T22:21:00-07:00",
    eventType: "thermal_reading",
    zoneId: "Z-BESS",
    locationLabel: "bess container row C",
    payloadRef: "/uploads/smr-thermal-anomaly.png",
    rawStatus: "high_thermal_reading",
    confidence: 0.93
  },
  // Fallback equivalent for the LIVE quadruped telemetry, served from the
  // recording if the live signal drops. Tagged as a quadruped patrol pass.
  {
    id: "demo-rec-ugv-fallback-01",
    sourceMachineId: LIVE_MACHINE_ID,
    siteId: SITE_ID,
    timestamp: "2026-07-21T22:10:00-07:00",
    eventType: "patrol_pass",
    zoneId: "Z-PERIMETER",
    locationLabel: "south fence line",
    payloadRef: "/uploads/smr-quadruped-inspection.png",
    rawStatus: "recorded_telemetry_equivalent",
    confidence: 0.9
  }
];

const steps: DemoStep[] = [
  narration(
    "step-00",
    0,
    "FleetBrain NOC online — Fort Pierce Resilience Microgrid",
    "One live quadruped on the wire; all other lanes replay a recorded shift. Source labels are shown on every tile."
  ),
  telemetry("step-01", 1, 71, { x: 12.0, y: 4.0, yaw: 90 }, "Docked; battery nominal."),
  dispatch("step-02", 2, LIVE_MACHINE_ID, "Z-PERIMETER", "Begin south perimeter patrol leg"),
  telemetry("step-03", 3, 70, { x: 18.0, y: 9.0, yaw: 95 }, "Departing dock toward fence line."),
  telemetry("step-04", 4, 69, { x: 26.0, y: 15.0, yaw: 110 }, "Walking south fence line."),
  telemetry("step-05", 5, 68, { x: 33.0, y: 21.0, yaw: 120 }, "Approaching south gate sector."),
  alert("step-06", 6, {
    eventId: "demo-rec-perim-01",
    zoneId: "Z-PERIMETER",
    locationLabel: "south gate",
    finding: "Unauthorized after-hours motion at south gate",
    severity: "high"
  }),
  narration(
    "step-07",
    7,
    "Operator triages perimeter alert",
    "Fixed-camera trigger raised. Operator decides to corroborate visually with the quadruped already in sector."
  ),
  dispatch("step-08", 8, LIVE_MACHINE_ID, "Z-PERIMETER", "Reposition to south gate for visual corroboration"),
  telemetry("step-09", 9, 67, { x: 38.0, y: 25.0, yaw: 135 }, "Moving to south gate under operator control."),
  telemetry("step-10", 10, 66, { x: 42.0, y: 28.0, yaw: 140 }, "At south gate; camera streaming."),
  narration(
    "step-11",
    11,
    "Perimeter corroborated — no intruder, vegetation movement",
    "Operator clears the perimeter alert as low-consequence after visual review."
  ),
  alert("step-12", 12, {
    eventId: "demo-rec-thermal-01",
    zoneId: "Z-BESS",
    locationLabel: "bess container row C",
    finding: "High thermal reading at BESS row C",
    severity: "high"
  }),
  narration(
    "step-13",
    13,
    "Thermal anomaly escalates the shift",
    "Recorded thermal finding at BESS row C. This is the consequential event; operator pivots the quadruped to BESS."
  ),
  dispatch("step-14", 14, LIVE_MACHINE_ID, "Z-BESS", "Drive to BESS row C to confirm heat signature"),
  telemetry("step-15", 15, 65, { x: 50.0, y: 22.0, yaw: 160 }, "En route to BESS yard."),
  telemetry("step-16", 16, 64, { x: 58.0, y: 18.0, yaw: 175 }, "Approaching BESS row C."),
  telemetry("step-17", 17, 63, { x: 63.0, y: 16.0, yaw: 180 }, "At BESS row C; thermal payload on target."),
  narration(
    "step-18",
    18,
    "Operator review — evidence assembled",
    "Camera + thermal + pose tied to BESS row C. Operator confirms anomaly and opens an exception."
  ),
  narration(
    "step-19",
    19,
    "Shift closed — signed audit trail",
    "Coverage evidence and the thermal exception are written to the immutable audit log. Demo complete."
  )
];

export const julyDemoScript: DemoScript = {
  scriptId: "july-21-xerox-noc",
  siteId: SITE_ID,
  liveMachineId: LIVE_MACHINE_ID,
  totalTicks: 19,
  steps,
  recordedEvents
};

import type { MachineEvent } from "../domain/types";

export type ScenarioId =
  | "seven_day_post_analysis"
  | "bess_heat_regression"
  | "switchgear_access_gap"
  | "solar_soiling_trend"
  | "perimeter_after_hours";

export interface Scenario {
  id: ScenarioId;
  label: string;
  operationalQuestion: string;
  phase: "Reconciling" | "Awaiting Review" | "Ready" | "Exercise";
  events: MachineEvent[];
}

const siteId = "SITE-FPR-01";

export const scenarios: Scenario[] = [
  {
    id: "seven_day_post_analysis",
    label: "7-day post analysis",
    phase: "Awaiting Review",
    operationalQuestion: "What changed after retrieving a week of images, thermal frames, and machine logs?",
    events: [
      event("evt-7d-001", "M-UAV-01", "2026-06-18T08:05:00-07:00", "image_capture", "Z-BESS", "bess container row A", "/uploads/smr-drone-inspection.png", "nominal", 0.91),
      event("evt-7d-002", "M-FIXED-01", "2026-06-18T08:12:00-07:00", "thermal_reading", "Z-BESS", "bess container row C", "/uploads/smr-thermal-anomaly.png", "high_thermal_reading", 0.93),
      event("evt-7d-003", "M-UAV-01", "2026-06-18T08:20:00-07:00", "image_capture", "Z-SWITCHGEAR", "mv switchgear west face", "/uploads/smr-drone-inspection.png", "door_clearance_nominal", 0.88),
      event("evt-7d-004", "M-UAV-01", "2026-06-18T08:28:00-07:00", "image_capture", "Z-SOLAR", "solar canopy east row 4", "/uploads/smr-drone-inspection.png", "panel_soiling_visible", 0.84),
      event("evt-7d-005", "M-UGV-01", "2026-06-18T08:36:00-07:00", "patrol_pass", "Z-LOAD-DOCK", "dock doors 3-5", "/uploads/smr-quadruped-inspection.png", "seal_damage_visible", 0.82),
      event("evt-7d-006", "M-FIXED-01", "2026-06-18T08:40:00-07:00", "fixed_camera_trigger", "Z-PERIMETER", "south gate", "/uploads/smr-remote-operations.png", "nominal", 0.79),
      event("evt-7d-007", "M-SCADA-01", "2026-06-18T08:41:00-07:00", "telemetry", undefined, "microgrid rtu", undefined, "bess_string_delta_elevated", 0.86)
    ]
  },
  {
    id: "bess_heat_regression",
    label: "BESS heat regression",
    phase: "Awaiting Review",
    operationalQuestion: "Did the recurring thermal finding grow enough to hold operational closure?",
    events: [
      event("evt-bess-001", "M-FIXED-01", "2026-06-18T09:04:00-07:00", "thermal_reading", "Z-BESS", "bess container row C", "/uploads/smr-thermal-anomaly.png", "high_thermal_reading", 0.94),
      event("evt-bess-002", "M-UAV-01", "2026-06-18T09:09:00-07:00", "image_capture", "Z-BESS", "bess container row C", "/uploads/smr-drone-inspection.png", "confirm_heat_signature", 0.91),
      event("evt-bess-003", "M-SCADA-01", "2026-06-18T09:10:00-07:00", "telemetry", undefined, "microgrid rtu", undefined, "bess_string_delta_elevated", 0.9),
      event("evt-bess-004", "M-UAV-01", "2026-06-18T09:14:00-07:00", "image_capture", "Z-SWITCHGEAR", "mv switchgear west face", "/uploads/smr-drone-inspection.png", "nominal", 0.88),
      event("evt-bess-005", "M-UAV-01", "2026-06-18T09:21:00-07:00", "image_capture", "Z-SOLAR", "solar canopy east row 4", "/uploads/smr-drone-inspection.png", "nominal", 0.86)
    ]
  },
  {
    id: "switchgear_access_gap",
    label: "Switchgear access gap",
    phase: "Reconciling",
    operationalQuestion: "Can the shift close when switchgear imagery is missing but SCADA is current?",
    events: [
      event("evt-switch-001", "M-SCADA-01", "2026-06-18T10:05:00-07:00", "telemetry", undefined, "mv switchgear", undefined, "breaker_status_nominal", 0.95),
      event("evt-switch-002", "M-UAV-01", "2026-06-18T10:09:00-07:00", "image_capture", "Z-BESS", "bess row A", "/uploads/smr-drone-inspection.png", "nominal", 0.89),
      event("evt-switch-003", "M-UGV-01", "2026-06-18T10:17:00-07:00", "dock_status", undefined, "west dock", undefined, "blocked_before_switchgear_pass", 0.97),
      event("evt-switch-004", "M-UAV-01", "2026-06-18T10:24:00-07:00", "image_capture", "Z-SOLAR", "solar canopy east row 4", "/uploads/smr-drone-inspection.png", "nominal", 0.86),
      event("evt-switch-005", "M-FIXED-01", "2026-06-18T10:26:00-07:00", "fixed_camera_trigger", "Z-PERIMETER", "south gate", "/uploads/smr-remote-operations.png", "nominal", 0.81)
    ]
  },
  {
    id: "solar_soiling_trend",
    label: "Solar soiling trend",
    phase: "Ready",
    operationalQuestion: "Does repeated panel soiling become maintenance work or just a watch item?",
    events: [
      event("evt-solar-001", "M-UAV-01", "2026-06-18T11:05:00-07:00", "image_capture", "Z-SOLAR", "solar canopy east row 4", "/uploads/smr-drone-inspection.png", "panel_soiling_visible", 0.85),
      event("evt-solar-002", "M-UAV-01", "2026-06-18T11:12:00-07:00", "image_capture", "Z-BESS", "bess row A", "/uploads/smr-drone-inspection.png", "nominal", 0.9),
      event("evt-solar-003", "M-UAV-01", "2026-06-18T11:18:00-07:00", "image_capture", "Z-SWITCHGEAR", "mv switchgear west face", "/uploads/smr-drone-inspection.png", "nominal", 0.88),
      event("evt-solar-004", "M-UGV-01", "2026-06-18T11:28:00-07:00", "patrol_pass", "Z-LOAD-DOCK", "dock doors 3-5", "/uploads/smr-quadruped-inspection.png", "complete", 0.88),
      event("evt-solar-005", "M-FIXED-01", "2026-06-18T11:31:00-07:00", "fixed_camera_trigger", "Z-PERIMETER", "south gate", "/uploads/smr-remote-operations.png", "nominal", 0.82)
    ]
  },
  {
    id: "perimeter_after_hours",
    label: "After-hours perimeter",
    phase: "Awaiting Review",
    operationalQuestion: "Is the after-hours south gate activity operationally relevant?",
    events: [
      event("evt-perim-001", "M-FIXED-01", "2026-06-18T22:13:00-07:00", "fixed_camera_trigger", "Z-PERIMETER", "south gate", "/uploads/smr-remote-operations.png", "unauthorized_motion", 0.82),
      event("evt-perim-002", "M-UAV-01", "2026-06-18T22:18:00-07:00", "image_capture", "Z-PERIMETER", "south gate", "/uploads/smr-drone-inspection.png", "person_near_gate", 0.84),
      event("evt-perim-003", "M-FIXED-01", "2026-06-18T22:21:00-07:00", "thermal_reading", "Z-BESS", "bess row A", "/uploads/smr-thermal-anomaly.png", "nominal", 0.87)
    ]
  }
];

function event(
  id: string,
  sourceMachineId: string,
  timestamp: string,
  eventType: MachineEvent["eventType"],
  zoneId: string | undefined,
  locationLabel: string,
  payloadRef: string | undefined,
  rawStatus: string,
  confidence: number
): MachineEvent {
  return {
    id,
    sourceMachineId,
    siteId,
    timestamp,
    eventType,
    zoneId,
    locationLabel,
    payloadRef,
    rawStatus,
    confidence,
    envelope: {
      observedAt: timestamp,
      receivedAt: new Date(new Date(timestamp).getTime() + 90_000).toISOString(),
      adapterCheckedAt: "2026-06-18T23:00:00-07:00",
      sourceClockSkewMs: sourceMachineId === "M-SCADA-01" ? 4200 : 350,
      freshnessState: "fresh",
      ttlSeconds: eventType === "telemetry" ? 900 : 3600,
      sequenceId: id,
      droppedSampleCount: 0
    }
  };
}

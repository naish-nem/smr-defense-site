import { describe, expect, it } from "vitest";
import type { DecisionItem } from "./queue";
import {
  assessSeverity,
  buildIncidentModel,
  detectKind,
  previewEligibility,
  recallDockLabel,
  recommendAction,
  simulatedThermalDelta
} from "./incident";
import { baselineMachines } from "../data/site";

const NOW = "2026-06-19T06:00:00.000Z";

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: "dec-test-1",
    kind: "needs_review",
    situationId: "seven_day_post_analysis",
    situationLabel: "7-day post analysis",
    severity: "medium",
    zoneName: "BESS Yard",
    zoneId: "Z-BESS",
    whatHappened: "High thermal reading detected",
    sourceMachine: "M-FIXED-01",
    timestamp: "2026-06-18T08:12:00-07:00",
    source: "RECORDED",
    evidence: { confidence: 0.93, imageUri: "/assets/thermal-anomaly.png" },
    ...overrides
  };
}

describe("detectKind", () => {
  it("classifies CV/thermal detections as model", () => {
    expect(detectKind("High thermal reading detected")).toBe("model");
    expect(detectKind("Person detected near gate")).toBe("model");
    expect(detectKind("Panel soiling visible")).toBe("model");
  });

  it("classifies threshold/telemetry statuses as telemetry", () => {
    expect(detectKind("BESS string delta elevated")).toBe("telemetry");
    expect(detectKind("Path blocked before switchgear pass")).toBe("telemetry");
  });
});

describe("simulatedThermalDelta", () => {
  it("returns a SIMULATED delta for thermal detections, tagged simulated and derived from score", () => {
    const d = simulatedThermalDelta(decision({ whatHappened: "High thermal reading detected", evidence: { confidence: 0.9 } }));
    expect(d).toBeDefined();
    expect(d!.source).toBe("simulated");
    expect(d!.value).toContain("simulated");
    // Deterministic: 0.9 * 10 = 9.0
    expect(d!.value).toContain("9.0");
  });

  it("returns undefined for non-thermal detections (never fabricates a delta)", () => {
    expect(simulatedThermalDelta(decision({ whatHappened: "Person detected near gate" }))).toBeUndefined();
    expect(simulatedThermalDelta(decision({ whatHappened: "Panel soiling visible" }))).toBeUndefined();
  });

  it("returns undefined when there is no model score", () => {
    expect(simulatedThermalDelta(decision({ whatHappened: "High thermal reading", evidence: {} }))).toBeUndefined();
  });
});

describe("assessSeverity", () => {
  it("rates an unauthorized-perimeter detection as critical", () => {
    const a = assessSeverity(
      decision({
        zoneId: "Z-PERIMETER",
        zoneName: "South Perimeter",
        whatHappened: "Person detected near gate",
        evidence: { confidence: 0.95 }
      })
    );
    expect(a.severity).toBe("critical");
    expect(a.rationale).toContain("→ critical");
  });

  it("rates solar soiling (low criticality, low weight) as low/medium", () => {
    const a = assessSeverity(
      decision({
        zoneId: "Z-SOLAR",
        zoneName: "Solar Canopy East",
        whatHappened: "Panel soiling visible",
        evidence: { confidence: 0.84 }
      })
    );
    expect(["low", "medium"]).toContain(a.severity);
  });

  it("is deterministic for identical input", () => {
    const d = decision();
    expect(assessSeverity(d)).toEqual(assessSeverity(d));
  });
});

describe("recommendAction", () => {
  it("recommends dispatch for a high-severity security detection", () => {
    const d = decision({
      zoneId: "Z-PERIMETER",
      zoneName: "South Perimeter",
      whatHappened: "Person detected near gate",
      evidence: { confidence: 0.95 }
    });
    const rec = recommendAction(d, assessSeverity(d));
    expect(rec.action).toBe("dispatch");
  });

  it("recommends escalate for a high-severity telemetry exception", () => {
    const d = decision({
      zoneId: "Z-BESS",
      zoneName: "BESS Yard",
      whatHappened: "BESS string delta elevated",
      evidence: { confidence: 0.7 }
    });
    const rec = recommendAction(d, { severity: "high", rationale: "" });
    expect(rec.action).toBe("escalate");
  });
});

describe("buildIncidentModel", () => {
  it("assembles all derived steps with honest tags", () => {
    const model = buildIncidentModel(decision());
    expect(model.detect.signal.source).toBe("model");
    expect(model.assess.severity).toBeTruthy();
    expect(["confirm", "dismiss", "dispatch", "escalate", "recall", "estop"]).toContain(
      model.recommend.action
    );
  });
});

describe("recallDockLabel (dual docks)", () => {
  it("targets the Quad Kennel for the quadruped command unit", () => {
    const label = recallDockLabel(baselineMachines, "M-UGV-01");
    expect(label).toContain("Quad Kennel");
    expect(label).toContain("DOCK-KENNEL-01");
  });

  it("targets the DJI Dock 3 for the UAV", () => {
    const label = recallDockLabel(baselineMachines, "M-UAV-01");
    expect(label).toContain("DJI Dock 3");
    expect(label).toContain("DOCK-DJI-03");
  });

  it("never sends a unit to the wrong dock", () => {
    expect(recallDockLabel(baselineMachines, "M-UGV-01")).not.toContain("DJI Dock 3");
    expect(recallDockLabel(baselineMachines, "M-UAV-01")).not.toContain("Quad Kennel");
  });
});

describe("previewEligibility", () => {
  it("returns motion=false for non-motion actions (no arbiter)", () => {
    const p = previewEligibility({
      action: "confirm",
      decision: decision(),
      machines: baselineMachines,
      role: "operator",
      nowIso: NOW
    });
    expect(p.motion).toBe(false);
    expect(p.allowed).toBe(true);
  });

  it("lists EVERY gate (not stop-at-first) for a dispatch", () => {
    const p = previewEligibility({
      action: "dispatch",
      decision: decision(),
      machines: baselineMachines,
      role: "operator",
      nowIso: NOW
    });
    expect(p.motion).toBe(true);
    // One verdict per ordered gate, including the new weather gate.
    expect(p.gates.length).toBe(10);
    expect(p.gates.map((g) => g.gateId)).toContain("weather");
  });

  it("denies a dispatch for an analyst (arbiter identity_scope, defence in depth)", () => {
    const p = previewEligibility({
      action: "dispatch",
      decision: decision(),
      machines: baselineMachines,
      role: "analyst",
      nowIso: NOW
    });
    expect(p.allowed).toBe(false);
    expect(p.deniedByGate).toBe("identity_scope");
  });
});

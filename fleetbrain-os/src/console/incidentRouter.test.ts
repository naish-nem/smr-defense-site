import { describe, expect, it } from "vitest";
import { baselineMachines } from "../data/site";
import type { Machine } from "../domain/types";
import { DecisionActionRouter } from "./decisionActions";
import type { DecisionItem } from "./queue";

const NOW = "2026-06-19T06:00:00.000Z";

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: "dec-incident-1",
    kind: "exception",
    situationId: "perimeter_after_hours",
    situationLabel: "After-hours perimeter",
    severity: "critical",
    zoneName: "South Perimeter",
    zoneId: "Z-PERIMETER",
    whatHappened: "Person detected near gate",
    sourceMachine: "M-FIXED-01",
    timestamp: "2026-06-18T22:18:00-07:00",
    source: "RECORDED",
    evidence: { imageUri: "/assets/drone-inspection.png", confidence: 0.84 },
    ...overrides
  };
}

describe("DecisionActionRouter recall — dual docks", () => {
  it("recalls the quadruped command unit to ITS OWN dock and logs it", () => {
    const router = new DecisionActionRouter();
    const result = router.act("recall", decision(), NOW, baselineMachines, { role: "operator" });
    expect(result.action).toBe("recall");
    expect(result.dispatch!.allowed).toBe(true);
    const detail = result.audit.find((a) => a.action === "recall_unit")?.detail ?? "";
    expect(detail).toContain("Quad Kennel");
    expect(detail).not.toContain("DJI Dock 3");
  });

  it("appends a tamper-evident audit chain that verifies", () => {
    const router = new DecisionActionRouter();
    router.act("recall", decision(), NOW, baselineMachines, { role: "operator" });
    expect(router.auditVerified()).toBe(true);
  });
});

describe("DecisionActionRouter estop — safety override", () => {
  it("engages a unit e-stop even when the unit is recalled (override)", () => {
    const recalled: Machine[] = baselineMachines.map((m) =>
      m.id === "M-UGV-01" ? { ...m, status: "recalled" } : m
    );
    const router = new DecisionActionRouter();
    const result = router.act("estop", decision(), NOW, recalled, { role: "operator" });
    expect(result.action).toBe("estop");
    expect(result.dispatch!.allowed).toBe(true);
    expect(result.audit.some((a) => a.action === "estop_engaged")).toBe(true);
  });
});

describe("DecisionActionRouter weather hold", () => {
  it("does not block a quadruped dispatch during a weather hold (UAV-only gate)", () => {
    const router = new DecisionActionRouter();
    const result = router.act("dispatch", decision(), NOW, baselineMachines, {
      role: "operator",
      weather: { hold: true, reason: "high wind" }
    });
    // The command unit is the quadruped, so the weather gate (UAV-only) does not deny.
    expect(result.dispatch!.allowed).toBe(true);
  });
});

describe("DecisionActionRouter role gating via arbiter", () => {
  it("denies a dispatch for an analyst role at the arbiter identity_scope gate", () => {
    const router = new DecisionActionRouter();
    const result = router.act("dispatch", decision(), NOW, baselineMachines, { role: "analyst" });
    expect(result.dispatch!.allowed).toBe(false);
    expect(result.dispatch!.deniedByGate).toBe("identity_scope");
  });
});

describe("DecisionActionRouter closeout", () => {
  it("appends a signed incident-closeout entry", () => {
    const router = new DecisionActionRouter();
    const entry = router.closeout(decision(), NOW, "Incident closed: confirmed and logged.");
    expect(entry.action).toBe("incident_closeout");
    expect(entry.hash).toBeTruthy();
    expect(router.auditVerified()).toBe(true);
  });
});

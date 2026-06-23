import { describe, expect, it } from "vitest";
import { baselineMachines } from "../data/site";
import type { Machine } from "../domain/types";
import { DecisionActionRouter } from "./decisionActions";
import type { DecisionItem } from "./queue";

const NOW = "2026-06-19T06:00:00.000Z";

function decision(overrides: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: "dec-test-1",
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
    evidence: { imageUri: "/assets/remote-operations.png", confidence: 0.84 },
    ...overrides
  };
}

/** The switchgear scenario roster: M-UGV-01 (the command unit) is recalled. */
const recalledRoster: Machine[] = baselineMachines.map((m) =>
  m.id === "M-UGV-01" ? { ...m, status: "recalled", batteryPct: 18 } : m
);

describe("DecisionActionRouter dispatch — real arbiter path", () => {
  it("ALLOWS dispatch with a healthy roster and creates an advancing mission", () => {
    const router = new DecisionActionRouter();
    const result = router.act("dispatch", decision(), NOW, baselineMachines);

    expect(result.dispatch).toBeDefined();
    expect(result.dispatch!.allowed).toBe(true);
    expect(result.dispatch!.deniedByGate).toBeUndefined();
    expect(result.dispatch!.missionId).toBeTruthy();
    expect(result.dispatch!.missionState).toBe("executing");
    expect(result.dispatch!.arbiterHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("DENIES dispatch into an unsafe unit and names the gate (unit_health)", () => {
    const router = new DecisionActionRouter();
    const result = router.act("dispatch", decision(), NOW, recalledRoster);

    expect(result.dispatch!.allowed).toBe(false);
    expect(result.dispatch!.deniedByGate).toBe("unit_health");
    expect(result.dispatch!.reasons.join(" ")).toMatch(/recalled/);
    expect(result.dispatch!.missionId).toBeUndefined();
  });

  it("routes dispatch to the decision zone's configured waypoint", () => {
    const router = new DecisionActionRouter();
    const result = router.act(
      "dispatch",
      decision({ zoneId: "Z-BESS", zoneName: "BESS Yard", whatHappened: "High thermal reading detected" }),
      NOW,
      baselineMachines
    );

    expect(result.dispatch!.allowed).toBe(true);
    expect(result.dispatch!.targetZoneId).toBe("Z-BESS");
    expect(result.dispatch!.waypointLabel).toContain("BESS");
  });

  it("audits the arbiter decision AND the operator dispatch action (allow OR deny)", () => {
    const router = new DecisionActionRouter();
    const denied = router.act("dispatch", decision(), NOW, recalledRoster);
    // Two audit entries: the arbiter decision, then the operator action.
    expect(denied.audit).toHaveLength(2);
    expect(denied.audit[0].action).toBe("arbiter_decision");
    expect(denied.audit[0].allowed).toBe(false);
    expect(denied.audit[0].deniedByGate).toBe("unit_health");
    expect(denied.audit[1].action).toBe("dispatch_unit");
  });
});

describe("DecisionActionRouter confirm / dismiss", () => {
  it("confirm appends exactly one signed audit entry", () => {
    const router = new DecisionActionRouter();
    const result = router.act("confirm", decision(), NOW);
    expect(result.audit).toHaveLength(1);
    expect(result.audit[0].action).toBe("confirm");
    expect(result.audit[0].subjectRef).toBe("dec-test-1");
    expect(result.dispatch).toBeUndefined();
  });

  it("dismiss records a false-positive audit entry", () => {
    const router = new DecisionActionRouter();
    const result = router.act("dismiss", decision(), NOW);
    expect(result.audit[0].action).toBe("dismiss_false_positive");
  });

  it("escalate records a customer-escalation audit entry", () => {
    const router = new DecisionActionRouter();
    const result = router.act("escalate", decision(), NOW);
    expect(result.audit[0].action).toBe("escalate_customer");
  });
});

describe("operator audit chain", () => {
  it("stays contiguous and verifiable across a sequence of mixed actions", () => {
    const router = new DecisionActionRouter();
    router.act("confirm", decision({ id: "d1" }), "2026-06-19T06:00:00.000Z");
    router.act("dispatch", decision({ id: "d2" }), "2026-06-19T06:01:00.000Z", baselineMachines);
    router.act("dismiss", decision({ id: "d3" }), "2026-06-19T06:02:00.000Z");
    router.act("dispatch", decision({ id: "d4" }), "2026-06-19T06:03:00.000Z", recalledRoster);

    const chain = router.auditChain();
    expect(chain.length).toBeGreaterThanOrEqual(6);
    expect(router.auditVerified()).toBe(true);

    // Each record's prevHash equals the prior record's hash (contiguous chain).
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].prevHash).toBe(chain[i - 1].hash);
    }
    // First record chains off GENESIS.
    expect(chain[0].prevHash).toBe("GENESIS");
  });

  it("is deterministic — identical action sequences produce identical hashes", () => {
    const run = () => {
      const router = new DecisionActionRouter();
      router.act("confirm", decision({ id: "d1" }), NOW);
      router.act("dispatch", decision({ id: "d2" }), NOW, baselineMachines);
      return router.auditChain().map((r) => r.hash);
    };
    expect(run()).toEqual(run());
  });
});

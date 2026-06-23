import { describe, expect, it } from "vitest";
import { OperationsConsole } from "./OperationsConsole";

const NOW = "2026-06-18T10:00:00.000Z";

describe("OperationsConsole — end-to-end phase integration", () => {
  it("wires all five phases into one coherent summary", async () => {
    const console = new OperationsConsole();
    const summary = await console.runPhaseSummary(NOW);

    // Phase 0 — demo: live_plus_recorded, non-empty banner, full frame count, has LIVE step.
    expect(summary.demo.mode).toBe("live_plus_recorded");
    expect(summary.demo.banner.length).toBeGreaterThan(0);
    expect(summary.demo.frameCount).toBeGreaterThan(0);
    expect(summary.demo.hasLiveStep).toBe(true);

    // Phase 1 — mission: reaches completed via 6 legal transitions.
    expect(summary.mission.finalState).toBe("completed");
    expect(summary.mission.transitionCount).toBe(6);
    expect(summary.mission.allTransitionsLegal).toBe(true);

    // Phase 3 — arbiter: valid intent allowed, invalid denied by a NAMED gate.
    expect(summary.arbiter.valid.allowed).toBe(true);
    expect(summary.arbiter.valid.deniedByGate).toBeUndefined();
    expect(summary.arbiter.invalid.allowed).toBe(false);
    expect(summary.arbiter.invalid.deniedByGate).toBe("geofence");
    expect(summary.arbiter.valid.auditHash).not.toBe(summary.arbiter.invalid.auditHash);
    expect(summary.arbiter.chainVerified).toBe(true);

    // Phase 2 — edge: zero data loss after draining the partition backlog.
    expect(summary.edge.dataLoss).toBe(false);
    expect(summary.edge.lostCount).toBe(0);
    expect(summary.edge.deliveredCount).toBeGreaterThan(0);
    expect(summary.edge.linkLossRatio).toBeGreaterThan(0);

    // Phase 4 — autonomy: 10/0-takeover gate pass + exact perception metrics.
    expect(summary.autonomy.gate.passedGate).toBe(true);
    expect(summary.autonomy.gate.completedLoops).toBe(10);
    expect(summary.autonomy.gate.takeoverCount).toBe(0);
    expect(summary.autonomy.perception.precision).toBeCloseTo(0.8, 10);
    expect(summary.autonomy.perception.recall).toBeCloseTo(4 / 6, 10);
    expect(summary.autonomy.perception.falsePositiveRate).toBeCloseTo(0.2, 10);
  });

  it("is deterministic — identical nowIso yields identical summaries", async () => {
    const a = await new OperationsConsole().runPhaseSummary(NOW);
    const b = await new OperationsConsole().runPhaseSummary(NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

import { describe, expect, it } from "vitest";
import { siteGeometry } from "../data/geometry";
import { PatrolLoopRunner, buildPatrolRoute } from "./PatrolLoopRunner";
import {
  MockPerceptionModel,
  scorePerception
} from "./PerceptionScorer";
import { perceptionFixture } from "./fixtures/perceptionFixture";

describe("PatrolLoopRunner", () => {
  const machineId = "M-UAV-01";

  it("completes a single loop hitting all waypoints", () => {
    const route = buildPatrolRoute(siteGeometry, machineId);
    const runner = new PatrolLoopRunner({ route, geometry: siteGeometry, seed: 1 });

    const result = runner.runLoop(1);

    expect(result.completed).toBe(true);
    expect(result.tookTakeover).toBe(false);
    expect(result.waypointsHit).toEqual(route.goals.map((g) => g.waypointId));
    expect(result.waypointsHit).toHaveLength(siteGeometry.inspectionWaypoints.length);
  });

  it("emits one patrol_pass MachineEvent per waypoint", () => {
    const route = buildPatrolRoute(siteGeometry, machineId);
    const runner = new PatrolLoopRunner({ route, geometry: siteGeometry, seed: 1 });

    runner.runLoop(1);
    const events = runner.getEvents();

    expect(events).toHaveLength(route.goals.length);
    expect(events.every((e) => e.eventType === "patrol_pass")).toBe(true);
    expect(events.every((e) => e.sourceMachineId === machineId)).toBe(true);
    expect(events.map((e) => e.zoneId)).toEqual(route.goals.map((g) => g.zoneId));
  });

  it("runConsecutiveLoops(10) passes the autonomy gate with zero takeover", () => {
    const route = buildPatrolRoute(siteGeometry, machineId);
    const runner = new PatrolLoopRunner({ route, geometry: siteGeometry, seed: 42 });

    const gate = runner.runConsecutiveLoops(10);

    expect(gate.passedGate).toBe(true);
    expect(gate.completedLoops).toBe(10);
    expect(gate.takeoverCount).toBe(0);
    expect(gate.loops.every((l) => l.completed)).toBe(true);
    expect(runner.getStatus()).toBe("completed");
  });

  it("injecting a takeover fails the gate and increments the counter", () => {
    const route = buildPatrolRoute(siteGeometry, machineId);
    const runner = new PatrolLoopRunner({
      route,
      geometry: siteGeometry,
      seed: 42,
      takeovers: [{ loopIndex: 4, goalIndex: 1 }]
    });

    const gate = runner.runConsecutiveLoops(10);

    expect(gate.passedGate).toBe(false);
    expect(gate.takeoverCount).toBe(1);
    expect(gate.completedLoops).toBe(9);
    expect(runner.getTakeoverCount()).toBe(1);

    const failedLoop = gate.loops.find((l) => l.loopIndex === 4);
    expect(failedLoop?.tookTakeover).toBe(true);
    expect(failedLoop?.completed).toBe(false);
    // The takeover aborted at goalIndex 1, so only the first waypoint was hit.
    expect(failedLoop?.waypointsHit).toEqual([route.goals[0].waypointId]);
  });

  it("pause/resume gate the patrolling status", () => {
    const route = buildPatrolRoute(siteGeometry, machineId);
    const runner = new PatrolLoopRunner({ route, geometry: siteGeometry, seed: 1 });

    runner.runLoop(1);
    runner.pause();
    expect(runner.getStatus()).toBe("paused");
    runner.resume();
    expect(runner.getStatus()).toBe("patrolling");
  });

  it("recall returns the machine to its dock", () => {
    const route = buildPatrolRoute(siteGeometry, machineId);
    const runner = new PatrolLoopRunner({ route, geometry: siteGeometry, seed: 1 });

    runner.runLoop(1);
    const dock = runner.recall();

    expect(runner.getStatus()).toBe("recalled");
    expect(dock).toEqual(route.dock);
    const expectedDock = siteGeometry.dockLocations.find((d) => d.machineId === machineId)?.point;
    expect(dock).toEqual(expectedDock);
  });

  it("is deterministic — identical seeds produce identical event ids", () => {
    const route = buildPatrolRoute(siteGeometry, machineId);
    const a = new PatrolLoopRunner({ route, geometry: siteGeometry, seed: 7 });
    const b = new PatrolLoopRunner({ route, geometry: siteGeometry, seed: 7 });
    a.runLoop(1);
    b.runLoop(1);
    expect(a.getEvents().map((e) => e.id)).toEqual(b.getEvents().map((e) => e.id));
  });
});

describe("scorePerception", () => {
  it("computes exact precision/recall/FP-rate on the fixture at threshold 0.5", () => {
    const model = new MockPerceptionModel();
    const metrics = scorePerception(model, perceptionFixture, 0.5);

    // TP=4, FP=1, FN=2 over 6 ground-truth objects (see PerceptionScorer doc).
    expect(metrics.precision).toBeCloseTo(0.8, 10); // 4/5
    expect(metrics.recall).toBeCloseTo(4 / 6, 10); // ≈0.6667
    expect(metrics.falsePositiveRate).toBeCloseTo(0.2, 10); // 1/5
    expect(metrics.sampleCount).toBe(perceptionFixture.length);
    expect(metrics.threshold).toBe(0.5);
  });

  it("respects the threshold — a lower threshold admits more detections", () => {
    const model = new MockPerceptionModel();

    // At 0.35, person@0.40 now counts (TP) but thermal@0.30 still excluded.
    // TP=5, FP=1, FN=1 → precision=5/6, recall=5/6, fpRate=1/6.
    const low = scorePerception(model, perceptionFixture, 0.35);
    expect(low.precision).toBeCloseTo(5 / 6, 10);
    expect(low.recall).toBeCloseTo(5 / 6, 10);
    expect(low.falsePositiveRate).toBeCloseTo(1 / 6, 10);

    // At 0.95, no detection clears the bar: TP=0, FP=0, FN=6.
    const high = scorePerception(model, perceptionFixture, 0.95);
    expect(high.precision).toBe(0);
    expect(high.recall).toBe(0);
    expect(high.falsePositiveRate).toBe(0);
  });
});

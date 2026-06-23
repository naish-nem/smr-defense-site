import { describe, expect, it } from "vitest";
import type { Machine, SiteGeometry } from "../domain/types";
import { weatherGate, ORDERED_GATES } from "./gates";
import type { CommandIntent, GateContext, UnitRuntimeState } from "./types";

const GEOMETRY: SiteGeometry = {
  siteId: "SITE-TEST",
  frameId: "site-local-enu",
  boundary: [],
  zones: [],
  noGoZones: [],
  dockLocations: [],
  inspectionWaypoints: []
};

const uav: Machine = {
  id: "M-UAV-01",
  label: "Drone Alpha",
  kind: "uav",
  vendor: "DJI",
  status: "available",
  batteryPct: 86
};

const ugv: Machine = {
  id: "M-UGV-01",
  label: "Ground Unit",
  kind: "quadruped",
  vendor: "Unitree",
  status: "available",
  batteryPct: 72
};

function unit(machineId: string): UnitRuntimeState {
  return { machineId, link: "up", maintenanceLockout: false, batteryFloorPct: 20 };
}

function ctx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    siteId: "SITE-TEST",
    machines: [uav, ugv],
    units: [unit("M-UAV-01"), unit("M-UGV-01")],
    geometry: GEOMETRY,
    siteLinkToCloud: "up",
    estop: { siteEngaged: false, engagedUnits: {} },
    ...overrides
  };
}

function dispatchIntent(targetMachineId: string): CommandIntent {
  return {
    id: `intent-${targetMachineId}`,
    type: "dispatch_machine",
    targetMachineId,
    issuedBy: {
      operatorId: "op-1",
      role: "site_operator",
      authority: "site_local_operator",
      scopedSiteId: "SITE-TEST"
    },
    params: { destination: { x: 1, y: 1 } },
    issuedAt: "2026-06-19T06:00:00.000Z",
    freshnessDeadlineMs: 60_000
  };
}

const NOW = "2026-06-19T06:00:00.000Z";

describe("weatherGate", () => {
  it("is registered in ORDERED_GATES, placed before estop", () => {
    const ids = ORDERED_GATES.map((g) => g.id);
    expect(ids).toContain("weather");
    expect(ids.indexOf("weather")).toBeLessThan(ids.indexOf("estop"));
  });

  it("denies UAV dispatch when a weather hold is in effect", () => {
    const r = weatherGate.evaluate(
      dispatchIntent("M-UAV-01"),
      ctx({ weather: { hold: true, reason: "high wind" } }),
      NOW
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toContain("weather hold");
    expect(r.reason).toContain("high wind");
  });

  it("PASSES when weather is undefined (so existing contexts stay green)", () => {
    const r = weatherGate.evaluate(dispatchIntent("M-UAV-01"), ctx(), NOW);
    expect(r.pass).toBe(true);
  });

  it("does not block a ground unit during a weather hold (UAV-only)", () => {
    const r = weatherGate.evaluate(
      dispatchIntent("M-UGV-01"),
      ctx({ weather: { hold: true } }),
      NOW
    );
    expect(r.pass).toBe(true);
  });

  it("does not block a recall (safety override) even during a weather hold", () => {
    const recall: CommandIntent = { ...dispatchIntent("M-UAV-01"), type: "recall_machine", params: {} };
    const r = weatherGate.evaluate(recall, ctx({ weather: { hold: true } }), NOW);
    expect(r.pass).toBe(true);
  });
});

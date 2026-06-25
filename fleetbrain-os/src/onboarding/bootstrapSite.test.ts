import { describe, expect, it } from "vitest";
import { coverageZones as fpCoverageZones, site as fpSite } from "../data/site";
import { siteGeometry as fpGeometry } from "../data/geometry";
import { bootstrapSite } from "./bootstrapSite";
import { fortPierceBlueprint } from "./fortPierceBlueprint";

const NOW = "2026-06-22T00:00:00Z";

function byId<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}
function byZoneId<T extends { zoneId: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.zoneId.localeCompare(b.zoneId));
}
function byMachineId<T extends { machineId: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.machineId.localeCompare(b.machineId));
}

describe("bootstrapSite — Fort Pierce golden reproduction", () => {
  const result = bootstrapSite(fortPierceBlueprint, { siteId: "SITE-FPR-01", now: NOW });

  it("reproduces the hand-authored Site identity", () => {
    expect(result.site).toEqual(fpSite);
  });

  it("reproduces the logical coverage zones (compared by id — hand-authored order differs)", () => {
    expect(byId(result.coverageZones)).toEqual(byId(fpCoverageZones));
  });

  it("reproduces the site geometry — boundary, zones, no-go, docks, waypoints", () => {
    expect(result.geometry.siteId).toBe(fpGeometry.siteId);
    expect(result.geometry.frameId).toBe(fpGeometry.frameId);
    expect(result.geometry.boundary).toEqual(fpGeometry.boundary);
    expect(byZoneId(result.geometry.zones)).toEqual(byZoneId(fpGeometry.zones));
    expect(byZoneId(result.geometry.noGoZones)).toEqual(byZoneId(fpGeometry.noGoZones));
    expect(byMachineId(result.geometry.dockLocations)).toEqual(byMachineId(fpGeometry.dockLocations));
    expect(byZoneId(result.geometry.inspectionWaypoints)).toEqual(byZoneId(fpGeometry.inspectionWaypoints));
  });

  it("pins inspectionWaypoint and zone ARRAY ORDER (load-bearing for patrol routes and dispatch fallback)", () => {
    // buildPatrolRoute numbers waypoints WP-N by index; dispatchDestination uses [0].
    // bootstrap output must match the hand-authored order array-for-array, not just by id.
    expect(result.geometry.inspectionWaypoints).toEqual(fpGeometry.inspectionWaypoints);
    expect(result.geometry.zones).toEqual(fpGeometry.zones);
    expect(result.geometry.dockLocations).toEqual(fpGeometry.dockLocations);
  });
});

describe("bootstrapSite — determinism & audit", () => {
  it("is deterministic for the same inputs", () => {
    const a = bootstrapSite(fortPierceBlueprint, { siteId: "SITE-FPR-01", now: NOW });
    const b = bootstrapSite(fortPierceBlueprint, { siteId: "SITE-FPR-01", now: NOW });
    expect(a).toEqual(b);
  });

  it("emits a deterministic site-bootstrap audit entry with the passed-in timestamp", () => {
    const { audit } = bootstrapSite(fortPierceBlueprint, { siteId: "SITE-FPR-01", now: NOW });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      id: `audit-site_bootstrap-SITE-FPR-01-${NOW}`,
      timestamp: NOW,
      actor: "operator",
      action: "site_bootstrap",
      subjectRef: "SITE-FPR-01"
    });
  });

  it("derives a zone id from the name when none is supplied", () => {
    const result = bootstrapSite(
      {
        name: "Test",
        location: "X",
        mission: "Y",
        boundary: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 }
        ],
        zones: [
          {
            name: "North Lot",
            purpose: "p",
            requiredMachineKinds: ["uav"],
            freshnessMinutes: 30,
            vertices: [
              { x: 1, y: 1 },
              { x: 5, y: 1 },
              { x: 5, y: 5 },
              { x: 1, y: 5 }
            ]
          }
        ],
        noGoZones: [],
        docks: []
      },
      { siteId: "SITE-T", now: NOW }
    );
    expect(result.coverageZones[0].id).toBe("Z-NORTH-LOT");
    expect(result.geometry.zones[0].zoneId).toBe("Z-NORTH-LOT");
  });
});

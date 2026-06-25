import { describe, expect, it } from "vitest";
import type { SiteBlueprint } from "./siteBlueprint";
import { fortPierceBlueprint } from "./fortPierceBlueprint";
import { validateBlueprint } from "./validateBlueprint";

/** A minimal valid blueprint: 10x10 site, one interior zone. */
function baseBlueprint(): SiteBlueprint {
  return {
    name: "Test Site",
    location: "Somewhere",
    mission: "Test mission",
    boundary: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ],
    zones: [
      {
        id: "Z-A",
        name: "Zone A",
        purpose: "p",
        requiredMachineKinds: ["uav"],
        freshnessMinutes: 30,
        vertices: [
          { x: 1, y: 1 },
          { x: 5, y: 1 },
          { x: 5, y: 5 },
          { x: 1, y: 5 }
        ],
        waypoint: { point: { x: 3, y: 3 }, label: "center" }
      }
    ],
    noGoZones: [],
    docks: [{ machineId: "M-1", point: { x: 8, y: 8 } }]
  };
}

describe("validateBlueprint", () => {
  it("accepts the Fort Pierce blueprint with no errors", () => {
    const result = validateBlueprint(fortPierceBlueprint);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a minimal valid blueprint", () => {
    expect(validateBlueprint(baseBlueprint()).ok).toBe(true);
  });

  it("rejects a degenerate boundary and short-circuits", () => {
    const bp = baseBlueprint();
    bp.boundary = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const result = validateBlueprint(bp);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("boundary_degenerate");
  });

  it("flags a zone that extends outside the boundary", () => {
    const bp = baseBlueprint();
    bp.zones[0].vertices = [
      { x: 1, y: 1 },
      { x: 50, y: 1 },
      { x: 50, y: 5 },
      { x: 1, y: 5 }
    ];
    const result = validateBlueprint(bp);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("zone_outside_boundary");
  });

  it("flags an inspection waypoint outside its zone", () => {
    const bp = baseBlueprint();
    bp.zones[0].waypoint = { point: { x: 9, y: 9 }, label: "out" };
    const result = validateBlueprint(bp);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("waypoint_outside_zone");
  });

  it("flags duplicate zone ids", () => {
    const bp = baseBlueprint();
    bp.zones.push({ ...bp.zones[0] });
    const result = validateBlueprint(bp);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("duplicate_zone_id");
  });

  it("flags a dock placed outside the boundary", () => {
    const bp = baseBlueprint();
    bp.docks[0].point = { x: 50, y: 50 };
    const result = validateBlueprint(bp);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("dock_outside_boundary");
  });

  it("flags a zone with no name and no explicit id", () => {
    const bp = baseBlueprint();
    bp.zones[0].id = undefined;
    bp.zones[0].name = "   ";
    const result = validateBlueprint(bp);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("zone_name_missing");
  });

  it("flags a zone whose name slugs to nothing usable", () => {
    const bp = baseBlueprint();
    bp.zones[0].id = undefined;
    bp.zones[0].name = "!!!";
    const result = validateBlueprint(bp);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("zone_id_unresolvable");
  });

  it("warns (not errors) on empty location and missing machine kinds", () => {
    const bp = baseBlueprint();
    bp.location = "";
    bp.zones[0].requiredMachineKinds = [];
    const result = validateBlueprint(bp);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["site_location_missing", "zone_no_machine_kinds"])
    );
  });
});

import type { SiteBlueprint } from "./siteBlueprint";

/**
 * The existing Fort Pierce site (SITE-FPR-01), expressed as a SiteBlueprint.
 * This is the golden fixture: `bootstrapSite(fortPierceBlueprint, …)` must
 * reproduce the hand-authored spine in `data/site.ts` + `data/geometry.ts`
 * exactly (compared by id, since the hand-authored arrays are unordered).
 *
 * It doubles as the "load example" blueprint for the onboarding UI.
 *
 * Zone order matters: it follows `data/geometry.ts` (PERIMETER, BESS,
 * SWITCHGEAR, SOLAR, LOAD-DOCK) because `inspectionWaypoints` order is
 * load-bearing downstream — `buildPatrolRoute` numbers waypoints `WP-N` by
 * array index, and `dispatchDestination` uses `inspectionWaypoints[0]` as its
 * absolute fallback. The golden test pins this order array-for-array.
 */
export const fortPierceBlueprint: SiteBlueprint = {
  name: "Fort Pierce Resilience Microgrid",
  location: "Fort Pierce, FL",
  mission:
    "Maintain evidence-backed readiness for BESS, switchgear, solar canopy, cold-chain load dock, and perimeter security.",
  boundary: [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 90 },
    { x: 0, y: 90 }
  ],
  zones: [
    {
      id: "Z-PERIMETER",
      name: "South Perimeter",
      purpose: "Confirm fence line, gate, vegetation, and unauthorized access indicators.",
      requiredMachineKinds: ["uav", "fixed-sensor"],
      freshnessMinutes: 45,
      vertices: [
        { x: 5, y: 8 },
        { x: 48, y: 8 },
        { x: 48, y: 40 },
        { x: 5, y: 40 }
      ],
      waypoint: { point: { x: 20, y: 24 }, label: "north gate visual" }
    },
    {
      id: "Z-BESS",
      name: "BESS Yard",
      purpose: "Detect thermal, access, and enclosure anomalies around battery containers.",
      requiredMachineKinds: ["uav", "fixed-sensor"],
      freshnessMinutes: 30,
      vertices: [
        { x: 66, y: 12 },
        { x: 112, y: 12 },
        { x: 112, y: 47 },
        { x: 66, y: 47 }
      ],
      waypoint: { point: { x: 102, y: 36 }, label: "BESS east thermal lane" }
    },
    {
      id: "Z-SWITCHGEAR",
      name: "MV Switchgear",
      purpose: "Verify cabinet condition, clearances, and visual/thermal indicators.",
      requiredMachineKinds: ["uav", "fixed-sensor"],
      freshnessMinutes: 45,
      vertices: [
        { x: 72, y: 52 },
        { x: 112, y: 52 },
        { x: 112, y: 82 },
        { x: 72, y: 82 }
      ],
      waypoint: { point: { x: 95, y: 68 }, label: "switchgear west face" }
    },
    {
      id: "Z-SOLAR",
      name: "Solar Canopy East",
      purpose: "Check panel rows, combiner access, soiling, cracking, and obstructions.",
      requiredMachineKinds: ["uav"],
      freshnessMinutes: 60,
      vertices: [
        { x: 20, y: 58 },
        { x: 66, y: 58 },
        { x: 66, y: 84 },
        { x: 20, y: 84 }
      ],
      waypoint: { point: { x: 45, y: 72 }, label: "solar canopy east row" }
    },
    {
      id: "Z-LOAD-DOCK",
      name: "Cold-Chain Load Dock",
      purpose: "Confirm doors, dock seals, emergency access, and refrigerated load continuity.",
      requiredMachineKinds: ["quadruped", "uav"],
      freshnessMinutes: 60,
      vertices: [
        { x: 8, y: 46 },
        { x: 38, y: 46 },
        { x: 38, y: 70 },
        { x: 8, y: 70 }
      ],
      waypoint: { point: { x: 26, y: 58 }, label: "load dock door line" }
    }
  ],
  noGoZones: [
    {
      id: "NO-GO-BESS-DOOR",
      vertices: [
        { x: 80, y: 25 },
        { x: 90, y: 25 },
        { x: 90, y: 34 },
        { x: 80, y: 34 }
      ]
    }
  ],
  docks: [
    { machineId: "M-UAV-01", point: { x: 94, y: 60 } },
    { machineId: "M-UGV-01", point: { x: 18, y: 50 } }
  ]
};

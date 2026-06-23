import type { SiteGeometry } from "../domain/types";

export const siteGeometry: SiteGeometry = {
  siteId: "SITE-FPR-01",
  frameId: "site-local-enu",
  boundary: [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 90 },
    { x: 0, y: 90 }
  ],
  zones: [
    {
      zoneId: "Z-PERIMETER",
      frameId: "site-local-enu",
      vertices: [
        { x: 5, y: 8 },
        { x: 48, y: 8 },
        { x: 48, y: 40 },
        { x: 5, y: 40 }
      ]
    },
    {
      zoneId: "Z-BESS",
      frameId: "site-local-enu",
      vertices: [
        { x: 66, y: 12 },
        { x: 112, y: 12 },
        { x: 112, y: 47 },
        { x: 66, y: 47 }
      ]
    },
    {
      zoneId: "Z-SWITCHGEAR",
      frameId: "site-local-enu",
      vertices: [
        { x: 72, y: 52 },
        { x: 112, y: 52 },
        { x: 112, y: 82 },
        { x: 72, y: 82 }
      ]
    },
    {
      zoneId: "Z-SOLAR",
      frameId: "site-local-enu",
      vertices: [
        { x: 20, y: 58 },
        { x: 66, y: 58 },
        { x: 66, y: 84 },
        { x: 20, y: 84 }
      ]
    },
    {
      zoneId: "Z-LOAD-DOCK",
      frameId: "site-local-enu",
      vertices: [
        { x: 8, y: 46 },
        { x: 38, y: 46 },
        { x: 38, y: 70 },
        { x: 8, y: 70 }
      ]
    }
  ],
  noGoZones: [
    {
      zoneId: "NO-GO-BESS-DOOR",
      frameId: "site-local-enu",
      vertices: [
        { x: 80, y: 25 },
        { x: 90, y: 25 },
        { x: 90, y: 34 },
        { x: 80, y: 34 }
      ]
    }
  ],
  dockLocations: [
    { machineId: "M-UAV-01", point: { x: 94, y: 60 } },
    { machineId: "M-UGV-01", point: { x: 18, y: 50 } }
  ],
  inspectionWaypoints: [
    { zoneId: "Z-PERIMETER", point: { x: 20, y: 24 }, label: "north gate visual" },
    { zoneId: "Z-BESS", point: { x: 102, y: 36 }, label: "BESS east thermal lane" },
    { zoneId: "Z-SWITCHGEAR", point: { x: 95, y: 68 }, label: "switchgear west face" },
    { zoneId: "Z-SOLAR", point: { x: 45, y: 72 }, label: "solar canopy east row" },
    { zoneId: "Z-LOAD-DOCK", point: { x: 26, y: 58 }, label: "load dock door line" }
  ]
};

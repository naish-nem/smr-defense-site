import type { CoverageZone, Machine, Site } from "../domain/types";

export const site: Site = {
  id: "SITE-FPR-01",
  name: "Fort Pierce Resilience Microgrid",
  location: "Fort Pierce, FL",
  mission: "Maintain evidence-backed readiness for BESS, switchgear, solar canopy, cold-chain load dock, and perimeter security."
};

export const coverageZones: CoverageZone[] = [
  {
    id: "Z-BESS",
    name: "BESS Yard",
    purpose: "Detect thermal, access, and enclosure anomalies around battery containers.",
    requiredMachineKinds: ["uav", "fixed-sensor"],
    freshnessMinutes: 30
  },
  {
    id: "Z-SWITCHGEAR",
    name: "MV Switchgear",
    purpose: "Verify cabinet condition, clearances, and visual/thermal indicators.",
    requiredMachineKinds: ["uav", "fixed-sensor"],
    freshnessMinutes: 45
  },
  {
    id: "Z-SOLAR",
    name: "Solar Canopy East",
    purpose: "Check panel rows, combiner access, soiling, cracking, and obstructions.",
    requiredMachineKinds: ["uav"],
    freshnessMinutes: 60
  },
  {
    id: "Z-LOAD-DOCK",
    name: "Cold-Chain Load Dock",
    purpose: "Confirm doors, dock seals, emergency access, and refrigerated load continuity.",
    requiredMachineKinds: ["quadruped", "uav"],
    freshnessMinutes: 60
  },
  {
    id: "Z-PERIMETER",
    name: "South Perimeter",
    purpose: "Confirm fence line, gate, vegetation, and unauthorized access indicators.",
    requiredMachineKinds: ["uav", "fixed-sensor"],
    freshnessMinutes: 45
  }
];

export const baselineMachines: Machine[] = [
  {
    id: "M-UAV-01",
    label: "Drone Alpha",
    kind: "uav",
    vendor: "DJI",
    model: "Dock 2 / M3D class",
    status: "available",
    batteryPct: 86
  },
  {
    id: "M-UGV-01",
    label: "Ground Unit WOLF",
    kind: "quadruped",
    vendor: "Unitree",
    model: "Go2 class",
    status: "docked",
    batteryPct: 72
  },
  {
    id: "M-FIXED-01",
    label: "Thermal North",
    kind: "fixed-sensor",
    vendor: "Fixed",
    status: "online"
  },
  {
    id: "M-SCADA-01",
    label: "Microgrid RTU",
    kind: "fixed-sensor",
    vendor: "Fixed",
    status: "online"
  }
];

import type { PostAnalysisWindow } from "../domain/postAnalysis";

export const postAnalysisWindow: PostAnalysisWindow = {
  siteId: "SITE-FPR-01",
  start: "2026-06-12T00:00:00-07:00",
  end: "2026-06-18T23:59:59-07:00",
  retrieved: {
    machineEvents: 1264,
    rgbImages: 438,
    thermalFrames: 96,
    videoClips: 18,
    telemetrySeries: 42
  },
  artifacts: [
    artifact("art-bess-0612", "2026-06-12", "Z-BESS", "BESS-C3", "M-FIXED-01", "thermal_frame", "/assets/thermal-anomaly.png", "human_review_required"),
    artifact("art-bess-0618", "2026-06-18", "Z-BESS", "BESS-C3", "M-UAV-01", "rgb_image", "/assets/drone-inspection.png", "human_review_required"),
    artifact("art-solar-0615", "2026-06-15", "Z-SOLAR", "PV-E-04", "M-UAV-01", "rgb_image", "/assets/drone-inspection.png", "machine_analyzed"),
    artifact("art-dock-0618", "2026-06-18", "Z-LOAD-DOCK", "DOCK-04", "M-UGV-01", "rgb_image", "/assets/quadruped-inspection.png", "human_review_required"),
    artifact("art-perim-0618", "2026-06-18", "Z-PERIMETER", "GATE-S", "M-FIXED-01", "video_clip", "/assets/remote-operations.png", "machine_analyzed")
  ],
  findings: [
    {
      id: "finding-bess-c3-heat",
      zoneId: "Z-BESS",
      assetId: "BESS-C3",
      title: "Recurring heat rise on BESS container C3",
      severity: "urgent",
      firstSeen: "2026-06-12T14:22:00-07:00",
      lastSeen: "2026-06-18T08:12:00-07:00",
      occurrences: 5,
      confidence: 0.91,
      trend: "worsening",
      summary: "Thermal frames show repeated hot spot at the same enclosure face; SCADA delta also elevated on June 18.",
      artifactRefs: ["art-bess-0612", "art-bess-0618"],
      recommendedAction: "Hold closure until battery technician reviews thermal frame and SCADA delta."
    },
    {
      id: "finding-pv-e4-soiling",
      zoneId: "Z-SOLAR",
      assetId: "PV-E-04",
      title: "Solar canopy row E4 soiling trend",
      severity: "watch",
      firstSeen: "2026-06-15T10:40:00-07:00",
      lastSeen: "2026-06-18T08:28:00-07:00",
      occurrences: 3,
      confidence: 0.84,
      trend: "recurring",
      summary: "RGB captures show visible soiling across the same panel row over three separate retrieval days.",
      artifactRefs: ["art-solar-0615"],
      recommendedAction: "Add to next planned maintenance window; not a closure blocker."
    },
    {
      id: "finding-dock-seal-04",
      zoneId: "Z-LOAD-DOCK",
      assetId: "DOCK-04",
      title: "Dock door seal damage",
      severity: "action",
      firstSeen: "2026-06-18T08:36:00-07:00",
      lastSeen: "2026-06-18T08:36:00-07:00",
      occurrences: 1,
      confidence: 0.82,
      trend: "new",
      summary: "Ground robot imagery shows torn dock seal near cold-chain door 4.",
      artifactRefs: ["art-dock-0618"],
      recommendedAction: "Assign facilities check before next cold-chain handoff."
    }
  ]
};

function artifact(
  id: string,
  day: string,
  zoneId: string,
  assetId: string,
  sourceMachineId: string,
  artifactType: "rgb_image" | "thermal_frame" | "video_clip" | "telemetry_log",
  uri: string,
  reviewState: "machine_analyzed" | "human_review_required" | "reviewed"
) {
  return {
    id,
    day,
    zoneId,
    assetId,
    sourceMachineId,
    artifactType,
    uri,
    capturedAt: `${day}T08:12:00-07:00`,
    reviewState
  };
}

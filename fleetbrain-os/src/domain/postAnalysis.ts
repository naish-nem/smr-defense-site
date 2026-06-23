export type FindingSeverity = "info" | "watch" | "action" | "urgent";

export interface AnalysisArtifact {
  id: string;
  day: string;
  zoneId: string;
  assetId: string;
  sourceMachineId: string;
  artifactType: "rgb_image" | "thermal_frame" | "video_clip" | "telemetry_log";
  uri: string;
  capturedAt: string;
  reviewState: "machine_analyzed" | "human_review_required" | "reviewed";
}

export interface AnalysisFinding {
  id: string;
  zoneId: string;
  assetId: string;
  title: string;
  severity: FindingSeverity;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  confidence: number;
  trend: "new" | "recurring" | "worsening" | "improving" | "stable";
  summary: string;
  artifactRefs: string[];
  recommendedAction: string;
}

export interface PostAnalysisWindow {
  siteId: string;
  start: string;
  end: string;
  retrieved: {
    machineEvents: number;
    rgbImages: number;
    thermalFrames: number;
    videoClips: number;
    telemetrySeries: number;
  };
  artifacts: AnalysisArtifact[];
  findings: AnalysisFinding[];
}

export function summarizePostAnalysis(window: PostAnalysisWindow) {
  const urgentOrAction = window.findings.filter((finding) => finding.severity === "urgent" || finding.severity === "action");
  const recurring = window.findings.filter((finding) => finding.trend === "recurring" || finding.trend === "worsening");
  const humanReview = window.artifacts.filter((artifact) => artifact.reviewState === "human_review_required");

  return {
    totalArtifacts:
      window.retrieved.rgbImages +
      window.retrieved.thermalFrames +
      window.retrieved.videoClips +
      window.retrieved.telemetrySeries,
    urgentOrActionCount: urgentOrAction.length,
    recurringCount: recurring.length,
    humanReviewCount: humanReview.length,
    topFinding: window.findings[0]
  };
}

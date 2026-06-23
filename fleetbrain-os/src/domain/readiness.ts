import type { SiteRecord } from "./types";

export type ReadinessOutcome = "ready" | "ready_with_limits" | "not_ready" | "requires_human_review";

export interface ReadinessGate {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  reason: string;
  blockingExceptionIds: string[];
  evidenceRefs: string[];
}

export interface ReadinessDecision {
  siteId: string;
  generatedAt: string;
  outcome: ReadinessOutcome;
  gates: ReadinessGate[];
  recommendedDecision: string;
  requiredHumanActions: string[];
}

export function evaluateReadiness(record: SiteRecord): ReadinessDecision {
  const gates: ReadinessGate[] = [
    {
      id: "coverage",
      label: "Coverage obligations",
      status: record.readiness.coveragePct === 100 ? "pass" : "fail",
      reason:
        record.readiness.coveragePct === 100
          ? "All configured zones have current evidence."
          : `${record.readiness.coveragePct}% of configured zones have accepted evidence.`,
      blockingExceptionIds: record.openExceptions.filter((item) => item.type === "missing_coverage").map((item) => item.id),
      evidenceRefs: record.latestEvidence.map((item) => item.id)
    },
    {
      id: "exceptions",
      label: "Exception severity",
      status: record.openExceptions.some((item) => item.severity === "critical" || item.severity === "high")
        ? "fail"
        : record.openExceptions.length
          ? "warn"
          : "pass",
      reason: record.openExceptions.length
        ? `${record.openExceptions.length} open exception(s) require review.`
        : "No open exceptions.",
      blockingExceptionIds: record.openExceptions.map((item) => item.id),
      evidenceRefs: record.openExceptions.flatMap((item) => item.evidenceRefs)
    },
    {
      id: "adapter-health",
      label: "Adapter health",
      status: record.readiness.adapterHealth === "healthy" ? "pass" : "warn",
      reason: `Primary adapter health is ${record.readiness.adapterHealth}.`,
      blockingExceptionIds: [],
      evidenceRefs: []
    },
    {
      id: "raw-unreviewed",
      label: "Unreviewed inputs",
      status: record.rawUnreviewedEvents.length ? "warn" : "pass",
      reason: record.rawUnreviewedEvents.length
        ? `${record.rawUnreviewedEvents.length} raw event(s) did not become evidence.`
        : "No raw-only events remain.",
      blockingExceptionIds: [],
      evidenceRefs: record.rawUnreviewedEvents.map((item) => item.id)
    },
    {
      id: "command-authority",
      label: "Command authority",
      status: record.readiness.commandAuthority === "read_only" ? "warn" : "fail",
      reason: `Hardware command authority is ${record.readiness.commandAuthority}.`,
      blockingExceptionIds: [],
      evidenceRefs: []
    }
  ];

  const hasFail = gates.some((gate) => gate.status === "fail");
  const hasWarn = gates.some((gate) => gate.status === "warn");
  const outcome: ReadinessOutcome = hasFail ? "not_ready" : hasWarn ? "ready_with_limits" : "ready";

  return {
    siteId: record.site.id,
    generatedAt: record.generatedAt,
    outcome,
    gates,
    recommendedDecision:
      outcome === "ready"
        ? "Archive the shift record."
        : outcome === "ready_with_limits"
          ? "Continue only with documented limits and human review."
          : "Hold operational closure until blockers are assigned.",
    requiredHumanActions: gates
      .filter((gate) => gate.status !== "pass")
      .map((gate) => `${gate.label}: ${gate.reason}`)
  };
}

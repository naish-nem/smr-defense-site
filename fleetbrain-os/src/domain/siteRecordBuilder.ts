import { coverageZones, site } from "../data/site";
import type {
  CoverageEvidence,
  EvidenceResult,
  FleetException,
  Machine,
  MachineEvent,
  SiteRecord
} from "./types";

const COVERAGE_EVENT_TYPES = new Set(["patrol_pass", "image_capture", "thermal_reading", "fixed_camera_trigger"]);

function isAnomalous(event: MachineEvent): boolean {
  return [
    "high_thermal_reading",
    "confirm_heat_signature",
    "unauthorized_motion",
    "person_near_gate"
  ].some((token) => event.rawStatus.includes(token));
}

function inferExceptionType(event: MachineEvent): FleetException["type"] {
  if (event.rawStatus.includes("thermal") || event.rawStatus.includes("heat")) return "thermal_anomaly";
  if (event.rawStatus.includes("unauthorized") || event.rawStatus.includes("person_near_gate")) return "unauthorized_perimeter";
  if (event.rawStatus.includes("battery") || event.rawStatus.includes("blocked")) return "machine_recall";
  return "adapter_gap";
}

function eventToEvidence(event: MachineEvent): CoverageEvidence | null {
  if (!event.zoneId || !COVERAGE_EVENT_TYPES.has(event.eventType)) return null;

  const anomalous = isAnomalous(event);
  return {
    id: `evidence-${event.id}`,
    eventIds: [event.id],
    zoneId: event.zoneId,
    sourceMachineId: event.sourceMachineId,
    checkedAt: event.timestamp,
    result: anomalous ? "exception" : "covered",
    artifactRefs: event.payloadRef ? [event.payloadRef] : [],
    confidence: event.confidence,
    reviewState: anomalous ? "needs_review" : "accepted",
    recommendedAction: anomalous ? "Assign human review before closing coverage." : "No immediate action."
  };
}

function classifyExceptions(events: MachineEvent[], evidence: CoverageEvidence[]): FleetException[] {
  const exceptions: FleetException[] = [];
  const evidenceByZone = new Map<string, CoverageEvidence[]>();

  evidence.forEach((item) => {
    evidenceByZone.set(item.zoneId, [...(evidenceByZone.get(item.zoneId) ?? []), item]);
  });

  coverageZones.forEach((zone) => {
    if (!evidenceByZone.has(zone.id)) {
      const relatedRawEvents = events.filter((event) => event.zoneId === zone.id).map((event) => event.id);
      exceptions.push({
        id: `exception-missing-${zone.id}`,
        type: "missing_coverage",
        severity: "high",
        location: zone.name,
        evidenceRefs: relatedRawEvents,
        status: "open",
        owner: "Unassigned",
        nextAction: `Assign follow-up coverage for ${zone.name}.`
      });
    }
  });

  evidence
    .filter((item) => item.result === "exception")
    .forEach((item) => {
      const event = events.find((candidate) => candidate.id === item.eventIds[0]);
      exceptions.push({
        id: `exception-${item.id}`,
        type: event ? inferExceptionType(event) : "adapter_gap",
        severity: item.confidence > 0.88 ? "high" : "medium",
        location: coverageZones.find((zone) => zone.id === item.zoneId)?.name ?? item.zoneId,
        evidenceRefs: [item.id],
        status: "open",
        owner: "Unassigned",
        nextAction: item.recommendedAction
      });
    });

  events
    .filter((event) => event.rawStatus.includes("battery_recall") || event.rawStatus.includes("blocked_before"))
    .forEach((event) => {
      exceptions.push({
        id: `exception-machine-${event.id}`,
        type: "machine_recall",
        severity: "medium",
        location: event.locationLabel,
        evidenceRefs: [event.id],
        status: "open",
        owner: "Unassigned",
        nextAction: "Review machine availability and schedule a replacement pass."
      });
    });

  return exceptions;
}

function zoneState(zoneId: string, evidence: CoverageEvidence[], exceptions: FleetException[]): EvidenceResult {
  if (exceptions.some((exception) => exception.location === coverageZones.find((zone) => zone.id === zoneId)?.name)) {
    return "exception";
  }
  if (evidence.some((item) => item.zoneId === zoneId && item.result === "covered")) return "covered";
  return "unreviewed";
}

export function buildSiteRecord(params: {
  machines: Machine[];
  events: MachineEvent[];
  generatedAt: string;
  adapterHealth: SiteRecord["readiness"]["adapterHealth"];
}): SiteRecord {
  const latestEvidence = params.events.map(eventToEvidence).filter((item): item is CoverageEvidence => Boolean(item));
  const rawUnreviewedEvents = params.events.filter(
    (event) => !latestEvidence.some((evidence) => evidence.eventIds.includes(event.id))
  );
  const openExceptions = classifyExceptions(params.events, latestEvidence);
  const coveredCount = coverageZones.filter((zone) => zoneState(zone.id, latestEvidence, openExceptions) === "covered").length;

  return {
    site,
    generatedAt: params.generatedAt,
    coverageZones: coverageZones.map((zone) => {
      const latestForZone = latestEvidence
        .filter((item) => item.zoneId === zone.id)
        .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
      return {
        ...zone,
        state: zoneState(zone.id, latestEvidence, openExceptions),
        lastCheckedAt: latestForZone?.checkedAt
      };
    }),
    machines: params.machines,
    latestEvidence,
    rawUnreviewedEvents,
    openExceptions,
    auditTrail: [
      {
        id: `audit-site-record-${params.generatedAt}`,
        timestamp: params.generatedAt,
        actor: "FleetBrainKernel",
        action: "site_record_built",
        subjectRef: site.id,
        detail: "Read-only adapter events normalized into evidence and exceptions."
      }
    ],
    readiness: {
      coveragePct: Math.round((coveredCount / coverageZones.length) * 100),
      openExceptionCount: openExceptions.length,
      adapterHealth: params.adapterHealth,
      commandAuthority: "read_only"
    }
  };
}

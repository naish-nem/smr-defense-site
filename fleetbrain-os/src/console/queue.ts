import { coverageZones, site } from "../data/site";
import { scenarios, type ScenarioId } from "../data/scenarios";
import type {
  CoverageEvidence,
  ExceptionSeverity,
  FleetException,
  MachineEvent,
  SiteRecord
} from "../domain/types";

/**
 * The Queue — pure decision-builder.
 *
 * Collapses every scenario's open exceptions and needs-review evidence into ONE
 * cross-situation, prioritized stream of decisions that need a human. This is the
 * heart of the product: not per-robot gauges, but a ranked list of "what needs me".
 *
 * Deterministic per CLAUDE.md invariant 3: this module reads only the immutable
 * scenario/site data and the SiteRecord passed in. It never reads the wall clock
 * or randomness; ranking is a total order over the data.
 */

/** Honesty label for the source feed (CLAUDE.md invariant 4). */
export type SourceLabel = "LIVE" | "RECORDED";

/** What kind of thing put this decision in the queue. */
export type DecisionKind = "exception" | "needs_review";

/** A single artifact (the evidence the human judges). */
export interface DecisionEvidence {
  /** Original payload ref from the event (e.g. /uploads/...). */
  payloadRef?: string;
  /**
   * Resolved displayable image URI for a REAL inspection frame (drone / thermal /
   * quadruped), mapped to /assets/. Undefined when the event has no genuine visual
   * frame — in that case the card shows an honest "no visual frame" sensor state
   * rather than a misleading stock image (CLAUDE.md invariant 4: honesty).
   */
  imageUri?: string;
  /** The model/CV score from the source event (a score, not a measurement), if present. */
  confidence?: number;
}

export interface DecisionItem {
  id: string;
  kind: DecisionKind;
  situationId: ScenarioId;
  situationLabel: string;
  severity: ExceptionSeverity;
  /** Resolved human-readable zone name (or location label when no zone). */
  zoneName: string;
  zoneId?: string;
  /** One-line "what happened", plain language. */
  whatHappened: string;
  sourceMachine: string;
  /** ISO timestamp of the underlying event. */
  timestamp: string;
  source: SourceLabel;
  evidence: DecisionEvidence;
  /** Refs back to the underlying exception / evidence for audit linkage. */
  exceptionId?: string;
  evidenceId?: string;
  /** Collapsed sibling count for repeated blockers such as missing coverage. */
  relatedCount?: number;
  relatedSituationLabels?: string[];
}

/** Asset map mirrors the wiring proven in the legacy app (payload -> bundled asset). */
export const imageByPayload: Record<string, string> = {
  "/uploads/smr-drone-inspection.png": "/assets/drone-inspection.png",
  "/uploads/smr-quadruped-inspection.png": "/assets/quadruped-inspection.png",
  "/uploads/smr-thermal-anomaly.png": "/assets/thermal-anomaly.png",
  "/uploads/smr-remote-operations.png": "/assets/remote-operations.png"
};

/**
 * Real inspection frames only. The control-room "remote-operations" image is NOT
 * evidence of anything at a site — it's ops-center stock imagery — so it never
 * stands in as a decision's evidence. Events without a genuine frame resolve to
 * undefined and the card renders a sensor/telemetry-only state instead.
 */
const FRAME_ASSETS = new Set<string>([
  "/assets/drone-inspection.png",
  "/assets/quadruped-inspection.png",
  "/assets/thermal-anomaly.png"
]);

export function resolveImage(payloadRef?: string): string | undefined {
  if (!payloadRef) return undefined;
  const mapped = imageByPayload[payloadRef];
  return mapped && FRAME_ASSETS.has(mapped) ? mapped : undefined;
}

const SEVERITY_RANK: Record<ExceptionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

function zoneName(zoneId: string | undefined, fallback: string): string {
  if (!zoneId) return fallback;
  return coverageZones.find((z) => z.id === zoneId)?.name ?? zoneId;
}

/** Turn a raw status token into a plain-language line a human can read fast. */
function humanize(rawStatus: string): string {
  const map: Record<string, string> = {
    high_thermal_reading: "High thermal reading detected",
    confirm_heat_signature: "Heat signature confirmed on re-pass",
    unauthorized_motion: "Unauthorized motion at gate",
    person_near_gate: "Person detected near gate",
    panel_soiling_visible: "Panel soiling visible",
    seal_damage_visible: "Dock seal damage visible",
    blocked_before_switchgear_pass: "Path blocked before switchgear pass",
    bess_string_delta_elevated: "BESS string delta elevated"
  };
  if (map[rawStatus]) return map[rawStatus];
  return rawStatus.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Map a needs-review evidence item to a severity, honestly derived from data. */
function evidenceSeverity(evidence: CoverageEvidence, event: MachineEvent | undefined): ExceptionSeverity {
  const status = event?.rawStatus ?? "";
  if (status.includes("unauthorized") || status.includes("person_near_gate")) return "critical";
  if (status.includes("thermal") || status.includes("heat")) return "high";
  // Confidence is the model/CV score from the event; use it to separate high vs medium.
  return evidence.confidence > 0.88 ? "high" : "medium";
}

function exceptionSeverity(exception: FleetException): ExceptionSeverity {
  return exception.severity;
}

function zoneIdFromName(zoneName: string): string | undefined {
  return coverageZones.find((zone) => zone.name === zoneName)?.id;
}

function collapseRepeatedMissingCoverage(items: DecisionItem[]): DecisionItem[] {
  const grouped = new Map<string, DecisionItem[]>();
  const passthrough: DecisionItem[] = [];

  for (const item of items) {
    if (item.kind === "exception" && item.exceptionId?.startsWith("exception-missing-")) {
      const key = `missing:${item.zoneId ?? item.zoneName}`;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    } else {
      passthrough.push(item);
    }
  }

  const collapsed = [...grouped.values()].map((group) => {
    const ordered = prioritize(group);
    const primary = ordered[0];
    return {
      ...primary,
      relatedCount: group.length,
      relatedSituationLabels: [...new Set(ordered.map((item) => item.situationLabel))]
    };
  });

  return [...passthrough, ...collapsed];
}

/**
 * Build the unified, prioritized decision queue from a set of already-built
 * SiteRecords (one per situation/scenario). Pass the records in keyed by scenario
 * id so the builder stays pure and deterministic.
 */
export function buildDecisionQueue(
  recordsByScenario: Array<{ scenarioId: ScenarioId; record: SiteRecord }>,
  options: { source?: SourceLabel } = {}
): DecisionItem[] {
  const source: SourceLabel = options.source ?? "RECORDED";
  const items: DecisionItem[] = [];

  for (const { scenarioId, record } of recordsByScenario) {
    const scenario = scenarios.find((s) => s.id === scenarioId);
    const situationLabel = scenario?.label ?? scenarioId;
    const eventsById = new Map(scenario?.events.map((e) => [e.id, e]) ?? []);

    // 1. Needs-review evidence -> decisions.
    for (const evidence of record.latestEvidence) {
      if (evidence.reviewState !== "needs_review") continue;
      const event = eventsById.get(evidence.eventIds[0]);
      items.push({
        id: `dec-ev-${scenarioId}-${evidence.id}`,
        kind: "needs_review",
        situationId: scenarioId,
        situationLabel,
        severity: evidenceSeverity(evidence, event),
        zoneName: zoneName(evidence.zoneId, event?.locationLabel ?? evidence.zoneId),
        zoneId: evidence.zoneId,
        whatHappened: humanize(event?.rawStatus ?? "needs review"),
        sourceMachine: evidence.sourceMachineId,
        timestamp: evidence.checkedAt,
        source,
        evidence: {
          payloadRef: evidence.artifactRefs[0],
          imageUri: resolveImage(evidence.artifactRefs[0]),
          confidence: evidence.confidence
        },
        evidenceId: evidence.id
      });
    }

    // 2. Open exceptions -> decisions. Skip exceptions that merely wrap a
    //    needs-review evidence item we already surfaced (exception-evidence-*),
    //    so each underlying observation produces exactly one decision.
    for (const exception of record.openExceptions) {
      if (exception.status !== "open") continue;
      const wrapsEvidence = exception.id.startsWith("exception-evidence-");
      if (wrapsEvidence) continue;

      // Try to find a backing event for an image + timestamp.
      const backingEventId = exception.evidenceRefs.find((ref) => eventsById.has(ref));
      const backingEvent = backingEventId ? eventsById.get(backingEventId) : undefined;
      const checkedAt = backingEvent?.timestamp ?? record.generatedAt;

      items.push({
        id: `dec-ex-${scenarioId}-${exception.id}`,
        kind: "exception",
        situationId: scenarioId,
        situationLabel,
        severity: exceptionSeverity(exception),
        zoneName: exception.location,
        zoneId: zoneIdFromName(exception.location),
        whatHappened:
          exception.type === "missing_coverage"
            ? `Missing coverage — ${exception.location}`
            : humanize(backingEvent?.rawStatus ?? exception.type),
        sourceMachine: backingEvent?.sourceMachineId ?? "—",
        timestamp: checkedAt,
        source,
        evidence: {
          payloadRef: backingEvent?.payloadRef,
          imageUri: resolveImage(backingEvent?.payloadRef),
          confidence: backingEvent?.confidence
        },
        exceptionId: exception.id
      });
    }
  }

  return prioritize(collapseRepeatedMissingCoverage(items));
}

/**
 * Total, deterministic ordering: severity first (critical > high > medium > low),
 * then staleness (older first), then id as a stable tiebreaker.
 */
export function prioritize(items: DecisionItem[]): DecisionItem[] {
  return [...items].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    const age = a.timestamp.localeCompare(b.timestamp); // older (smaller ISO) first
    if (age !== 0) return age;
    return a.id.localeCompare(b.id);
  });
}

export const siteName = site.name;

import { fnv1a } from "../arbiter/CommandArbiter";
import type {
  DeviceActivityRecord,
  DeviceTrailPoint,
  Machine
} from "../domain/types";
import type { OperatorAuditRecord } from "./auditChain";

/**
 * Incident replay — reconstruct "what did this device see, where was it, and what
 * was on the record" at any moment T, and export that reconstruction as a signed
 * evidence package.
 *
 * This is the moat surface: it turns a pile of trail samples + activity records
 * into a defensible, scrubbable account of an operation. Pure + deterministic
 * (CLAUDE.md invariant 3): every function takes timestamps as inputs and never
 * reads the wall clock. The export reuses the same `fnv1a` linker as the operator
 * audit chain (invariant 2) so the package carries a tamper-evident digest.
 *
 * Nothing here is dramatized — every keyframe keeps the SourceTag it arrived with,
 * so a reader can always tell measured truth from a configured/simulated value.
 */

export type ReplayKeyframeType = "trail" | "activity";

export interface ReplayKeyframe {
  atMs: number;
  at: string;
  type: ReplayKeyframeType;
  /** Present when type === "trail". */
  trail?: DeviceTrailPoint;
  /** Present when type === "activity". */
  activity?: DeviceActivityRecord;
}

export interface ReplaySnapshot {
  atMs: number;
  atIso: string;
  /** Last known trail point at or before T (undefined if T precedes all samples). */
  position?: DeviceTrailPoint;
  /** Trail samples observed up to and including T, oldest first. */
  trailSoFar: DeviceTrailPoint[];
  /** Most recent activity at or before T. */
  currentActivity?: DeviceActivityRecord;
  /** Activity records observed up to and including T, oldest first. */
  activitiesSoFar: DeviceActivityRecord[];
  /** Zone the device was in at T, if known from its last trail sample. */
  zoneId?: string;
}

export interface IncidentEvidencePackage {
  kind: "fleetbrain.incident-replay.v1";
  generatedAtIso: string;
  machine: {
    id: string;
    label: string;
    kind: Machine["kind"];
    vendor: Machine["vendor"];
    model?: string;
    status: Machine["status"];
  };
  window: { startIso: string; endIso: string };
  /** The moment the operator chose to anchor the package. */
  focusIso: string;
  reconstruction: {
    positionZoneId?: string;
    positionLabel?: string;
    currentActivityId?: string;
    activitiesObserved: number;
  };
  keyframes: Array<{
    at: string;
    type: ReplayKeyframeType;
    source: string;
    detail: string;
    ref?: string;
    hash?: string;
  }>;
  /** Operator actions whose timestamp falls within [window.start, focus]. */
  operatorActions: Array<{
    timestamp: string;
    action: string;
    subjectRef: string;
    detail: string;
    allowed?: boolean;
    deniedByGate?: string;
    hash: string;
  }>;
  /** fnv1a digest over the canonical package body (everything above this field). */
  packageDigest: string;
}

function ms(iso: string): number {
  return Date.parse(iso);
}

/**
 * Merge a device's trail and activity into one timeline, oldest first. Ties are
 * broken deterministically (trail before activity, then by ref id) so the same
 * inputs always produce the same keyframe order.
 */
export function buildReplayTimeline(
  trail: DeviceTrailPoint[],
  activity: DeviceActivityRecord[]
): ReplayKeyframe[] {
  const frames: ReplayKeyframe[] = [];
  for (const point of trail) {
    frames.push({ atMs: ms(point.at), at: point.at, type: "trail", trail: point });
  }
  for (const record of activity) {
    frames.push({ atMs: ms(record.at), at: record.at, type: "activity", activity: record });
  }
  return frames.sort((a, b) => {
    if (a.atMs !== b.atMs) return a.atMs - b.atMs;
    if (a.type !== b.type) return a.type === "trail" ? -1 : 1;
    return refOf(a).localeCompare(refOf(b));
  });
}

function refOf(frame: ReplayKeyframe): string {
  if (frame.type === "trail" && frame.trail) {
    return `${frame.trail.point.x},${frame.trail.point.y}`;
  }
  return frame.activity?.id ?? "";
}

export function replayBounds(timeline: ReplayKeyframe[]): { startMs: number; endMs: number } | null {
  if (timeline.length === 0) return null;
  return { startMs: timeline[0].atMs, endMs: timeline[timeline.length - 1].atMs };
}

/** Reconstruct device state at moment T (in epoch ms) from the merged timeline. */
export function reconstructAt(timeline: ReplayKeyframe[], atMs: number): ReplaySnapshot {
  const trailSoFar: DeviceTrailPoint[] = [];
  const activitiesSoFar: DeviceActivityRecord[] = [];
  for (const frame of timeline) {
    if (frame.atMs > atMs) break;
    if (frame.type === "trail" && frame.trail) trailSoFar.push(frame.trail);
    if (frame.type === "activity" && frame.activity) activitiesSoFar.push(frame.activity);
  }
  const position = trailSoFar[trailSoFar.length - 1];
  const currentActivity = activitiesSoFar[activitiesSoFar.length - 1];
  return {
    atMs,
    atIso: new Date(atMs).toISOString(),
    position,
    trailSoFar,
    currentActivity,
    activitiesSoFar,
    zoneId: position?.zoneId
  };
}

/**
 * Build a signed, exportable evidence package anchored at `focusIso`. The window
 * spans the full replay timeline; operator actions are scoped to the part of the
 * window up to the focus moment. `generatedAtIso` is passed in (the demo clock),
 * never read from the wall clock.
 */
export function buildIncidentPackage(input: {
  machine: Machine;
  timeline: ReplayKeyframe[];
  focusIso: string;
  generatedAtIso: string;
  operatorAudit?: readonly OperatorAuditRecord[];
  zoneLabelFor?: (zoneId: string) => string;
}): IncidentEvidencePackage {
  const { machine, timeline, focusIso, generatedAtIso, operatorAudit = [], zoneLabelFor } = input;
  const bounds = replayBounds(timeline);
  const startIso = bounds ? new Date(bounds.startMs).toISOString() : focusIso;
  const endIso = bounds ? new Date(bounds.endMs).toISOString() : focusIso;
  const focusMs = ms(focusIso);
  const snapshot = reconstructAt(timeline, focusMs);

  const keyframes = timeline.map((frame) => {
    if (frame.type === "trail" && frame.trail) {
      const t = frame.trail;
      return {
        at: t.at,
        type: "trail" as const,
        source: t.source,
        detail: `${t.zoneId ?? "site"} · (${t.point.x},${t.point.y}) · ${t.state}`,
        ref: t.zoneId
      };
    }
    const a = frame.activity!;
    return {
      at: a.at,
      type: "activity" as const,
      source: a.source,
      detail: `${a.kind}: ${a.title}`,
      ref: a.artifactRef,
      hash: a.hash
    };
  });

  const windowStartMs = bounds ? bounds.startMs : focusMs;
  const operatorActions = operatorAudit
    .filter((rec) => {
      const t = ms(rec.timestamp);
      return t >= windowStartMs && t <= focusMs;
    })
    .map((rec) => ({
      timestamp: rec.timestamp,
      action: rec.action,
      subjectRef: rec.subjectRef,
      detail: rec.detail,
      allowed: rec.allowed,
      deniedByGate: rec.deniedByGate,
      hash: rec.hash
    }));

  const body: Omit<IncidentEvidencePackage, "packageDigest"> = {
    kind: "fleetbrain.incident-replay.v1",
    generatedAtIso,
    machine: {
      id: machine.id,
      label: machine.label,
      kind: machine.kind,
      vendor: machine.vendor,
      model: machine.model,
      status: machine.status
    },
    window: { startIso, endIso },
    focusIso,
    reconstruction: {
      positionZoneId: snapshot.zoneId,
      positionLabel:
        snapshot.zoneId && zoneLabelFor ? zoneLabelFor(snapshot.zoneId) : snapshot.zoneId,
      currentActivityId: snapshot.currentActivity?.id,
      activitiesObserved: snapshot.activitiesSoFar.length
    },
    keyframes,
    operatorActions
  };

  return { ...body, packageDigest: digestPackage(body) };
}

/** Stable fnv1a digest over the package body (canonical JSON, no digest field). */
export function digestPackage(body: Omit<IncidentEvidencePackage, "packageDigest">): string {
  return fnv1a(JSON.stringify(body));
}

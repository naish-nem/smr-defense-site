import { describe, expect, it } from "vitest";
import {
  buildIncidentPackage,
  buildReplayTimeline,
  digestPackage,
  reconstructAt,
  replayBounds
} from "./replay";
import type { DeviceActivityRecord, DeviceTrailPoint, Machine } from "../domain/types";
import type { OperatorAuditRecord } from "./auditChain";

const MACHINE: Machine = {
  id: "M-UAV-01",
  label: "Skydeck UAV",
  kind: "uav",
  vendor: "DJI",
  model: "M350",
  status: "in_mission"
};

const TRAIL: DeviceTrailPoint[] = [
  { machineId: "M-UAV-01", at: "2026-06-18T08:05:00Z", point: { x: 98, y: 38 }, zoneId: "Z-BESS", state: "observed", source: "artifact" },
  { machineId: "M-UAV-01", at: "2026-06-18T08:20:00Z", point: { x: 96, y: 66 }, zoneId: "Z-SWITCHGEAR", state: "observed", source: "artifact" },
  { machineId: "M-UAV-01", at: "2026-06-18T08:28:00Z", point: { x: 45, y: 72 }, zoneId: "Z-SOLAR", state: "observed", source: "artifact" }
];

const ACTIVITY: DeviceActivityRecord[] = [
  { id: "act-1", machineId: "M-UAV-01", at: "2026-06-18T08:05:00Z", kind: "capture", title: "BESS frame", summary: "kept", zoneId: "Z-BESS", hash: "aaa", source: "artifact" },
  { id: "act-2", machineId: "M-UAV-01", at: "2026-06-18T08:28:00Z", kind: "capture", title: "Solar soiling", summary: "review", zoneId: "Z-SOLAR", hash: "bbb", source: "artifact" }
];

const at = (iso: string) => Date.parse(iso);

describe("buildReplayTimeline", () => {
  it("merges trail and activity into one oldest-first timeline", () => {
    const timeline = buildReplayTimeline(TRAIL, ACTIVITY);
    expect(timeline).toHaveLength(5);
    const times = timeline.map((f) => f.atMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("breaks ties deterministically: trail before activity at the same instant", () => {
    const timeline = buildReplayTimeline(TRAIL, ACTIVITY);
    const tie = timeline.filter((f) => f.at === "2026-06-18T08:05:00Z");
    expect(tie.map((f) => f.type)).toEqual(["trail", "activity"]);
  });

  it("is stable across input ordering", () => {
    const a = buildReplayTimeline(TRAIL, ACTIVITY);
    const b = buildReplayTimeline([...TRAIL].reverse(), [...ACTIVITY].reverse());
    expect(b.map((f) => `${f.type}@${f.atMs}`)).toEqual(a.map((f) => `${f.type}@${f.atMs}`));
  });
});

describe("reconstructAt", () => {
  const timeline = buildReplayTimeline(TRAIL, ACTIVITY);

  it("returns no position before the first sample", () => {
    const snap = reconstructAt(timeline, at("2026-06-18T08:00:00Z"));
    expect(snap.position).toBeUndefined();
    expect(snap.trailSoFar).toHaveLength(0);
    expect(snap.activitiesSoFar).toHaveLength(0);
  });

  it("reconstructs last-known position and accumulated records at T", () => {
    const snap = reconstructAt(timeline, at("2026-06-18T08:21:00Z"));
    expect(snap.position?.zoneId).toBe("Z-SWITCHGEAR");
    expect(snap.zoneId).toBe("Z-SWITCHGEAR");
    expect(snap.trailSoFar).toHaveLength(2);
    expect(snap.currentActivity?.id).toBe("act-1");
    expect(snap.activitiesSoFar.map((a) => a.id)).toEqual(["act-1"]);
  });

  it("includes a sample exactly at T (inclusive)", () => {
    const snap = reconstructAt(timeline, at("2026-06-18T08:28:00Z"));
    expect(snap.position?.zoneId).toBe("Z-SOLAR");
    expect(snap.activitiesSoFar.map((a) => a.id)).toEqual(["act-1", "act-2"]);
  });

  it("accumulation is monotonic as T advances", () => {
    let prev = 0;
    for (const frame of timeline) {
      const snap = reconstructAt(timeline, frame.atMs);
      expect(snap.activitiesSoFar.length + snap.trailSoFar.length).toBeGreaterThanOrEqual(prev);
      prev = snap.activitiesSoFar.length + snap.trailSoFar.length;
    }
  });
});

describe("replayBounds", () => {
  it("spans first to last keyframe", () => {
    const bounds = replayBounds(buildReplayTimeline(TRAIL, ACTIVITY));
    expect(bounds).toEqual({ startMs: at("2026-06-18T08:05:00Z"), endMs: at("2026-06-18T08:28:00Z") });
  });

  it("is null for an empty timeline", () => {
    expect(replayBounds([])).toBeNull();
  });
});

describe("buildIncidentPackage", () => {
  const timeline = buildReplayTimeline(TRAIL, ACTIVITY);
  const audit: OperatorAuditRecord[] = [
    { id: "op-1", timestamp: "2026-06-18T08:10:00Z", actor: "operator", action: "dispatch_unit", subjectRef: "dec-1", detail: "verify BESS", allowed: true, prevHash: "GENESIS", hash: "h1" },
    { id: "op-2", timestamp: "2026-06-18T09:00:00Z", actor: "operator", action: "confirm", subjectRef: "dec-1", detail: "closed after focus", prevHash: "h1", hash: "h2" }
  ];

  it("anchors at the focus moment and scopes operator actions to [start, focus]", () => {
    const pkg = buildIncidentPackage({
      machine: MACHINE,
      timeline,
      focusIso: "2026-06-18T08:28:00Z",
      generatedAtIso: "2026-06-19T06:00:00Z",
      operatorAudit: audit,
      zoneLabelFor: (z) => `Zone ${z}`
    });
    expect(pkg.kind).toBe("fleetbrain.incident-replay.v1");
    expect(pkg.window).toEqual({ startIso: "2026-06-18T08:05:00.000Z", endIso: "2026-06-18T08:28:00.000Z" });
    expect(pkg.reconstruction.positionLabel).toBe("Zone Z-SOLAR");
    expect(pkg.reconstruction.activitiesObserved).toBe(2);
    // op-2 (09:00, after focus) is excluded; op-1 (within window) is kept.
    expect(pkg.operatorActions.map((a) => a.action)).toEqual(["dispatch_unit"]);
  });

  it("keyframes preserve the source tag of every datum", () => {
    const pkg = buildIncidentPackage({
      machine: MACHINE,
      timeline,
      focusIso: "2026-06-18T08:28:00Z",
      generatedAtIso: "2026-06-19T06:00:00Z"
    });
    expect(pkg.keyframes).toHaveLength(5);
    expect(pkg.keyframes.every((k) => typeof k.source === "string" && k.source.length > 0)).toBe(true);
  });

  it("digest is deterministic and tamper-evident", () => {
    const args = {
      machine: MACHINE,
      timeline,
      focusIso: "2026-06-18T08:28:00Z",
      generatedAtIso: "2026-06-19T06:00:00Z",
      operatorAudit: audit
    };
    const a = buildIncidentPackage(args);
    const b = buildIncidentPackage(args);
    expect(a.packageDigest).toBe(b.packageDigest);

    const { packageDigest, ...body } = a;
    expect(digestPackage(body)).toBe(packageDigest);

    const tampered = { ...body, focusIso: "2026-06-18T08:05:00Z" };
    expect(digestPackage(tampered)).not.toBe(packageDigest);
  });
});

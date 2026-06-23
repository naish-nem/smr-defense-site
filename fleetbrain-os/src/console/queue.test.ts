import { describe, expect, it } from "vitest";
import { SimulatorAdapter } from "../adapters/SimulatorAdapter";
import { FleetBrainKernel } from "../kernel/FleetBrainKernel";
import { scenarios, type ScenarioId } from "../data/scenarios";
import type { SiteRecord } from "../domain/types";
import { buildDecisionQueue, prioritize, type DecisionItem } from "./queue";

const SEVERITY_RANK: Record<DecisionItem["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

async function buildAllRecords(): Promise<Array<{ scenarioId: ScenarioId; record: SiteRecord }>> {
  return Promise.all(
    scenarios.map(async (scenario) => {
      const adapter = new SimulatorAdapter(scenario.id);
      const kernel = new FleetBrainKernel(adapter);
      const record = await kernel.buildCurrentSiteRecord("SITE-FPR-01");
      return { scenarioId: scenario.id, record };
    })
  );
}

describe("buildDecisionQueue", () => {
  it("builds decisions from open exceptions and needs-review evidence across all situations", async () => {
    const records = await buildAllRecords();
    const queue = buildDecisionQueue(records);

    expect(queue.length).toBeGreaterThan(0);
    // Every item carries the cross-situation provenance the operator needs.
    for (const item of queue) {
      expect(item.situationId).toBeTruthy();
      expect(item.situationLabel).toBeTruthy();
      expect(item.zoneName).toBeTruthy();
      // Evidence frame is either a real inspection asset or honestly absent
      // (sensor/telemetry-only) — never a misleading stock image.
      if (item.evidence.imageUri !== undefined) {
        expect(item.evidence.imageUri).toMatch(/^\/assets\//);
        expect(item.evidence.imageUri).not.toMatch(/remote-operations/);
      }
      expect(["exception", "needs_review"]).toContain(item.kind);
    }
    // Decisions come from more than one situation (it is a cross-situation stream).
    const distinctSituations = new Set(queue.map((d) => d.situationId));
    expect(distinctSituations.size).toBeGreaterThan(1);
  });

  it("labels every decision RECORDED by default (honesty label)", async () => {
    const records = await buildAllRecords();
    const queue = buildDecisionQueue(records);
    expect(queue.every((d) => d.source === "RECORDED")).toBe(true);
  });

  it("surfaces the after-hours perimeter intrusion as a critical decision", async () => {
    const records = await buildAllRecords();
    const queue = buildDecisionQueue(records);
    const perimeter = queue.filter((d) => d.situationId === "perimeter_after_hours");
    expect(perimeter.length).toBeGreaterThan(0);
    expect(perimeter.some((d) => d.severity === "critical")).toBe(true);
  });

  it("is prioritized by severity then staleness (older first)", async () => {
    const records = await buildAllRecords();
    const queue = buildDecisionQueue(records);
    for (let i = 1; i < queue.length; i++) {
      const prev = queue[i - 1];
      const cur = queue[i];
      const prevSev = SEVERITY_RANK[prev.severity];
      const curSev = SEVERITY_RANK[cur.severity];
      expect(prevSev).toBeLessThanOrEqual(curSev);
      if (prevSev === curSev) {
        // older (lexicographically smaller ISO) must come first
        expect(prev.timestamp.localeCompare(cur.timestamp)).toBeLessThanOrEqual(0);
      }
    }
  });

  it("is deterministic — same input yields identical output", async () => {
    const records = await buildAllRecords();
    const a = buildDecisionQueue(records);
    const b = buildDecisionQueue(records);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("collapses repeated missing-coverage blockers by configured zone", async () => {
    const records = await buildAllRecords();
    const queue = buildDecisionQueue(records);
    const missing = queue.filter((item) => item.exceptionId?.startsWith("exception-missing-"));

    expect(missing.length).toBeGreaterThan(0);
    expect(missing.some((item) => (item.relatedCount ?? 0) > 1)).toBe(true);
    for (const item of missing) {
      expect(item.zoneId).toBeTruthy();
      expect(item.relatedSituationLabels?.length).toBe(item.relatedCount);
    }
  });
});

describe("prioritize", () => {
  it("orders critical before high before medium before low", () => {
    const base = {
      kind: "exception" as const,
      situationId: "solar_soiling_trend" as ScenarioId,
      situationLabel: "x",
      zoneName: "z",
      whatHappened: "w",
      sourceMachine: "m",
      timestamp: "2026-06-18T10:00:00-07:00",
      source: "RECORDED" as const,
      evidence: { imageUri: "/assets/remote-operations.png" }
    };
    const items: DecisionItem[] = [
      { ...base, id: "a", severity: "low" },
      { ...base, id: "b", severity: "critical" },
      { ...base, id: "c", severity: "medium" },
      { ...base, id: "d", severity: "high" }
    ];
    const ordered = prioritize(items).map((d) => d.severity);
    expect(ordered).toEqual(["critical", "high", "medium", "low"]);
  });

  it("breaks severity ties by older timestamp first", () => {
    const base = {
      kind: "exception" as const,
      situationId: "solar_soiling_trend" as ScenarioId,
      situationLabel: "x",
      zoneName: "z",
      whatHappened: "w",
      sourceMachine: "m",
      severity: "high" as const,
      source: "RECORDED" as const,
      evidence: { imageUri: "/assets/remote-operations.png" }
    };
    const items: DecisionItem[] = [
      { ...base, id: "newer", timestamp: "2026-06-18T12:00:00-07:00" },
      { ...base, id: "older", timestamp: "2026-06-18T08:00:00-07:00" }
    ];
    expect(prioritize(items).map((d) => d.id)).toEqual(["older", "newer"]);
  });
});

import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "../src/adapters/AdapterRegistry";
import { DjiCloudReadOnlyAdapter } from "../src/adapters/DjiCloudReadOnlyAdapter";
import { SimulatorAdapter } from "../src/adapters/SimulatorAdapter";
import { UnitreeReadOnlyAdapter } from "../src/adapters/UnitreeReadOnlyAdapter";
import { applyWorkOrderAction, createInitialLedger } from "../src/domain/operationLedger";
import { assessFreshness } from "../src/domain/freshness";
import { zoneContainsPoint } from "../src/domain/geometry";
import { evaluateReadiness } from "../src/domain/readiness";
import { siteGeometry } from "../src/data/geometry";
import { postAnalysisWindow } from "../src/data/postAnalysis";
import { summarizePostAnalysis } from "../src/domain/postAnalysis";
import { evaluateCommandIntent } from "../src/kernel/CommandSafetyPolicy";
import { EventIngestionService } from "../src/kernel/EventIngestionService";
import { FleetBrainKernel } from "../src/kernel/FleetBrainKernel";
import { FleetBrainStore } from "../src/kernel/FleetBrainStore";

describe("OS spine", () => {
  it("ingests events into an append-only store and dedupes replays", async () => {
    const store = new FleetBrainStore();
    const adapter = new SimulatorAdapter("seven_day_post_analysis");
    const ingestion = new EventIngestionService(store, adapter);

    const first = await ingestion.ingest("SITE-FPR-01");
    const second = await ingestion.ingest("SITE-FPR-01");

    expect(first.insertedCount).toBe(7);
    expect(second.insertedCount).toBe(0);
    expect(second.duplicateCount).toBe(7);
    expect(store.listAuditTrail("SITE-FPR-01")).toHaveLength(2);
  });

  it("registers adapters by site and reports degraded future integrations", async () => {
    const registry = new AdapterRegistry();
    registry.register("SITE-FPR-01", new SimulatorAdapter("seven_day_post_analysis"));
    registry.register("SITE-FPR-01", new DjiCloudReadOnlyAdapter({}));
    registry.register("SITE-FPR-01", new UnitreeReadOnlyAdapter({}));

    expect(registry.listReadOnly("SITE-FPR-01")).toHaveLength(3);
    const health = await registry.healthRollup("SITE-FPR-01");
    expect(health.some((item) => item.adapterId === "dji-cloud-readonly" && item.status === "degraded")).toBe(true);
    expect(health.some((item) => item.adapterId === "unitree-readonly" && item.status === "degraded")).toBe(true);
  });

  it("creates human work orders from exceptions and records operator actions", async () => {
    const record = await new FleetBrainKernel(new SimulatorAdapter("switchgear_access_gap")).buildCurrentSiteRecord("SITE-FPR-01");
    const ledger = createInitialLedger(record);
    const target = ledger.workOrders[0];

    const assigned = applyWorkOrderAction(ledger, {
      type: "assign",
      workOrderId: target.id,
      owner: "Field Ops",
      at: "2026-06-18T10:00:00-07:00"
    });

    expect(assigned.workOrders.find((item) => item.id === target.id)?.status).toBe("assigned");
    expect(assigned.workOrders.find((item) => item.id === target.id)?.owner).toBe("Field Ops");
    expect(assigned.audit[0].action).toBe("assign");
  });

  it("blocks hardware command intents while authority and adapters are read-only", async () => {
    const record = await new FleetBrainKernel(new SimulatorAdapter("bess_heat_regression")).buildCurrentSiteRecord("SITE-FPR-01");
    const decision = evaluateCommandIntent({
      intent: {
        id: "intent-001",
        type: "dispatch_machine",
        targetMachineId: "M-UAV-01",
        reason: "Follow-up inspection"
      },
      record,
      adapters: [new SimulatorAdapter("bess_heat_regression")]
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(" ")).toContain("read_only");
    expect(decision.reasons.join(" ")).toContain("No registered adapter");
  });

  it("evaluates readiness gates from the generated site record", async () => {
    const record = await new FleetBrainKernel(new SimulatorAdapter("switchgear_access_gap")).buildCurrentSiteRecord("SITE-FPR-01");
    const decision = evaluateReadiness(record);

    expect(decision.outcome).toBe("not_ready");
    expect(decision.gates.some((gate) => gate.id === "coverage" && gate.status === "fail")).toBe(true);
    expect(decision.requiredHumanActions.length).toBeGreaterThan(0);
  });

  it("treats old observations as stale even when ingestion is recent", () => {
    const freshness = assessFreshness(
      {
        observedAt: "2026-06-18T09:00:00-07:00",
        ttlSeconds: 600
      },
      "2026-06-18T09:45:00-07:00"
    );

    expect(freshness).toBe("stale");
  });

  it("uses site-local geometry instead of trusting location labels", () => {
    expect(zoneContainsPoint("Z-BESS", { x: 88, y: 30 }, siteGeometry.zones)).toBe(true);
    expect(zoneContainsPoint("Z-BESS", { x: 20, y: 24 }, siteGeometry.zones)).toBe(false);
  });

  it("summarizes multi-day retrieved artifacts into post-analysis workload", () => {
    const summary = summarizePostAnalysis(postAnalysisWindow);

    expect(summary.totalArtifacts).toBe(594);
    expect(summary.urgentOrActionCount).toBe(2);
    expect(summary.recurringCount).toBeGreaterThan(1);
    expect(summary.humanReviewCount).toBe(3);
  });
});

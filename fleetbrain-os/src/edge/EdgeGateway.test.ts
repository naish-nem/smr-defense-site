import { describe, expect, it } from "vitest";
import type { MachineEvent } from "../domain/types";
import { EdgeGateway } from "./EdgeGateway";
import { StoreAndForwardSpool } from "./StoreAndForwardSpool";
import { runSoak } from "./soakHarness";

const NOW = "2026-06-18T12:00:00.000Z";

function makeEvent(id: string, observedAt: string, ttlSeconds = 60): MachineEvent {
  return {
    id,
    sourceMachineId: "M-01",
    siteId: "site-1",
    timestamp: observedAt,
    eventType: "telemetry",
    locationLabel: "zone-a",
    rawStatus: "ok",
    confidence: 1,
    envelope: {
      observedAt,
      receivedAt: observedAt,
      adapterCheckedAt: observedAt,
      sourceClockSkewMs: 0,
      freshnessState: "unknown",
      ttlSeconds
    }
  };
}

/** Adapter that returns whatever batch it was last handed. */
class StubAdapter {
  readonly adapterId = "stub";
  readonly capabilities = {
    readMachineState: false,
    readRecentEvents: true,
    readMediaReferences: false,
    reportAdapterHealth: true,
    commandHardware: false as const
  };
  private batch: MachineEvent[] = [];
  setBatch(events: MachineEvent[]) {
    this.batch = events;
  }
  async readMachineState() {
    return [];
  }
  async readRecentEvents() {
    return this.batch;
  }
  async readMediaReferences() {
    return [];
  }
  async reportAdapterHealth() {
    return {
      adapterId: this.adapterId,
      status: "healthy" as const,
      message: "stub",
      checkedAt: NOW,
      missingInputs: []
    };
  }
}

describe("StoreAndForwardSpool", () => {
  it("enqueues and drains in FIFO order when up", () => {
    const spool = new StoreAndForwardSpool();
    spool.enqueue(makeEvent("e1", NOW), NOW);
    spool.enqueue(makeEvent("e2", NOW), NOW);
    spool.enqueue(makeEvent("e3", NOW), NOW);

    const drained = spool.drain(10, "up");
    expect(drained.map((d) => d.eventId)).toEqual(["e1", "e2", "e3"]);
    expect(spool.pendingCount()).toBe(0);
  });

  it("dedupes by event id", () => {
    const spool = new StoreAndForwardSpool();
    expect(spool.enqueue(makeEvent("dup", NOW), NOW)).not.toBeNull();
    expect(spool.enqueue(makeEvent("dup", NOW), NOW)).toBeNull();
    expect(spool.pendingCount()).toBe(1);
  });

  it("dedupes even after an event was already drained", () => {
    const spool = new StoreAndForwardSpool();
    spool.enqueue(makeEvent("e1", NOW), NOW);
    spool.drain(10, "up");
    // A flapping adapter re-offers the same id; must be rejected.
    expect(spool.enqueue(makeEvent("e1", NOW), NOW)).toBeNull();
    expect(spool.pendingCount()).toBe(0);
  });

  it("does not drain while degraded or partitioned", () => {
    const spool = new StoreAndForwardSpool();
    spool.enqueue(makeEvent("e1", NOW), NOW);
    spool.enqueue(makeEvent("e2", NOW), NOW);

    expect(spool.drain(10, "degraded")).toEqual([]);
    expect(spool.drain(10, "partitioned")).toEqual([]);
    expect(spool.pendingCount()).toBe(2);
  });

  it("respects the maxBatch cap and keeps remainder in order", () => {
    const spool = new StoreAndForwardSpool();
    for (let i = 0; i < 5; i++) spool.enqueue(makeEvent(`e${i}`, NOW), NOW);
    const first = spool.drain(2, "up");
    expect(first.map((d) => d.eventId)).toEqual(["e0", "e1"]);
    const rest = spool.drain(10, "up");
    expect(rest.map((d) => d.eventId)).toEqual(["e2", "e3", "e4"]);
  });
});

describe("EdgeGateway freshness stamping", () => {
  const gw = new EdgeGateway("gw-fresh");

  it("marks fresh when age < ttl*0.5", () => {
    // ttl 60s, age 10s -> fresh
    const observed = new Date(Date.parse(NOW) - 10_000).toISOString();
    expect(gw.computeFreshness(observed, NOW, 60).state).toBe("fresh");
  });

  it("marks aging at the ttl*0.5 boundary (age == half)", () => {
    // age exactly 30s with ttl 60 -> NOT < 30, so aging
    const observed = new Date(Date.parse(NOW) - 30_000).toISOString();
    expect(gw.computeFreshness(observed, NOW, 60).state).toBe("aging");
  });

  it("marks aging when half <= age < ttl", () => {
    const observed = new Date(Date.parse(NOW) - 45_000).toISOString();
    expect(gw.computeFreshness(observed, NOW, 60).state).toBe("aging");
  });

  it("marks stale at the ttl boundary (age == ttl)", () => {
    const observed = new Date(Date.parse(NOW) - 60_000).toISOString();
    expect(gw.computeFreshness(observed, NOW, 60).state).toBe("stale");
  });

  it("marks stale when age > ttl", () => {
    const observed = new Date(Date.parse(NOW) - 120_000).toISOString();
    expect(gw.computeFreshness(observed, NOW, 60).state).toBe("stale");
  });

  it("marks unknown on negative age (future clock skew)", () => {
    const observed = new Date(Date.parse(NOW) + 5_000).toISOString();
    expect(gw.computeFreshness(observed, NOW, 60).state).toBe("unknown");
  });

  it("marks unknown when observedAt is unparseable", () => {
    expect(gw.computeFreshness("not-a-date", NOW, 60).state).toBe("unknown");
  });

  it("stamps the computed envelope onto ingested events", async () => {
    const gateway = new EdgeGateway("gw-stamp");
    gateway.enroll("site-1", NOW);
    const adapter = new StubAdapter();
    const fresh = new Date(Date.parse(NOW) - 5_000).toISOString();
    const stale = new Date(Date.parse(NOW) - 90_000).toISOString();
    adapter.setBatch([makeEvent("a", fresh), makeEvent("b", stale)]);

    const res = await gateway.ingestFromAdapter(adapter, "site-1", NOW);
    expect(res.freshnessCounts.fresh).toBe(1);
    expect(res.freshnessCounts.stale).toBe(1);
    expect(res.enqueued[0].envelope?.receivedAt).toBe(NOW);
  });
});

describe("EdgeGateway store-and-forward through a partition", () => {
  it("buffers while partitioned and replays in order with zero loss on reconnect", async () => {
    const gateway = new EdgeGateway("gw-partition");
    gateway.enroll("site-1", NOW);
    const adapter = new StubAdapter();

    // Link goes down. Ingest three batches while partitioned.
    gateway.setLinkState("partitioned", NOW);
    adapter.setBatch([makeEvent("p1", NOW), makeEvent("p2", NOW)]);
    await gateway.ingestFromAdapter(adapter, "site-1", NOW);
    adapter.setBatch([makeEvent("p3", NOW)]);
    await gateway.ingestFromAdapter(adapter, "site-1", NOW);
    adapter.setBatch([makeEvent("p4", NOW), makeEvent("p5", NOW)]);
    await gateway.ingestFromAdapter(adapter, "site-1", NOW);

    // Nothing must have been delivered while down.
    expect(gateway.flushToCloud(NOW).delivered).toEqual([]);
    expect(gateway.status().spoolDepth).toBe(5);

    // Reconnect and drain.
    gateway.setLinkState("up", NOW);
    const flush = gateway.flushToCloud(NOW);
    expect(flush.delivered.map((e) => e.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(gateway.status().spoolDepth).toBe(0);
  });

  it("does not deliver while degraded either", async () => {
    const gateway = new EdgeGateway("gw-degraded");
    gateway.enroll("site-1", NOW);
    const adapter = new StubAdapter();
    gateway.setLinkState("degraded", NOW);
    adapter.setBatch([makeEvent("d1", NOW)]);
    await gateway.ingestFromAdapter(adapter, "site-1", NOW);
    expect(gateway.flushToCloud(NOW).delivered).toEqual([]);
    expect(gateway.status().spoolDepth).toBe(1);
  });

  it("audits link transitions but not no-op same-state calls", () => {
    const gateway = new EdgeGateway("gw-audit");
    gateway.enroll("site-1", NOW);
    const before = gateway.auditTrail().length;
    gateway.setLinkState("up", NOW); // no-op, already up
    expect(gateway.auditTrail().length).toBe(before);
    gateway.setLinkState("partitioned", NOW); // real transition
    expect(gateway.auditTrail().length).toBe(before + 1);
  });
});

describe("EdgeGateway soak", () => {
  it("survives 72h compressed with a brief partition: zero data loss, low link-loss ratio", async () => {
    // 2000 ticks over 72h. A single ~30-tick partition window keeps the
    // link-loss ratio well under 2%.
    const result = await runSoak({
      totalTicks: 2000,
      windowMs: 72 * 60 * 60 * 1000,
      startIso: "2026-06-18T00:00:00.000Z",
      seed: 1337,
      linkLossWindows: [
        { startTick: 900, endTick: 919, state: "partitioned" },
        { startTick: 1400, endTick: 1409, state: "degraded" }
      ],
      minEventsPerTick: 1,
      maxEventsPerTick: 4,
      ttlSeconds: 60
    });

    expect(result.dataLoss).toBe(false);
    expect(result.lostCount).toBe(0);
    expect(result.deliveredCount).toBe(result.generatedCount);
    expect(result.linkLossRatio).toBeLessThan(0.02);
    expect(result.maxSpoolDepth).toBeGreaterThan(0);
  });

  it("is reproducible for a given seed", async () => {
    const params = {
      totalTicks: 500,
      windowMs: 24 * 60 * 60 * 1000,
      startIso: "2026-06-18T00:00:00.000Z",
      seed: 42,
      linkLossWindows: [{ startTick: 100, endTick: 104, state: "partitioned" as const }]
    };
    const a = await runSoak(params);
    const b = await runSoak(params);
    expect(a).toEqual(b);
  });
});

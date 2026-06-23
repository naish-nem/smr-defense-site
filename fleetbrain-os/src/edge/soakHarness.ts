import type { AdapterCapabilities, AdapterHealth, Machine, MachineAdapter, MachineEvent } from "../domain/types";
import { EdgeGateway } from "./EdgeGateway";
import type { LinkState } from "./types";

/**
 * Deterministic soak harness for the edge gateway. Compresses a long wall-clock
 * window (e.g. 72h) into N evenly-spaced ticks. On each tick it: advances a
 * synthetic clock, generates events from a scripted adapter, ingests them,
 * applies a scripted link-loss schedule, then flushes to cloud. At the end it
 * forces the link up and drains so any backlog buffered during partitions is
 * delivered — proving zero data loss.
 *
 * No Math.random, no Date.now. Randomness comes from a seeded LCG so every run
 * is byte-for-byte reproducible.
 */

/** A scripted window during which the link is held in a non-`up` state. */
export interface LinkLossWindow {
  /** First tick index (inclusive) the window applies. */
  startTick: number;
  /** Last tick index (inclusive) the window applies. */
  endTick: number;
  /** Link state to hold during the window. */
  state: Exclude<LinkState, "up">;
}

export interface SoakParams {
  /** Number of discrete ticks to simulate. */
  totalTicks: number;
  /** Total wall-clock span the ticks represent, in milliseconds (e.g. 72h). */
  windowMs: number;
  /** ISO timestamp the simulated clock starts at. */
  startIso: string;
  /** RNG seed — same seed ⇒ identical run. */
  seed: number;
  /** Scripted link-loss windows (everything else is `up`). */
  linkLossWindows: LinkLossWindow[];
  /** Min events generated per tick (inclusive). */
  minEventsPerTick?: number;
  /** Max events generated per tick (inclusive). */
  maxEventsPerTick?: number;
  /** TTL stamped on generated events, seconds. */
  ttlSeconds?: number;
}

export interface SoakResult {
  totalTicks: number;
  deliveredCount: number;
  generatedCount: number;
  /** generated - delivered. Must be 0 for a healthy run. */
  lostCount: number;
  /** Fraction of ticks during which the link was NOT `up`. */
  linkLossRatio: number;
  maxSpoolDepth: number;
  /** True if any generated event failed to reach the cloud. */
  dataLoss: boolean;
}

/** Small seeded LCG (Numerical Recipes constants). Reproducible, dependency-free. */
class Lcg {
  private state: number;
  constructor(seed: number) {
    // Keep state in 32-bit unsigned range; avoid a zero fixed point.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }
  /** Next uint32. */
  nextUint(): number {
    // x_{n+1} = (a*x_n + c) mod 2^32
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }
  /** Float in [0, 1). */
  nextFloat(): number {
    return this.nextUint() / 0x100000000;
  }
  /** Integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }
}

const SOAK_CAPABILITIES: AdapterCapabilities = {
  readMachineState: true,
  readRecentEvents: true,
  readMediaReferences: false,
  reportAdapterHealth: true,
  commandHardware: false
};

/**
 * Scripted adapter whose event batch for the current tick is set externally by
 * the harness. Deterministic; never reads a clock.
 */
class SoakAdapter implements MachineAdapter {
  readonly adapterId = "soak-sim";
  readonly capabilities = SOAK_CAPABILITIES;
  private batch: MachineEvent[] = [];

  setBatch(events: MachineEvent[]): void {
    this.batch = events;
  }
  async readMachineState(): Promise<Machine[]> {
    return [];
  }
  async readRecentEvents(): Promise<MachineEvent[]> {
    return this.batch;
  }
  async readMediaReferences(): Promise<string[]> {
    return [];
  }
  async reportAdapterHealth(): Promise<AdapterHealth> {
    return {
      adapterId: this.adapterId,
      status: "healthy",
      message: "soak",
      checkedAt: "1970-01-01T00:00:00.000Z",
      missingInputs: []
    };
  }
}

function linkStateForTick(tick: number, windows: LinkLossWindow[]): LinkState {
  for (const w of windows) {
    if (tick >= w.startTick && tick <= w.endTick) {
      return w.state;
    }
  }
  return "up";
}

export async function runSoak(params: SoakParams): Promise<SoakResult> {
  const {
    totalTicks,
    windowMs,
    startIso,
    seed,
    linkLossWindows,
    minEventsPerTick = 1,
    maxEventsPerTick = 5,
    ttlSeconds = 60
  } = params;

  const rng = new Lcg(seed);
  const gateway = new EdgeGateway("soak-gw");
  const adapter = new SoakAdapter();

  const startMs = Date.parse(startIso);
  // Avoid div-by-zero for a single-tick run.
  const stepMs = totalTicks > 1 ? windowMs / (totalTicks - 1) : 0;

  gateway.enroll("site-soak", startIso, "soak run");

  let generatedCount = 0;
  let deliveredCount = 0;
  let lossTicks = 0;
  let eventSeq = 0;

  for (let tick = 0; tick < totalTicks; tick++) {
    const nowMs = startMs + Math.round(stepMs * tick);
    const nowIso = new Date(nowMs).toISOString();

    // Generate a scripted, seeded batch for this tick.
    const count = rng.nextInt(minEventsPerTick, maxEventsPerTick);
    const batch: MachineEvent[] = [];
    for (let i = 0; i < count; i++) {
      // Observed slightly before "now" so freshness is meaningful and varied.
      const ageMs = rng.nextInt(0, ttlSeconds * 1000);
      const observedIso = new Date(nowMs - ageMs).toISOString();
      batch.push({
        id: `soak-evt-${eventSeq++}`,
        sourceMachineId: "M-SOAK-01",
        siteId: "site-soak",
        timestamp: observedIso,
        eventType: "telemetry",
        locationLabel: "soak-zone",
        rawStatus: "ok",
        confidence: 1,
        envelope: {
          observedAt: observedIso,
          receivedAt: observedIso,
          adapterCheckedAt: observedIso,
          sourceClockSkewMs: 0,
          freshnessState: "unknown",
          ttlSeconds
        }
      });
    }
    generatedCount += batch.length;
    adapter.setBatch(batch);

    // Apply scripted link state for this tick (audits only real transitions).
    const link = linkStateForTick(tick, linkLossWindows);
    gateway.setLinkState(link, nowIso);
    if (link !== "up") {
      lossTicks += 1;
    }

    gateway.heartbeat(nowIso);

    // Ingest (always) then attempt a flush (only delivers when link is up).
    await gateway.ingestFromAdapter(adapter, "site-soak", nowIso);
    const flush = gateway.flushToCloud(nowIso);
    deliveredCount += flush.delivered.length;
  }

  // Reconnect and drain the entire backlog accrued during partitions.
  const finalMs = startMs + windowMs + 1000;
  const finalIso = new Date(finalMs).toISOString();
  gateway.setLinkState("up", finalIso);
  // Loop flush until the spool is empty (covers batch-cap on a deep backlog).
  for (;;) {
    const flush = gateway.flushToCloud(finalIso);
    deliveredCount += flush.delivered.length;
    if (flush.delivered.length === 0) {
      break;
    }
  }

  const lostCount = generatedCount - deliveredCount;
  return {
    totalTicks,
    deliveredCount,
    generatedCount,
    lostCount,
    linkLossRatio: totalTicks > 0 ? lossTicks / totalTicks : 0,
    maxSpoolDepth: gateway.maxSpoolDepth(),
    dataLoss: lostCount !== 0
  };
}

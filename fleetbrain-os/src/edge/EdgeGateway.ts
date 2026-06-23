import type {
  AuditEntry,
  FreshnessState,
  MachineAdapter,
  MachineEvent,
  TelemetryEnvelope
} from "../domain/types";
import { StoreAndForwardSpool } from "./StoreAndForwardSpool";
import type { EdgeStatus, EnrollmentRecord, FreshnessStampResult, LinkState } from "./types";

/** Default TTL applied when an event/adapter does not specify one (seconds). */
const DEFAULT_TTL_SECONDS = 60;
/** Max events released to the cloud per flush. */
const DEFAULT_FLUSH_BATCH = 256;

export interface IngestFromAdapterResult {
  /** Events pulled from the adapter this tick that were newly spooled. */
  enqueued: MachineEvent[];
  /** Events skipped because their id was already in the spool. */
  duplicates: MachineEvent[];
  /** Freshness breakdown across the events spooled this tick. */
  freshnessCounts: Record<FreshnessState, number>;
}

export interface FlushResult {
  /** Events drained from the spool and delivered to the cloud this flush. */
  delivered: MachineEvent[];
  /** Events still buffered after the flush (e.g. link not up, or batch cap). */
  remaining: number;
}

/**
 * Site-resident edge gateway (Phase 2). Sits between vendor adapters and the
 * cloud control plane. Its job: keep ingesting + stamping freshness even when
 * the WAN drops, buffer everything through partitions, and replay in order on
 * reconnect with zero data loss.
 *
 * Determinism (CLAUDE.md invariant 3): every method that needs "now" takes the
 * ISO timestamp as an argument. The gateway never calls Date.now()/new Date().
 */
export class EdgeGateway {
  private readonly spool = new StoreAndForwardSpool();
  private readonly audit: AuditEntry[] = [];

  private enrollment: EnrollmentRecord | null = null;
  private linkState: LinkState = "up";
  private lastHeartbeatAt: string | null = null;

  constructor(
    private readonly gatewayId: string,
    private readonly flushBatch: number = DEFAULT_FLUSH_BATCH
  ) {}

  // --- Lifecycle -----------------------------------------------------------

  /** Bind this gateway to a site. The trust anchor for everything it emits. */
  enroll(siteId: string, enrolledAt: string, note = ""): EnrollmentRecord {
    this.enrollment = { gatewayId: this.gatewayId, siteId, enrolledAt, note };
    this.appendAudit({
      timestamp: enrolledAt,
      action: "edge_enrolled",
      subjectRef: this.gatewayId,
      detail: `Gateway ${this.gatewayId} enrolled to site ${siteId}.`,
      after: { siteId, enrolledAt }
    });
    return { ...this.enrollment };
  }

  /** Record a liveness heartbeat at `nowIso`. */
  heartbeat(nowIso: string): EdgeStatus {
    this.lastHeartbeatAt = nowIso;
    return this.status();
  }

  // --- Link health ---------------------------------------------------------

  /**
   * Update WAN link state. Audits only genuine transitions (no noise on
   * repeated same-state calls). Transitions toward/away from `up` are the
   * notable ones — they gate whether the spool may drain.
   */
  setLinkState(state: LinkState, nowIso: string): EdgeStatus {
    const previous = this.linkState;
    if (previous === state) {
      return this.status();
    }
    this.linkState = state;
    this.appendAudit({
      timestamp: nowIso,
      action: "edge_link_transition",
      subjectRef: this.gatewayId,
      detail: `Link ${previous} -> ${state} (spoolDepth=${this.spool.pendingCount()}).`,
      before: { linkState: previous },
      after: { linkState: state, spoolDepth: this.spool.pendingCount() }
    });
    return this.status();
  }

  // --- Ingestion -----------------------------------------------------------

  /**
   * Pull recent events from an adapter, stamp each with a freshness-computed
   * TelemetryEnvelope (using `nowIso`), and enqueue into the spool. Works in any
   * link state — buffering is the whole point. Emits a single audit entry
   * summarizing the tick.
   */
  async ingestFromAdapter(
    adapter: MachineAdapter,
    siteId: string,
    nowIso: string
  ): Promise<IngestFromAdapterResult> {
    const events = await adapter.readRecentEvents(siteId);
    const enqueued: MachineEvent[] = [];
    const duplicates: MachineEvent[] = [];
    const freshnessCounts: Record<FreshnessState, number> = {
      fresh: 0,
      aging: 0,
      stale: 0,
      unknown: 0
    };

    for (const raw of events) {
      const stamped = this.stampEvent(raw, nowIso);
      const entry = this.spool.enqueue(stamped, nowIso);
      if (entry === null) {
        duplicates.push(raw);
        continue;
      }
      enqueued.push(stamped);
      freshnessCounts[stamped.envelope!.freshnessState] += 1;
    }

    this.appendAudit({
      timestamp: nowIso,
      action: "edge_ingest",
      subjectRef: adapter.adapterId,
      detail:
        `${enqueued.length} spooled, ${duplicates.length} dup from ${adapter.adapterId} ` +
        `(fresh=${freshnessCounts.fresh} aging=${freshnessCounts.aging} ` +
        `stale=${freshnessCounts.stale} unknown=${freshnessCounts.unknown}).`,
      after: {
        enqueuedCount: enqueued.length,
        duplicateCount: duplicates.length,
        spoolDepth: this.spool.pendingCount(),
        freshnessCounts
      }
    });

    return { enqueued, duplicates, freshnessCounts };
  }

  // --- Forward to cloud ----------------------------------------------------

  /**
   * Drain the spool to the cloud — but only when the link is `up`. Returns the
   * delivered events (already envelope-stamped). When the link is down/degraded
   * this is a no-op and the backlog is preserved for the next reconnect.
   */
  flushToCloud(nowIso: string): FlushResult {
    const drained = this.spool.drain(this.flushBatch, this.linkState);
    if (drained.length > 0) {
      this.appendAudit({
        timestamp: nowIso,
        action: "edge_flush",
        subjectRef: this.gatewayId,
        detail: `Delivered ${drained.length} events to cloud; ${this.spool.pendingCount()} remain.`,
        after: { deliveredCount: drained.length, remaining: this.spool.pendingCount() }
      });
    }
    return {
      delivered: drained.map((entry) => entry.event),
      remaining: this.spool.pendingCount()
    };
  }

  // --- Observability -------------------------------------------------------

  status(): EdgeStatus {
    return {
      gatewayId: this.gatewayId,
      siteId: this.enrollment?.siteId ?? "",
      linkState: this.linkState,
      lastHeartbeatAt: this.lastHeartbeatAt,
      spoolDepth: this.spool.pendingCount(),
      enrolledAt: this.enrollment?.enrolledAt ?? null
    };
  }

  /** Highest spool depth observed over the gateway's lifetime. */
  maxSpoolDepth(): number {
    return this.spool.maxDepth();
  }

  /** Append-only audit trail (newest last). */
  auditTrail(): AuditEntry[] {
    return [...this.audit];
  }

  // --- Freshness model -----------------------------------------------------

  /**
   * Compute freshness from observedAt vs now vs ttl.
   *   age = now - observedAt (seconds)
   *   fresh  if age < ttl * 0.5
   *   aging  if age < ttl
   *   stale  if age >= ttl
   *   unknown if observedAt is missing/unparseable, or age is negative
   *           (clock skew — observed "in the future").
   */
  computeFreshness(observedAtIso: string | undefined, nowIso: string, ttlSeconds: number): {
    state: FreshnessState;
    ageSeconds: number;
  } {
    const ttl = ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
    const observedMs = observedAtIso ? Date.parse(observedAtIso) : NaN;
    const nowMs = Date.parse(nowIso);
    if (Number.isNaN(observedMs) || Number.isNaN(nowMs)) {
      return { state: "unknown", ageSeconds: 0 };
    }
    const ageSeconds = (nowMs - observedMs) / 1000;
    if (ageSeconds < 0) {
      return { state: "unknown", ageSeconds };
    }
    let state: FreshnessState;
    if (ageSeconds < ttl * 0.5) {
      state = "fresh";
    } else if (ageSeconds < ttl) {
      state = "aging";
    } else {
      state = "stale";
    }
    return { state, ageSeconds };
  }

  /**
   * Build the freshness-stamped envelope for an event observed at `observedAtIso`,
   * received/checked at `nowIso`.
   */
  stampFreshness(
    observedAtIso: string,
    nowIso: string,
    ttlSeconds: number,
    base?: Partial<TelemetryEnvelope>
  ): FreshnessStampResult {
    const ttl = ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
    const { state, ageSeconds } = this.computeFreshness(observedAtIso, nowIso, ttl);
    const envelope: TelemetryEnvelope = {
      observedAt: observedAtIso,
      receivedAt: nowIso,
      adapterCheckedAt: nowIso,
      sourceClockSkewMs: base?.sourceClockSkewMs ?? 0,
      freshnessState: state,
      ttlSeconds: ttl,
      sequenceId: base?.sequenceId,
      droppedSampleCount: base?.droppedSampleCount
    };
    return { envelope, ageSeconds };
  }

  // --- internals -----------------------------------------------------------

  /** Stamp a raw event with a freshness envelope, preserving any prior envelope hints. */
  private stampEvent(raw: MachineEvent, nowIso: string): MachineEvent {
    const prior = raw.envelope;
    const observedAt = prior?.observedAt ?? raw.timestamp;
    const ttl = prior?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const { envelope } = this.stampFreshness(observedAt, nowIso, ttl, prior);
    return { ...raw, envelope };
  }

  /** Append a deterministic-id audit entry (actor fixed to "system" for the edge plane). */
  private appendAudit(partial: Omit<AuditEntry, "id" | "actor">): void {
    const seq = this.audit.length;
    this.audit.push({
      id: `audit-${partial.action}-${this.gatewayId}-${partial.timestamp}-${seq}`,
      actor: "system",
      ...partial
    });
  }
}

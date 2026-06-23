import type { MachineEvent, TelemetryEnvelope } from "../domain/types";

/**
 * Edge-local types for the Phase 2 site gateway. These are co-located here
 * (not in domain/types.ts) because they describe edge-runtime concerns —
 * link health, the store-and-forward spool, enrollment — that the cloud
 * control plane never manipulates directly. Shared shapes (MachineEvent,
 * TelemetryEnvelope) are imported from the domain spine.
 */

/**
 * WAN link health between the site gateway and the cloud control plane.
 * - `up`         — link healthy; spool may drain to cloud.
 * - `degraded`   — link is flaky/high-latency; treat as not-deliverable, keep buffering.
 * - `partitioned`— WAN is down; everything is buffered locally, nothing drains.
 *
 * Real-time safety never depends on this link (see CLAUDE.md invariant 5/edge plane);
 * the gateway must keep ingesting and stamping freshness regardless of link state.
 */
export type LinkState = "up" | "degraded" | "partitioned";

/**
 * A single buffered telemetry event awaiting forward to the cloud. The spool is a
 * durable-in-memory FIFO; entries are kept in arrival order and deduped by event id.
 */
export interface SpoolEntry {
  /** Stable id of the underlying event — used for dedupe. */
  eventId: string;
  /** Monotonic spool sequence assigned at enqueue time (FIFO ordering key). */
  spoolSeq: number;
  /** ISO timestamp at which the gateway accepted the event into the spool. */
  enqueuedAt: string;
  /** The event itself, already carrying a stamped TelemetryEnvelope. */
  event: MachineEvent;
}

/**
 * Record of a gateway/site binding. Produced by EdgeGateway.enroll and surfaced
 * via EdgeStatus. Enrollment is the trust anchor for everything the gateway emits.
 */
export interface EnrollmentRecord {
  gatewayId: string;
  siteId: string;
  enrolledAt: string;
  /** Free-text site/operator note captured at enrollment time. */
  note: string;
}

/**
 * Point-in-time snapshot of gateway health, suitable for the operator console
 * and for cloud-side liveness checks.
 */
export interface EdgeStatus {
  gatewayId: string;
  siteId: string;
  linkState: LinkState;
  /** ISO timestamp of the most recent heartbeat, or null before the first one. */
  lastHeartbeatAt: string | null;
  /** Number of events currently buffered in the spool (un-forwarded). */
  spoolDepth: number;
  /** ISO timestamp at which this gateway was enrolled, or null if not yet enrolled. */
  enrolledAt: string | null;
}

/** Result of stamping freshness onto an event, surfaced for audit/debug. */
export interface FreshnessStampResult {
  envelope: TelemetryEnvelope;
  ageSeconds: number;
}

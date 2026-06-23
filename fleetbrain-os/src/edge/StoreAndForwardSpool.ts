import type { MachineEvent } from "../domain/types";
import type { LinkState, SpoolEntry } from "./types";

/**
 * Durable-in-memory store-and-forward spool for the edge gateway.
 *
 * Contract (the zero-data-loss guarantee):
 * - `enqueue` accepts events in any link state and keeps them in strict FIFO
 *   arrival order, deduping by event id (an event already spooled or already
 *   drained is never buffered twice).
 * - `drain` only releases events when the link is `up`. While `degraded` or
 *   `partitioned`, the spool holds everything — nothing is dropped or expired.
 * - On reconnect (link returns to `up`), `drain` releases the backlog in the
 *   same order it arrived, oldest first.
 *
 * This is "durable-in-memory": within a running gateway process it never loses
 * a buffered event. A real deployment would back this with an append-only
 * on-disk WAL; the in-memory FIFO here models the same ordering/dedupe invariants.
 */
export class StoreAndForwardSpool {
  /** Buffered, not-yet-drained entries in FIFO (ascending spoolSeq) order. */
  private readonly buffer: SpoolEntry[] = [];
  /** Every event id ever accepted (buffered OR already drained) — dedupe set. */
  private readonly seenEventIds = new Set<string>();
  /** Monotonic counter assigning FIFO ordering keys. */
  private nextSeq = 0;
  /** High-water mark of buffer depth, for soak/observability. */
  private maxDepthSeen = 0;

  /**
   * Buffer an event for later forward. Idempotent by event id.
   * @returns the created SpoolEntry, or null if the event id was already seen.
   */
  enqueue(event: MachineEvent, enqueuedAt: string): SpoolEntry | null {
    if (this.seenEventIds.has(event.id)) {
      return null;
    }
    const entry: SpoolEntry = {
      eventId: event.id,
      spoolSeq: this.nextSeq++,
      enqueuedAt,
      event
    };
    this.seenEventIds.add(event.id);
    this.buffer.push(entry);
    if (this.buffer.length > this.maxDepthSeen) {
      this.maxDepthSeen = this.buffer.length;
    }
    return entry;
  }

  /**
   * Release up to `maxBatch` oldest buffered events — but ONLY when the link is
   * `up`. In any other link state this returns an empty array and the buffer is
   * untouched (store-and-forward holds the line through partitions).
   *
   * Drained event ids remain in the dedupe set so a re-delivered duplicate from
   * a flapping adapter is still rejected by `enqueue`.
   */
  drain(maxBatch: number, linkState: LinkState): SpoolEntry[] {
    if (linkState !== "up") {
      return [];
    }
    if (maxBatch <= 0) {
      return [];
    }
    const taken = this.buffer.splice(0, maxBatch);
    return taken;
  }

  /** Number of events currently buffered (un-forwarded). */
  pendingCount(): number {
    return this.buffer.length;
  }

  /** Highest buffer depth observed over the spool's lifetime. */
  maxDepth(): number {
    return this.maxDepthSeen;
  }

  /** True if an event id has ever been accepted (buffered or drained). */
  hasSeen(eventId: string): boolean {
    return this.seenEventIds.has(eventId);
  }

  /** Read-only view of the current backlog, oldest first. */
  peek(): readonly SpoolEntry[] {
    return [...this.buffer];
  }
}

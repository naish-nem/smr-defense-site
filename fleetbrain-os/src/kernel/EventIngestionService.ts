import type { AdapterHealth, MachineAdapter, MachineEvent } from "../domain/types";
import { FleetBrainStore } from "./FleetBrainStore";

export interface IngestionResult {
  events: MachineEvent[];
  health: AdapterHealth;
  insertedCount: number;
  duplicateCount: number;
}

export class EventIngestionService {
  constructor(
    private store: FleetBrainStore,
    private adapter: MachineAdapter
  ) {}

  async ingest(siteId: string): Promise<IngestionResult> {
    const [events, health] = await Promise.all([
      this.adapter.readRecentEvents(siteId),
      this.adapter.reportAdapterHealth()
    ]);
    const result = this.store.appendEvents(siteId, events);

    this.store.appendAuditEntry(siteId, {
      id: `audit-ingest-${this.adapter.adapterId}-${health.checkedAt}-${result.inserted.length}-${result.duplicates.length}`,
      timestamp: health.checkedAt,
      actor: "EventIngestionService",
      action: "events_ingested",
      subjectRef: this.adapter.adapterId,
      detail: `${result.inserted.length} inserted, ${result.duplicates.length} duplicates from ${this.adapter.adapterId}.`,
      after: {
        insertedCount: result.inserted.length,
        duplicateCount: result.duplicates.length
      }
    });

    return {
      events: this.store.listEvents(siteId),
      health,
      insertedCount: result.inserted.length,
      duplicateCount: result.duplicates.length
    };
  }
}

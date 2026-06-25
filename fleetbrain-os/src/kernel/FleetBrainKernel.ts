import type { MachineAdapter, SiteRecord } from "../domain/types";
import { buildSiteRecord } from "../domain/siteRecordBuilder";
import { EventIngestionService } from "./EventIngestionService";
import { FleetBrainStore } from "./FleetBrainStore";
import { chainAuditTrail } from "./auditTrailChain";

export class FleetBrainKernel {
  constructor(
    private adapter: MachineAdapter,
    private store = new FleetBrainStore()
  ) {}

  async buildCurrentSiteRecord(siteId: string): Promise<SiteRecord> {
    const ingestion = new EventIngestionService(this.store, this.adapter);
    const [machines, result] = await Promise.all([
      this.adapter.readMachineState(siteId),
      ingestion.ingest(siteId)
    ]);

    const record = buildSiteRecord({
      machines,
      events: result.events,
      generatedAt: result.health.checkedAt,
      adapterHealth: result.health.status
    });

    const hashedEntries = chainAuditTrail([
      ...record.auditTrail,
      ...this.store.listAuditTrail(siteId)
    ]);

    this.store.saveSiteRecord({
      ...record,
      auditTrail: hashedEntries
    });

    return this.store.getLatestSiteRecord(siteId) ?? record;
  }
}

import type { AuditEntry, MachineEvent, SiteRecord } from "../domain/types";

export class FleetBrainStore {
  private eventsBySite = new Map<string, MachineEvent[]>();
  private auditBySite = new Map<string, AuditEntry[]>();
  private recordsBySite = new Map<string, SiteRecord>();

  appendEvents(siteId: string, events: MachineEvent[]): { inserted: MachineEvent[]; duplicates: MachineEvent[] } {
    const existing = this.eventsBySite.get(siteId) ?? [];
    const existingIds = new Set(existing.map((event) => event.id));
    const inserted = events.filter((event) => !existingIds.has(event.id));
    const duplicates = events.filter((event) => existingIds.has(event.id));

    this.eventsBySite.set(siteId, [...existing, ...inserted].sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
    return { inserted, duplicates };
  }

  listEvents(siteId: string): MachineEvent[] {
    return [...(this.eventsBySite.get(siteId) ?? [])];
  }

  appendAuditEntry(siteId: string, entry: AuditEntry): void {
    this.auditBySite.set(siteId, [entry, ...(this.auditBySite.get(siteId) ?? [])]);
  }

  listAuditTrail(siteId: string): AuditEntry[] {
    return [...(this.auditBySite.get(siteId) ?? [])];
  }

  saveSiteRecord(record: SiteRecord): void {
    this.recordsBySite.set(record.site.id, record);
  }

  getLatestSiteRecord(siteId: string): SiteRecord | undefined {
    return this.recordsBySite.get(siteId);
  }
}

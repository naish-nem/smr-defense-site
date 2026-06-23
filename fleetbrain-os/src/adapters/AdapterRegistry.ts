import type { AdapterHealth, MachineAdapter } from "../domain/types";

export class AdapterRegistry {
  private adaptersBySite = new Map<string, MachineAdapter[]>();

  register(siteId: string, adapter: MachineAdapter): void {
    const adapters = this.adaptersBySite.get(siteId) ?? [];
    const withoutDuplicate = adapters.filter((item) => item.adapterId !== adapter.adapterId);
    this.adaptersBySite.set(siteId, [...withoutDuplicate, adapter]);
  }

  list(siteId: string): MachineAdapter[] {
    return [...(this.adaptersBySite.get(siteId) ?? [])];
  }

  listReadOnly(siteId: string): MachineAdapter[] {
    return this.list(siteId).filter((adapter) => adapter.capabilities.commandHardware === false);
  }

  async healthRollup(siteId: string): Promise<AdapterHealth[]> {
    return Promise.all(this.list(siteId).map((adapter) => adapter.reportAdapterHealth()));
  }
}

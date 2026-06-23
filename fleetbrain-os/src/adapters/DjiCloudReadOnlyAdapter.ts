import type { AdapterCapabilities, AdapterHealth, Machine, MachineAdapter, MachineEvent } from "../domain/types";

const capabilities: AdapterCapabilities = {
  readMachineState: true,
  readRecentEvents: true,
  readMediaReferences: true,
  reportAdapterHealth: true,
  commandHardware: false
};

export interface DjiCloudConfig {
  workspaceId?: string;
  appId?: string;
  appKey?: string;
  mqttBrokerUrl?: string;
  mediaBucketUrl?: string;
  checkedAtIso?: string;
  machineState?: Machine[];
  recentEvents?: MachineEvent[];
  mediaReferences?: string[];
}

export class DjiCloudReadOnlyAdapter implements MachineAdapter {
  readonly adapterId = "dji-cloud-readonly";
  readonly capabilities = capabilities;

  constructor(private config: DjiCloudConfig) {}

  async readMachineState(_siteId: string): Promise<Machine[]> {
    this.assertConfigured();
    return (this.config.machineState ?? []).map((machine) => ({ ...machine }));
  }

  async readRecentEvents(_siteId: string): Promise<MachineEvent[]> {
    this.assertConfigured();
    return (this.config.recentEvents ?? []).map((event) => ({ ...event }));
  }

  async readMediaReferences(_siteId: string): Promise<string[]> {
    this.assertConfigured();
    return [...(this.config.mediaReferences ?? [])];
  }

  async reportAdapterHealth(): Promise<AdapterHealth> {
    const checks: Array<[string, string | undefined]> = [
      ["workspaceId", this.config.workspaceId],
      ["appId", this.config.appId],
      ["appKey", this.config.appKey],
      ["mqttBrokerUrl", this.config.mqttBrokerUrl],
      ["mediaBucketUrl", this.config.mediaBucketUrl]
    ];
    const missingInputs = checks.filter(([, value]) => !value).map(([key]) => key);

    return {
      adapterId: this.adapterId,
      status: missingInputs.length ? "degraded" : "healthy",
      message: missingInputs.length
        ? "DJI Cloud adapter is waiting for real workspace, MQTT, and media credentials."
        : "DJI Cloud credentials are present; returning configured normalized snapshots.",
      checkedAt: this.config.checkedAtIso ?? "1970-01-01T00:00:00.000Z",
      missingInputs
    };
  }

  private assertConfigured(): void {
    const required: Array<keyof DjiCloudConfig> = ["workspaceId", "appId", "appKey", "mqttBrokerUrl", "mediaBucketUrl"];
    const missing = required.filter((key) => !this.config[key]);
    if (missing.length) {
      throw new Error(`DJI Cloud adapter missing required inputs: ${missing.join(", ")}`);
    }
  }
}

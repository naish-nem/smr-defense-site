import type { AdapterCapabilities, AdapterHealth, Machine, MachineAdapter, MachineEvent } from "../domain/types";

const capabilities: AdapterCapabilities = {
  readMachineState: true,
  readRecentEvents: true,
  readMediaReferences: true,
  reportAdapterHealth: true,
  commandHardware: false
};

export interface UnitreeConfig {
  robotIp?: string;
  sdkMode?: "sdk2" | "webrtc";
  siteId?: string;
  checkedAtIso?: string;
  machineState?: Machine[];
  recentEvents?: MachineEvent[];
  mediaReferences?: string[];
}

export class UnitreeReadOnlyAdapter implements MachineAdapter {
  readonly adapterId: string;
  readonly capabilities = capabilities;

  /** `adapterId` defaults to the vendor class id; hardware onboarding passes a
   * per-unit id (e.g. "unitree-readonly:M-UGV-02") so multiple Unitree units can
   * coexist in the AdapterRegistry without evicting each other. */
  constructor(private config: UnitreeConfig, adapterId = "unitree-readonly") {
    this.adapterId = adapterId;
  }

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
      ["robotIp", this.config.robotIp],
      ["sdkMode", this.config.sdkMode],
      ["siteId", this.config.siteId]
    ];
    const missingInputs = checks.filter(([, value]) => !value).map(([key]) => key);

    return {
      adapterId: this.adapterId,
      status: missingInputs.length ? "degraded" : "healthy",
      message: missingInputs.length
        ? "Unitree adapter is waiting for robot network access and SDK mode."
        : "Unitree connection settings are present; returning configured normalized snapshots.",
      checkedAt: this.config.checkedAtIso ?? "1970-01-01T00:00:00.000Z",
      missingInputs
    };
  }

  private assertConfigured(): void {
    const required: Array<keyof UnitreeConfig> = ["robotIp", "sdkMode", "siteId"];
    const missing = required.filter((key) => !this.config[key]);
    if (missing.length) {
      console.warn(`Unitree adapter warning: missing required inputs: ${missing.join(", ")}. Degrading gracefully.`);
    }
  }
}

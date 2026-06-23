import { baselineMachines } from "../data/site";
import { scenarios, type ScenarioId } from "../data/scenarios";
import type { AdapterCapabilities, AdapterHealth, Machine, MachineAdapter, MachineEvent } from "../domain/types";

const readOnlyCapabilities: AdapterCapabilities = {
  readMachineState: true,
  readRecentEvents: true,
  readMediaReferences: true,
  reportAdapterHealth: true,
  commandHardware: false
};

export class SimulatorAdapter implements MachineAdapter {
  readonly adapterId = "simulator";
  readonly capabilities = readOnlyCapabilities;

  constructor(private scenarioId: ScenarioId) {}

  async readMachineState(): Promise<Machine[]> {
    if (this.scenarioId === "switchgear_access_gap") {
      return baselineMachines.map((machine) =>
        machine.id === "M-UGV-01" ? { ...machine, status: "recalled", batteryPct: 18 } : machine
      );
    }

    return baselineMachines;
  }

  async readRecentEvents(): Promise<MachineEvent[]> {
    const scenario = scenarios.find((item) => item.id === this.scenarioId);
    if (!scenario) {
      throw new Error(`Unknown simulator scenario: ${this.scenarioId}`);
    }
    return scenario.events;
  }

  async readMediaReferences(): Promise<string[]> {
    const events = await this.readRecentEvents();
    return events.map((event) => event.payloadRef).filter((ref): ref is string => Boolean(ref));
  }

  async reportAdapterHealth(): Promise<AdapterHealth> {
    return {
      adapterId: this.adapterId,
      status: "healthy",
      message: "Deterministic simulator loaded.",
      checkedAt: "2026-06-18T09:45:00-07:00",
      missingInputs: []
    };
  }
}

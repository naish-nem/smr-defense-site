import type {
  AdapterHealth,
  Machine,
  MachineEvent
} from "../domain/types";
import type { CommandControlLevel, SitePoint } from "./types";

/**
 * GuardedSimulatorAdapter — a Unitree-class, command-CAPABLE adapter for the sim
 * harness. It implements the MachineAdapter read surface AND exposes guarded
 * command methods (dispatch / recall / safeState). It performs NO real hardware
 * I/O: commands only LOG/record into an in-memory ledger so tests and the demo can
 * assert the arbiter authorized them.
 *
 * SAFETY-CLASS NOTE (CLAUDE.md invariant 5 — "DJI != Unitree safety class"):
 *  - This adapter models a Unitree/DEEP quadruped: safeState() is a DETERMINISTIC,
 *    INSTANT LAN call. We OWN the failsafe; calling it stops the unit synchronously
 *    and the result is known immediately.
 *  - A DJI-class aircraft would NOT look like this. Its safe_state is a MEDIATED,
 *    NON-DETERMINISTIC request: the real failsafe is firmware Return-To-Home, which
 *    is OWNED BY THE AIRCRAFT, not by us. We would only OBSERVE the outcome (RTH
 *    initiated / completed) via telemetry — never synchronously assert it. Never
 *    pretend one interface covers both classes.
 *
 * NOTE on the capabilities type: domain/types currently pins
 * AdapterCapabilities.commandHardware to the literal `false` (read-only spine). A
 * command-capable adapter therefore carries an extended capability shape. We model
 * that locally rather than mutate the shared spine (do-not-modify-existing-files).
 * The class still satisfies the MachineAdapter READ contract structurally (same
 * read-method signatures), so it is assignable to MachineAdapter for read use via
 * `asReadAdapter()`. It deliberately does NOT `implements MachineAdapter`, because
 * that interface pins commandHardware:false and we need true.
 */

export type GuardedCommandKind = "dispatch" | "recall" | "safeState";

export interface GuardedCommandLogEntry {
  kind: GuardedCommandKind;
  machineId: string;
  at: string;
  detail: string;
  /** safeState is deterministic for this Unitree-class adapter. */
  deterministic: boolean;
}

export interface GuardedAdapterCapabilities {
  readMachineState: true;
  readRecentEvents: true;
  readMediaReferences: true;
  reportAdapterHealth: true;
  commandHardware: true;
  supportedControlLevels: CommandControlLevel[];
}

export class GuardedSimulatorAdapter {
  readonly adapterId: string;
  readonly capabilities: GuardedAdapterCapabilities;

  private readonly machines: Machine[];
  private readonly siteId: string;
  private readonly log: GuardedCommandLogEntry[] = [];

  constructor(params: {
    adapterId?: string;
    siteId: string;
    machines: Machine[];
    supportedControlLevels?: CommandControlLevel[];
  }) {
    this.adapterId = params.adapterId ?? "adapter-guarded-sim";
    this.siteId = params.siteId;
    this.machines = params.machines;
    this.capabilities = {
      readMachineState: true,
      readRecentEvents: true,
      readMediaReferences: true,
      reportAdapterHealth: true,
      commandHardware: true,
      supportedControlLevels: params.supportedControlLevels ?? ["observe", "guarded"]
    };
  }

  // --- MachineAdapter read surface ----------------------------------------

  async readMachineState(_siteId: string): Promise<Machine[]> {
    return this.machines;
  }

  async readRecentEvents(_siteId: string): Promise<MachineEvent[]> {
    return [];
  }

  async readMediaReferences(_siteId: string): Promise<string[]> {
    return [];
  }

  async reportAdapterHealth(): Promise<AdapterHealth> {
    return {
      adapterId: this.adapterId,
      status: "healthy",
      message: "guarded simulator adapter online",
      checkedAt: "1970-01-01T00:00:00.000Z",
      missingInputs: []
    };
  }

  // --- Guarded command surface (log-only; no real hardware) ----------------

  /**
   * Dispatch the unit toward a destination. Only invoked AFTER the arbiter allows.
   * Records intent; does not move anything.
   */
  dispatch(machineId: string, destination: SitePoint, nowIso: string): GuardedCommandLogEntry {
    return this.append({
      kind: "dispatch",
      machineId,
      at: nowIso,
      detail: `dispatch to (${destination.x},${destination.y})`,
      deterministic: true
    });
  }

  /** Recall the unit to its dock. Deterministic for this class. */
  recall(machineId: string, nowIso: string): GuardedCommandLogEntry {
    return this.append({
      kind: "recall",
      machineId,
      at: nowIso,
      detail: "recall to dock",
      deterministic: true
    });
  }

  /**
   * safeState — Unitree-class: DETERMINISTIC and INSTANT. Returns synchronously with
   * a known outcome. (A DJI-class adapter would instead return an "RTH requested"
   * acknowledgement and we'd observe completion asynchronously via telemetry.)
   */
  safeState(machineId: string, nowIso: string): GuardedCommandLogEntry {
    return this.append({
      kind: "safeState",
      machineId,
      at: nowIso,
      detail: "deterministic LAN safe-state: motors disabled, hold position",
      deterministic: true
    });
  }

  getCommandLog(): readonly GuardedCommandLogEntry[] {
    return this.log;
  }

  /**
   * Expose the read surface for code that only needs the read-only MachineAdapter
   * contract (registry, ingestion). Returns a structurally-typed view; this adapter
   * is command-capable but its reads are identical in shape to a read-only adapter.
   */
  asReadAdapter(): {
    adapterId: string;
    readMachineState(siteId: string): Promise<Machine[]>;
    readRecentEvents(siteId: string): Promise<MachineEvent[]>;
    readMediaReferences(siteId: string): Promise<string[]>;
    reportAdapterHealth(): Promise<AdapterHealth>;
  } {
    return this;
  }

  private append(entry: GuardedCommandLogEntry): GuardedCommandLogEntry {
    this.log.push(entry);
    return entry;
  }
}

import type { AuditEntry, Machine, MachineAdapter, SitePoint } from "../domain/types";
import { AdapterRegistry } from "../adapters/AdapterRegistry";
import { UnitreeReadOnlyAdapter, type UnitreeConfig } from "../adapters/UnitreeReadOnlyAdapter";
import { DjiCloudReadOnlyAdapter, type DjiCloudConfig } from "../adapters/DjiCloudReadOnlyAdapter";
import { dockForKind } from "../data/docks";
import { getHardwareProfile, type SafetyClass } from "./hardwareProfile";

/**
 * Hardware onboarding: turn a profile + connection config into a registered,
 * safety-classed read-only `Machine`. Construction goes through the vendor's
 * read-only adapter and registers it in the AdapterRegistry — nothing here can
 * command hardware (invariant 1), and DJI/Unitree keep distinct safety classes
 * (invariant 5, carried on the profile).
 *
 * Incomplete config does NOT throw: the adapter degrades (it warns and reports
 * `degraded` health), and `validation.missingKeys` surfaces what's still needed.
 * Timestamp is passed in (invariant 3).
 */

interface OnboardHardwareBase {
  machineId: string;
  label: string;
  batteryPct?: number;
  /** Explicit dock point; if omitted, the dock that serves this kind is used. */
  dockPoint?: SitePoint;
}

/**
 * Discriminated on `profileId` so the compiler forces the config shape to match
 * the profile — a DJI config can no longer be passed to a Unitree profile.
 */
export type OnboardHardwareInput =
  | (OnboardHardwareBase & { profileId: "unitree-go2"; config: UnitreeConfig })
  | (OnboardHardwareBase & { profileId: "dji-dock2-m3d"; config: DjiCloudConfig });

export interface OnboardHardwareResult {
  machine: Machine;
  adapter: MachineAdapter;
  dockLocation?: { machineId: string; point: SitePoint };
  audit: AuditEntry[];
  validation: { ok: boolean; missingKeys: string[] };
  safetyClass: SafetyClass;
}

/**
 * Per-unit adapter id so multiple same-vendor units coexist in the registry
 * (which dedupes by adapterId) instead of evicting one another.
 */
function adapterIdFor(input: OnboardHardwareInput): string {
  return `${getHardwareProfile(input.profileId).adapterKind}:${input.machineId}`;
}

function buildAdapter(input: OnboardHardwareInput): MachineAdapter {
  const adapterId = adapterIdFor(input);
  switch (input.profileId) {
    case "unitree-go2":
      return new UnitreeReadOnlyAdapter(input.config, adapterId);
    case "dji-dock2-m3d":
      return new DjiCloudReadOnlyAdapter(input.config, adapterId);
  }
}

export function onboardHardware(
  input: OnboardHardwareInput,
  opts: { siteId: string; now: string; registry: AdapterRegistry }
): OnboardHardwareResult {
  const { siteId, now, registry } = opts;
  const profile = getHardwareProfile(input.profileId);

  const cfg = input.config as Record<string, unknown>;
  const missingKeys = profile.requiredConfigKeys.filter((key) => !cfg[key]);
  const validation = { ok: missingKeys.length === 0, missingKeys };

  const adapter = buildAdapter(input);
  // Defensive guard for invariant 1: a registered adapter must be read-only.
  if (adapter.capabilities.commandHardware !== false) {
    throw new Error(`Refusing to onboard command-capable adapter "${adapter.adapterId}" via onboardHardware.`);
  }
  registry.register(siteId, adapter);

  const dockPoint = input.dockPoint ?? dockForKind(profile.kind)?.location;
  const dockLocation = dockPoint ? { machineId: input.machineId, point: dockPoint } : undefined;

  const machine: Machine = {
    id: input.machineId,
    label: input.label,
    kind: profile.kind,
    vendor: profile.vendor,
    model: profile.model,
    // A freshly installed unit with a known dock starts docked; without a
    // resolved dock we can't claim that, so it's merely available.
    status: dockLocation ? "docked" : "available",
    batteryPct: input.batteryPct
  };

  const audit: AuditEntry[] = [
    {
      id: `audit-hardware_onboard-${input.machineId}-${now}`,
      timestamp: now,
      actor: "operator",
      action: "hardware_onboard",
      subjectRef: input.machineId,
      detail:
        `Onboarded ${profile.vendor} ${profile.model} (${profile.kind}, ${profile.safetyClass}) as ${input.machineId} ` +
        `via ${adapter.adapterId}` +
        (validation.ok ? "." : `; awaiting config: ${missingKeys.join(", ")}.`)
    }
  ];

  return { machine, adapter, dockLocation, audit, validation, safetyClass: profile.safetyClass };
}

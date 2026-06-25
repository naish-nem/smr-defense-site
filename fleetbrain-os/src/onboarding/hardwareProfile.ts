import type { MachineKind, Machine } from "../domain/types";

/**
 * Catalogue of field-deployable hardware FleetBrain can onboard. A profile maps
 * a vendor + model to the machine kind, the read-only adapter that speaks to it,
 * its required connection config, and its SAFETY CLASS.
 *
 * Invariant 5 (CLAUDE.md): DJI and Unitree are NOT the same safety class. A
 * Unitree/DEEP `safe_state` is a deterministic LAN call; a DJI failsafe is the
 * aircraft's own RTH firmware, which we observe rather than own. That difference
 * is modeled here as `safetyClass`, never collapsed into one interface.
 *
 * Every profile is read-only (`commandHardware: false`, invariant 1). The
 * Simulator adapter is intentionally absent — it is a dev/test harness, not
 * hardware deployed to a site.
 */

export type SafetyClass = "deterministic_lan" | "mediated_observed";

export type OnboardingAdapterKind = "unitree-readonly" | "dji-cloud-readonly";

export type HardwareProfileId = "unitree-go2" | "dji-dock2-m3d";

export interface HardwareProfile {
  id: HardwareProfileId;
  vendor: Machine["vendor"];
  model: string;
  kind: MachineKind;
  adapterKind: OnboardingAdapterKind;
  safetyClass: SafetyClass;
  /**
   * Config keys that must be present for the adapter to report healthy. These
   * MUST mirror the keys the matching adapter checks in its own
   * `reportAdapterHealth` (UnitreeReadOnlyAdapter / DjiCloudReadOnlyAdapter) —
   * the `onboardHardware` test asserts the two agree so they can't drift.
   */
  requiredConfigKeys: string[];
  /**
   * Allowed values for enum-typed config keys, so the UI can render a select
   * instead of free text (and not launder an invalid value past the adapter's
   * literal-union config type). The catalogue is the single source of truth.
   */
  configOptions?: Partial<Record<string, readonly string[]>>;
  /** Read-only by construction (invariant 1). */
  commandHardware: false;
}

export const HARDWARE_PROFILES: Record<HardwareProfileId, HardwareProfile> = {
  "unitree-go2": {
    id: "unitree-go2",
    vendor: "Unitree",
    model: "Go2 class",
    kind: "quadruped",
    adapterKind: "unitree-readonly",
    safetyClass: "deterministic_lan",
    requiredConfigKeys: ["robotIp", "sdkMode", "siteId"],
    configOptions: { sdkMode: ["sdk2", "webrtc"] },
    commandHardware: false
  },
  "dji-dock2-m3d": {
    id: "dji-dock2-m3d",
    vendor: "DJI",
    model: "Dock 2 / M3D class",
    kind: "uav",
    adapterKind: "dji-cloud-readonly",
    safetyClass: "mediated_observed",
    requiredConfigKeys: ["workspaceId", "appId", "appKey", "mqttBrokerUrl", "mediaBucketUrl"],
    commandHardware: false
  }
};

export function getHardwareProfile(id: HardwareProfileId): HardwareProfile {
  return HARDWARE_PROFILES[id];
}

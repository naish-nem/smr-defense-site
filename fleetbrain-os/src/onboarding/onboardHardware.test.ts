import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "../adapters/AdapterRegistry";
import { onboardHardware } from "./onboardHardware";

const NOW = "2026-06-22T00:00:00Z";
const SITE = "SITE-FPR-01";

describe("onboardHardware — Unitree (deterministic LAN safety class)", () => {
  it("registers a read-only quadruped with full config as healthy", () => {
    const registry = new AdapterRegistry();
    const result = onboardHardware(
      {
        profileId: "unitree-go2",
        machineId: "M-UGV-02",
        label: "Ground Unit FOX",
        config: { robotIp: "10.0.0.5", sdkMode: "sdk2", siteId: SITE }
      },
      { siteId: SITE, now: NOW, registry }
    );

    expect(result.validation.ok).toBe(true);
    expect(result.safetyClass).toBe("deterministic_lan");
    expect(result.machine).toMatchObject({ id: "M-UGV-02", kind: "quadruped", vendor: "Unitree", status: "docked" });
    expect(result.adapter.capabilities.commandHardware).toBe(false);
    expect(result.dockLocation).toEqual({ machineId: "M-UGV-02", point: { x: 18, y: 50 } });
    expect(result.adapter.adapterId).toBe("unitree-readonly:M-UGV-02");
    expect(registry.list(SITE).map((a) => a.adapterId)).toContain("unitree-readonly:M-UGV-02");
    expect(result.audit[0]).toMatchObject({ action: "hardware_onboard", subjectRef: "M-UGV-02", actor: "operator" });
  });
});

describe("onboardHardware — DJI (mediated/observed safety class)", () => {
  it("uses a distinct safety class from Unitree (invariant 5)", () => {
    const registry = new AdapterRegistry();
    const result = onboardHardware(
      {
        profileId: "dji-dock2-m3d",
        machineId: "M-UAV-02",
        label: "Drone Bravo",
        config: {
          workspaceId: "w",
          appId: "a",
          appKey: "k",
          mqttBrokerUrl: "mqtt://x",
          mediaBucketUrl: "s3://y"
        }
      },
      { siteId: SITE, now: NOW, registry }
    );

    expect(result.safetyClass).toBe("mediated_observed");
    expect(result.machine).toMatchObject({ kind: "uav", vendor: "DJI" });
    expect(result.adapter.adapterId).toBe("dji-cloud-readonly:M-UAV-02");
    expect(result.dockLocation).toEqual({ machineId: "M-UAV-02", point: { x: 94, y: 60 } });
  });
});

describe("onboardHardware — multiple same-vendor units coexist (no registry eviction)", () => {
  it("registers two Unitree units under distinct per-unit adapter ids", () => {
    const registry = new AdapterRegistry();
    const cfg = { robotIp: "10.0.0.5", sdkMode: "sdk2" as const, siteId: SITE };
    onboardHardware({ profileId: "unitree-go2", machineId: "M-UGV-10", label: "A", config: cfg }, { siteId: SITE, now: NOW, registry });
    onboardHardware({ profileId: "unitree-go2", machineId: "M-UGV-11", label: "B", config: cfg }, { siteId: SITE, now: NOW, registry });

    const ids = registry.list(SITE).map((a) => a.adapterId).sort();
    expect(ids).toEqual(["unitree-readonly:M-UGV-10", "unitree-readonly:M-UGV-11"]);
  });
});

describe("onboardHardware — validation agrees with the adapter's own health (no drift)", () => {
  it("missingKeys matches reportAdapterHealth().missingInputs for a degraded unit", async () => {
    const registry = new AdapterRegistry();
    const result = onboardHardware(
      { profileId: "unitree-go2", machineId: "M-UGV-12", label: "C", config: { robotIp: "10.0.0.9" } },
      { siteId: SITE, now: NOW, registry }
    );
    const health = await result.adapter.reportAdapterHealth();
    expect(result.validation.missingKeys.sort()).toEqual([...health.missingInputs].sort());
  });
});

describe("onboardHardware — degraded config does not throw", () => {
  it("registers the adapter but surfaces missing keys", () => {
    const registry = new AdapterRegistry();
    const result = onboardHardware(
      { profileId: "unitree-go2", machineId: "M-UGV-03", label: "FOX2", config: { robotIp: "10.0.0.6" } },
      { siteId: SITE, now: NOW, registry }
    );

    expect(result.validation.ok).toBe(false);
    expect(result.validation.missingKeys).toEqual(["sdkMode", "siteId"]);
    // Still registered so it shows as a degraded device, not a crash.
    expect(registry.list(SITE)).toHaveLength(1);
    expect(result.audit[0].detail).toContain("awaiting config");
  });
});

describe("onboardHardware — deterministic", () => {
  it("produces identical output for identical inputs", () => {
    const make = () =>
      onboardHardware(
        { profileId: "unitree-go2", machineId: "M-UGV-04", label: "FOX3", config: { robotIp: "10.0.0.7", sdkMode: "sdk2", siteId: SITE } },
        { siteId: SITE, now: NOW, registry: new AdapterRegistry() }
      );
    const a = make();
    const b = make();
    expect(a.machine).toEqual(b.machine);
    expect(a.audit).toEqual(b.audit);
    expect(a.validation).toEqual(b.validation);
  });
});

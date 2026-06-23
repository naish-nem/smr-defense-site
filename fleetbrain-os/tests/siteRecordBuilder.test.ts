import { describe, expect, it } from "vitest";
import { SimulatorAdapter } from "../src/adapters/SimulatorAdapter";
import { DjiCloudReadOnlyAdapter } from "../src/adapters/DjiCloudReadOnlyAdapter";
import { UnitreeReadOnlyAdapter } from "../src/adapters/UnitreeReadOnlyAdapter";
import { baselineMachines } from "../src/data/site";
import { FleetBrainKernel } from "../src/kernel/FleetBrainKernel";

describe("FleetBrainKernel", () => {
  it("builds deterministic normal coverage", async () => {
    const kernel = new FleetBrainKernel(new SimulatorAdapter("solar_soiling_trend"));
    const record = await kernel.buildCurrentSiteRecord("SITE-FPR-01");

    expect(record.readiness.coveragePct).toBe(100);
    expect(record.openExceptions.some((item) => item.type === "missing_coverage")).toBe(false);
    expect(record.readiness.commandAuthority).toBe("read_only");
  });

  it("surfaces missed zones as open exceptions", async () => {
    const kernel = new FleetBrainKernel(new SimulatorAdapter("switchgear_access_gap"));
    const record = await kernel.buildCurrentSiteRecord("SITE-FPR-01");

    expect(record.readiness.coveragePct).toBeLessThan(100);
    expect(record.openExceptions.some((item) => item.type === "missing_coverage")).toBe(true);
    expect(record.rawUnreviewedEvents.some((item) => item.eventType === "dock_status")).toBe(true);
  });

  it("turns thermal inputs into evidence-backed exceptions", async () => {
    const kernel = new FleetBrainKernel(new SimulatorAdapter("bess_heat_regression"));
    const record = await kernel.buildCurrentSiteRecord("SITE-FPR-01");

    expect(record.openExceptions.some((item) => item.type === "thermal_anomaly")).toBe(true);
    record.openExceptions
      .filter((item) => item.type === "thermal_anomaly")
      .forEach((item) => expect(item.evidenceRefs.length).toBeGreaterThan(0));
  });

  it("keeps vendor adapters read-only and degraded until real inputs exist", async () => {
    const dji = new DjiCloudReadOnlyAdapter({});
    const unitree = new UnitreeReadOnlyAdapter({});

    await expect(dji.reportAdapterHealth()).resolves.toMatchObject({
      status: "degraded"
    });
    await expect(unitree.reportAdapterHealth()).resolves.toMatchObject({
      status: "degraded"
    });
    expect(dji.capabilities.commandHardware).toBe(false);
    expect(unitree.capabilities.commandHardware).toBe(false);
  });

  it("returns deterministic configured snapshots from vendor adapters", async () => {
    const checkedAtIso = "2026-06-19T06:00:00.000Z";
    const dji = new DjiCloudReadOnlyAdapter({
      workspaceId: "workspace-1",
      appId: "app-1",
      appKey: "key-1",
      mqttBrokerUrl: "mqtts://broker.example.test",
      mediaBucketUrl: "s3://media-bucket",
      checkedAtIso,
      machineState: [baselineMachines[0]],
      recentEvents: [],
      mediaReferences: ["dji-cloud://SITE-FPR-01/M-UAV-01/camera-0/zoom-0"]
    });
    const unitree = new UnitreeReadOnlyAdapter({
      robotIp: "192.0.2.10",
      sdkMode: "webrtc",
      siteId: "SITE-FPR-01",
      checkedAtIso,
      machineState: [baselineMachines[1]],
      recentEvents: [],
      mediaReferences: ["edge-webrtc://SITE-FPR-01/M-UGV-01/front"]
    });

    await expect(dji.readMachineState("SITE-FPR-01")).resolves.toEqual([baselineMachines[0]]);
    await expect(unitree.readMachineState("SITE-FPR-01")).resolves.toEqual([baselineMachines[1]]);
    await expect(dji.readMediaReferences("SITE-FPR-01")).resolves.toEqual([
      "dji-cloud://SITE-FPR-01/M-UAV-01/camera-0/zoom-0"
    ]);
    await expect(unitree.readMediaReferences("SITE-FPR-01")).resolves.toEqual([
      "edge-webrtc://SITE-FPR-01/M-UGV-01/front"
    ]);
    await expect(dji.reportAdapterHealth()).resolves.toMatchObject({
      status: "healthy",
      checkedAt: checkedAtIso
    });
    await expect(unitree.reportAdapterHealth()).resolves.toMatchObject({
      status: "healthy",
      checkedAt: checkedAtIso
    });
  });
});

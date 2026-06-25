import { describe, expect, it } from "vitest";
import { HARDWARE_PROFILES } from "./hardwareProfile";

describe("hardware profiles", () => {
  it("are all read-only (invariant 1)", () => {
    for (const profile of Object.values(HARDWARE_PROFILES)) {
      expect(profile.commandHardware).toBe(false);
    }
  });

  it("keep DJI and Unitree in distinct safety classes (invariant 5)", () => {
    expect(HARDWARE_PROFILES["unitree-go2"].safetyClass).toBe("deterministic_lan");
    expect(HARDWARE_PROFILES["dji-dock2-m3d"].safetyClass).toBe("mediated_observed");
  });

  it("expose enum options for the Unitree sdkMode key so the UI can constrain it", () => {
    expect(HARDWARE_PROFILES["unitree-go2"].configOptions?.sdkMode).toEqual(["sdk2", "webrtc"]);
  });
});

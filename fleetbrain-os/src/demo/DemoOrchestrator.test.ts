import { describe, expect, it } from "vitest";
import { DemoOrchestrator } from "./DemoOrchestrator";
import { julyDemoScript } from "./demoScript";
import type { DemoRunFrame } from "./types";

function allVisible(frames: DemoRunFrame[]) {
  return frames.flatMap((f) => f.visibleEvents);
}

describe("DemoOrchestrator — headless run", () => {
  it("produces one frame per scripted tick in order", () => {
    const orch = new DemoOrchestrator(julyDemoScript);
    const frames = orch.run();

    expect(frames).toHaveLength(julyDemoScript.totalTicks + 1);
    frames.forEach((frame, idx) => {
      expect(frame.tick).toBe(idx);
    });
  });

  it("is deterministic — two runs produce identical frames", () => {
    const a = new DemoOrchestrator(julyDemoScript).run();
    const b = new DemoOrchestrator(julyDemoScript).run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("surfaces every scripted step exactly once across the run", () => {
    const orch = new DemoOrchestrator(julyDemoScript);
    const seen = allVisible(orch.run()).map((v) => v.step.id);
    expect(seen).toHaveLength(julyDemoScript.steps.length);
    expect(new Set(seen).size).toBe(julyDemoScript.steps.length);
  });

  it("step() walks one tick at a time then returns null at the end", () => {
    const orch = new DemoOrchestrator(julyDemoScript);
    let count = 0;
    while (orch.step() !== null) {
      count += 1;
    }
    expect(count).toBe(julyDemoScript.totalTicks + 1);
    expect(orch.isComplete).toBe(true);
    expect(orch.step()).toBeNull();
  });
});

describe("DemoOrchestrator — live_plus_recorded mode", () => {
  it("defaults to live_plus_recorded", () => {
    expect(new DemoOrchestrator(julyDemoScript).mode).toBe("live_plus_recorded");
  });

  it("contains LIVE-tagged telemetry steps from the one live machine", () => {
    const orch = new DemoOrchestrator(julyDemoScript);
    const liveEvents = allVisible(orch.run()).filter(
      (v) => v.effectiveSourceLabel === "LIVE"
    );
    expect(liveEvents.length).toBeGreaterThan(0);
    for (const v of liveEvents) {
      expect(v.step.kind).toBe("telemetry");
      const payload = v.step.payload as { machineId: string };
      expect(payload.machineId).toBe(julyDemoScript.liveMachineId);
    }
  });

  it("labels dispatch steps as TELEOP, never autonomous", () => {
    const orch = new DemoOrchestrator(julyDemoScript);
    const dispatches = allVisible(orch.run()).filter(
      (v) => v.step.kind === "dispatch_scripted"
    );
    expect(dispatches.length).toBeGreaterThan(0);
    for (const v of dispatches) {
      const payload = v.step.payload as { teleopLabel: string };
      expect(payload.teleopLabel).toBe("TELEOP — operator-driven");
    }
  });
});

describe("DemoOrchestrator — fallbackToRecorded", () => {
  it("removes all LIVE tags but still completes the full story", () => {
    const orch = new DemoOrchestrator(julyDemoScript);
    orch.fallbackToRecorded();
    expect(orch.mode).toBe("recorded_fallback");

    const frames = orch.run();
    const visible = allVisible(frames);

    // Full story still completes: same frame count and same step coverage.
    expect(frames).toHaveLength(julyDemoScript.totalTicks + 1);
    expect(visible).toHaveLength(julyDemoScript.steps.length);

    // No LIVE labels survive the fallback.
    const liveCount = visible.filter((v) => v.effectiveSourceLabel === "LIVE").length;
    expect(liveCount).toBe(0);
    expect(visible.every((v) => v.effectiveSourceLabel === "RECORDED")).toBe(true);

    // Resolved telemetry steps are re-sourced (label rewritten to RECORDED).
    const telemetrySteps = visible.filter((v) => v.step.kind === "telemetry");
    expect(telemetrySteps.length).toBeGreaterThan(0);
    expect(telemetrySteps.every((v) => v.step.sourceLabel === "RECORDED")).toBe(true);
  });

  it("can fall back mid-run and the remaining frames carry no LIVE data", () => {
    const orch = new DemoOrchestrator(julyDemoScript);
    const before: DemoRunFrame[] = [];
    // Advance a few ticks live.
    for (let i = 0; i < 4; i += 1) {
      const f = orch.step();
      if (f) before.push(f);
    }
    expect(allVisible(before).some((v) => v.effectiveSourceLabel === "LIVE")).toBe(true);

    orch.fallbackToRecorded();

    const after: DemoRunFrame[] = [];
    let f = orch.step();
    while (f !== null) {
      after.push(f);
      f = orch.step();
    }
    // Run reaches the final tick.
    expect(after[after.length - 1].tick).toBe(julyDemoScript.totalTicks);
    // Nothing after the switch is presented as LIVE.
    expect(allVisible(after).every((v) => v.effectiveSourceLabel === "RECORDED")).toBe(true);
  });
});

describe("DemoOrchestrator — disclosure banner (honesty invariant)", () => {
  it("is never empty in either mode and discloses the active source", () => {
    const live = new DemoOrchestrator(julyDemoScript).run();
    for (const frame of live) {
      expect(frame.banner.length).toBeGreaterThan(0);
      expect(frame.banner).toContain("LIVE");
      expect(frame.banner).toContain("TELEOP");
    }

    const fallbackOrch = new DemoOrchestrator(julyDemoScript);
    fallbackOrch.fallbackToRecorded();
    for (const frame of fallbackOrch.run()) {
      expect(frame.banner.length).toBeGreaterThan(0);
      expect(frame.banner).toContain("RECORDED FALLBACK");
      expect(frame.banner).toContain("TELEOP");
    }
  });
});

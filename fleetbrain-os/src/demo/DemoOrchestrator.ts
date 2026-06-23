import type {
  DemoMode,
  DemoRunFrame,
  DemoScript,
  DemoStep,
  DemoVisibleEvent,
  DemoSourceLabel,
  TelemetryPayload
} from "./types";

/**
 * Drives the Phase 0 July-21 demo script tick-by-tick.
 *
 * Determinism: the orchestrator holds an internal tick counter and never reads
 * the wall clock or randomness. Calling `step()` advances exactly one tick;
 * `run()` replays the whole script from a clean clone.
 *
 * Honesty invariant: every frame carries a non-empty disclosure banner that
 * states whether the live lane is LIVE or has fallen back to RECORDED, and
 * `fallbackToRecorded()` rewrites every LIVE label to RECORDED so the operator
 * can never be shown recorded data dressed as live.
 */
export class DemoOrchestrator {
  private readonly script: DemoScript;
  private currentMode: DemoMode;
  private tick: number;

  constructor(script: DemoScript, mode: DemoMode = "live_plus_recorded") {
    this.script = script;
    this.currentMode = mode;
    this.tick = -1; // first step() advances to tick 0
  }

  get mode(): DemoMode {
    return this.currentMode;
  }

  /** Current tick (−1 before the first step). */
  get currentTick(): number {
    return this.tick;
  }

  /** True once the final scripted tick has been emitted. */
  get isComplete(): boolean {
    return this.tick >= this.script.totalTicks;
  }

  /**
   * Switch to the fully-recorded fallback. The LIVE telemetry source is
   * replaced by its recorded equivalent: every step keeps firing, but LIVE
   * labels resolve to RECORDED so nothing is presented as live anymore.
   * Idempotent and safe to call mid-run.
   */
  fallbackToRecorded(): void {
    this.currentMode = "recorded_fallback";
  }

  /**
   * Advance exactly one tick and return the frame, or `null` when the script
   * is exhausted. Steps fire on the tick equal to their `atTick`.
   */
  step(): DemoRunFrame | null {
    if (this.isComplete) {
      return null;
    }
    this.tick += 1;
    return this.frameForTick(this.tick);
  }

  /**
   * Replay the entire script from tick 0 to `totalTicks` in the current mode,
   * returning the ordered frames. Does not mutate the live tick cursor used by
   * `step()` beyond running it to completion.
   */
  run(): DemoRunFrame[] {
    this.tick = -1;
    const frames: DemoRunFrame[] = [];
    let frame = this.step();
    while (frame !== null) {
      frames.push(frame);
      frame = this.step();
    }
    return frames;
  }

  private frameForTick(tick: number): DemoRunFrame {
    const firing = this.script.steps.filter((s) => s.atTick === tick);
    const visibleEvents: DemoVisibleEvent[] = firing.map((step) => ({
      step: this.resolveStep(step),
      effectiveSourceLabel: this.effectiveLabel(step)
    }));
    return {
      tick,
      mode: this.currentMode,
      visibleEvents,
      banner: this.banner()
    };
  }

  /**
   * In fallback mode, a LIVE telemetry step is re-sourced from the recording:
   * its note is annotated so the surface text matches the RECORDED label. Other
   * step kinds are returned unchanged (they were already RECORDED).
   */
  private resolveStep(step: DemoStep): DemoStep {
    if (this.currentMode === "recorded_fallback" && step.sourceLabel === "LIVE") {
      const payload = step.payload as TelemetryPayload;
      const reSourced: TelemetryPayload = {
        ...payload,
        note: `${payload.note} [recorded equivalent — live signal unavailable]`
      };
      return { ...step, sourceLabel: "RECORDED", payload: reSourced };
    }
    return step;
  }

  private effectiveLabel(step: DemoStep): DemoSourceLabel {
    if (this.currentMode === "recorded_fallback") {
      return "RECORDED";
    }
    return step.sourceLabel;
  }

  /** Always-on disclosure. Never empty. */
  private banner(): string {
    if (this.currentMode === "live_plus_recorded") {
      return `LIVE telemetry: ${this.script.liveMachineId} (simulated live). All other lanes are RECORDED replay. Movement is TELEOP, operator-driven — not autonomous.`;
    }
    return `RECORDED FALLBACK — live signal unavailable. ALL lanes (including ${this.script.liveMachineId}) are RECORDED replay. Movement is TELEOP, operator-driven — not autonomous.`;
  }
}

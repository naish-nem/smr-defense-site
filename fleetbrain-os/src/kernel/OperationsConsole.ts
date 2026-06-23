import { siteGeometry } from "../data/geometry";
import { baselineMachines, coverageZones, site } from "../data/site";
import { DemoOrchestrator } from "../demo/DemoOrchestrator";
import { julyDemoScript } from "../demo/demoScript";
import { CommandArbiter } from "../arbiter/CommandArbiter";
import { GuardedSimulatorAdapter } from "../arbiter/GuardedSimulatorAdapter";
import type {
  CommandIntent,
  GateContext,
  UnitRuntimeState
} from "../arbiter/types";
import { runSoak } from "../edge/soakHarness";
import { PatrolLoopRunner, buildPatrolRoute } from "../autonomy/PatrolLoopRunner";
import { MockPerceptionModel, scorePerception } from "../autonomy/PerceptionScorer";
import { perceptionFixture } from "../autonomy/fixtures/perceptionFixture";
import type { ConsecutiveLoopResult, PerceptionMetrics } from "../autonomy/types";
import { MissionService } from "../mission/MissionService";
import type { MissionState } from "../mission/types";

/**
 * Unified facade over the five FleetBrain phase packages.
 *
 * The OperationsConsole is the single composition root that wires Phase 0 (demo),
 * Phase 1 (mission lifecycle), Phase 2 (edge store-and-forward), Phase 3 (command
 * arbiter), and Phase 4 (autonomy/perception) together and proves they connect.
 *
 * It is pure and deterministic per CLAUDE.md invariant 3: every timestamp is
 * passed in (`nowIso`); nothing here reads the wall clock or randomness directly.
 * It adds zero runtime dependencies.
 */

/** Sub-result for Phase 0 — the July-21 demo orchestration. */
export interface DemoPhaseSummary {
  mode: string;
  banner: string;
  frameCount: number;
  /** True if any visible step in the run carries an effective LIVE source label. */
  hasLiveStep: boolean;
}

/** Sub-result for Phase 1 — mission lifecycle. */
export interface MissionPhaseSummary {
  finalState: MissionState;
  /** Number of recorded lifecycle transitions in mission.history. */
  transitionCount: number;
  /** True if every transition this run was driven through a legal edge. */
  allTransitionsLegal: boolean;
}

/** A single arbiter decision, flattened for the summary surface. */
export interface ArbiterDecisionSummary {
  allowed: boolean;
  deniedByGate?: string;
  /** Hash of this decision record in the signed audit chain. */
  auditHash: string;
}

/** Sub-result for Phase 3 — the command arbiter. */
export interface ArbiterPhaseSummary {
  /** A valid dispatch inside an allowed zone — expected allowed. */
  valid: ArbiterDecisionSummary;
  /** A dispatch into a no-go zone — expected denied by the geofence gate. */
  invalid: ArbiterDecisionSummary;
  /** True if the hash-chained audit ledger verifies end to end. */
  chainVerified: boolean;
}

/** Sub-result for Phase 2 — the edge soak. */
export interface EdgePhaseSummary {
  deliveredCount: number;
  lostCount: number;
  linkLossRatio: number;
  dataLoss: boolean;
}

/** Sub-result for Phase 4 — autonomy + perception. */
export interface AutonomyPhaseSummary {
  gate: ConsecutiveLoopResult;
  perception: PerceptionMetrics;
}

/** The unified, deterministic summary across all five phases. */
export interface PhaseSummary {
  nowIso: string;
  demo: DemoPhaseSummary;
  mission: MissionPhaseSummary;
  arbiter: ArbiterPhaseSummary;
  edge: EdgePhaseSummary;
  autonomy: AutonomyPhaseSummary;
}

const LIVE_MACHINE_ID = "M-UGV-01"; // Unitree quadruped — command-capable in the sim.

/** Map domain CoverageZone ids onto the mission validation context. */
const MISSION_ZONES = coverageZones;

export class OperationsConsole {
  private readonly missions = new MissionService();

  /**
   * Run a single deterministic pass over every phase and return one coherent
   * summary object. Every timestamp derives from the supplied `nowIso`, so two
   * calls with the same argument return identical summaries.
   */
  async runPhaseSummary(nowIso: string): Promise<PhaseSummary> {
    return {
      nowIso,
      demo: this.runDemo(),
      mission: this.runMission(nowIso),
      arbiter: this.runArbiter(nowIso),
      edge: await this.runEdge(nowIso),
      autonomy: this.runAutonomy()
    };
  }

  // --- Phase 0: demo -------------------------------------------------------

  private runDemo(): DemoPhaseSummary {
    const orchestrator = new DemoOrchestrator(julyDemoScript);
    const frames = orchestrator.run();
    const hasLiveStep = frames.some((frame) =>
      frame.visibleEvents.some((event) => event.effectiveSourceLabel === "LIVE")
    );
    return {
      mode: orchestrator.mode,
      banner: frames[0]?.banner ?? "",
      frameCount: frames.length,
      hasLiveStep
    };
  }

  // --- Phase 1: mission lifecycle -----------------------------------------

  private runMission(nowIso: string): MissionPhaseSummary {
    const missionId = `MSN-${nowIso}`;
    const baseMs = Date.parse(nowIso);
    const at = (offsetSeconds: number) => new Date(baseMs + offsetSeconds * 1000).toISOString();

    const created = this.missions.create({
      id: missionId,
      siteId: site.id,
      taskType: "perimeter_patrol",
      targetZoneIds: ["Z-PERIMETER"],
      assignedMachineIds: ["M-UAV-01"],
      createdAt: nowIso,
      actor: "operator"
    });

    const steps: Array<{ ok: boolean }> = [];

    if (created.ok) {
      steps.push(
        this.missions.validate(missionId, {
          site,
          zones: MISSION_ZONES,
          machines: baselineMachines,
          at: at(1),
          actor: "FleetBrainKernel"
        }),
        this.missions.authorize(missionId, "operator", at(2)),
        this.missions.transition(missionId, "dispatched", "FleetBrainKernel", "Dispatched to edge.", at(3)),
        this.missions.transition(missionId, "accepted", "system", "Edge accepted.", at(4)),
        this.missions.transition(missionId, "executing", "system", "Patrol started.", at(5)),
        this.missions.transition(missionId, "completed", "system", "Patrol complete.", at(30))
      );
    }

    const mission = this.missions.get(missionId);
    return {
      finalState: mission?.state ?? "draft",
      transitionCount: mission?.history.length ?? 0,
      allTransitionsLegal: created.ok && steps.every((step) => step.ok)
    };
  }

  // --- Phase 3: command arbiter -------------------------------------------

  private runArbiter(nowIso: string): ArbiterPhaseSummary {
    const arbiter = new CommandArbiter();
    const guarded = new GuardedSimulatorAdapter({
      siteId: site.id,
      machines: baselineMachines
    });

    const units: UnitRuntimeState[] = baselineMachines.map((machine) => ({
      machineId: machine.id,
      link: "up",
      maintenanceLockout: false,
      batteryFloorPct: 20
    }));

    const ctx: GateContext = {
      siteId: site.id,
      machines: baselineMachines,
      units,
      geometry: siteGeometry,
      adapter: {
        adapterId: guarded.adapterId,
        commandHardware: guarded.capabilities.commandHardware,
        supportedControlLevels: guarded.capabilities.supportedControlLevels
      },
      siteLinkToCloud: "up",
      estop: { siteEngaged: false, engagedUnits: {} }
    };

    // (a) Valid dispatch inside an allowed zone (Z-PERIMETER waypoint).
    const validIntent: CommandIntent = {
      id: `intent-valid-${nowIso}`,
      type: "dispatch_machine",
      targetMachineId: LIVE_MACHINE_ID,
      issuedBy: {
        operatorId: "op-1",
        role: "site_operator",
        authority: "site_local_operator",
        scopedSiteId: site.id
      },
      params: {
        destination: { x: 20, y: 24 }, // inside Z-PERIMETER, clear of all no-go zones
        targetZoneId: "Z-PERIMETER",
        reason: "Begin south perimeter patrol leg"
      },
      issuedAt: nowIso,
      freshnessDeadlineMs: 60_000
    };

    // (b) Dispatch into a no-go zone — geofence must deny.
    const invalidIntent: CommandIntent = {
      id: `intent-invalid-${nowIso}`,
      type: "dispatch_machine",
      targetMachineId: LIVE_MACHINE_ID,
      issuedBy: {
        operatorId: "op-1",
        role: "site_operator",
        authority: "site_local_operator",
        scopedSiteId: site.id
      },
      params: {
        destination: { x: 85, y: 30 }, // inside NO-GO-BESS-DOOR
        reason: "Attempt dispatch into a no-go zone"
      },
      issuedAt: nowIso,
      freshnessDeadlineMs: 60_000
    };

    const valid = arbiter.evaluate(validIntent, ctx, nowIso);
    const invalid = arbiter.evaluate(invalidIntent, ctx, nowIso);

    // The arbiter only authorizes; the guarded adapter records the allowed motion.
    if (valid.allowed) {
      guarded.dispatch(LIVE_MACHINE_ID, validIntent.params.destination!, nowIso);
    }

    return {
      valid: { allowed: valid.allowed, deniedByGate: valid.deniedByGate, auditHash: valid.hash },
      invalid: { allowed: invalid.allowed, deniedByGate: invalid.deniedByGate, auditHash: invalid.hash },
      chainVerified: arbiter.verifyChain()
    };
  }

  // --- Phase 2: edge soak --------------------------------------------------

  private async runEdge(nowIso: string): Promise<EdgePhaseSummary> {
    const result = await runSoak({
      totalTicks: 48,
      windowMs: 72 * 60 * 60 * 1000, // 72h compressed into 48 ticks
      startIso: nowIso,
      seed: 0x5eed,
      linkLossWindows: [{ startTick: 10, endTick: 20, state: "partitioned" }],
      minEventsPerTick: 1,
      maxEventsPerTick: 4
    });
    return {
      deliveredCount: result.deliveredCount,
      lostCount: result.lostCount,
      linkLossRatio: result.linkLossRatio,
      dataLoss: result.dataLoss
    };
  }

  // --- Phase 4: autonomy + perception -------------------------------------

  private runAutonomy(): AutonomyPhaseSummary {
    const route = buildPatrolRoute(siteGeometry, "M-UAV-01");
    const runner = new PatrolLoopRunner({ route, geometry: siteGeometry, seed: 42 });
    const gate = runner.runConsecutiveLoops(10);

    const perception = scorePerception(new MockPerceptionModel(), perceptionFixture, 0.5);

    return { gate, perception };
  }
}

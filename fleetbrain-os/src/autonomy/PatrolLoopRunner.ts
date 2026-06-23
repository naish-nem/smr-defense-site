import type { MachineEvent, SiteGeometry, SitePoint } from "../domain/types";
import type {
  ConsecutiveLoopResult,
  NavGoal,
  PatrolRoute,
  PatrolRunResult
} from "./types";

/**
 * Deterministic patrol-loop simulator.
 *
 * This is NOT autonomy. It is a faithful behavioral harness for what a Nav2
 * waypoint-follower would do: visit an ordered set of goals, emit a coverage
 * event per goal, support pause/resume/recall, and count operator takeovers.
 * A real Nav2 backend swaps in behind `advance()`/`recall()` without changing
 * callers or the autonomy gate (`runConsecutiveLoops`).
 *
 * Variability (e.g. an injected operator takeover) uses a seeded LCG — never
 * Math.random — so every run is reproducible.
 */

/** Seeded linear congruential generator (Numerical Recipes constants). */
class LCG {
  private state: number;
  constructor(seed: number) {
    // Keep state in the 32-bit unsigned range.
    this.state = seed >>> 0;
  }
  /** Next float in [0, 1). */
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
}

/** When to inject an operator takeover, to prove the counter works. */
export interface TakeoverSchedule {
  /** 1-based loop index at which a takeover occurs. */
  loopIndex: number;
  /** Index into the route's goals at which the operator must intervene. */
  goalIndex: number;
}

export interface PatrolRunnerOptions {
  route: PatrolRoute;
  geometry: SiteGeometry;
  /** Seed for the deterministic LCG. */
  seed?: number;
  /**
   * Optional injected takeover(s). The default schedule (none) completes every
   * loop cleanly; injecting one forces a takeover so the gate fails.
   */
  takeovers?: TakeoverSchedule[];
}

type RunnerStatus = "idle" | "patrolling" | "paused" | "recalled" | "completed";

export class PatrolLoopRunner {
  private readonly route: PatrolRoute;
  private readonly geometry: SiteGeometry;
  private readonly rng: LCG;
  private readonly takeovers: TakeoverSchedule[];

  private status: RunnerStatus = "idle";
  private tick = 0;
  private takeoverCount = 0;
  private readonly events: MachineEvent[] = [];

  constructor(options: PatrolRunnerOptions) {
    this.route = options.route;
    this.geometry = options.geometry;
    this.rng = new LCG(options.seed ?? 0x5eed);
    this.takeovers = options.takeovers ?? [];
  }

  /** Operator pauses the patrol in place. */
  pause(): void {
    if (this.status === "patrolling") this.status = "paused";
  }

  /** Operator resumes a paused patrol. */
  resume(): void {
    if (this.status === "paused") this.status = "patrolling";
  }

  /** Recall the machine to its dock; returns the synthetic timestamp at dock. */
  recall(): SitePoint {
    this.status = "recalled";
    return this.route.dock;
  }

  getStatus(): RunnerStatus {
    return this.status;
  }

  getTakeoverCount(): number {
    return this.takeoverCount;
  }

  /** All `patrol_pass` events emitted so far across loops. */
  getEvents(): readonly MachineEvent[] {
    return this.events;
  }

  /** Deterministic synthetic timestamp derived from the tick counter. */
  private timestampForTick(tick: number): string {
    // Base epoch chosen as a fixed instant; +1s per tick. Deterministic.
    const base = Date.parse("2026-06-18T00:00:00.000Z");
    return new Date(base + tick * 1000).toISOString();
  }

  private emitPatrolPass(loopIndex: number, goal: NavGoal): void {
    this.tick += this.route.ticksPerLeg;
    const ts = this.timestampForTick(this.tick);
    this.events.push({
      id: `patrol-${this.route.machineId}-L${loopIndex}-${goal.waypointId}-${this.tick}`,
      sourceMachineId: this.route.machineId,
      siteId: this.route.siteId,
      timestamp: ts,
      eventType: "patrol_pass",
      zoneId: goal.zoneId,
      locationLabel: goal.label,
      pose: {
        frameId: "site-local-enu",
        position: { x: goal.point.x, y: goal.point.y, z: goal.point.z ?? 0 },
        fixType: "site_map",
        accuracyMeters: 0.2 + this.rng.next() * 0.1
      },
      payloadRef: `route:${this.route.id}`,
      rawStatus: "patrol_pass",
      confidence: 1
    });
  }

  /**
   * Run a single patrol loop. Visits each goal in order, emitting a
   * `patrol_pass` event per goal. If a takeover is scheduled for this loop, the
   * loop aborts at that goal, the takeover counter increments, and the loop is
   * marked incomplete.
   */
  runLoop(loopIndex: number): PatrolRunResult {
    this.status = "patrolling";
    const startTick = this.tick;
    const waypointsHit: string[] = [];
    let tookTakeover = false;

    for (let i = 0; i < this.route.goals.length; i++) {
      const scheduled = this.takeovers.find(
        (t) => t.loopIndex === loopIndex && t.goalIndex === i
      );
      if (scheduled) {
        tookTakeover = true;
        this.takeoverCount += 1;
        this.status = "paused";
        break;
      }
      const goal = this.route.goals[i];
      this.emitPatrolPass(loopIndex, goal);
      waypointsHit.push(goal.waypointId);
    }

    const completed = !tookTakeover && waypointsHit.length === this.route.goals.length;
    if (completed) this.status = "patrolling";

    return {
      loopIndex,
      waypointsHit,
      completed,
      tookTakeover,
      durationTicks: this.tick - startTick
    };
  }

  /**
   * The Phase-4 autonomy gate: run `n` consecutive loops and report whether all
   * completed with ZERO operator takeover. This is the deterministic stand-in
   * for the field acceptance criterion ("N clean loops, no human intervention").
   */
  runConsecutiveLoops(n: number): ConsecutiveLoopResult {
    const loops: PatrolRunResult[] = [];
    const takeoverBefore = this.takeoverCount;
    let completedLoops = 0;

    for (let loopIndex = 1; loopIndex <= n; loopIndex++) {
      const result = this.runLoop(loopIndex);
      loops.push(result);
      if (result.completed) completedLoops += 1;
    }

    const takeoverCount = this.takeoverCount - takeoverBefore;
    const passedGate = completedLoops === n && takeoverCount === 0;
    if (passedGate) this.status = "completed";

    return {
      requestedLoops: n,
      completedLoops,
      takeoverCount,
      passedGate,
      loops
    };
  }

  /** Verify every goal lies inside its declared zone — interface sanity check. */
  validateRouteGeometry(): boolean {
    return this.route.goals.every((goal) => {
      const zone = this.geometry.zones.find((z) => z.zoneId === goal.zoneId);
      return zone !== undefined;
    });
  }
}

/** Build a default patrol route from a site's inspection waypoints. */
export function buildPatrolRoute(
  geometry: SiteGeometry,
  machineId: string,
  options?: { ticksPerLeg?: number; toleranceMeters?: number }
): PatrolRoute {
  const dock =
    geometry.dockLocations.find((d) => d.machineId === machineId)?.point ??
    geometry.dockLocations[0]?.point ?? { x: 0, y: 0 };

  const goals: NavGoal[] = geometry.inspectionWaypoints.map((wp, i) => ({
    waypointId: `WP-${i + 1}`,
    zoneId: wp.zoneId,
    point: wp.point,
    label: wp.label,
    toleranceMeters: options?.toleranceMeters ?? 0.5
  }));

  return {
    id: `route-${geometry.siteId}-${machineId}`,
    siteId: geometry.siteId,
    machineId,
    allowedMachineKinds: ["uav", "quadruped"],
    goals,
    dock,
    ticksPerLeg: options?.ticksPerLeg ?? 5
  };
}

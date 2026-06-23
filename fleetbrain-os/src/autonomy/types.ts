import type { MachineKind, Pose, SitePoint } from "../domain/types";

/**
 * Phase 4 autonomy & perception INTERFACES.
 *
 * These are faithful interface shapes for a navigation/SLAM/perception backend
 * (Nav2, a SLAM localizer, a real object detector). The Phase-4 simulation
 * implementations behind them are deterministic and honest: they prove the
 * interfaces compile, are testable, and that a real backend can drop in later.
 * Nothing here claims measured autonomy or measured perception accuracy.
 */

/** A single navigation goal in the site-local ENU frame. */
export interface NavGoal {
  waypointId: string;
  zoneId: string;
  point: SitePoint;
  label: string;
  /** Tolerance (meters) within which the goal counts as reached. */
  toleranceMeters: number;
}

/** An ordered patrol route over the site geometry that a machine repeats. */
export interface PatrolRoute {
  id: string;
  siteId: string;
  machineId: string;
  /** The machine kinds permitted to fly/walk this route. */
  allowedMachineKinds: MachineKind[];
  /** Ordered goals; the runner visits them in sequence then returns to dock. */
  goals: NavGoal[];
  /** Dock the machine launches from and recalls to. */
  dock: SitePoint;
  /** Ticks the machine spends transiting between consecutive goals. */
  ticksPerLeg: number;
}

/** Result of running a single patrol loop. */
export interface PatrolRunResult {
  loopIndex: number;
  waypointsHit: string[];
  completed: boolean;
  tookTakeover: boolean;
  durationTicks: number;
}

/** Result of running N consecutive loops — the Phase-4 autonomy gate. */
export interface ConsecutiveLoopResult {
  requestedLoops: number;
  completedLoops: number;
  takeoverCount: number;
  /** The gate: all N loops completed with zero operator takeover. */
  passedGate: boolean;
  loops: PatrolRunResult[];
}

/**
 * Localization interface — what a SLAM / GNSS-RTK / VIO backend must provide.
 * `accuracyMeters` is a reported estimate from the localizer, NOT a measured
 * ground-truth error. A real backend fills this from its covariance estimate.
 */
export interface Localization {
  pose: Pose;
  fixType: NonNullable<Pose["fixType"]>;
  accuracyMeters: number;
}

/** A 2D image-space bounding box (pixels). */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One detection emitted by a perception model for a frame.
 * `score` is the model's confidence for THIS detection — decoration until a
 * harness (see PerceptionScorer) measures precision/recall against ground truth.
 */
export interface PerceptionDetection {
  label: string;
  bbox: BBox;
  score: number;
  /** Optional projection of the detection into a site/world pose. */
  poseProjection?: Pose;
}

/**
 * Measured perception metrics produced by scoring a model against a labeled
 * fixture at a fixed threshold. These are the honest numbers — unlike a raw
 * per-detection `score`, these are computed from true/false positives and
 * false negatives over a known ground truth.
 */
export interface PerceptionMetrics {
  precision: number;
  recall: number;
  falsePositiveRate: number;
  sampleCount: number;
  threshold: number;
}

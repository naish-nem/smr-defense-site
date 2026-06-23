import type { BBox } from "../types";

/**
 * A small, deterministic labeled perception fixture.
 *
 * Each frame carries a list of ground-truth objects (what is REALLY there).
 * A perception model is run over the same `frameRef`s and its detections are
 * scored against these labels by `scorePerception`. This is the data that turns
 * a decorative "confidence" into a measured precision/recall number.
 */

export interface GroundTruthObject {
  label: string;
  bbox: BBox;
}

export interface LabeledFrame {
  frameRef: string;
  /** What is actually present in the frame. */
  truth: GroundTruthObject[];
}

export type LabeledFixture = LabeledFrame[];

/**
 * 5 frames, 6 ground-truth objects total across the relevant inspection labels
 * (thermal_hotspot, open_door, person). Coordinates are arbitrary pixel boxes;
 * what matters is that they are fixed so scoring is reproducible.
 */
export const perceptionFixture: LabeledFixture = [
  {
    frameRef: "frame-001",
    truth: [
      { label: "thermal_hotspot", bbox: { x: 10, y: 10, width: 20, height: 20 } },
      { label: "open_door", bbox: { x: 80, y: 40, width: 30, height: 60 } }
    ]
  },
  {
    frameRef: "frame-002",
    truth: [{ label: "thermal_hotspot", bbox: { x: 50, y: 50, width: 15, height: 15 } }]
  },
  {
    frameRef: "frame-003",
    truth: [{ label: "person", bbox: { x: 120, y: 30, width: 25, height: 70 } }]
  },
  {
    frameRef: "frame-004",
    // Intentionally empty: a clean frame. Any detection here is a false positive.
    truth: []
  },
  {
    frameRef: "frame-005",
    truth: [
      { label: "open_door", bbox: { x: 5, y: 5, width: 40, height: 80 } },
      { label: "thermal_hotspot", bbox: { x: 200, y: 100, width: 18, height: 18 } }
    ]
  }
];

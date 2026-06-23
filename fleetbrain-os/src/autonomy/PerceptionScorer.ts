import type { PerceptionDetection, PerceptionMetrics } from "./types";
import type { GroundTruthObject, LabeledFixture } from "./fixtures/perceptionFixture";

/**
 * PERCEPTION SCORING HARNESS.
 *
 * The point of this file is intellectual honesty. The clickable prototype shows
 * a "96% confidence" badge on a detection. That number is DECORATION: it is a
 * model's per-detection score, not a measured statement about how often the
 * model is right. `scorePerception` is the harness that turns a real model into
 * real numbers — precision, recall, false-positive rate — by running it over a
 * labeled fixture and comparing detections against ground truth.
 *
 * When a real detector (e.g. a fine-tuned YOLO/DETR or a vendor SDK) is ready,
 * it implements `PerceptionModel.detect()` and this exact harness measures it.
 * Until then, `MockPerceptionModel` provides deterministic detections so the
 * harness itself is tested and trustworthy.
 */

/** A perception backend: given a frame reference, return its detections. */
export interface PerceptionModel {
  detect(frameRef: string): PerceptionDetection[];
}

/**
 * Deterministic mock detector keyed by frame reference. Returns a fixed set of
 * detections — including deliberate misses and false positives — so the scorer
 * produces known precision/recall/FP numbers under test.
 */
export class MockPerceptionModel implements PerceptionModel {
  private readonly table: Record<string, PerceptionDetection[]>;

  constructor(table?: Record<string, PerceptionDetection[]>) {
    this.table = table ?? MockPerceptionModel.defaultDetections();
  }

  detect(frameRef: string): PerceptionDetection[] {
    return this.table[frameRef] ?? [];
  }

  /**
   * Hand-tuned detections over `perceptionFixture` (6 ground-truth objects).
   *
   * At threshold 0.5 the detections above threshold are:
   *  - frame-001: thermal_hotspot @0.92 (TP), open_door @0.81 (TP)
   *  - frame-002: thermal_hotspot @0.74 (TP)
   *  - frame-003: person @0.40 (BELOW threshold → not counted; truth missed → FN)
   *  - frame-004: thermal_hotspot @0.88 (FP — clean frame)
   *  - frame-005: open_door @0.66 (TP), thermal_hotspot @0.30 (BELOW threshold → FN)
   *
   * => TP=4, FP=1, FN=2  (over 6 ground-truth objects)
   *    precision = 4/5 = 0.8
   *    recall    = 4/6 ≈ 0.6667
   *    fpRate    = FP / (FP + TP) = 1/5 = 0.2
   */
  static defaultDetections(): Record<string, PerceptionDetection[]> {
    return {
      "frame-001": [
        { label: "thermal_hotspot", bbox: { x: 10, y: 10, width: 20, height: 20 }, score: 0.92 },
        { label: "open_door", bbox: { x: 80, y: 40, width: 30, height: 60 }, score: 0.81 }
      ],
      "frame-002": [
        { label: "thermal_hotspot", bbox: { x: 50, y: 50, width: 15, height: 15 }, score: 0.74 }
      ],
      "frame-003": [
        { label: "person", bbox: { x: 120, y: 30, width: 25, height: 70 }, score: 0.4 }
      ],
      "frame-004": [
        { label: "thermal_hotspot", bbox: { x: 60, y: 60, width: 12, height: 12 }, score: 0.88 }
      ],
      "frame-005": [
        { label: "open_door", bbox: { x: 5, y: 5, width: 40, height: 80 }, score: 0.66 },
        { label: "thermal_hotspot", bbox: { x: 200, y: 100, width: 18, height: 18 }, score: 0.3 }
      ]
    };
  }
}

/** A detection matches a ground-truth object if labels agree and boxes overlap (IoU >= 0.5). */
function matches(detection: PerceptionDetection, truth: GroundTruthObject): boolean {
  if (detection.label !== truth.label) return false;
  return iou(detection.bbox, truth.bbox) >= 0.5;
}

function iou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Score a perception model against a labeled fixture at a given confidence
 * threshold. Detections below `threshold` are discarded before matching.
 *
 * - True positive (TP): a kept detection that matches an unused ground-truth box.
 * - False positive (FP): a kept detection that matches nothing.
 * - False negative (FN): a ground-truth box left unmatched.
 *
 *   precision        = TP / (TP + FP)
 *   recall           = TP / (TP + FN)
 *   falsePositiveRate = FP / (TP + FP)   (share of predictions that were wrong)
 */
export function scorePerception(
  model: PerceptionModel,
  labeledFixture: LabeledFixture,
  threshold: number
): PerceptionMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let sampleCount = 0;

  for (const frame of labeledFixture) {
    sampleCount += 1;
    const detections = model
      .detect(frame.frameRef)
      .filter((d) => d.score >= threshold);

    const truthUsed = new Array<boolean>(frame.truth.length).fill(false);

    for (const detection of detections) {
      const matchIdx = frame.truth.findIndex(
        (truth, idx) => !truthUsed[idx] && matches(detection, truth)
      );
      if (matchIdx >= 0) {
        truthUsed[matchIdx] = true;
        tp += 1;
      } else {
        fp += 1;
      }
    }

    fn += truthUsed.filter((used) => !used).length;
  }

  const predicted = tp + fp;
  const actual = tp + fn;

  return {
    precision: predicted === 0 ? 0 : tp / predicted,
    recall: actual === 0 ? 0 : tp / actual,
    falsePositiveRate: predicted === 0 ? 0 : fp / predicted,
    sampleCount,
    threshold
  };
}

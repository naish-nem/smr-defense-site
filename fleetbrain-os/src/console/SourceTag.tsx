/**
 * SourceTag — the HONESTY primitive.
 *
 * Every value shown in the incident workflow must carry exactly one of these tags
 * so a reader can tell at a glance WHERE a number came from. The rule (CLAUDE.md
 * invariant: honesty by construction):
 *
 *   - "telemetry"  — a field read straight from a device/telemetry event.
 *   - "computed"   — genuinely derived in-app from data present in the app
 *                    (a pure function of real fields). Never a literal.
 *   - "model"      — a model/CV/thermal score. A SCORE, not a measurement.
 *   - "simulated"  — dramatized for the demo. The word "simulated" is always
 *                    visible so it can never be mistaken for measured truth.
 *   - "artifact"   — a stored evidence artifact (frame / pose / timestamp).
 *   - "acked"      — an acknowledgement returned by a command path (command_id).
 *   - "authored"   — a configured / human-authored constant (policy, zone config).
 *
 * Nothing may be tagged "computed" or "telemetry" unless it is genuinely derived
 * from data; anything dramatized must be tagged "simulated".
 */

export type SourceKind =
  | "telemetry"
  | "computed"
  | "model"
  | "simulated"
  | "artifact"
  | "acked"
  | "authored";

const LABELS: Record<SourceKind, string> = {
  telemetry: "telemetry",
  computed: "computed",
  model: "model score",
  simulated: "simulated",
  artifact: "artifact",
  acked: "acked",
  authored: "configured"
};

const TITLES: Record<SourceKind, string> = {
  telemetry: "Field read directly from a device / telemetry event.",
  computed: "Derived in-app by a pure rule from real fields present in the app.",
  model: "A model / CV / thermal score — a score, not a physical measurement.",
  simulated: "Dramatized for the demo. Not measured. Deterministic from the event seed.",
  artifact: "A stored evidence artifact (frame, pose, timestamp).",
  acked: "An acknowledgement returned by the command path (command_id).",
  authored: "A configured / human-authored constant (policy, zone config)."
};

export function SourceTag(props: { kind: SourceKind }) {
  const { kind } = props;
  return (
    <span className={`cx-srctag cx-srctag-${kind}`} title={TITLES[kind]}>
      {LABELS[kind]}
    </span>
  );
}

/** The plain label, for non-React contexts (e.g. tests / export). */
export function sourceLabel(kind: SourceKind): string {
  return LABELS[kind];
}

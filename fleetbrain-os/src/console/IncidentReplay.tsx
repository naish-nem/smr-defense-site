import { useMemo, useState } from "react";
import { coverageZones } from "../data/site";
import { activityForMachine, trailForMachine } from "../data/deviceTelemetry";
import type { Machine } from "../domain/types";
import type { OperatorAuditRecord } from "./auditChain";
import {
  buildIncidentPackage,
  buildReplayTimeline,
  reconstructAt
} from "./replay";
import { SourceTag } from "./SourceTag";

/**
 * Incident replay — scrub to any moment T and see where the device was, what it
 * had captured by then, and which operator actions had fired. "Export evidence
 * package" freezes that reconstruction into a signed, tamper-evident JSON file.
 *
 * This is the surface that makes FleetBrain read as defensible operations software
 * rather than a robot dashboard. All reconstruction is pure (see replay.ts); this
 * component only renders it and triggers the download.
 */
export function IncidentReplay(props: {
  machine: Machine | undefined;
  nowIso: string;
  operatorAudit?: readonly OperatorAuditRecord[];
}) {
  const { machine, nowIso, operatorAudit } = props;

  const timeline = useMemo(
    () => (machine ? buildReplayTimeline(trailForMachine(machine.id), activityForMachine(machine.id)) : []),
    [machine]
  );

  // Default the scrubber to the end (the full picture); reset when the device changes.
  const [index, setIndex] = useState(() => Math.max(0, timeline.length - 1));
  const safeIndex = Math.min(index, Math.max(0, timeline.length - 1));

  if (!machine) return null;
  if (timeline.length === 0) {
    return (
      <div className="cx-replay cx-replay-empty">
        <strong>Incident replay</strong>
        <span>No retained trail or activity for {machine.label} yet.</span>
      </div>
    );
  }

  const focus = timeline[safeIndex];
  const snapshot = reconstructAt(timeline, focus.atMs);

  function exportPackage() {
    const pkg = buildIncidentPackage({
      machine: machine!,
      timeline,
      focusIso: focus.at,
      generatedAtIso: nowIso,
      operatorAudit,
      zoneLabelFor: zoneLabel
    });
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `incident-replay-${machine!.id}-${focus.at.replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="cx-replay">
      <div className="cx-device-section-title">
        <strong>Incident replay</strong>
        <span>
          {safeIndex + 1} / {timeline.length} · {formatStamp(focus.at)}
        </span>
      </div>

      <ReplayMap trail={snapshot.trailSoFar} />

      <input
        className="cx-replay-scrub"
        type="range"
        min={0}
        max={timeline.length - 1}
        value={safeIndex}
        step={1}
        aria-label={`Replay ${machine.label} — keyframe ${safeIndex + 1} of ${timeline.length}`}
        onChange={(e) => setIndex(Number(e.target.value))}
      />

      <div className="cx-replay-now">
        <div>
          <span className="cx-replay-tag">Position</span>
          <strong>{snapshot.zoneId ? zoneLabel(snapshot.zoneId) : "off-zone / unknown"}</strong>
          {snapshot.position ? (
            <small>
              ({snapshot.position.point.x},{snapshot.position.point.y}) · {snapshot.position.state}{" "}
              <SourceTag kind={snapshot.position.source} />
            </small>
          ) : (
            <small>before first sample</small>
          )}
        </div>
        <div>
          <span className="cx-replay-tag">Latest observation</span>
          {snapshot.currentActivity ? (
            <>
              <strong>{snapshot.currentActivity.title}</strong>
              <small>
                {snapshot.currentActivity.summary} · hash {snapshot.currentActivity.hash}{" "}
                <SourceTag kind={snapshot.currentActivity.source} />
              </small>
            </>
          ) : (
            <small>nothing observed yet at this moment</small>
          )}
        </div>
        <div>
          <span className="cx-replay-tag">Observed so far</span>
          <strong>{snapshot.activitiesSoFar.length} record(s)</strong>
          <small>{snapshot.trailSoFar.length} trail sample(s)</small>
        </div>
      </div>

      <button type="button" className="cx-replay-export" onClick={exportPackage}>
        Export evidence package
      </button>
    </div>
  );
}

/** Progressive trail: samples up to the focus moment, with the current one marked. */
function ReplayMap(props: { trail: ReturnType<typeof trailForMachine> }) {
  const { trail } = props;
  const W = 120;
  const H = 90;
  const line = trail.map((s) => `${s.point.x},${H - s.point.y}`).join(" ");
  const head = trail[trail.length - 1];

  return (
    <svg className="cx-replay-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Replay trail up to selected moment">
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} fill="none" stroke="var(--line)" strokeWidth={0.6} />
      {trail.length > 1 ? (
        <polyline points={line} fill="none" stroke="var(--blue)" strokeWidth={1.4} strokeLinejoin="round" />
      ) : null}
      {trail.map((s) => (
        <circle
          key={`${s.at}-${s.point.x}-${s.point.y}`}
          cx={s.point.x}
          cy={H - s.point.y}
          r={s.state === "blocked" ? 2.2 : 1.5}
          fill={s.state === "blocked" ? "var(--red)" : "var(--blue)"}
          opacity={0.55}
        />
      ))}
      {head ? (
        <circle cx={head.point.x} cy={H - head.point.y} r={3.4} fill="var(--blue)" stroke="var(--ink)" strokeWidth={0.9}>
          <animate attributeName="r" values="3;4;3" dur="1.6s" repeatCount="indefinite" />
        </circle>
      ) : null}
    </svg>
  );
}

function zoneLabel(zoneId: string): string {
  return coverageZones.find((zone) => zone.id === zoneId)?.name ?? zoneId;
}

function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

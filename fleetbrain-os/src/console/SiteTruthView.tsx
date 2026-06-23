import { useState } from "react";
import { coverageZones } from "../data/site";
import { siteGeometry } from "../data/geometry";
import { trailForMachine } from "../data/deviceTelemetry";
import type { EvidenceResult, Machine, SiteRecord } from "../domain/types";
import type { ScenarioId } from "../data/scenarios";
import type { OperatorAuditRecord } from "./auditChain";
import { DeviceDetailPanel } from "./DeviceDetailPanel";

/**
 * Site Truth — the calm answer, on demand. ONE screen that answers "is this
 * covered right now?": coverage by zone as a plain verdict, what's running, and a
 * site map rendered as an ANSWER (zone polygons colored only by state). No gauge
 * wall. When everything is covered, this screen is intentionally boring.
 */

const VERDICT: Record<EvidenceResult, { label: string; tone: string }> = {
  covered: { label: "Covered", tone: "ok" },
  exception: { label: "Exception", tone: "bad" },
  stale: { label: "Stale", tone: "warn" },
  unreviewed: { label: "Stale", tone: "warn" }
};

export function SiteTruthView(props: {
  situations: Array<{ id: ScenarioId; label: string; question: string }>;
  selected: ScenarioId;
  onSelect: (id: ScenarioId) => void;
  record: SiteRecord | undefined;
  machines: Machine[];
  nowIso: string;
  operatorAudit?: readonly OperatorAuditRecord[];
}) {
  const { situations, selected, onSelect, record, machines, nowIso, operatorAudit } = props;
  const question = situations.find((s) => s.id === selected)?.question;
  const [selectedMachineId, setSelectedMachineId] = useState<string | undefined>();

  if (!record) return <div className="cx-boot">Loading site…</div>;

  const allCovered = record.coverageZones.every((z) => z.state === "covered");
  const selectedMachine = machines.find((machine) => machine.id === selectedMachineId) ?? machines[0];
  const activeMachineId = selectedMachine?.id;

  return (
    <div className="cx-truth">
      <div className="cx-truth-head">
        <SituationPicker situations={situations} selected={selected} onSelect={onSelect} />
        <h1>Is this site covered right now?</h1>
        {question ? <p className="cx-sub">{question}</p> : null}
        <p className={`cx-verdict-banner ${allCovered ? "ok" : "attention"}`}>
          {allCovered
            ? "All zones covered. Nothing needs you here."
            : `${record.coverageZones.filter((z) => z.state !== "covered").length} zone(s) need attention.`}
        </p>
      </div>

      <div className="cx-truth-grid">
        <section className="cx-zones">
          {record.coverageZones.map((zone) => {
            const v = VERDICT[zone.state];
            return (
              <div className={`cx-zone-row tone-${v.tone}`} key={zone.id}>
                <div>
                  <strong>{zone.name}</strong>
                  <span>{zone.purpose}</span>
                </div>
                <div className="cx-zone-verdict">
                  <span className={`cx-pill tone-${v.tone}`}>{v.label}</span>
                  {zone.lastCheckedAt ? (
                    <small>checked {formatTime(zone.lastCheckedAt)}</small>
                  ) : (
                    <small>no recent check</small>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section className="cx-map-panel">
          <SiteMap record={record} selectedMachineId={activeMachineId} />
          <div className="cx-running">
            <h3>Running now</h3>
            <ul>
              {machines.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`cx-device-row${m.id === activeMachineId ? " active" : ""}`}
                    onClick={() => setSelectedMachineId(m.id)}
                  >
                    <strong>{m.label}</strong>
                    <span>
                      {m.kind} · {m.vendor} · {m.status}
                      {typeof m.batteryPct === "number" ? ` · ${m.batteryPct}%` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <DeviceDetailPanel machine={selectedMachine} nowIso={nowIso} operatorAudit={operatorAudit} />
        </section>
      </div>
    </div>
  );
}

/** Site map rendered as an answer: zone polygons, colored only by coverage state. */
function SiteMap(props: { record: SiteRecord; selectedMachineId?: string }) {
  const { record, selectedMachineId } = props;
  const { boundary, zones, noGoZones, dockLocations } = siteGeometry;
  // ENU site frame is ~120 x 90; render directly with a small margin.
  const W = 120;
  const H = 90;
  const stateById = new Map(record.coverageZones.map((z) => [z.id, z.state]));
  const nameById = new Map(coverageZones.map((z) => [z.id, z.name]));
  const selectedTrail = selectedMachineId ? trailForMachine(selectedMachineId) : [];

  const toPath = (verts: { x: number; y: number }[]) =>
    verts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${H - p.y}`).join(" ") + " Z";
  const toPolyline = (points: { x: number; y: number }[]) =>
    points.map((p) => `${p.x},${H - p.y}`).join(" ");

  const toneFill = (state: EvidenceResult | undefined): string => {
    if (state === "exception") return "var(--red-soft)";
    if (state === "covered") return "var(--green-soft)";
    if (state === "stale" || state === "unreviewed") return "var(--amber-soft)";
    return "var(--panel-2)";
  };
  const toneStroke = (state: EvidenceResult | undefined): string => {
    if (state === "exception") return "var(--red)";
    if (state === "covered") return "var(--green)";
    if (state === "stale" || state === "unreviewed") return "var(--amber)";
    return "var(--line-strong)";
  };

  return (
    <svg className="cx-map" viewBox={`-4 -4 ${W + 8} ${H + 8}`} role="img" aria-label="Site coverage map">
      <path d={toPath(boundary)} fill="none" stroke="var(--line)" strokeWidth={0.6} />
      {zones.map((z) => {
        const state = stateById.get(z.zoneId);
        return (
          <g key={z.zoneId}>
            <path
              d={toPath(z.vertices)}
              fill={toneFill(state)}
              stroke={toneStroke(state)}
              strokeWidth={0.8}
            />
            <text
              x={z.vertices.reduce((s, p) => s + p.x, 0) / z.vertices.length}
              y={H - z.vertices.reduce((s, p) => s + p.y, 0) / z.vertices.length}
              textAnchor="middle"
              fontSize={3}
              fill="var(--ink)"
            >
              {nameById.get(z.zoneId) ?? z.zoneId.replace("Z-", "")}
            </text>
          </g>
        );
      })}
      {noGoZones.map((z) => (
        <path
          key={z.zoneId}
          d={toPath(z.vertices)}
          fill="none"
          stroke="var(--red)"
          strokeWidth={0.8}
          strokeDasharray="2 1.5"
        />
      ))}
      {dockLocations.map((dock) => (
        <circle
          key={dock.machineId}
          cx={dock.point.x}
          cy={H - dock.point.y}
          r={2}
          fill={dock.machineId === selectedMachineId ? "var(--ink)" : "var(--line-strong)"}
        />
      ))}
      {selectedTrail.length > 0 ? (
        <polyline
          points={toPolyline(selectedTrail.map((sample) => sample.point))}
          fill="none"
          stroke="var(--blue)"
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
      ) : null}
      {selectedTrail.map((sample) => (
        <circle
          key={`${sample.machineId}-${sample.at}`}
          cx={sample.point.x}
          cy={H - sample.point.y}
          r={1.8}
          fill={sample.state === "blocked" ? "var(--red)" : "var(--blue)"}
        />
      ))}
    </svg>
  );
}

function SituationPicker(props: {
  situations: Array<{ id: ScenarioId; label: string }>;
  selected: ScenarioId;
  onSelect: (id: ScenarioId) => void;
}) {
  return (
    <div className="cx-picker">
      {props.situations.map((s) => (
        <button
          key={s.id}
          type="button"
          className={s.id === props.selected ? "active" : ""}
          onClick={() => props.onSelect(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

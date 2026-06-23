import { coverageZones } from "../data/site";
import {
  activityForMachine,
  streamForMachine,
  trailForMachine
} from "../data/deviceTelemetry";
import type { DeviceStreamState, DeviceTrailPoint, Machine } from "../domain/types";
import type { OperatorAuditRecord } from "./auditChain";
import { IncidentReplay } from "./IncidentReplay";
import { SourceTag } from "./SourceTag";

const STREAM_LABELS: Record<DeviceStreamState["availability"], string> = {
  live_ready: "Live ready",
  standby: "Standby",
  recorded_only: "Recorded only",
  unavailable: "No video"
};

export function DeviceDetailPanel(props: {
  machine: Machine | undefined;
  nowIso: string;
  operatorAudit?: readonly OperatorAuditRecord[];
}) {
  const { machine, nowIso, operatorAudit } = props;
  if (!machine) return null;

  const stream = streamForMachine(machine.id);
  const activity = activityForMachine(machine.id);
  const trail = trailForMachine(machine.id);
  const moving = machine.status === "in_mission";

  return (
    <section className="cx-device-detail" aria-label={`${machine.label} device detail`}>
      <div className="cx-device-head">
        <div>
          <p className="cx-kicker">{machine.id}</p>
          <h3>{machine.label}</h3>
          <span>
            {machine.kind} · {machine.vendor} · {machine.status}
            {typeof machine.batteryPct === "number" ? ` · ${machine.batteryPct}%` : ""}
          </span>
        </div>
        <span className={`cx-device-motion ${moving ? "moving" : "idle"}`}>
          {moving ? "Moving" : "Not moving"}
        </span>
      </div>

      {stream ? <StreamPanel stream={stream} moving={moving} /> : null}
      <TrailPanel trail={trail} />

      <IncidentReplay machine={machine} nowIso={nowIso} operatorAudit={operatorAudit} />

      <div className="cx-activity">
        <div className="cx-device-section-title">
          <strong>Activity dump</strong>
          <span>{activity.length} retained records</span>
        </div>
        <ol>
          {activity.map((item) => (
            <li key={item.id}>
              <time>{formatTime(item.at)}</time>
              <div>
                <strong>{item.title}</strong>
                <span>{item.summary}</span>
                <small>
                  {item.zoneId ? `${zoneLabel(item.zoneId)} · ` : ""}
                  {item.artifactRef ? "artifact retained · " : ""}
                  hash {item.hash} <SourceTag kind={item.source} />
                </small>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StreamPanel(props: { stream: DeviceStreamState; moving: boolean }) {
  const { stream, moving } = props;
  return (
    <div className={`cx-stream-panel stream-${stream.availability}`}>
      <div className="cx-video-surface">
        <span className="cx-stream-dot" />
        <strong>{stream.label}</strong>
        <span>{STREAM_LABELS[stream.availability]}</span>
        <small>
          {stream.availability === "unavailable"
            ? "Telemetry only"
            : moving
              ? "Real-time session should attach"
              : "Session opens on demand"}
        </small>
      </div>
      <dl className="cx-stream-facts">
        <div>
          <dt>Protocol</dt>
          <dd>{stream.protocol}</dd>
        </div>
        <div>
          <dt>Quality</dt>
          <dd>{stream.qualityLabel ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{typeof stream.latencyMs === "number" ? `${stream.latencyMs} ms` : "n/a"}</dd>
        </div>
        <div>
          <dt>Uplink</dt>
          <dd>{typeof stream.uplinkKbps === "number" ? `${stream.uplinkKbps} Kbps` : "n/a"}</dd>
        </div>
        <div>
          <dt>Retention</dt>
          <dd>{stream.retentionClass.replace("_", " ")}</dd>
        </div>
      </dl>
      <p>
        {stream.note} <SourceTag kind={stream.source} />
      </p>
    </div>
  );
}

function TrailPanel(props: { trail: DeviceTrailPoint[] }) {
  const { trail } = props;
  return (
    <div className="cx-trail-panel">
      <div className="cx-device-section-title">
        <strong>Trail</strong>
        <span>{trail.length} samples</span>
      </div>
      <TrailMap trail={trail} />
      <ul>
        {trail.slice(-4).map((point) => (
          <li key={`${point.machineId}-${point.at}-${point.point.x}-${point.point.y}`}>
            <time>{formatTime(point.at)}</time>
            <span>
              {point.zoneId ? zoneLabel(point.zoneId) : "site"} · ({point.point.x},{point.point.y}) · {point.state}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrailMap(props: { trail: DeviceTrailPoint[] }) {
  const { trail } = props;
  const W = 120;
  const H = 90;
  const points = trail.map((sample) => `${sample.point.x},${H - sample.point.y}`).join(" ");
  const last = trail[trail.length - 1];

  return (
    <svg className="cx-device-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Selected device trail">
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} fill="none" stroke="var(--line)" strokeWidth={0.6} />
      {points ? (
        <polyline points={points} fill="none" stroke="var(--blue)" strokeWidth={1.4} strokeLinejoin="round" />
      ) : null}
      {trail.map((sample) => (
        <circle
          key={`${sample.at}-${sample.point.x}-${sample.point.y}`}
          cx={sample.point.x}
          cy={H - sample.point.y}
          r={sample.state === "blocked" ? 2.4 : 1.7}
          fill={sample.state === "blocked" ? "var(--red)" : "var(--blue)"}
        />
      ))}
      {last ? (
        <circle
          cx={last.point.x}
          cy={H - last.point.y}
          r={3.2}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={0.9}
        />
      ) : null}
    </svg>
  );
}

function zoneLabel(zoneId: string): string {
  return coverageZones.find((zone) => zone.id === zoneId)?.name ?? zoneId;
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

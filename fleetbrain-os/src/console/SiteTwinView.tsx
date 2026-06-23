import { useMemo, useState } from "react";
import { activityForMachine, streamForMachine, trailForMachine } from "../data/deviceTelemetry";
import type { Machine, SiteRecord } from "../domain/types";
import type { ScenarioId } from "../data/scenarios";
import type { DecisionItem } from "./queue";

type DataLane = "live" | "history" | "onboarding";
type RetentionHorizon = "shift" | "7d" | "30d";

const LANE_COPY: Record<DataLane, { title: string; body: string }> = {
  live: {
    title: "Live operations",
    body: "Pose, battery, mission state, and stream session metadata are control-plane records. Raw video should terminate at the media gateway unless a clip is promoted."
  },
  history: {
    title: "Activity trail",
    body: "Trails, retained clips, images, inspection values, and mission status changes become queryable records with hashes and retention classes."
  },
  onboarding: {
    title: "Base twin",
    body: "The site model should come from a drone ortho/DSM, robot SLAM occupancy grid, traced zones, docks, waypoints, routes, and threshold rules."
  }
};

const HORIZON_LABEL: Record<RetentionHorizon, string> = {
  shift: "Shift",
  "7d": "7 days",
  "30d": "30 days"
};

export function SiteTwinView(props: {
  situations: Array<{ id: ScenarioId; label: string; question: string }>;
  selected: ScenarioId;
  onSelect: (id: ScenarioId) => void;
  record: SiteRecord | undefined;
  machines: Machine[];
  decisions: DecisionItem[];
  onOpenDecision: (decision: DecisionItem) => void;
}) {
  const { situations, selected, onSelect, record, machines, decisions, onOpenDecision } = props;
  const [lane, setLane] = useState<DataLane>("live");
  const [horizon, setHorizon] = useState<RetentionHorizon>("shift");
  const mobileMachines = machines.filter((machine) => machine.kind === "uav" || machine.kind === "quadruped");
  const [selectedMachineId, setSelectedMachineId] = useState<string | undefined>(mobileMachines[0]?.id);

  const selectedMachine = mobileMachines.find((machine) => machine.id === selectedMachineId) ?? mobileMachines[0];
  const selectedStream = selectedMachine ? streamForMachine(selectedMachine.id) : undefined;
  const selectedTrail = selectedMachine ? trailForMachine(selectedMachine.id) : [];
  const selectedActivity = selectedMachine ? activityForMachine(selectedMachine.id) : [];
  const siteDecisions = decisions.filter((decision) => decision.situationId === selected);
  const question = situations.find((s) => s.id === selected)?.question;
  const activeStreams = mobileMachines.filter((machine) => {
    const stream = streamForMachine(machine.id);
    return stream?.availability === "live_ready" || stream?.availability === "standby";
  }).length;

  const totals = useMemo(() => {
    const trailCount = mobileMachines.reduce((sum, machine) => sum + trailForMachine(machine.id).length, 0);
    const activityCount = mobileMachines.reduce((sum, machine) => sum + activityForMachine(machine.id).length, 0);
    return { trailCount, activityCount };
  }, [mobileMachines]);

  if (!record) return <div className="cx-boot">Loading site twin...</div>;

  return (
    <div className="cx-site-twin">
      <section className="cx-site-twin-stage" aria-label="Site twin map and 3D proof frame">
        <div className="cx-site-twin-toolbar">
          <div>
            <p className="cx-kicker">Site twin</p>
            <h1>Map and 3D model</h1>
          </div>
          <span>Sample Topaz frame - not a survey deliverable</span>
        </div>
        <iframe
          className="cx-site-twin-frame"
          src="/site-twin/index.html"
          title="FleetBrain site twin proof frame"
        />
      </section>

      <aside className="cx-site-twin-rail" aria-label="Site twin operational context">
        <div className="cx-twin-block">
          <SituationPicker situations={situations} selected={selected} onSelect={onSelect} />
          <h2>{record.site.name}</h2>
          {question ? <p>{question}</p> : null}
          <div className="cx-twin-metrics">
            <Metric label="Coverage" value={`${record.readiness.coveragePct}%`} />
            <Metric label="Open" value={String(siteDecisions.length)} />
            <Metric label="Streams" value={String(activeStreams)} />
            <Metric label="Stored" value={String(totals.activityCount + totals.trailCount)} />
          </div>
        </div>

        <div className="cx-twin-block">
          <div className="cx-device-section-title">
            <strong>Input lane</strong>
            <span>{HORIZON_LABEL[horizon]}</span>
          </div>
          <div className="cx-segmented" role="tablist" aria-label="Input lane">
            {(["live", "history", "onboarding"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={lane === value ? "active" : ""}
                onClick={() => setLane(value)}
              >
                {LANE_COPY[value].title}
              </button>
            ))}
          </div>
          <p className="cx-lane-copy">{LANE_COPY[lane].body}</p>
          <div className="cx-horizon">
            {(["shift", "7d", "30d"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={horizon === value ? "active" : ""}
                onClick={() => setHorizon(value)}
              >
                {HORIZON_LABEL[value]}
              </button>
            ))}
          </div>
        </div>

        <div className="cx-twin-block">
          <div className="cx-device-section-title">
            <strong>Devices</strong>
            <span>{mobileMachines.length} mobile records</span>
          </div>
          <div className="cx-twin-device-list">
            {mobileMachines.map((machine) => {
              const stream = streamForMachine(machine.id);
              return (
                <button
                  type="button"
                  key={machine.id}
                  className={`cx-twin-device${selectedMachine?.id === machine.id ? " active" : ""}`}
                  onClick={() => setSelectedMachineId(machine.id)}
                >
                  <span>
                    <strong>{machine.label}</strong>
                    <small>
                      {machine.vendor} {machine.kind} - {machine.status}
                    </small>
                  </span>
                  <em className={`cx-stream-badge ${stream?.availability ?? "unavailable"}`}>
                    {streamLabel(stream?.availability)}
                  </em>
                </button>
              );
            })}
          </div>
        </div>

        {selectedMachine ? (
          <div className="cx-twin-block">
            <div className="cx-device-section-title">
              <strong>{selectedMachine.label}</strong>
              <span>{selectedMachine.batteryPct != null ? `${selectedMachine.batteryPct}% battery` : "no battery"}</span>
            </div>
            <dl className="cx-twin-facts">
              <div>
                <dt>Stream</dt>
                <dd>{selectedStream?.protocol ?? "none"}</dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd>{selectedStream?.latencyMs != null ? `${selectedStream.latencyMs} ms` : "n/a"}</dd>
              </div>
              <div>
                <dt>Retention</dt>
                <dd>{selectedStream?.retentionClass.replace("_", " ") ?? "n/a"}</dd>
              </div>
              <div>
                <dt>Trail samples</dt>
                <dd>{selectedTrail.length}</dd>
              </div>
            </dl>
            {selectedStream ? <p className="cx-lane-copy">{selectedStream.note}</p> : null}
            <ol className="cx-mini-feed">
              {selectedActivity.slice(0, 4).map((activity) => (
                <li key={activity.id}>
                  <time>{formatShortTime(activity.at)}</time>
                  <span>
                    <strong>{activity.title}</strong>
                    <small>{activity.summary}</small>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="cx-twin-block">
          <div className="cx-device-section-title">
            <strong>Open findings</strong>
            <span>{siteDecisions.length} for this situation</span>
          </div>
          <div className="cx-twin-finding-list">
            {siteDecisions.length === 0 ? <p className="cx-lane-copy">No open findings for this situation.</p> : null}
            {siteDecisions.slice(0, 6).map((decision) => (
              <button key={decision.id} type="button" onClick={() => onOpenDecision(decision)}>
                <em className={`sev-${decision.severity}`}>{decision.severity}</em>
                <span>
                  <strong>{decision.whatHappened}</strong>
                  <small>{decision.zoneName}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div>
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function SituationPicker(props: {
  situations: Array<{ id: ScenarioId; label: string }>;
  selected: ScenarioId;
  onSelect: (id: ScenarioId) => void;
}) {
  return (
    <div className="cx-picker compact">
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

function streamLabel(availability: string | undefined): string {
  if (availability === "live_ready") return "Live";
  if (availability === "standby") return "Standby";
  if (availability === "recorded_only") return "Recorded";
  return "None";
}

function formatShortTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    new Date(timestamp)
  );
}

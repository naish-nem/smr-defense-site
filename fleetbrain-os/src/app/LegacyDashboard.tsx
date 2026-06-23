import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  BatteryWarning,
  Boxes,
  CheckCircle2,
  CheckCheck,
  Clock3,
  ClipboardCheck,
  DatabaseZap,
  FileSearch,
  Layers,
  Map,
  Image,
  RadioTower,
  ShieldAlert,
  ShieldX,
  UserPlus
} from "lucide-react";
import { SimulatorAdapter } from "../adapters/SimulatorAdapter";
import { DjiCloudReadOnlyAdapter } from "../adapters/DjiCloudReadOnlyAdapter";
import { UnitreeReadOnlyAdapter } from "../adapters/UnitreeReadOnlyAdapter";
import { scenarios, type ScenarioId } from "../data/scenarios";
import type { AdapterHealth, EvidenceResult, SiteRecord } from "../domain/types";
import {
  applyWorkOrderAction,
  deriveWorkOrders,
  mergeDerivedWorkOrders,
  type OperationLedger
} from "../domain/operationLedger";
import { evaluateCommandIntent } from "../kernel/CommandSafetyPolicy";
import { FleetBrainKernel } from "../kernel/FleetBrainKernel";
import { evaluateReadiness } from "../domain/readiness";
import { postAnalysisWindow } from "../data/postAnalysis";
import { summarizePostAnalysis } from "../domain/postAnalysis";
import { OperationsConsole, type PhaseSummary } from "../kernel/OperationsConsole";
import { usePersistentState } from "./usePersistentState";

/** Fixed, deterministic instant used to drive the phases-0-4 build status panel. */
const PHASE_SUMMARY_NOW = "2026-06-18T10:00:00.000Z";

const zonePositions: Record<string, { x: number; y: number; w: number; h: number }> = {
  "Z-BESS": { x: 7, y: 10, w: 33, h: 30 },
  "Z-SWITCHGEAR": { x: 48, y: 10, w: 24, h: 26 },
  "Z-SOLAR": { x: 9, y: 58, w: 44, h: 28 },
  "Z-LOAD-DOCK": { x: 61, y: 57, w: 30, h: 28 },
  "Z-PERIMETER": { x: 74, y: 13, w: 18, h: 28 }
};

const imageByPayload: Record<string, string> = {
  "/uploads/smr-drone-inspection.png": "/assets/drone-inspection.png",
  "/uploads/smr-quadruped-inspection.png": "/assets/quadruped-inspection.png",
  "/uploads/smr-thermal-anomaly.png": "/assets/thermal-anomaly.png",
  "/uploads/smr-remote-operations.png": "/assets/remote-operations.png"
};

const stateCopy: Record<EvidenceResult, string> = {
  covered: "covered",
  exception: "attention",
  stale: "stale",
  unreviewed: "unreviewed"
};

export function LegacyDashboard() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("seven_day_post_analysis");
  const [record, setRecord] = useState<SiteRecord | null>(null);
  const [vendorHealth, setVendorHealth] = useState<AdapterHealth[]>([]);
  const [ledger, setLedger] = usePersistentState<OperationLedger>("fleetbrain.operationLedger", {
    workOrders: [],
    audit: []
  });
  const [phaseSummary, setPhaseSummary] = useState<PhaseSummary | null>(null);

  const scenario = useMemo(() => scenarios.find((item) => item.id === scenarioId) ?? scenarios[0], [scenarioId]);
  const simulatorAdapter = useMemo(() => new SimulatorAdapter(scenarioId), [scenarioId]);
  const vendorAdapters = useMemo(() => [new DjiCloudReadOnlyAdapter({}), new UnitreeReadOnlyAdapter({})], []);

  useEffect(() => {
    const kernel = new FleetBrainKernel(simulatorAdapter);

    void kernel.buildCurrentSiteRecord("SITE-FPR-01").then(setRecord);
    void Promise.all(vendorAdapters.map((adapter) => adapter.reportAdapterHealth())).then(setVendorHealth);
  }, [simulatorAdapter, vendorAdapters]);

  useEffect(() => {
    if (!record) return;
    setLedger((current) => ({
      ...current,
      workOrders: mergeDerivedWorkOrders(current.workOrders, deriveWorkOrders(record))
    }));
  }, [record, setLedger]);

  useEffect(() => {
    let active = true;
    void new OperationsConsole().runPhaseSummary(PHASE_SUMMARY_NOW).then((summary) => {
      if (active) setPhaseSummary(summary);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!record) {
    return <div className="boot">Starting FleetBrain kernel...</div>;
  }

  const primaryException = record.openExceptions[0];
  const currentScenarioEvents = scenario.events;
  const readinessDecision = evaluateReadiness(record);
  const analysisSummary = summarizePostAnalysis(postAnalysisWindow);
  const unresolvedWorkOrders = ledger.workOrders.filter((item) => item.status !== "reviewed");
  const commandDecision = evaluateCommandIntent({
    intent: {
      id: "intent-followup-pass",
      type: "dispatch_machine",
      targetMachineId: "M-UAV-01",
      reason: "Follow-up coverage requested from exception workbench."
    },
    record,
    adapters: [simulatorAdapter, ...vendorAdapters]
  });
  const timeline = [
    ...currentScenarioEvents.map((event) => ({
      id: event.id,
      at: event.timestamp,
      kind: "machine event",
      title: event.eventType.replaceAll("_", " "),
      detail: `${event.sourceMachineId} · ${event.rawStatus}`
    })),
    ...record.auditTrail.map((event) => ({
      id: event.id,
      at: event.timestamp,
      kind: event.actor,
      title: event.action.replaceAll("_", " "),
      detail: event.detail
    })),
    ...ledger.audit.map((event) => ({
      id: event.id,
      at: event.timestamp,
      kind: event.actor,
      title: event.action.replaceAll("_", " "),
      detail: event.detail
    }))
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">FB</div>
          <div>
            <strong>FleetBrain OS</strong>
            <span>Read-only orchestration kernel</span>
          </div>
        </div>

        <section>
          <p className="sideLabel">Adapter feed</p>
          <div className="scenarioList">
            {scenarios.map((item) => (
              <button
                className={item.id === scenarioId ? "active" : ""}
                key={item.id}
                onClick={() => setScenarioId(item.id)}
                type="button"
              >
                <strong>{item.label}</strong>
                <span>{item.operationalQuestion}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="missing">
          <p className="sideLabel">Missing for real world</p>
          <ul>
            <li>DJI Cloud workspace, MQTT broker, media library credentials</li>
            <li>Unitree robot network access and SDK/WebRTC mode</li>
            <li>Site geometry, zone polygons, inspection SLA windows</li>
            <li>Artifact store, user identities, assignment workflow</li>
            <li>Safety case before any command path exists</li>
          </ul>
        </section>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="kicker">Current site record</p>
            <h1>{record.site.name}</h1>
            <p>{record.site.location} · {record.site.mission}</p>
          </div>
          <div className="authority">
            <ShieldAlert size={18} />
            <span>No hardware command authority</span>
          </div>
        </header>

        <section className="metrics">
          <Metric icon={<ClipboardCheck />} label="Readiness" value={readinessDecision.outcome.replaceAll("_", " ")} />
          <Metric icon={<Image />} label="Artifacts analyzed" value={analysisSummary.totalArtifacts.toString()} />
          <Metric icon={<AlertTriangle />} label="Action findings" value={analysisSummary.urgentOrActionCount.toString()} />
          <Metric icon={<UserPlus />} label="Active work" value={unresolvedWorkOrders.length.toString()} />
        </section>

        <section className="panel analysisPanel">
          <PanelHeading
            icon={<DatabaseZap />}
            title="Post-analysis window"
            subtitle={`${formatDate(postAnalysisWindow.start)} to ${formatDate(postAnalysisWindow.end)} · retrieved data reconciled into findings.`}
          />
          <div className="analysisStrip">
            <div><b>{postAnalysisWindow.retrieved.machineEvents}</b><span>machine events</span></div>
            <div><b>{postAnalysisWindow.retrieved.rgbImages}</b><span>RGB images</span></div>
            <div><b>{postAnalysisWindow.retrieved.thermalFrames}</b><span>thermal frames</span></div>
            <div><b>{postAnalysisWindow.retrieved.videoClips}</b><span>video clips</span></div>
            <div><b>{analysisSummary.humanReviewCount}</b><span>human reviews</span></div>
          </div>
          <div className="findingBoard">
            {postAnalysisWindow.findings.map((finding) => (
              <div className={`finding ${finding.severity}`} key={finding.id}>
                <div className="findingTop">
                  <strong>{finding.title}</strong>
                  <span>{finding.severity}</span>
                </div>
                <p>{finding.summary}</p>
                <small>{finding.assetId} · {finding.occurrences} occurrence(s) · {finding.trend} · {Math.round(finding.confidence * 100)}%</small>
              </div>
            ))}
          </div>
        </section>

        <section className="panel readinessPanel">
          <PanelHeading icon={<RadioTower />} title="Readiness decision" subtitle={readinessDecision.recommendedDecision} />
          <div className="readinessGrid">
            {readinessDecision.gates.map((gate) => (
              <div className={`readinessGate ${gate.status}`} key={gate.id}>
                <div>
                  <strong>{gate.label}</strong>
                  <span>{gate.reason}</span>
                </div>
                <b>{gate.status}</b>
              </div>
            ))}
          </div>
        </section>

        {phaseSummary ? (
          <section className="panel phasePanel">
            <PanelHeading
              icon={<Layers />}
              title="Phases 0–4 — live build status"
              subtitle="Deterministic facade run across demo, mission, arbiter, edge, and autonomy packages."
            />
            <div className="phaseGrid">
              <div className="phaseCard">
                <span className="phaseLabel">Phase 0 · Demo</span>
                <strong>{phaseSummary.demo.mode.replaceAll("_", " ")}</strong>
                <small>
                  {phaseSummary.demo.frameCount} frames · {phaseSummary.demo.hasLiveStep ? "LIVE step present" : "no LIVE step"}
                </small>
                <p className="phaseBanner">{phaseSummary.demo.banner}</p>
              </div>

              <div className="phaseCard">
                <span className="phaseLabel">Phase 1 · Mission</span>
                <strong>{phaseSummary.mission.finalState}</strong>
                <small>
                  {phaseSummary.mission.transitionCount} transitions ·{" "}
                  {phaseSummary.mission.allTransitionsLegal ? "all legal" : "illegal transition"}
                </small>
              </div>

              <div className="phaseCard">
                <span className="phaseLabel">Phase 3 · Arbiter</span>
                <div className="phaseDecisions">
                  <span className={`phasePill ${phaseSummary.arbiter.valid.allowed ? "pass" : "fail"}`}>
                    valid: {phaseSummary.arbiter.valid.allowed ? "allowed" : `denied (${phaseSummary.arbiter.valid.deniedByGate})`}
                  </span>
                  <span className={`phasePill ${phaseSummary.arbiter.invalid.allowed ? "fail" : "pass"}`}>
                    no-go: {phaseSummary.arbiter.invalid.allowed ? "allowed" : `denied · ${phaseSummary.arbiter.invalid.deniedByGate}`}
                  </span>
                </div>
                <small>chain {phaseSummary.arbiter.chainVerified ? "verified" : "broken"}</small>
              </div>

              <div className="phaseCard">
                <span className="phaseLabel">Phase 2 · Edge soak</span>
                <strong>{phaseSummary.edge.deliveredCount} delivered</strong>
                <small>
                  {phaseSummary.edge.lostCount} lost · link-loss {Math.round(phaseSummary.edge.linkLossRatio * 100)}% ·{" "}
                  {phaseSummary.edge.dataLoss ? "DATA LOSS" : "zero data loss"}
                </small>
              </div>

              <div className="phaseCard">
                <span className="phaseLabel">Phase 4 · Autonomy</span>
                <strong>
                  {phaseSummary.autonomy.gate.completedLoops}/{phaseSummary.autonomy.gate.requestedLoops} loops ·{" "}
                  {phaseSummary.autonomy.gate.takeoverCount} takeovers
                </strong>
                <small>
                  gate {phaseSummary.autonomy.gate.passedGate ? "passed" : "failed"} · precision{" "}
                  {Math.round(phaseSummary.autonomy.perception.precision * 100)}% · recall{" "}
                  {Math.round(phaseSummary.autonomy.perception.recall * 100)}% · FP{" "}
                  {Math.round(phaseSummary.autonomy.perception.falsePositiveRate * 100)}%
                </small>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid primary">
          <article className="panel mapPanel">
            <PanelHeading icon={<Map />} title="Site coverage" subtitle="Zone state derived from adapter events and evidence logic." />
            <div className="siteMap">
              {record.coverageZones.map((zone) => {
                const position = zonePositions[zone.id];
                return (
                  <div
                    className={`zone ${zone.state}`}
                    key={zone.id}
                    style={{
                      left: `${position.x}%`,
                      top: `${position.y}%`,
                      width: `${position.w}%`,
                      height: `${position.h}%`
                    }}
                  >
                    <strong>{zone.name}</strong>
                    <span>{stateCopy[zone.state]}</span>
                  </div>
                );
              })}
              <div className="machinePin uav">UAV</div>
              <div className="machinePin ugv">UGV</div>
              <div className="machinePin fixed">TH</div>
            </div>
          </article>

          <article className="panel exceptionPanel">
            <PanelHeading
              icon={primaryException ? <ShieldAlert /> : <CheckCircle2 />}
              title="Exception workbench"
              subtitle="Human-owned work orders derived from evidence-backed exceptions."
            />
            {ledger.workOrders.length ? (
              <div className="workbench">
                {ledger.workOrders.map((workOrder) => (
                  <div className="workOrder" key={workOrder.id}>
                    <div className="workOrderTop">
                      <div className={`severity ${workOrder.severity}`}>{workOrder.severity}</div>
                      <span className={`status ${workOrder.status}`}>{workOrder.status}</span>
                    </div>
                    <h2>{workOrder.type.replaceAll("_", " ")}</h2>
                    <p>{workOrder.location}</p>
                    <dl>
                      <div>
                        <dt>Owner</dt>
                        <dd>{workOrder.owner}</dd>
                      </div>
                      <div>
                        <dt>Next action</dt>
                        <dd>{workOrder.nextAction}</dd>
                      </div>
                      <div>
                        <dt>Evidence</dt>
                        <dd>{workOrder.evidenceRefs.join(", ") || "coverage gap detected by absence"}</dd>
                      </div>
                    </dl>
                    <div className="workActions">
                      <button type="button" onClick={() => assignWorkOrder(workOrder.id)}>
                        <UserPlus size={15} /> Assign
                      </button>
                      <button type="button" onClick={() => reviewWorkOrder(workOrder.id)}>
                        <CheckCheck size={15} /> Reviewed
                      </button>
                      <button type="button" onClick={() => escalateWorkOrder(workOrder.id)}>
                        <AlertTriangle size={15} /> Escalate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="emptyState">All zones have accepted evidence for this scenario.</div>
            )}
          </article>
        </section>

        <section className="grid secondary">
          <article className="panel">
            <PanelHeading icon={<Clock3 />} title="Operational timeline" subtitle="Machine events, ingestion audit, projection audit, and operator actions." />
            <div className="timeline">
              {timeline.slice(0, 8).map((item) => (
                <div className="timelineItem" key={item.id}>
                  <time>{formatTime(item.at)}</time>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.kind} · {item.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <PanelHeading icon={<FileSearch />} title="Evidence ledger" subtitle="Current-site claims after multi-day retrieval and latest adapter pass." />
            <div className="ledger">
              {record.latestEvidence.map((evidence) => (
                <div className="ledgerRow" key={evidence.id}>
                  <img src={imageByPayload[evidence.artifactRefs[0]] ?? "/assets/remote-operations.png"} alt="" />
                  <div>
                    <strong>{evidence.zoneId} · {evidence.result}</strong>
                    <span>{evidence.sourceMachineId} at {formatTime(evidence.checkedAt)} · confidence {Math.round(evidence.confidence * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <PanelHeading icon={<BatteryWarning />} title="Raw / unlinked inputs" subtitle="Telemetry or status inputs that need mapping before they can support a site claim." />
            <div className="rawList">
              {record.rawUnreviewedEvents.length ? (
                record.rawUnreviewedEvents.map((event) => (
                  <div className="rawEvent" key={event.id}>
                    <strong>{event.eventType}</strong>
                    <span>{event.sourceMachineId} · {event.rawStatus}</span>
                  </div>
                ))
              ) : (
                <div className="emptyState">No raw-only events in this scenario.</div>
              )}
            </div>
          </article>

          <article className="panel">
            <PanelHeading icon={<Boxes />} title="Adapter registry" subtitle="Registered future adapters, capabilities, and missing integration inputs." />
            <div className="adapterStack">
              <div className="adapterHealth healthy">
                <strong>{simulatorAdapter.adapterId}</strong>
                <span>Deterministic scenario adapter. Schema-mapped and read-only.</span>
                <small>Capabilities: state, events, media, health · commandHardware=false</small>
              </div>
              {vendorHealth.map((health) => (
                <div className="adapterHealth" key={health.adapterId}>
                  <strong>{health.adapterId}</strong>
                  <span>{health.message}</span>
                  <small>{health.missingInputs.length ? `Missing: ${health.missingInputs.join(", ")}` : "Ready to normalize"}</small>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <PanelHeading icon={<ShieldX />} title="Command safety policy" subtitle="FleetBrain can recommend work, but it cannot command machines yet." />
            <div className="policyBox">
              <strong>{commandDecision.allowed ? "Command allowed" : "Command blocked"}</strong>
              <ul>
                {commandDecision.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          </article>
        </section>

        <section className="panel artifactPanel">
          <PanelHeading icon={<Image />} title="Retrieved artifact review" subtitle="Representative items from the multi-day image, thermal, video, and telemetry retrieval." />
          <div className="artifactGrid">
            {postAnalysisWindow.artifacts.map((artifact) => (
              <div className="artifactCard" key={artifact.id}>
                <img src={artifact.uri} alt="" />
                <div>
                  <strong>{artifact.assetId}</strong>
                  <span>{artifact.artifactType.replaceAll("_", " ")} · {artifact.day}</span>
                  <small>{artifact.sourceMachineId} · {artifact.reviewState.replaceAll("_", " ")}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );

  function assignWorkOrder(workOrderId: string) {
    setLedger((current) =>
      applyWorkOrderAction(current, {
        type: "assign",
        workOrderId,
        owner: "Field Ops",
        at: new Date().toISOString()
      })
    );
  }

  function reviewWorkOrder(workOrderId: string) {
    setLedger((current) =>
      applyWorkOrderAction(current, {
        type: "mark_reviewed",
        workOrderId,
        at: new Date().toISOString()
      })
    );
  }

  function escalateWorkOrder(workOrderId: string) {
    setLedger((current) =>
      applyWorkOrderAction(current, {
        type: "escalate",
        workOrderId,
        at: new Date().toISOString()
      })
    );
  }
}

function Metric(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {props.icon}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function PanelHeading(props: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="panelHeading">
      <div className="panelIcon">{props.icon}</div>
      <div>
        <h2>{props.title}</h2>
        <p>{props.subtitle}</p>
      </div>
    </div>
  );
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

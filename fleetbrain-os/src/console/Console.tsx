import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState } from "../app/usePersistentState";
import { SimulatorAdapter } from "../adapters/SimulatorAdapter";
import { scenarios, type ScenarioId } from "../data/scenarios";
import { FleetBrainKernel } from "../kernel/FleetBrainKernel";
import type { Machine, SiteRecord } from "../domain/types";
import { buildDecisionQueue, siteName, type DecisionItem } from "./queue";
import { DecisionActionRouter } from "./decisionActions";
import type { DecisionActionKind, DecisionActionResult } from "./decisionActions";
import type { OperatorAuditRecord } from "./auditChain";
import { QueueView } from "./QueueView";
import { SiteTruthView } from "./SiteTruthView";
import { SiteTwinView } from "./SiteTwinView";
import { ProofView } from "./ProofView";
import { DevView } from "./DevView";
import { IncidentWorkflow } from "./IncidentWorkflow";
import { OPERATOR_ROLES, ROLE_LABELS, roleBlockReason, roleCan, type OperatorRole } from "./roles";
import type { DecisionActionState } from "./DecisionCard";
import "./console.css";

/**
 * The FleetBrain console shell. Three surfaces — Queue, Site Truth, Proof — plus a
 * de-emphasized Dev link. The Queue is the default and the heart of the product.
 *
 * A FIXED demo clock drives every operator action so the audit is reproducible
 * (CLAUDE.md invariant 3: determinism). The clock advances by a fixed step per
 * action; it never reads the wall clock for logic.
 */

type Surface = "queue" | "map" | "truth" | "proof" | "incident" | "dev";

/**
 * Demo weather hold: high wind exceeds the UAV airframe envelope. This is a
 * CONFIGURED demo constant (SourceTag "authored") — when on, the arbiter's weather
 * gate denies UAV dispatch; ground-unit motion is unaffected. Default OFF so the
 * golden path stays green.
 */
const DEFAULT_WEATHER = { hold: false, reason: "" } as const;

const DEMO_CLOCK_START = Date.parse("2026-06-19T06:00:00.000Z");
const DEMO_CLOCK_STEP_MS = 60_000;
const STORAGE_PREFIX = "fleetbrain.console.v2";
const TERMINAL_ACTIONS: ReadonlySet<DecisionActionKind> = new Set([
  "confirm",
  "dismiss",
  "escalate"
]);

export function Console() {
  const [surface, setSurface] = useState<Surface>("queue");
  const [role, setRole] = usePersistentState<OperatorRole>(`${STORAGE_PREFIX}.role`, "operator");
  const [weatherHold, setWeatherHold] = usePersistentState(`${STORAGE_PREFIX}.weatherHold`, false);
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);
  const [recordsByScenario, setRecordsByScenario] = useState<
    Array<{ scenarioId: ScenarioId; record: SiteRecord }>
  >([]);
  const [machinesByScenario, setMachinesByScenario] = useState<Record<string, Machine[]>>({});
  const [selectedSituation, setSelectedSituation] = usePersistentState<ScenarioId>(
    `${STORAGE_PREFIX}.selectedSituation`,
    scenarios[0].id
  );

  // Resolved decisions are removed from the queue; track by id.
  const [resolvedIds, setResolvedIds] = usePersistentState<string[]>(`${STORAGE_PREFIX}.resolvedIds`, []);
  // Operator audit chain (UI mirror); the router owns the authoritative chain.
  const [operatorAudit, setOperatorAudit] = usePersistentState<OperatorAuditRecord[]>(
    `${STORAGE_PREFIX}.operatorAudit`,
    []
  );
  // Last dispatch outcome per decision id, so the card can show ALLOWED/DENIED.
  const [actionResults, setActionResults] = usePersistentState<Record<string, DecisionActionResult>>(
    `${STORAGE_PREFIX}.actionResults`,
    {}
  );

  // One router for the whole session, seeded per-situation machine rosters.
  const routerRef = useRef<DecisionActionRouter | null>(null);
  if (!routerRef.current) {
    routerRef.current = new DecisionActionRouter({ seedAudit: operatorAudit });
  }
  const router = routerRef.current;
  const [clockMs, setClockMs] = usePersistentState(`${STORAGE_PREFIX}.clockMs`, DEMO_CLOCK_START);

  useEffect(() => {
    let active = true;
    async function load() {
      const built = await Promise.all(
        scenarios.map(async (scenario) => {
          const adapter = new SimulatorAdapter(scenario.id);
          const kernel = new FleetBrainKernel(adapter);
          const [record, machines] = await Promise.all([
            kernel.buildCurrentSiteRecord("SITE-FPR-01"),
            adapter.readMachineState()
          ]);
          return { scenarioId: scenario.id, record, machines };
        })
      );
      if (!active) return;
      setRecordsByScenario(built.map(({ scenarioId, record }) => ({ scenarioId, record })));
      setMachinesByScenario(
        Object.fromEntries(built.map(({ scenarioId, machines }) => [scenarioId, machines]))
      );
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const allDecisions = useMemo(
    () => buildDecisionQueue(recordsByScenario, { source: "RECORDED" }),
    [recordsByScenario]
  );
  const openDecisions = useMemo(
    () => {
      const resolved = new Set(resolvedIds);
      return allDecisions.filter((d) => !resolved.has(d.id));
    },
    [allDecisions, resolvedIds]
  );

  const weather = useMemo(
    () => ({ hold: weatherHold, reason: weatherHold ? "high wind exceeds UAV airframe envelope" : undefined }),
    [weatherHold]
  );

  function actionState(action: DecisionActionKind, decision: DecisionItem): DecisionActionState {
    if (!roleCan(role, action)) {
      return { enabled: false, reason: roleBlockReason(role, action) };
    }
    const lastResult = actionResults[decision.id];
    if (action === "dispatch" && lastResult?.action === "dispatch" && lastResult.dispatch?.allowed) {
      return { enabled: false, reason: "verification mission in flight" };
    }
    return { enabled: true };
  }

  function handleAction(action: DecisionActionKind, decision: DecisionItem) {
    const nowIso = new Date(clockMs).toISOString();
    const situationMachines = machinesByScenario[decision.situationId];
    const result = router.act(action, decision, nowIso, situationMachines, { role, weather });
    setClockMs((ms) => ms + DEMO_CLOCK_STEP_MS);
    setOperatorAudit([...router.auditChain()]);
    setActionResults((current) => ({ ...current, [decision.id]: result }));

    // Verification commands start work; confirm/dismiss/escalate are the closeout.
    if (TERMINAL_ACTIONS.has(action)) {
      setResolvedIds((current) => (current.includes(decision.id) ? current : [...current, decision.id]));
    }
  }

  function openIncident(decision: DecisionItem) {
    setSelectedDecisionId(decision.id);
    setSurface("incident");
  }

  const selectedDecision = allDecisions.find((d) => d.id === selectedDecisionId);

  const recordForSituation = recordsByScenario.find((r) => r.scenarioId === selectedSituation)?.record;

  if (recordsByScenario.length === 0) {
    return <div className="cx-boot">Building situation records…</div>;
  }

  return (
    <div className="cx-shell">
      <header className="cx-topbar">
        <div className="cx-brand">
          <span className="cx-mark">FB</span>
          <div>
            <strong>FleetBrain</strong>
            <span className="cx-site">{siteName}</span>
          </div>
        </div>
        <nav className="cx-switch">
          <button className={surface === "queue" ? "active" : ""} onClick={() => setSurface("queue")} type="button">
            Queue
            {openDecisions.length > 0 ? <span className="cx-count">{openDecisions.length}</span> : null}
          </button>
          <button className={surface === "map" ? "active" : ""} onClick={() => setSurface("map")} type="button">
            Map
          </button>
          <button className={surface === "truth" ? "active" : ""} onClick={() => setSurface("truth")} type="button">
            Site Truth
          </button>
          <button className={surface === "proof" ? "active" : ""} onClick={() => setSurface("proof")} type="button">
            Proof
          </button>
        </nav>
        <div className="cx-controls">
          <label className="cx-role">
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as OperatorRole)}>
              {OPERATOR_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="cx-weather" title="Demo weather hold — denies UAV flight (configured)">
            <input type="checkbox" checked={weatherHold} onChange={(e) => setWeatherHold(e.target.checked)} />
            <span>Weather hold</span>
          </label>
        </div>
        <button className={`cx-dev ${surface === "dev" ? "active" : ""}`} onClick={() => setSurface("dev")} type="button">
          Dev
        </button>
      </header>

      <main className={`cx-main${surface === "map" ? " cx-main-twin" : ""}`}>
        {surface === "queue" ? (
          <QueueView
            decisions={openDecisions}
            actionResults={actionResults}
            getActionState={actionState}
            onAction={handleAction}
            onOpen={openIncident}
          />
        ) : null}

        {surface === "incident" && selectedDecision ? (
          <IncidentWorkflow
            decision={selectedDecision}
            machines={machinesByScenario[selectedDecision.situationId] ?? []}
            role={role}
            weather={weather}
            nowIso={new Date(clockMs).toISOString()}
            result={actionResults[selectedDecision.id]}
            onAction={handleAction}
            onBack={() => setSurface("queue")}
          />
        ) : null}

        {surface === "incident" && !selectedDecision ? (
          <div className="cx-empty">
            <strong>No incident selected.</strong>
            <button type="button" className="cx-back" onClick={() => setSurface("queue")}>
              ← Back to queue
            </button>
          </div>
        ) : null}

        {surface === "map" ? (
          <SiteTwinView
            situations={scenarios.map((s) => ({ id: s.id, label: s.label, question: s.operationalQuestion }))}
            selected={selectedSituation}
            onSelect={setSelectedSituation}
            record={recordForSituation}
            machines={machinesByScenario[selectedSituation] ?? []}
            decisions={openDecisions}
            onOpenDecision={openIncident}
          />
        ) : null}

        {surface === "truth" ? (
          <SiteTruthView
            situations={scenarios.map((s) => ({ id: s.id, label: s.label, question: s.operationalQuestion }))}
            selected={selectedSituation}
            onSelect={setSelectedSituation}
            record={recordForSituation}
            machines={machinesByScenario[selectedSituation] ?? []}
            nowIso={new Date(clockMs).toISOString()}
            operatorAudit={operatorAudit}
          />
        ) : null}

        {surface === "proof" ? (
          <ProofView
            situations={scenarios.map((s) => ({ id: s.id, label: s.label }))}
            selected={selectedSituation}
            onSelect={setSelectedSituation}
            record={recordForSituation}
            decisions={allDecisions.filter((d) => d.situationId === selectedSituation)}
            operatorAudit={operatorAudit}
          />
        ) : null}

        {surface === "dev" ? <DevView /> : null}
      </main>
    </div>
  );
}

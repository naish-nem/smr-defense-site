import { useEffect, useState } from "react";
import { OperationsConsole, type PhaseSummary } from "../kernel/OperationsConsole";
import { LegacyDashboard } from "../app/LegacyDashboard";

/**
 * Dev — the hidden, de-emphasized engineering surface. Holds the Phases 0–4 build
 * status (an engineering artifact, not a user surface) and a route to the preserved
 * legacy dashboard, so nothing built earlier is lost.
 */

const PHASE_SUMMARY_NOW = "2026-06-18T10:00:00.000Z";

export function DevView() {
  const [summary, setSummary] = useState<PhaseSummary | null>(null);
  const [showLegacy, setShowLegacy] = useState(false);

  useEffect(() => {
    let active = true;
    void new OperationsConsole().runPhaseSummary(PHASE_SUMMARY_NOW).then((s) => {
      if (active) setSummary(s);
    });
    return () => {
      active = false;
    };
  }, []);

  if (showLegacy) {
    return (
      <div className="cx-dev-legacy">
        <button className="cx-export" type="button" onClick={() => setShowLegacy(false)}>
          ← Back to Dev
        </button>
        <LegacyDashboard />
      </div>
    );
  }

  return (
    <div className="cx-devview">
      <div className="cx-dev-head">
        <h1>Dev · build status</h1>
        <p className="cx-sub">Engineering artifact. Not a user surface.</p>
        <button className="cx-export" type="button" onClick={() => setShowLegacy(true)}>
          Open legacy dashboard
        </button>
      </div>

      {summary ? (
        <div className="cx-phase-grid">
          <PhaseCard title="Phase 0 · Demo" headline={summary.demo.mode.replace(/_/g, " ")}>
            {summary.demo.frameCount} frames · {summary.demo.hasLiveStep ? "LIVE step present" : "no LIVE step"}
          </PhaseCard>
          <PhaseCard title="Phase 1 · Mission" headline={summary.mission.finalState}>
            {summary.mission.transitionCount} transitions · {summary.mission.allTransitionsLegal ? "all legal" : "illegal transition"}
          </PhaseCard>
          <PhaseCard title="Phase 3 · Arbiter" headline={summary.arbiter.chainVerified ? "chain verified" : "chain broken"}>
            valid: {summary.arbiter.valid.allowed ? "allowed" : `denied (${summary.arbiter.valid.deniedByGate})`} · no-go:{" "}
            {summary.arbiter.invalid.allowed ? "allowed" : `denied · ${summary.arbiter.invalid.deniedByGate}`}
          </PhaseCard>
          <PhaseCard title="Phase 2 · Edge soak" headline={`${summary.edge.deliveredCount} delivered`}>
            {summary.edge.lostCount} lost · link-loss {Math.round(summary.edge.linkLossRatio * 100)}% ·{" "}
            {summary.edge.dataLoss ? "DATA LOSS" : "zero data loss"}
          </PhaseCard>
          <PhaseCard
            title="Phase 4 · Autonomy"
            headline={`${summary.autonomy.gate.completedLoops}/${summary.autonomy.gate.requestedLoops} loops`}
          >
            {summary.autonomy.gate.takeoverCount} takeovers · precision {Math.round(summary.autonomy.perception.precision * 100)}% · recall{" "}
            {Math.round(summary.autonomy.perception.recall * 100)}%
          </PhaseCard>
        </div>
      ) : (
        <div className="cx-boot">Running phase summary…</div>
      )}
    </div>
  );
}

function PhaseCard(props: { title: string; headline: string; children: React.ReactNode }) {
  return (
    <div className="cx-phase-card">
      <span className="cx-phase-label">{props.title}</span>
      <strong>{props.headline}</strong>
      <small>{props.children}</small>
    </div>
  );
}

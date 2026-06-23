import type { DecisionItem } from "./queue";
import type { DecisionActionKind, DecisionActionResult } from "./decisionActions";

export interface DecisionActionState {
  enabled: boolean;
  reason?: string;
}

const QUICK_ACTIONS: Array<{ action: DecisionActionKind; label: string }> = [
  { action: "confirm", label: "Confirm" },
  { action: "dismiss", label: "Dismiss (false positive)" },
  { action: "dispatch", label: "Dispatch unit to verify" },
  { action: "escalate", label: "Escalate to customer" }
];

/**
 * A single decision card. The evidence image is the HERO — the brightest, largest
 * thing on the card, because it is the thing the human judges. Everything else is
 * quiet context plus a small fixed action set. Honesty labels (LIVE/RECORDED,
 * ALLOWED/DENIED + gate) are always present.
 */
export function DecisionCard(props: {
  decision: DecisionItem;
  result?: DecisionActionResult;
  getActionState?: (action: DecisionActionKind) => DecisionActionState;
  onAction: (action: DecisionActionKind) => void;
  onOpen?: () => void;
}) {
  const { decision, result, getActionState, onAction, onOpen } = props;
  const dispatch = result?.dispatch;

  return (
    <article className={`cx-card sev-${decision.severity}`}>
      <div className={`cx-card-evidence${decision.evidence.imageUri ? "" : " noframe"}`}>
        {decision.evidence.imageUri ? (
          <img src={decision.evidence.imageUri} alt={decision.whatHappened} />
        ) : (
          <div className="cx-noframe">
            <span className="cx-noframe-glyph" aria-hidden>◌</span>
            <strong>No visual frame</strong>
            <span>Sensor / telemetry evidence — {decision.sourceMachine}</span>
          </div>
        )}
        <span className={`cx-honesty ${decision.source === "LIVE" ? "live" : "recorded"}`}>
          {decision.source}
        </span>
      </div>

      <div className="cx-card-body">
        <div className="cx-card-top">
          <span className={`cx-sev sev-${decision.severity}`}>{decision.severity}</span>
          <span className="cx-situation">{decision.situationLabel}</span>
        </div>

        <h2>{decision.whatHappened}</h2>
        <p className="cx-where">
          {decision.zoneName} · {decision.sourceMachine} · {formatTime(decision.timestamp)}
        </p>

        <div className="cx-meta">
          <span>{decision.kind === "exception" ? "Exception" : "Needs review"}</span>
          {decision.relatedCount && decision.relatedCount > 1 ? (
            <span>{decision.relatedCount} related situations</span>
          ) : null}
          {typeof decision.evidence.confidence === "number" ? (
            <span title="Model/CV score from the source event — a score, not a physical measurement">
              confidence {Math.round(decision.evidence.confidence * 100)}% <em>model score</em>
            </span>
          ) : (
            <span><em>no model score</em></span>
          )}
        </div>

        {decision.relatedSituationLabels && decision.relatedSituationLabels.length > 1 ? (
          <p className="cx-related">
            Also open in {decision.relatedSituationLabels.join(", ")}
          </p>
        ) : null}

        {dispatch ? (
          <div className={`cx-arbiter ${dispatch.allowed ? "allow" : "deny"}`}>
            {dispatch.allowed ? (
              <>
                <strong>✓ ALLOWED</strong>
                <span>
                  Arbiter authorized dispatch
                  {dispatch.waypointLabel ? ` · ${dispatch.waypointLabel}` : ""}
                  {dispatch.missionId ? ` · mission ${dispatch.missionState}` : ""} · audit {dispatch.arbiterHash}
                </span>
              </>
            ) : (
              <>
                <strong>✗ DENIED · {dispatch.deniedByGate} gate</strong>
                <span>{dispatch.reasons.join(" · ")}</span>
              </>
            )}
          </div>
        ) : null}

        <div className="cx-actions">
          {onOpen ? (
            <button type="button" className="primary" onClick={onOpen}>
            Open incident →
          </button>
          ) : null}
          {QUICK_ACTIONS.map(({ action, label }) => {
            const state = getActionState?.(action) ?? { enabled: true };
            return (
              <button
                key={action}
                type="button"
                disabled={!state.enabled}
                title={state.enabled ? undefined : state.reason}
                onClick={() => onAction(action)}
              >
                {label}
                {!state.enabled && state.reason ? (
                  <span className="cx-block-reason">{state.reason}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

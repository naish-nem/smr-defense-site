import { useMemo } from "react";
import type { Machine } from "../domain/types";
import { SourceTag } from "./SourceTag";
import type { DecisionItem } from "./queue";
import type { DecisionActionKind, DecisionActionResult } from "./decisionActions";
import { roleBlockReason, roleCan, ROLE_LABELS, type OperatorRole } from "./roles";
import {
  buildIncidentModel,
  previewEligibility,
  recallDockLabel,
  type TaggedValue
} from "./incident";

/**
 * IncidentWorkflow — the centerpiece. ONE decision rendered as the full loop from
 * alert to approved robot action to audited closeout. Narrow, deep, honest: every
 * value carries a SourceTag, no value is asserted without provenance, and motion
 * buttons are enabled only if (role permits) AND (the arbiter allows).
 *
 * Pure-ish: all derivation is in incident.ts; this component only renders and
 * routes the operator's chosen action back up to the Console (single audit chain).
 */

const ALL_ACTIONS: DecisionActionKind[] = [
  "confirm",
  "dismiss",
  "dispatch",
  "escalate",
  "recall",
  "estop"
];

const ACTION_LABELS: Record<DecisionActionKind, string> = {
  confirm: "Confirm",
  dismiss: "Dismiss (false positive)",
  dispatch: "Dispatch unit to verify",
  escalate: "Escalate to customer",
  recall: "Recall unit",
  estop: "E-stop unit"
};

const TERMINAL_ACTIONS: ReadonlySet<DecisionActionKind> = new Set([
  "confirm",
  "dismiss",
  "escalate"
]);

function isTerminalAction(action: DecisionActionKind | undefined): boolean {
  return action ? TERMINAL_ACTIONS.has(action) : false;
}

function Value(props: { v: TaggedValue }) {
  const { v } = props;
  return (
    <div className="cx-iv">
      <span className="cx-iv-label">{v.label}</span>
      <span className="cx-iv-value">
        {v.value} <SourceTag kind={v.source} />
      </span>
      {v.note ? <span className="cx-iv-note">{v.note}</span> : null}
    </div>
  );
}

function Step(props: {
  n: number;
  title: string;
  children: React.ReactNode;
  done?: boolean;
}) {
  return (
    <li className={`cx-step${props.done ? " done" : ""}`}>
      <div className="cx-step-rail">
        <span className="cx-step-dot">{props.done ? "✓" : props.n}</span>
      </div>
      <div className="cx-step-body">
        <h3>{props.title}</h3>
        {props.children}
      </div>
    </li>
  );
}

export function IncidentWorkflow(props: {
  decision: DecisionItem;
  machines: Machine[];
  role: OperatorRole;
  weather: { hold: boolean; reason?: string };
  nowIso: string;
  result?: DecisionActionResult;
  onAction: (action: DecisionActionKind, decision: DecisionItem) => void;
  onBack: () => void;
}) {
  const { decision, machines, role, weather, nowIso, result, onAction, onBack } = props;

  const model = useMemo(() => buildIncidentModel(decision), [decision]);

  // Eligibility for the RECOMMENDED action, evaluated against live state.
  const eligibility = useMemo(
    () =>
      previewEligibility({
        action: model.recommend.action,
        decision,
        machines,
        role,
        weather,
        nowIso
      }),
    [model.recommend.action, decision, machines, role, weather, nowIso]
  );

  const dispatch = result?.dispatch;
  const closed = isTerminalAction(result?.action);
  const motionAcked = Boolean(dispatch?.allowed);
  const dispatchInFlight = result?.action === "dispatch" && Boolean(dispatch?.allowed);

  function actionEnabled(action: DecisionActionKind): { enabled: boolean; reason?: string } {
    if (closed) return { enabled: false, reason: "Incident already closed" };
    if (action === "dispatch" && dispatchInFlight) {
      return { enabled: false, reason: "verification mission in flight" };
    }
    if (action === "recall" && result?.action === "recall" && dispatch?.allowed) {
      return { enabled: false, reason: "recall already acknowledged" };
    }
    if (action === "estop" && result?.action === "estop" && dispatch?.allowed) {
      return { enabled: false, reason: "e-stop already engaged" };
    }
    if (!roleCan(role, action)) {
      return { enabled: false, reason: roleBlockReason(role, action) };
    }
    // For motion actions, the arbiter must also allow — except e-stop, which is a
    // safety override that the role already governs and the arbiter permits.
    if (action === "dispatch" || action === "recall") {
      const preview = previewEligibility({ action, decision, machines, role, weather, nowIso });
      if (preview.motion && !preview.allowed) {
        return { enabled: false, reason: `blocked by ${preview.deniedByGate} gate` };
      }
    }
    return { enabled: true };
  }

  const dockLabel = recallDockLabel(machines);

  return (
    <div className="cx-incident">
      <div className="cx-incident-head">
        <button type="button" className="cx-back" onClick={onBack}>
          ← Back to queue
        </button>
        <div className="cx-incident-title">
          <span className={`cx-sev sev-${model.assess.severity}`}>{model.assess.severity}</span>
          <h1>{decision.whatHappened}</h1>
          <p className="cx-where">
            {decision.zoneName} · {decision.sourceMachine} · {decision.situationLabel}
          </p>
        </div>
        <span className={`cx-honesty inline ${decision.source === "LIVE" ? "live" : "recorded"}`}>
          {decision.source}
        </span>
      </div>

      <ol className="cx-stepper">
        {/* 1. Detect */}
        <Step n={1} title="Detect">
          <p className="cx-step-lead">{model.detect.what}</p>
          <Value v={model.detect.signal} />
        </Step>

        {/* 2. Evidence */}
        <Step n={2} title="Evidence">
          <div className="cx-incident-evidence">
            {model.evidence.imageUri ? (
              <img src={model.evidence.imageUri} alt={decision.whatHappened} />
            ) : (
              <div className="cx-noframe small">
                <span className="cx-noframe-glyph" aria-hidden>◌</span>
                <strong>No visual frame</strong>
                <span>Sensor / telemetry evidence — {decision.sourceMachine}</span>
              </div>
            )}
          </div>
          <Value v={model.evidence.pose} />
          <Value
            v={{
              label: "Captured at",
              value: model.evidence.timestamp,
              source: "artifact"
            }}
          />
          {model.evidence.thermalDelta ? <Value v={model.evidence.thermalDelta} /> : null}
        </Step>

        {/* 3. Assess */}
        <Step n={3} title="Assess">
          <Value
            v={{
              label: "Severity",
              value: model.assess.severity,
              source: "computed",
              note: model.assess.rationale
            }}
          />
        </Step>

        {/* 4. Recommend */}
        <Step n={4} title="Recommend">
          <Value
            v={{
              label: "Recommended action",
              value: ACTION_LABELS[model.recommend.action],
              source: "computed",
              note: model.recommend.rationale
            }}
          />
        </Step>

        {/* 5. Eligibility gates */}
        <Step n={5} title="Eligibility gates">
          {eligibility.motion ? (
            <>
              <p className="cx-step-lead">
                Arbiter checklist for the recommended action ({ACTION_LABELS[model.recommend.action]}){" "}
                <SourceTag kind="computed" />
              </p>
              <ul className="cx-gates">
                {eligibility.gates.map((g) => (
                  <li key={g.gateId} className={g.pass ? "pass" : "fail"}>
                    <span className="cx-gate-id">{g.gateId}</span>
                    <span className="cx-gate-verdict">{g.pass ? "PASS" : "FAIL"}</span>
                    {!g.pass && g.reason ? <span className="cx-gate-reason">{g.reason}</span> : null}
                  </li>
                ))}
              </ul>
              <p className={`cx-gate-summary ${eligibility.allowed ? "allow" : "deny"}`}>
                {eligibility.allowed
                  ? "All gates pass — motion eligible."
                  : `Denied by ${eligibility.deniedByGate} gate.`}
              </p>
            </>
          ) : (
            <p className="cx-step-lead">
              Recommended action is non-motion ({ACTION_LABELS[model.recommend.action]}); no arbiter
              gates apply. <SourceTag kind="computed" />
            </p>
          )}
        </Step>

        {/* 6. Act */}
        <Step n={6} title="Act">
          <div className="cx-incident-actions">
            {ALL_ACTIONS.map((action) => {
              const { enabled, reason } = actionEnabled(action);
              const isRecommended = action === model.recommend.action;
              const recallHint = action === "recall" ? ` → ${dockLabel}` : "";
              return (
                <button
                  key={action}
                  type="button"
                  className={`${isRecommended ? "primary" : ""}${action === "estop" ? " danger" : ""}`}
                  disabled={!enabled}
                  title={enabled ? undefined : reason}
                  onClick={() => onAction(action, decision)}
                >
                  {ACTION_LABELS[action]}
                  {recallHint}
                  {!enabled && reason ? <span className="cx-block-reason">{reason}</span> : null}
                </button>
              );
            })}
          </div>
          <p className="cx-act-note">
            Buttons enable only when the seated role ({ROLE_LABELS[role]}) permits AND the arbiter
            allows. e-stop is a safety override for Operator / NOC Admin.
          </p>
        </Step>

        {/* 7. Acknowledge */}
        <Step n={7} title="Acknowledge" done={motionAcked}>
          {dispatch ? (
            dispatch.allowed ? (
              <Value
                v={{
                  label: "Command acknowledged",
                  value: `command ${dispatch.arbiterHash}${
                    dispatch.missionId ? ` · mission ${dispatch.missionState}` : ""
                  }`,
                  source: "acked",
                  note: dispatch.waypointLabel
                    ? `Returned by the guarded adapter command path for ${dispatch.waypointLabel}.`
                    : "Returned by the guarded adapter command path."
                }}
              />
            ) : (
              <p className="cx-step-lead deny">
                Command DENIED by {dispatch.deniedByGate} gate — no unit moved. {dispatch.reasons.join(" · ")}
              </p>
            )
          ) : (
            <p className="cx-step-lead muted">Awaiting an approved motion action.</p>
          )}
        </Step>

        {/* 8. Monitor */}
        <Step n={8} title="Monitor" done={motionAcked}>
          {dispatch?.allowed && result?.action === "dispatch" ? (
            <>
              <Value
                v={{
                  label: "Mission state",
                  value: dispatch.missionState ?? "—",
                  source: "computed"
                }}
              />
              <Value
                v={{
                  label: "Unit position / battery",
                  value: `simulated en-route to ${dispatch.waypointLabel ?? "verify waypoint"}`,
                  source: "simulated",
                  note: "No live unit attached in the simulator; position is illustrative."
                }}
              />
            </>
          ) : dispatch?.allowed && result?.action === "recall" ? (
            <Value
              v={{
                label: "Unit en-route to dock",
                value: `simulated recall → ${dockLabel}`,
                source: "simulated",
                note: "Dual-dock: routed to the unit's own home base by kind."
              }}
            />
          ) : dispatch?.allowed && result?.action === "estop" ? (
            <Value
              v={{
                label: "Unit held",
                value: `${dispatch.targetMachineId} motors held by safety override`,
                source: "acked",
                note: "E-stop does not close the incident; confirm, dismiss, or escalate the finding next."
              }}
            />
          ) : (
            <p className="cx-step-lead muted">No mission in flight.</p>
          )}
        </Step>

        {/* 9. Closeout */}
        <Step n={9} title="Closeout" done={closed}>
          {closed ? (
            <Value
              v={{
                label: "Signed audit entry",
                value:
                  result?.audit && result.audit.length > 0
                    ? result.audit[result.audit.length - 1].hash
                    : "—",
                source: "computed",
                note: "Hash-chained operator audit entry — tamper-evident."
              }}
            />
          ) : dispatchInFlight ? (
            <p className="cx-step-lead muted">
              Verification mission in flight — review returned evidence, then confirm, dismiss, or escalate.
            </p>
          ) : dispatch && !dispatch.allowed ? (
            <p className="cx-step-lead muted">
              No closeout recorded because the command was denied. Choose a review action or change the blocker.
            </p>
          ) : motionAcked ? (
            <p className="cx-step-lead muted">
              Safety command acknowledged. The incident remains open until a review action closes it.
            </p>
          ) : (
            <p className="cx-step-lead muted">Incident open — resolve an action to close out.</p>
          )}
        </Step>
      </ol>
    </div>
  );
}

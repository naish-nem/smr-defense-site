import { DecisionCard, type DecisionActionState } from "./DecisionCard";
import type { DecisionItem } from "./queue";
import type { DecisionActionKind, DecisionActionResult } from "./decisionActions";

/**
 * The Queue — the heart of the product. A single, cross-situation, prioritized
 * stream of decisions that need a human. Calm when short: lots of quiet space and
 * a clear empty state when the queue is clear.
 */
export function QueueView(props: {
  decisions: DecisionItem[];
  actionResults: Record<string, DecisionActionResult>;
  getActionState?: (action: DecisionActionKind, decision: DecisionItem) => DecisionActionState;
  onAction: (action: DecisionActionKind, decision: DecisionItem) => void;
  onOpen?: (decision: DecisionItem) => void;
}) {
  const { decisions, actionResults, getActionState, onAction, onOpen } = props;

  return (
    <div className="cx-queue">
      <div className="cx-queue-head">
        <h1>Needs a human</h1>
        <p className="cx-sub">
          {decisions.length > 0
            ? `${decisions.length} decision${decisions.length === 1 ? "" : "s"} across all situations, ranked by severity then age.`
            : "Nothing waiting."}
        </p>
      </div>

      {decisions.length === 0 ? (
        <div className="cx-empty">
          <div className="cx-empty-mark">✓</div>
          <strong>Queue clear — all situations covered.</strong>
          <span>No open exceptions or evidence awaiting review.</span>
        </div>
      ) : (
        <div className="cx-cards">
          {decisions.map((decision) => (
            <DecisionCard
              key={decision.id}
              decision={decision}
              result={actionResults[decision.id]}
              getActionState={
                getActionState ? (action) => getActionState(action, decision) : undefined
              }
              onAction={(action) => onAction(action, decision)}
              onOpen={onOpen ? () => onOpen(decision) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

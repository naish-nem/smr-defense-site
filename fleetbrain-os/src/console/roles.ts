import type { OperatorRole as ArbiterRole } from "../arbiter/types";
import type { DecisionActionKind } from "./decisionActions";

/**
 * Operator roles (their PM gap #3): high-risk actions must NOT be globally callable.
 *
 * These are CONSOLE roles — the human's seat at the NOC. They are distinct from the
 * arbiter's CommandIssuer.role (which is about command authority at the edge). The
 * console role is the FIRST gate: if the seated operator's role can't perform an
 * action, the button is disabled before we ever build a command intent. For motion
 * commands the arbiter then independently re-checks via its identity_scope gate, so
 * the role is enforced in TWO places (UI + arbiter), never just the UI.
 */
export type OperatorRole = "noc_admin" | "operator" | "analyst" | "viewer";

export const OPERATOR_ROLES: readonly OperatorRole[] = [
  "noc_admin",
  "operator",
  "analyst",
  "viewer"
];

export const ROLE_LABELS: Record<OperatorRole, string> = {
  noc_admin: "NOC Admin",
  operator: "Operator",
  analyst: "Analyst",
  viewer: "Viewer"
};

/**
 * Capability map: which console roles may perform which decision action.
 *
 *   - dispatch / recall / estop   → noc_admin + operator only (motion / safety override)
 *   - confirm / dismiss / escalate → noc_admin / operator / analyst (review actions)
 *   - viewer                       → none (read-only seat)
 *
 * e-stop is intentionally available to noc_admin + operator as a safety override —
 * it is never gated more tightly than recall.
 */
const CAPABILITIES: Record<OperatorRole, ReadonlySet<DecisionActionKind>> = {
  noc_admin: new Set<DecisionActionKind>([
    "confirm",
    "dismiss",
    "escalate",
    "dispatch",
    "recall",
    "estop"
  ]),
  operator: new Set<DecisionActionKind>([
    "confirm",
    "dismiss",
    "escalate",
    "dispatch",
    "recall",
    "estop"
  ]),
  analyst: new Set<DecisionActionKind>(["confirm", "dismiss", "escalate"]),
  viewer: new Set<DecisionActionKind>([])
};

/** True if `role` is permitted to perform `action`. */
export function roleCan(role: OperatorRole, action: DecisionActionKind): boolean {
  return CAPABILITIES[role].has(action);
}

/** Human-readable reason a role cannot perform an action (for disabled buttons). */
export function roleBlockReason(role: OperatorRole, action: DecisionActionKind): string {
  const motion = action === "dispatch" || action === "recall" || action === "estop";
  if (role === "viewer") return "Viewer is read-only";
  if (motion) return "requires Operator role";
  return `requires a role with ${action} permission`;
}

/**
 * Map a console role into the arbiter's CommandIssuer.role so the arbiter's
 * identity_scope gate reflects the seated operator. A console "operator" /
 * "noc_admin" is a site_local operator at the edge; analyst/viewer have no motion
 * authority, so they map to the arbiter "viewer" role and the identity_scope gate
 * will deny their motion intents (defence in depth — the UI already disabled them).
 */
export function toArbiterRole(role: OperatorRole): ArbiterRole {
  switch (role) {
    case "noc_admin":
    case "operator":
      return "site_operator";
    case "analyst":
    case "viewer":
    default:
      return "viewer";
  }
}

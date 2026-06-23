import type { MissionState } from "./types";

/**
 * Single source of truth for the mission lifecycle transition table.
 *
 *   draft → validated → authorized → dispatched → accepted → executing
 *   executing → { completed | paused | canceled | rejected | failed }
 *   paused → executing  (resume)
 *
 * Terminal states (completed, canceled, rejected, failed) have no legal next state.
 * Every fallible operation in MissionService consults this table; nothing here
 * mutates state or reads the clock — it is a pure, deterministic lookup.
 */
const TRANSITIONS: Record<MissionState, readonly MissionState[]> = {
  draft: ["validated", "canceled"],
  validated: ["authorized", "rejected", "canceled"],
  authorized: ["dispatched", "canceled"],
  dispatched: ["accepted", "rejected", "canceled"],
  accepted: ["executing", "canceled"],
  executing: ["completed", "paused", "canceled", "rejected", "failed"],
  paused: ["executing", "canceled", "failed"],
  completed: [],
  canceled: [],
  rejected: [],
  failed: []
};

/** True when a mission may move directly from `from` to `to`. */
export function canTransition(from: MissionState, to: MissionState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** All states a mission in `state` may legally transition into. */
export function legalNextStates(state: MissionState): MissionState[] {
  return [...TRANSITIONS[state]];
}

/** True when no further transitions are possible. */
export function isTerminal(state: MissionState): boolean {
  return TRANSITIONS[state].length === 0;
}

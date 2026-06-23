import { siteGeometry } from "../data/geometry";
import { coverageZones } from "../data/site";
import type { SitePoint } from "../domain/types";
import type { DecisionItem } from "./queue";

/** The Unitree-class quadruped is the command-capable verifier in the simulator. */
export const COMMAND_UNIT_ID = "M-UGV-01";

export interface DispatchDestination {
  point: SitePoint;
  targetZoneId: string;
  waypointLabel: string;
}

function zoneIdForDecision(decision: DecisionItem): string | undefined {
  if (decision.zoneId) return decision.zoneId;
  return coverageZones.find((zone) => zone.name === decision.zoneName)?.id;
}

export function destinationForDecision(decision: DecisionItem): DispatchDestination {
  const zoneId = zoneIdForDecision(decision);
  const exact = zoneId
    ? siteGeometry.inspectionWaypoints.find((waypoint) => waypoint.zoneId === zoneId)
    : undefined;
  const fallback =
    siteGeometry.inspectionWaypoints.find((waypoint) => waypoint.zoneId === "Z-PERIMETER") ??
    siteGeometry.inspectionWaypoints[0];

  const waypoint = exact ?? fallback;
  return {
    point: waypoint.point,
    targetZoneId: waypoint.zoneId,
    waypointLabel: waypoint.label
  };
}

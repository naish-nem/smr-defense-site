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

  if (exact) {
    return {
      point: exact.point,
      targetZoneId: exact.zoneId,
      waypointLabel: exact.label
    };
  }

  // Fallback if not an exact waypoint:
  // If the zone exists in siteGeometry, compute its centroid from its vertices
  const zoneGeo = zoneId ? siteGeometry.zones.find((z) => z.zoneId === zoneId) : undefined;
  if (zoneGeo && zoneGeo.vertices.length > 0) {
    const sumX = zoneGeo.vertices.reduce((sum, v) => sum + v.x, 0);
    const sumY = zoneGeo.vertices.reduce((sum, v) => sum + v.y, 0);
    const centroid = {
      x: Math.round(sumX / zoneGeo.vertices.length),
      y: Math.round(sumY / zoneGeo.vertices.length)
    };
    return {
      point: centroid,
      targetZoneId: zoneId || "unknown",
      waypointLabel: `${decision.zoneName || "zone"} centroid`
    };
  }

  // Absolute fallback to first waypoint
  const defaultWaypoint = siteGeometry.inspectionWaypoints[0];
  return {
    point: defaultWaypoint.point,
    targetZoneId: defaultWaypoint.zoneId,
    waypointLabel: `${defaultWaypoint.label} (default fallback)`
  };
}

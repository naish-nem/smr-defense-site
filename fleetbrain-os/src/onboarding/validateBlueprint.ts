import { pointInPolygon } from "../domain/geometry";
import type { SitePoint, ZonePolygon } from "../domain/types";
import type { SiteBlueprint } from "./siteBlueprint";
import { resolveZoneId } from "./blueprintIds";

/**
 * Pure validation of a SiteBlueprint before it is bootstrapped into the live
 * spine. Reuses `pointInPolygon` from domain/geometry so containment is checked
 * with the same ray-cast the rest of the system uses.
 *
 * The blueprint model already unifies a zone's logical fields and its polygon,
 * so the logical/geometry id-desync that the hand-authored data allows cannot
 * occur by construction. Validation therefore focuses on geometric validity and
 * uniqueness — the errors that would otherwise ship a broken site.
 *
 * Known v1 limitations (documented, not silently assumed away):
 * - Boundary/zone membership uses vertex ray-cast containment, so survey
 *   coordinates must be strictly interior — a point exactly ON the boundary
 *   edge is ambiguous. Zones flush to the perimeter are not yet supported.
 * - Containment checks vertices only, not edges: with a CONCAVE boundary a zone
 *   edge could bow outside while all vertices stay inside. Fort Pierce's
 *   boundary is convex, so this is safe today.
 * - No self-intersection / zero-area / zone-overlap / no-go-inside-a-zone
 *   checks yet. These are future hardening, not v1 guarantees.
 */

export interface BlueprintIssue {
  code: string;
  message: string;
  /** The offending element id (zone id, dock machineId, …) where applicable. */
  ref?: string;
}

export interface BlueprintValidation {
  ok: boolean;
  errors: BlueprintIssue[];
  warnings: BlueprintIssue[];
}

const FRAME = "site-local-enu" as const;

function asPolygon(zoneId: string, vertices: SitePoint[]): ZonePolygon {
  return { zoneId, frameId: FRAME, vertices };
}

/** Every vertex of `vertices` lies inside `boundary`. */
function allInside(boundary: ZonePolygon, vertices: SitePoint[]): boolean {
  return vertices.every((v) => pointInPolygon(v, boundary));
}

export function validateBlueprint(blueprint: SiteBlueprint): BlueprintValidation {
  const errors: BlueprintIssue[] = [];
  const warnings: BlueprintIssue[] = [];

  // Identity
  if (!blueprint.name.trim()) errors.push({ code: "site_name_missing", message: "Site name is required." });
  if (!blueprint.location.trim()) warnings.push({ code: "site_location_missing", message: "Site location is empty." });
  if (!blueprint.mission.trim()) warnings.push({ code: "site_mission_missing", message: "Site mission is empty." });

  // Boundary
  if (blueprint.boundary.length < 3) {
    errors.push({ code: "boundary_degenerate", message: "Site boundary needs at least 3 vertices." });
    // Without a valid boundary, containment checks below are meaningless.
    return { ok: false, errors, warnings };
  }
  const boundary = asPolygon("__boundary__", blueprint.boundary);

  // Zones
  if (blueprint.zones.length === 0) {
    errors.push({ code: "no_zones", message: "A site needs at least one coverage zone." });
  }

  const seenZoneIds = new Set<string>();
  for (const zone of blueprint.zones) {
    const zoneId = resolveZoneId(zone);

    if (!zone.id?.trim() && !zone.name.trim()) {
      errors.push({ code: "zone_name_missing", message: "A zone needs a name (or an explicit id)." });
    } else if (zoneId === "Z-") {
      // Name was punctuation/whitespace-only and slugged to nothing.
      errors.push({ code: "zone_id_unresolvable", message: `Zone name "${zone.name}" does not yield a usable id; set an explicit id.` });
    }

    if (seenZoneIds.has(zoneId)) {
      errors.push({ code: "duplicate_zone_id", message: `Two zones resolve to the same id "${zoneId}" (names may differ but slug alike) — set distinct ids.`, ref: zoneId });
    }
    seenZoneIds.add(zoneId);

    if (zone.vertices.length < 3) {
      errors.push({ code: "zone_polygon_degenerate", message: `Zone "${zoneId}" needs at least 3 vertices.`, ref: zoneId });
      continue; // containment checks need a real polygon
    }
    if (!allInside(boundary, zone.vertices)) {
      errors.push({ code: "zone_outside_boundary", message: `Zone "${zoneId}" extends outside the site boundary.`, ref: zoneId });
    }
    if (zone.requiredMachineKinds.length === 0) {
      warnings.push({ code: "zone_no_machine_kinds", message: `Zone "${zoneId}" lists no required machine kinds.`, ref: zoneId });
    }
    if (zone.freshnessMinutes <= 0) {
      errors.push({ code: "zone_freshness_invalid", message: `Zone "${zoneId}" freshnessMinutes must be positive.`, ref: zoneId });
    }
    if (zone.waypoint && !pointInPolygon(zone.waypoint.point, asPolygon(zoneId, zone.vertices))) {
      errors.push({ code: "waypoint_outside_zone", message: `Inspection waypoint for "${zoneId}" is outside the zone.`, ref: zoneId });
    }
  }

  // No-go zones
  const seenNoGoIds = new Set<string>();
  for (const noGo of blueprint.noGoZones) {
    if (seenNoGoIds.has(noGo.id)) {
      errors.push({ code: "duplicate_nogo_id", message: `Duplicate no-go zone id "${noGo.id}".`, ref: noGo.id });
    }
    seenNoGoIds.add(noGo.id);
    if (noGo.vertices.length < 3) {
      errors.push({ code: "nogo_polygon_degenerate", message: `No-go zone "${noGo.id}" needs at least 3 vertices.`, ref: noGo.id });
      continue;
    }
    if (!allInside(boundary, noGo.vertices)) {
      errors.push({ code: "nogo_outside_boundary", message: `No-go zone "${noGo.id}" extends outside the site boundary.`, ref: noGo.id });
    }
  }

  // Docks
  const seenDockMachines = new Set<string>();
  for (const dock of blueprint.docks) {
    if (seenDockMachines.has(dock.machineId)) {
      warnings.push({ code: "duplicate_dock_machine", message: `More than one dock for machine "${dock.machineId}".`, ref: dock.machineId });
    }
    seenDockMachines.add(dock.machineId);
    if (!pointInPolygon(dock.point, boundary)) {
      errors.push({ code: "dock_outside_boundary", message: `Dock for "${dock.machineId}" is outside the site boundary.`, ref: dock.machineId });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

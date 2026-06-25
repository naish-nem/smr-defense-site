import type { AuditEntry, CoverageZone, Site, SiteGeometry, ZonePolygon } from "../domain/types";
import type { SiteBlueprint } from "./siteBlueprint";
import { resolveZoneId } from "./blueprintIds";

/**
 * Pure assembler: turn a validated SiteBlueprint into the live spine —
 * `Site` + `CoverageZone[]` (logical) + `SiteGeometry` (polygons) — plus a
 * site-creation audit entry. Deterministic: ids derive from the blueprint and
 * the timestamp is passed in (CLAUDE.md invariant 3), never read from a clock.
 *
 * Because both the logical zone and its polygon are derived from the SAME
 * blueprint zone (sharing `resolveZoneId`), the logical/geometry id-desync that
 * the hand-authored data permits cannot be produced here.
 */

const FRAME = "site-local-enu" as const;

export interface BootstrapResult {
  site: Site;
  coverageZones: CoverageZone[];
  geometry: SiteGeometry;
  audit: AuditEntry[];
}

export function bootstrapSite(blueprint: SiteBlueprint, opts: { siteId: string; now: string }): BootstrapResult {
  const { siteId, now } = opts;

  const site: Site = {
    id: siteId,
    name: blueprint.name,
    location: blueprint.location,
    mission: blueprint.mission
  };

  const coverageZones: CoverageZone[] = blueprint.zones.map((zone) => ({
    id: resolveZoneId(zone),
    name: zone.name,
    purpose: zone.purpose,
    requiredMachineKinds: zone.requiredMachineKinds,
    freshnessMinutes: zone.freshnessMinutes
  }));

  const zones: ZonePolygon[] = blueprint.zones.map((zone) => ({
    zoneId: resolveZoneId(zone),
    frameId: FRAME,
    vertices: zone.vertices
  }));

  const noGoZones: ZonePolygon[] = blueprint.noGoZones.map((noGo) => ({
    zoneId: noGo.id,
    frameId: FRAME,
    vertices: noGo.vertices
  }));

  const inspectionWaypoints = blueprint.zones.flatMap((zone) =>
    zone.waypoint ? [{ zoneId: resolveZoneId(zone), point: zone.waypoint.point, label: zone.waypoint.label }] : []
  );

  const geometry: SiteGeometry = {
    siteId,
    frameId: FRAME,
    boundary: blueprint.boundary,
    zones,
    noGoZones,
    dockLocations: blueprint.docks.map((dock) => ({ machineId: dock.machineId, point: dock.point })),
    inspectionWaypoints
  };

  const audit: AuditEntry[] = [
    {
      id: `audit-site_bootstrap-${siteId}-${now}`,
      timestamp: now,
      actor: "operator",
      action: "site_bootstrap",
      subjectRef: siteId,
      detail: `Bootstrapped site "${site.name}": ${coverageZones.length} zones, ${noGoZones.length} no-go zones, ${geometry.dockLocations.length} docks.`
    }
  ];

  return { site, coverageZones, geometry, audit };
}

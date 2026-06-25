import type { MachineKind, SitePoint } from "../domain/types";

/**
 * A SiteBlueprint is the declarative output of a site survey — the inputs an
 * operator provides to stand up a new site, before any geometry/coverage
 * records exist. `bootstrapSite` turns a blueprint into the live spine
 * (Site + CoverageZone[] + SiteGeometry); `validateBlueprint` checks it first.
 *
 * Pure data only. v1 stays on the existing CoverageZone + inspection-waypoint
 * model — Asset/InspectionPoint are a deliberate future extension and are not
 * modeled here yet.
 */

export interface BlueprintZone {
  /** Stable zone id (e.g. "Z-BESS"). Optional — derived from `name` if absent. */
  id?: string;
  name: string;
  purpose: string;
  requiredMachineKinds: MachineKind[];
  freshnessMinutes: number;
  /** Traced zone polygon in site-local ENU coordinates. */
  vertices: SitePoint[];
  /** Optional inspection waypoint inside the zone. */
  waypoint?: { point: SitePoint; label: string };
}

export interface BlueprintNoGoZone {
  id: string;
  vertices: SitePoint[];
}

export interface BlueprintDock {
  /** Machine this dock serves. The machine itself is added via hardware onboarding. */
  machineId: string;
  point: SitePoint;
}

export interface SiteBlueprint {
  name: string;
  location: string;
  mission: string;
  /** Outer site boundary polygon in site-local ENU coordinates. */
  boundary: SitePoint[];
  zones: BlueprintZone[];
  noGoZones: BlueprintNoGoZone[];
  docks: BlueprintDock[];
}

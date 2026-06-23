import type { MachineKind } from "../domain/types";
import type { SitePoint } from "../arbiter/types";

/**
 * DUAL DOCKS — each unit charges at its OWN home base.
 *
 * A recall must send a unit to the dock that SERVES ITS KIND, never to the wrong
 * dock. The quadruped returns to the quad kennel; the UAV returns to the DJI Dock 3.
 * These are configured constants (SourceTag "authored"). Locations are in the same
 * site-local-ENU frame as siteGeometry.dockLocations.
 */

export interface Dock {
  id: string;
  name: string;
  /** The single machine kind this dock charges / houses. */
  serves: Extract<MachineKind, "quadruped" | "uav">;
  location: SitePoint;
}

export const docks: Dock[] = [
  {
    id: "DOCK-KENNEL-01",
    name: "Quad Kennel",
    serves: "quadruped",
    location: { x: 18, y: 50 }
  },
  {
    id: "DOCK-DJI-03",
    name: "DJI Dock 3",
    serves: "uav",
    location: { x: 94, y: 60 }
  }
];

/** Find the dock that serves a given machine kind. Returns undefined if none. */
export function dockForKind(kind: MachineKind): Dock | undefined {
  if (kind !== "quadruped" && kind !== "uav") return undefined;
  return docks.find((d) => d.serves === kind);
}

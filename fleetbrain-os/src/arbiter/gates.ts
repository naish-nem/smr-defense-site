import { pointInPolygon } from "../domain/geometry";
import type { SitePoint } from "../domain/types";
import type {
  CommandControlLevel,
  CommandIntent,
  CommandType,
  Gate,
  GateContext,
  GateResult,
  OperatorRole,
  UnitRuntimeState
} from "./types";

/**
 * Ordered gate list — cheapest / safety-first. Evaluation stops at the first
 * failing gate. Every gate is a PURE function of (intent, ctx, nowIso); it reads,
 * never mutates. To add a gate, append a Gate to ORDERED_GATES (order is the
 * contract — see CLAUDE.md "Add an arbiter gate").
 */

const pass = (): GateResult => ({ pass: true, reason: "" });
const fail = (reason: string): GateResult => ({ pass: false, reason });

/** Commands that are always permitted as safety overrides during stop conditions. */
const SAFETY_OVERRIDE_COMMANDS: ReadonlySet<CommandType> = new Set([
  "recall_machine",
  "hold_machine",
  "estop",
  "clear_estop"
]);

/** Commands that physically move a unit (subject to the strictest gates). */
const MOTION_COMMANDS: ReadonlySet<CommandType> = new Set([
  "dispatch_machine",
  "upload_route"
]);

/** Which roles may issue which command types. */
const ROLE_PERMISSIONS: Record<OperatorRole, ReadonlySet<CommandType>> = {
  viewer: new Set<CommandType>([]),
  site_operator: new Set<CommandType>([
    "dispatch_machine",
    "upload_route",
    "recall_machine",
    "hold_machine",
    "estop",
    "clear_estop"
  ]),
  fleet_operator: new Set<CommandType>([
    "dispatch_machine",
    "upload_route",
    "recall_machine",
    "hold_machine",
    "estop"
  ]),
  // Safety officers can stop anything but must not initiate motion or clear an e-stop.
  safety_officer: new Set<CommandType>(["recall_machine", "hold_machine", "estop"])
};

function findUnit(ctx: GateContext, machineId: string): UnitRuntimeState | undefined {
  return ctx.units.find((u) => u.machineId === machineId);
}

function requiredControlLevel(intent: CommandIntent): CommandControlLevel {
  if (intent.params.requiredControlLevel) return intent.params.requiredControlLevel;
  if (MOTION_COMMANDS.has(intent.type)) return "guarded";
  return "guarded";
}

/** Collect the points that must clear the geofence for this command. */
function motionPoints(intent: CommandIntent): SitePoint[] {
  const points: SitePoint[] = [];
  if (intent.params.destination) points.push(intent.params.destination);
  if (intent.params.waypoints) points.push(...intent.params.waypoints);
  return points;
}

// ---------------------------------------------------------------------------
// Gate 1: identity_scope — operator role allowed for this command + same site.
// ---------------------------------------------------------------------------
export const identityScopeGate: Gate = {
  id: "identity_scope",
  evaluate(intent, ctx) {
    const { role, scopedSiteId, operatorId } = intent.issuedBy;
    if (scopedSiteId !== ctx.siteId) {
      return fail(
        `operator ${operatorId} scoped to ${scopedSiteId}, not site ${ctx.siteId}`
      );
    }
    const allowed = ROLE_PERMISSIONS[role];
    if (!allowed || !allowed.has(intent.type)) {
      return fail(`role ${role} may not issue ${intent.type}`);
    }
    return pass();
  }
};

// ---------------------------------------------------------------------------
// Gate 2: capability — adapter exposes commandHardware && supports control level.
// ---------------------------------------------------------------------------
export const capabilityGate: Gate = {
  id: "capability",
  evaluate(intent, ctx) {
    const adapter = ctx.adapter;
    if (!adapter) {
      return fail(`no command-capable adapter registered for ${intent.targetMachineId}`);
    }
    if (!adapter.commandHardware) {
      return fail(`adapter ${adapter.adapterId} is read-only (commandHardware=false)`);
    }
    const needed = requiredControlLevel(intent);
    if (!adapter.supportedControlLevels.includes(needed)) {
      return fail(
        `adapter ${adapter.adapterId} does not support control level ${needed}`
      );
    }
    return pass();
  }
};

// ---------------------------------------------------------------------------
// Gate 3: unit_health — machine online/available, not offline/recalled/unknown.
// ---------------------------------------------------------------------------
export const unitHealthGate: Gate = {
  id: "unit_health",
  evaluate(intent, ctx) {
    const machine = ctx.machines.find((m) => m.id === intent.targetMachineId);
    if (!machine) {
      return fail(`unknown machine ${intent.targetMachineId}`);
    }
    // Recall / hold / stop must work on recalled or in-mission units.
    if (SAFETY_OVERRIDE_COMMANDS.has(intent.type)) {
      if (machine.status === "offline") {
        return fail(`machine ${machine.id} is offline; cannot deliver command`);
      }
      return pass();
    }
    if (machine.status === "offline" || machine.status === "unknown") {
      return fail(`machine ${machine.id} status ${machine.status}; not commandable`);
    }
    if (machine.status === "recalled") {
      return fail(`machine ${machine.id} is recalled; clear recall before dispatch`);
    }
    return pass();
  }
};

// ---------------------------------------------------------------------------
// Gate 4: geofence — every motion point inside an allowed zone, none in a noGoZone.
// ---------------------------------------------------------------------------
export const geofenceGate: Gate = {
  id: "geofence",
  evaluate(intent, ctx) {
    if (!MOTION_COMMANDS.has(intent.type)) return pass();
    const points = motionPoints(intent);
    if (points.length === 0) {
      return fail(`${intent.type} requires a destination/waypoints for geofence check`);
    }
    for (const p of points) {
      const inNoGo = ctx.geometry.noGoZones.some((z) => pointInPolygon(p, z));
      if (inNoGo) {
        return fail(`point (${p.x},${p.y}) lies inside a no-go zone`);
      }
      const inAllowed = ctx.geometry.zones.some((z) => pointInPolygon(p, z));
      if (!inAllowed) {
        return fail(`point (${p.x},${p.y}) is outside all allowed zones`);
      }
      if (
        intent.params.targetZoneId &&
        !ctx.geometry.zones.some(
          (z) => z.zoneId === intent.params.targetZoneId && pointInPolygon(p, z)
        )
      ) {
        return fail(
          `point (${p.x},${p.y}) not inside declared zone ${intent.params.targetZoneId}`
        );
      }
    }
    return pass();
  }
};

// ---------------------------------------------------------------------------
// Gate 5: battery_link — battery above the unit floor and link up (for motion).
// ---------------------------------------------------------------------------
export const batteryLinkGate: Gate = {
  id: "battery_link",
  evaluate(intent, ctx) {
    const unit = findUnit(ctx, intent.targetMachineId);
    const machine = ctx.machines.find((m) => m.id === intent.targetMachineId);
    if (!unit) return fail(`no runtime state for ${intent.targetMachineId}`);

    // Safety overrides are allowed to proceed even on low battery / degraded link;
    // lost-link specifics are enforced by the freshness/estop pipeline and the
    // arbiter's LOST-LINK policy. Motion commands need a healthy link + battery.
    if (SAFETY_OVERRIDE_COMMANDS.has(intent.type)) {
      if (unit.link === "partitioned") {
        // Recall/hold are still attempted (store-and-forward); never block a stop.
        return pass();
      }
      return pass();
    }

    if (unit.link !== "up") {
      return fail(`link to ${unit.machineId} is ${unit.link}; motion requires link up`);
    }
    const battery = machine?.batteryPct;
    if (battery === undefined) {
      return fail(`battery unknown for ${unit.machineId}; cannot authorize motion`);
    }
    if (battery < unit.batteryFloorPct) {
      return fail(
        `battery ${battery}% below floor ${unit.batteryFloorPct}% for ${unit.machineId}`
      );
    }
    return pass();
  }
};

// ---------------------------------------------------------------------------
// Gate 6: maintenance_lockout — machine not locked out.
// ---------------------------------------------------------------------------
export const maintenanceLockoutGate: Gate = {
  id: "maintenance_lockout",
  evaluate(intent, ctx) {
    const unit = findUnit(ctx, intent.targetMachineId);
    if (!unit) return fail(`no runtime state for ${intent.targetMachineId}`);
    // A stop/hold/recall must still be honored on a locked-out unit.
    if (SAFETY_OVERRIDE_COMMANDS.has(intent.type)) return pass();
    if (unit.maintenanceLockout) {
      return fail(`machine ${unit.machineId} is in maintenance lockout`);
    }
    return pass();
  }
};

// ---------------------------------------------------------------------------
// Gate 7: mission_state — no conflicting active mission unless recall/stop.
// ---------------------------------------------------------------------------
export const missionStateGate: Gate = {
  id: "mission_state",
  evaluate(intent, ctx) {
    const unit = findUnit(ctx, intent.targetMachineId);
    if (!unit) return fail(`no runtime state for ${intent.targetMachineId}`);
    if (SAFETY_OVERRIDE_COMMANDS.has(intent.type)) return pass();
    if (unit.activeMissionId) {
      return fail(
        `machine ${unit.machineId} has active mission ${unit.activeMissionId}; recall first`
      );
    }
    return pass();
  }
};

// ---------------------------------------------------------------------------
// Gate 8: freshness — issuedAt within freshnessDeadline relative to nowIso.
// ---------------------------------------------------------------------------
export const freshnessGate: Gate = {
  id: "freshness",
  evaluate(intent, _ctx, nowIso) {
    const now = Date.parse(nowIso);
    const issued = Date.parse(intent.issuedAt);
    if (Number.isNaN(now) || Number.isNaN(issued)) {
      return fail(`unparseable timestamp (issuedAt=${intent.issuedAt}, now=${nowIso})`);
    }
    const ageMs = now - issued;
    if (ageMs < 0) {
      return fail(`command issuedAt is in the future relative to evaluation time`);
    }
    if (ageMs > intent.freshnessDeadlineMs) {
      return fail(
        `command is stale: age ${ageMs}ms exceeds deadline ${intent.freshnessDeadlineMs}ms`
      );
    }
    return pass();
  }
};

// ---------------------------------------------------------------------------
// Gate 9: weather — deny UAV dispatch/route during a weather hold (e.g. high wind).
//   Passes when weather is undefined (no hold known) so existing contexts stay green.
//   Only applies to MOTION commands targeting a uav; ground units are unaffected,
//   and safety overrides (recall/hold/stop) are never blocked by weather.
// ---------------------------------------------------------------------------
export const weatherGate: Gate = {
  id: "weather",
  evaluate(intent, ctx) {
    if (!MOTION_COMMANDS.has(intent.type)) return pass();
    if (SAFETY_OVERRIDE_COMMANDS.has(intent.type)) return pass();
    if (!ctx.weather?.hold) return pass();
    const machine = ctx.machines.find((m) => m.id === intent.targetMachineId);
    if (machine?.kind !== "uav") return pass();
    const why = ctx.weather.reason ? `: ${ctx.weather.reason}` : "";
    return fail(`weather hold in effect; UAV ${intent.targetMachineId} flight denied${why}`);
  }
};

// ---------------------------------------------------------------------------
// Gate 10: estop — if site or unit e-stop engaged, deny everything except clear.
// ---------------------------------------------------------------------------
export const estopGate: Gate = {
  id: "estop",
  evaluate(intent, ctx) {
    const unitEngaged = Boolean(ctx.estop.engagedUnits[intent.targetMachineId]);
    const engaged = ctx.estop.siteEngaged || unitEngaged;
    if (!engaged) return pass();
    if (intent.type === "clear_estop") return pass();
    const scope = ctx.estop.siteEngaged ? "site" : "unit";
    return fail(`${scope} e-stop engaged; only clear_estop is permitted`);
  }
};

/**
 * The ordered gate list. ORDER IS THE CONTRACT: cheap identity/capability checks
 * first, geometry and battery in the middle, freshness and the e-stop backstop last
 * so the e-stop verdict is the final word before allow.
 */
export const ORDERED_GATES: readonly Gate[] = [
  identityScopeGate,
  capabilityGate,
  unitHealthGate,
  geofenceGate,
  batteryLinkGate,
  maintenanceLockoutGate,
  missionStateGate,
  freshnessGate,
  weatherGate,
  estopGate
];

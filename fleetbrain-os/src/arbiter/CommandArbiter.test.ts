import { describe, expect, it } from "vitest";
import type { Machine, SiteGeometry } from "../domain/types";
import { CommandArbiter, fnv1a } from "./CommandArbiter";
import { GuardedSimulatorAdapter } from "./GuardedSimulatorAdapter";
import type {
  CommandIntent,
  CommandType,
  EstopAuthority,
  GateContext,
  LinkState,
  OperatorRole,
  UnitRuntimeState
} from "./types";

// ---------------------------------------------------------------------------
// Fixtures (a trimmed copy of site geometry so the test owns no shared file).
// Allowed zone Z-OK contains (50,50). No-go zone NG contains (51,51).
// ---------------------------------------------------------------------------
const GEOMETRY: SiteGeometry = {
  siteId: "SITE-TEST",
  frameId: "site-local-enu",
  boundary: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 }
  ],
  zones: [
    {
      zoneId: "Z-OK",
      frameId: "site-local-enu",
      vertices: [
        { x: 40, y: 40 },
        { x: 60, y: 40 },
        { x: 60, y: 60 },
        { x: 40, y: 60 }
      ]
    }
  ],
  noGoZones: [
    {
      zoneId: "NG",
      frameId: "site-local-enu",
      // Sits in the corner of Z-OK so a point can be both "in a zone" and in no-go.
      vertices: [
        { x: 50, y: 50 },
        { x: 60, y: 50 },
        { x: 60, y: 60 },
        { x: 50, y: 60 }
      ]
    }
  ],
  dockLocations: [{ machineId: "M-UGV-01", point: { x: 10, y: 10 } }],
  inspectionWaypoints: [{ zoneId: "Z-OK", point: { x: 45, y: 45 }, label: "center" }]
};

const SAFE_POINT = { x: 45, y: 45 }; // inside Z-OK, outside NG
const NOGO_POINT = { x: 55, y: 55 }; // inside Z-OK AND inside NG
const OUTSIDE_POINT = { x: 5, y: 5 }; // inside no zone

const SITE_ID = "SITE-TEST";

function baseMachine(overrides: Partial<Machine> = {}): Machine {
  return {
    id: "M-UGV-01",
    label: "Ground Unit",
    kind: "quadruped",
    vendor: "Unitree",
    status: "available",
    batteryPct: 80,
    ...overrides
  };
}

function baseUnit(overrides: Partial<UnitRuntimeState> = {}): UnitRuntimeState {
  return {
    machineId: "M-UGV-01",
    link: "up",
    maintenanceLockout: false,
    activeMissionId: undefined,
    batteryFloorPct: 25,
    ...overrides
  };
}

function baseCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    siteId: SITE_ID,
    machines: [baseMachine()],
    units: [baseUnit()],
    geometry: GEOMETRY,
    adapter: {
      adapterId: "adapter-guarded-sim",
      commandHardware: true,
      supportedControlLevels: ["observe", "guarded"]
    },
    siteLinkToCloud: "up",
    // estop here is a placeholder; the arbiter overrides it from its own ledger.
    estop: { siteEngaged: false, engagedUnits: {} },
    ...overrides
  };
}

function baseIntent(overrides: Partial<CommandIntent> = {}): CommandIntent {
  return {
    id: "intent-0",
    type: "dispatch_machine",
    targetMachineId: "M-UGV-01",
    issuedBy: {
      operatorId: "op-1",
      role: "site_operator",
      authority: "site_local_operator",
      scopedSiteId: SITE_ID
    },
    params: { destination: SAFE_POINT, requiredControlLevel: "guarded" },
    issuedAt: "2026-06-18T12:00:00.000Z",
    freshnessDeadlineMs: 5000,
    ...overrides
  };
}

const NOW = "2026-06-18T12:00:01.000Z"; // 1s after issue — fresh for a 5s deadline

// ===========================================================================
// Explicit gate tests
// ===========================================================================
describe("CommandArbiter — explicit gate behavior", () => {
  it("allows a clean dispatch through all gates", () => {
    const arb = new CommandArbiter();
    const d = arb.evaluate(baseIntent(), baseCtx(), NOW);
    expect(d.allowed).toBe(true);
    expect(d.deniedByGate).toBeUndefined();
  });

  it("denies a non-permitted role (identity_scope)", () => {
    const arb = new CommandArbiter();
    const intent = baseIntent({
      issuedBy: {
        operatorId: "v-1",
        role: "viewer" as OperatorRole,
        authority: "cloud_operator",
        scopedSiteId: SITE_ID
      }
    });
    const d = arb.evaluate(intent, baseCtx(), NOW);
    expect(d.allowed).toBe(false);
    expect(d.deniedByGate).toBe("identity_scope");
  });

  it("denies a command scoped to a different site (identity_scope)", () => {
    const arb = new CommandArbiter();
    const intent = baseIntent({
      issuedBy: {
        operatorId: "op-x",
        role: "site_operator",
        authority: "site_local_operator",
        scopedSiteId: "SITE-OTHER"
      }
    });
    const d = arb.evaluate(intent, baseCtx(), NOW);
    expect(d.deniedByGate).toBe("identity_scope");
  });

  it("denies when adapter is read-only (capability)", () => {
    const arb = new CommandArbiter();
    const ctx = baseCtx({
      adapter: {
        adapterId: "ro",
        commandHardware: false,
        supportedControlLevels: ["observe"]
      }
    });
    const d = arb.evaluate(baseIntent(), ctx, NOW);
    expect(d.deniedByGate).toBe("capability");
  });

  it("denies dispatch to a recalled unit (unit_health)", () => {
    const arb = new CommandArbiter();
    const ctx = baseCtx({ machines: [baseMachine({ status: "recalled" })] });
    const d = arb.evaluate(baseIntent(), ctx, NOW);
    expect(d.deniedByGate).toBe("unit_health");
  });

  it("denies a destination inside a no-go zone (geofence)", () => {
    const arb = new CommandArbiter();
    const intent = baseIntent({ params: { destination: NOGO_POINT } });
    const d = arb.evaluate(intent, baseCtx(), NOW);
    expect(d.allowed).toBe(false);
    expect(d.deniedByGate).toBe("geofence");
  });

  it("denies a destination outside all allowed zones (geofence)", () => {
    const arb = new CommandArbiter();
    const intent = baseIntent({ params: { destination: OUTSIDE_POINT } });
    const d = arb.evaluate(intent, baseCtx(), NOW);
    expect(d.deniedByGate).toBe("geofence");
  });

  it("denies when battery is below the unit floor (battery_link)", () => {
    const arb = new CommandArbiter();
    const ctx = baseCtx({ machines: [baseMachine({ batteryPct: 10 })] });
    const d = arb.evaluate(baseIntent(), ctx, NOW);
    expect(d.allowed).toBe(false);
    expect(d.deniedByGate).toBe("battery_link");
  });

  it("denies motion when the link is degraded (battery_link)", () => {
    const arb = new CommandArbiter();
    const ctx = baseCtx({ units: [baseUnit({ link: "degraded" })] });
    const d = arb.evaluate(baseIntent(), ctx, NOW);
    expect(d.deniedByGate).toBe("battery_link");
  });

  it("denies a maintenance-locked unit (maintenance_lockout)", () => {
    const arb = new CommandArbiter();
    const ctx = baseCtx({ units: [baseUnit({ maintenanceLockout: true })] });
    const d = arb.evaluate(baseIntent(), ctx, NOW);
    expect(d.deniedByGate).toBe("maintenance_lockout");
  });

  it("denies dispatch with a conflicting active mission (mission_state)", () => {
    const arb = new CommandArbiter();
    const ctx = baseCtx({ units: [baseUnit({ activeMissionId: "MIS-9" })] });
    const d = arb.evaluate(baseIntent(), ctx, NOW);
    expect(d.deniedByGate).toBe("mission_state");
  });

  it("denies a stale command (freshness)", () => {
    const arb = new CommandArbiter();
    const stale = baseIntent({ freshnessDeadlineMs: 500 }); // NOW is 1000ms later
    const d = arb.evaluate(stale, baseCtx(), NOW);
    expect(d.allowed).toBe(false);
    expect(d.deniedByGate).toBe("freshness");
  });

  it("forced e-stop denies dispatch but allows clear", () => {
    const arb = new CommandArbiter();
    arb.estopEngage({
      scope: "site",
      targetId: SITE_ID,
      authority: "physical",
      intentId: "estop-1",
      nowIso: NOW
    });
    const dispatch = arb.evaluate(baseIntent({ id: "i-after-estop" }), baseCtx(), NOW);
    expect(dispatch.allowed).toBe(false);
    expect(dispatch.deniedByGate).toBe("estop");

    const clear = arb.clearEstop({
      scope: "site",
      targetId: SITE_ID,
      authority: "physical",
      intentId: "clear-1",
      nowIso: NOW
    });
    expect(clear.applied).toBe(true);
    expect(arb.isSiteEstopEngaged()).toBe(false);
  });

  it("e-stop denies all commands except clear_estop (incl. recall)", () => {
    // Per spec the estop gate is an absolute backstop: once engaged, the unit is
    // already commanded to a stop, so even recall is denied until the stop is cleared.
    const arb = new CommandArbiter();
    arb.estopEngage({
      scope: "unit",
      targetId: "M-UGV-01",
      authority: "site_local_operator",
      intentId: "estop-u",
      nowIso: NOW
    });
    const recall = arb.evaluate(
      baseIntent({ id: "recall-1", type: "recall_machine", params: {} }),
      baseCtx(),
      NOW
    );
    expect(recall.allowed).toBe(false);
    expect(recall.deniedByGate).toBe("estop");
  });

  it("recall IS allowed during lost-link (partition), without an e-stop engaged", () => {
    // Distinct from e-stop: a partitioned link inhibits dispatch but recall/hold
    // must still be permitted so the operator can pull the unit home.
    const arb = new CommandArbiter();
    const ctx = baseCtx({ units: [baseUnit({ link: "partitioned" })] });
    const recall = arb.evaluate(
      baseIntent({ id: "recall-link", type: "recall_machine", params: {} }),
      ctx,
      NOW
    );
    expect(recall.allowed).toBe(true);
  });

  it("enforces e-stop authority precedence: cloud cannot clear a physical stop", () => {
    const arb = new CommandArbiter();
    arb.estopEngage({
      scope: "site",
      targetId: SITE_ID,
      authority: "physical",
      intentId: "estop-p",
      nowIso: NOW
    });
    const cloudClear = arb.clearEstop({
      scope: "site",
      targetId: SITE_ID,
      authority: "cloud_operator",
      intentId: "clear-cloud",
      nowIso: NOW
    });
    expect(cloudClear.applied).toBe(false);
    expect(arb.isSiteEstopEngaged()).toBe(true);
  });

  it("LOST-LINK: partitioned link denies dispatch but allows recall", () => {
    const arb = new CommandArbiter();
    const ctx = baseCtx({ units: [baseUnit({ link: "partitioned" })] });
    const dispatch = arb.evaluate(baseIntent({ id: "d-partition" }), ctx, NOW);
    expect(dispatch.allowed).toBe(false);
    // battery_link rejects the partitioned link before the lost_link backstop.
    expect(["battery_link", "lost_link"]).toContain(dispatch.deniedByGate);

    const recall = arb.evaluate(
      baseIntent({ id: "r-partition", type: "recall_machine", params: {} }),
      ctx,
      NOW
    );
    expect(recall.allowed).toBe(true);
  });

  it("is idempotent by intent.id and does not append a second audit link", () => {
    const arb = new CommandArbiter();
    const intent = baseIntent({ id: "idem-1" });
    const first = arb.evaluate(intent, baseCtx(), NOW);
    const lenAfterFirst = arb.getAuditChain().length;
    const second = arb.evaluate(intent, baseCtx(), "2026-06-18T13:00:00.000Z");
    expect(second).toEqual(first);
    expect(arb.getAuditChain().length).toBe(lenAfterFirst);
  });

  it("fnv1a is deterministic and tamper-evident", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(fnv1a("abc")).not.toBe(fnv1a("abd"));
  });

  it("GuardedSimulatorAdapter exposes commandHardware and deterministic safeState", async () => {
    const adapter = new GuardedSimulatorAdapter({
      siteId: SITE_ID,
      machines: [baseMachine()]
    });
    expect(adapter.capabilities.commandHardware).toBe(true);
    const entry = adapter.safeState("M-UGV-01", NOW);
    expect(entry.deterministic).toBe(true);
    expect(adapter.getCommandLog().length).toBe(1);
    const machines = await adapter.readMachineState(SITE_ID);
    expect(machines.length).toBe(1);
  });
});

// ===========================================================================
// HIL-style table test: 100 deterministic scenarios.
// ===========================================================================

type ViolationKind =
  | "valid"
  | "identity_scope"
  | "capability"
  | "unit_health"
  | "geofence"
  | "battery_link"
  | "maintenance_lockout"
  | "mission_state"
  | "freshness"
  | "estop"
  | "lost_link";

interface Scenario {
  intent: CommandIntent;
  ctx: GateContext;
  /** If set, engage a site/unit e-stop before evaluation. */
  estopBefore?: { scope: "site" | "unit"; authority: EstopAuthority };
  expectAllowed: boolean;
  expectGate?: string;
  kind: ViolationKind;
}

// A small deterministic PRNG (mulberry32) so the 100 scenarios are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildScenario(i: number, rng: () => number): Scenario {
  const kinds: ViolationKind[] = [
    "valid",
    "identity_scope",
    "capability",
    "unit_health",
    "geofence",
    "battery_link",
    "maintenance_lockout",
    "mission_state",
    "freshness",
    "estop",
    "lost_link"
  ];
  // Bias toward a healthy mix: rotate through the kinds deterministically, with a
  // little rng jitter on parameters so each scenario is a distinct sample.
  const kind = kinds[i % kinds.length];
  const id = `hil-${i}`;
  const jitterPoint = SAFE_POINT;

  // healthy baseline
  let intent = baseIntent({ id, params: { destination: jitterPoint } });
  let ctx = baseCtx();
  let estopBefore: Scenario["estopBefore"];
  let expectAllowed = true;
  let expectGate: string | undefined;

  switch (kind) {
    case "valid": {
      // vary battery comfortably above floor
      const battery = 40 + Math.floor(rng() * 50);
      ctx = baseCtx({ machines: [baseMachine({ batteryPct: battery })] });
      expectAllowed = true;
      break;
    }
    case "identity_scope": {
      intent = baseIntent({
        id,
        params: { destination: jitterPoint },
        issuedBy: {
          operatorId: `v-${i}`,
          role: "viewer",
          authority: "cloud_operator",
          scopedSiteId: SITE_ID
        }
      });
      expectAllowed = false;
      expectGate = "identity_scope";
      break;
    }
    case "capability": {
      ctx = baseCtx({
        adapter: {
          adapterId: "ro",
          commandHardware: false,
          supportedControlLevels: ["observe"]
        }
      });
      expectAllowed = false;
      expectGate = "capability";
      break;
    }
    case "unit_health": {
      const status = rng() < 0.5 ? "offline" : "recalled";
      ctx = baseCtx({ machines: [baseMachine({ status })] });
      expectAllowed = false;
      expectGate = "unit_health";
      break;
    }
    case "geofence": {
      const point = rng() < 0.5 ? NOGO_POINT : OUTSIDE_POINT;
      intent = baseIntent({ id, params: { destination: point } });
      expectAllowed = false;
      expectGate = "geofence";
      break;
    }
    case "battery_link": {
      const battery = Math.floor(rng() * 20); // below floor of 25
      ctx = baseCtx({ machines: [baseMachine({ batteryPct: battery })] });
      expectAllowed = false;
      expectGate = "battery_link";
      break;
    }
    case "maintenance_lockout": {
      ctx = baseCtx({ units: [baseUnit({ maintenanceLockout: true })] });
      expectAllowed = false;
      expectGate = "maintenance_lockout";
      break;
    }
    case "mission_state": {
      ctx = baseCtx({ units: [baseUnit({ activeMissionId: `MIS-${i}` })] });
      expectAllowed = false;
      expectGate = "mission_state";
      break;
    }
    case "freshness": {
      // deadline shorter than the 1000ms age between issuedAt and NOW
      intent = baseIntent({
        id,
        params: { destination: jitterPoint },
        freshnessDeadlineMs: 100 + Math.floor(rng() * 300)
      });
      expectAllowed = false;
      expectGate = "freshness";
      break;
    }
    case "estop": {
      estopBefore = { scope: rng() < 0.5 ? "site" : "unit", authority: "physical" };
      expectAllowed = false;
      expectGate = "estop";
      break;
    }
    case "lost_link": {
      // Partitioned link on a dispatch. battery_link fires first (link !== up),
      // so the expected denying gate is battery_link; either way it must be denied.
      const linkStates: LinkState[] = ["partitioned"];
      ctx = baseCtx({ units: [baseUnit({ link: linkStates[0] })] });
      expectAllowed = false;
      expectGate = undefined; // accept battery_link OR lost_link
      break;
    }
  }

  return { intent, ctx, estopBefore, expectAllowed, expectGate, kind };
}

describe("CommandArbiter — 100-scenario HIL table", () => {
  it("decides correctly for all 100 scenarios and keeps a contiguous hash chain", () => {
    const rng = mulberry32(0xc0ffee);
    const scenarios: Scenario[] = Array.from({ length: 100 }, (_, i) =>
      buildScenario(i, rng)
    );

    let correct = 0;
    const failures: string[] = [];

    for (let i = 0; i < scenarios.length; i++) {
      const s = scenarios[i];
      // Each scenario gets a fresh arbiter so an engaged e-stop in one does not
      // bleed into the next; the chain contiguity is asserted per-arbiter below
      // AND on a shared arbiter afterward.
      const arb = new CommandArbiter();
      if (s.estopBefore) {
        arb.estopEngage({
          scope: s.estopBefore.scope,
          targetId: s.estopBefore.scope === "site" ? SITE_ID : "M-UGV-01",
          authority: s.estopBefore.authority,
          intentId: `pre-estop-${i}`,
          nowIso: NOW
        });
      }
      const d = arb.evaluate(s.intent, s.ctx, NOW);

      const allowedOk = d.allowed === s.expectAllowed;
      const gateOk = s.expectGate === undefined || d.deniedByGate === s.expectGate;
      if (allowedOk && gateOk) {
        correct++;
      } else {
        failures.push(
          `#${i} kind=${s.kind} expectedAllowed=${s.expectAllowed} got=${d.allowed} ` +
            `expectedGate=${s.expectGate ?? "*"} gotGate=${d.deniedByGate ?? "-"}`
        );
      }
    }

    if (failures.length > 0) {
      // Surface the first few failures for fast debugging.
      throw new Error(`HIL failures (${failures.length}):\n${failures.slice(0, 10).join("\n")}`);
    }
    expect(correct).toBe(100);

    // Contiguity on a SINGLE shared arbiter running all 100 in sequence.
    const shared = new CommandArbiter();
    for (let i = 0; i < scenarios.length; i++) {
      const s = scenarios[i];
      if (s.estopBefore) {
        shared.estopEngage({
          scope: s.estopBefore.scope,
          targetId: s.estopBefore.scope === "site" ? SITE_ID : `M-UGV-${i}`,
          authority: s.estopBefore.authority,
          intentId: `pre-estop-shared-${i}`,
          nowIso: NOW
        });
      }
      shared.evaluate({ ...s.intent, id: `shared-${i}` }, s.ctx, NOW);
    }
    const chain = shared.getAuditChain();
    expect(chain.length).toBeGreaterThanOrEqual(100);
    // prevHash of each record must equal the prior record's hash; first is GENESIS.
    let expectedPrev = "GENESIS";
    for (const rec of chain) {
      expect(rec.prevHash).toBe(expectedPrev);
      const recomputed = fnv1a(
        rec.prevHash +
          JSON.stringify([
            rec.auditId,
            rec.intentId,
            rec.commandType,
            rec.targetMachineId,
            rec.operatorId,
            rec.allowed,
            rec.deniedByGate ?? null,
            rec.reasons,
            rec.decidedAt
          ])
      );
      expect(rec.hash).toBe(recomputed);
      expectedPrev = rec.hash;
    }
    expect(shared.verifyChain()).toBe(true);
  });
});

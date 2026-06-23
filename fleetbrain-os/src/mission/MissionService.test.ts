import { describe, expect, it } from "vitest";
import type { CoverageZone, Machine, Site } from "../domain/types";
import { MissionService } from "./MissionService";
import { canTransition, isTerminal, legalNextStates } from "./missionStateMachine";
import type { CreateMissionParams, MissionState, MissionValidationContext } from "./types";

const SITE: Site = {
  id: "SITE-FPR-01",
  name: "Fort Pierce Resilience Microgrid",
  location: "Fort Pierce, FL",
  mission: "Maintain evidence-backed readiness."
};

const ZONES: CoverageZone[] = [
  { id: "Z-PERIMETER", name: "South Perimeter", purpose: "Fence line", requiredMachineKinds: ["uav"], freshnessMinutes: 45 },
  { id: "Z-BESS", name: "BESS Yard", purpose: "Battery containers", requiredMachineKinds: ["uav"], freshnessMinutes: 30 }
];

const MACHINES: Machine[] = [
  { id: "M-UAV-01", label: "Drone Alpha", kind: "uav", vendor: "DJI", status: "available", batteryPct: 86 },
  { id: "M-UGV-01", label: "Ground Unit WOLF", kind: "quadruped", vendor: "Unitree", status: "docked", batteryPct: 72 },
  { id: "M-OFFLINE-01", label: "Dead Unit", kind: "uav", vendor: "DJI", status: "offline" }
];

function baseCreateParams(overrides: Partial<CreateMissionParams> = {}): CreateMissionParams {
  return {
    id: "MSN-001",
    siteId: SITE.id,
    taskType: "perimeter_patrol",
    targetZoneIds: ["Z-PERIMETER"],
    assignedMachineIds: ["M-UAV-01"],
    createdAt: "2026-06-18T10:00:00.000Z",
    ...overrides
  };
}

function validationCtx(overrides: Partial<MissionValidationContext> = {}): MissionValidationContext {
  return {
    site: SITE,
    zones: ZONES,
    machines: MACHINES,
    at: "2026-06-18T10:01:00.000Z",
    ...overrides
  };
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`Expected ok result, got error: ${result.error}`);
  return result.value;
}

describe("missionStateMachine", () => {
  it("encodes the documented transition table", () => {
    expect(legalNextStates("draft")).toEqual(["validated", "canceled"]);
    expect(legalNextStates("validated")).toEqual(["authorized", "rejected", "canceled"]);
    expect(legalNextStates("authorized")).toEqual(["dispatched", "canceled"]);
    expect(legalNextStates("dispatched")).toEqual(["accepted", "rejected", "canceled"]);
    expect(legalNextStates("accepted")).toEqual(["executing", "canceled"]);
    expect(legalNextStates("executing")).toEqual(["completed", "paused", "canceled", "rejected", "failed"]);
    expect(legalNextStates("paused")).toEqual(["executing", "canceled", "failed"]);
  });

  it("marks completed/canceled/rejected/failed as terminal", () => {
    for (const state of ["completed", "canceled", "rejected", "failed"] as MissionState[]) {
      expect(isTerminal(state)).toBe(true);
      expect(legalNextStates(state)).toEqual([]);
    }
  });

  it("canTransition agrees with legalNextStates", () => {
    expect(canTransition("draft", "validated")).toBe(true);
    expect(canTransition("draft", "executing")).toBe(false);
    expect(canTransition("paused", "executing")).toBe(true);
  });
});

describe("MissionService.create", () => {
  it("creates a draft mission and audits creation", () => {
    const svc = new MissionService();
    const mission = unwrap(svc.create(baseCreateParams()));
    expect(mission.state).toBe("draft");
    expect(mission.history).toEqual([]);

    const audit = svc.listAuditTrail(SITE.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("mission_created");
    expect(audit[0].subjectRef).toBe("MSN-001");
  });

  it("rejects duplicate ids, empty targets, and unsupported task types", () => {
    const svc = new MissionService();
    unwrap(svc.create(baseCreateParams()));

    expect(svc.create(baseCreateParams())).toMatchObject({ ok: false });
    expect(svc.create(baseCreateParams({ id: "MSN-002", targetZoneIds: [] })).ok).toBe(false);
    // @ts-expect-error deliberately passing an unsupported task type at runtime
    expect(svc.create(baseCreateParams({ id: "MSN-003", taskType: "bogus_type" })).ok).toBe(false);
  });
});

describe("MissionService happy-path lifecycle", () => {
  it("walks draft → ... → completed with one audit entry per transition", () => {
    const svc = new MissionService();
    unwrap(svc.create(baseCreateParams()));

    unwrap(svc.validate("MSN-001", validationCtx()));
    expect(svc.get("MSN-001")!.state).toBe("validated");

    unwrap(svc.authorize("MSN-001", "operator", "2026-06-18T10:02:00.000Z"));
    expect(svc.get("MSN-001")!.state).toBe("authorized");

    unwrap(svc.transition("MSN-001", "dispatched", "FleetBrainKernel", "Dispatched to edge.", "2026-06-18T10:03:00.000Z"));
    unwrap(svc.transition("MSN-001", "accepted", "system", "Edge accepted.", "2026-06-18T10:04:00.000Z"));
    unwrap(svc.transition("MSN-001", "executing", "system", "Patrol started.", "2026-06-18T10:05:00.000Z"));
    const completed = unwrap(
      svc.transition("MSN-001", "completed", "system", "Patrol complete.", "2026-06-18T10:30:00.000Z")
    );

    expect(completed.state).toBe("completed");

    // history: validated, authorized, dispatched, accepted, executing, completed = 6 transitions
    expect(completed.history.map((step) => step.to)).toEqual([
      "validated",
      "authorized",
      "dispatched",
      "accepted",
      "executing",
      "completed"
    ]);

    // Audit: 1 creation + 6 transitions = 7 entries; newest first.
    const audit = svc.listAuditTrail(SITE.id);
    expect(audit).toHaveLength(7);
    expect(audit[0].action).toBe("mission_executing_to_completed");
    const actions = audit.map((entry) => entry.action);
    expect(actions).toContain("mission_draft_to_validated");
    expect(actions).toContain("mission_authorized_to_dispatched");
    audit.forEach((entry) => expect(entry.subjectRef).toBe("MSN-001"));
  });
});

describe("MissionService illegal transitions", () => {
  it("rejects every illegal transition with a clear error and no state change", () => {
    const svc = new MissionService();
    unwrap(svc.create(baseCreateParams()));

    // From draft, anything but validated/canceled is illegal.
    for (const target of ["authorized", "dispatched", "accepted", "executing", "completed", "paused", "failed"] as MissionState[]) {
      const res = svc.transition("MSN-001", target, "operator", "illegal attempt", "2026-06-18T10:10:00.000Z");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain("Illegal transition");
    }
    // State unchanged and nothing appended to history.
    const mission = svc.get("MSN-001")!;
    expect(mission.state).toBe("draft");
    expect(mission.history).toEqual([]);
  });

  it("rejects transitions out of a terminal state", () => {
    const svc = new MissionService();
    unwrap(svc.create(baseCreateParams()));
    unwrap(svc.validate("MSN-001", validationCtx()));
    unwrap(svc.transition("MSN-001", "canceled", "operator", "Stand down.", "2026-06-18T10:06:00.000Z"));

    const res = svc.transition("MSN-001", "executing", "operator", "too late", "2026-06-18T10:07:00.000Z");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("terminal");
  });
});

describe("MissionService.validate failures", () => {
  it("fails on a nonexistent target zone", () => {
    const svc = new MissionService();
    unwrap(svc.create(baseCreateParams({ targetZoneIds: ["Z-DOES-NOT-EXIST"] })));
    const res = svc.validate("MSN-001", validationCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Z-DOES-NOT-EXIST");
    expect(svc.get("MSN-001")!.state).toBe("draft");
  });

  it("fails on an offline assigned machine", () => {
    const svc = new MissionService();
    unwrap(svc.create(baseCreateParams({ assignedMachineIds: ["M-UAV-01", "M-OFFLINE-01"] })));
    const res = svc.validate("MSN-001", validationCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("M-OFFLINE-01");
    expect(svc.get("MSN-001")!.state).toBe("draft");
  });

  it("fails on a missing assigned machine", () => {
    const svc = new MissionService();
    unwrap(svc.create(baseCreateParams({ assignedMachineIds: ["M-GHOST"] })));
    const res = svc.validate("MSN-001", validationCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("M-GHOST");
  });
});

describe("MissionService pause/resume", () => {
  it("supports executing → paused → executing", () => {
    const svc = new MissionService();
    unwrap(svc.create(baseCreateParams()));
    unwrap(svc.validate("MSN-001", validationCtx()));
    unwrap(svc.authorize("MSN-001", "operator", "2026-06-18T10:02:00.000Z"));
    unwrap(svc.transition("MSN-001", "dispatched", "system", "Dispatched.", "2026-06-18T10:03:00.000Z"));
    unwrap(svc.transition("MSN-001", "accepted", "system", "Accepted.", "2026-06-18T10:04:00.000Z"));
    unwrap(svc.transition("MSN-001", "executing", "system", "Started.", "2026-06-18T10:05:00.000Z"));

    unwrap(svc.transition("MSN-001", "paused", "operator", "Weather hold.", "2026-06-18T10:06:00.000Z"));
    expect(svc.get("MSN-001")!.state).toBe("paused");

    const resumed = unwrap(svc.transition("MSN-001", "executing", "operator", "Resumed.", "2026-06-18T10:07:00.000Z"));
    expect(resumed.state).toBe("executing");
    expect(resumed.history.map((s) => s.to)).toEqual([
      "validated",
      "authorized",
      "dispatched",
      "accepted",
      "executing",
      "paused",
      "executing"
    ]);
  });
});

describe("MissionService idempotency", () => {
  it("treats a re-issued transitionId as a no-op", () => {
    const svc = new MissionService();
    unwrap(svc.create(baseCreateParams()));

    const first = unwrap(
      svc.validate("MSN-001", validationCtx({ transitionId: "T-VALIDATE-1" }))
    );
    expect(first.state).toBe("validated");
    expect(first.history).toHaveLength(1);

    // Re-issue the exact same transition id: no-op, no new history, no new audit.
    const replay = unwrap(svc.validate("MSN-001", validationCtx({ transitionId: "T-VALIDATE-1" })));
    expect(replay.state).toBe("validated");
    expect(replay.history).toHaveLength(1);

    const audit = svc.listAuditTrail(SITE.id);
    // 1 creation + 1 validate transition = 2 (replay added nothing).
    expect(audit).toHaveLength(2);
  });
});

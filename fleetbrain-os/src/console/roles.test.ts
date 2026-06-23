import { describe, expect, it } from "vitest";
import { roleBlockReason, roleCan, toArbiterRole, type OperatorRole } from "./roles";
import type { DecisionActionKind } from "./decisionActions";

describe("roleCan — capability matrix", () => {
  const motion: DecisionActionKind[] = ["dispatch", "recall", "estop"];
  const review: DecisionActionKind[] = ["confirm", "dismiss", "escalate"];

  it("noc_admin and operator can perform motion + safety actions", () => {
    for (const role of ["noc_admin", "operator"] as OperatorRole[]) {
      for (const a of motion) expect(roleCan(role, a)).toBe(true);
      for (const a of review) expect(roleCan(role, a)).toBe(true);
    }
  });

  it("analyst can do review actions but NOT motion", () => {
    for (const a of review) expect(roleCan("analyst", a)).toBe(true);
    for (const a of motion) expect(roleCan("analyst", a)).toBe(false);
  });

  it("viewer can do nothing", () => {
    for (const a of [...motion, ...review]) expect(roleCan("viewer", a)).toBe(false);
  });

  it("e-stop is available to noc_admin and operator (safety override), not analyst/viewer", () => {
    expect(roleCan("noc_admin", "estop")).toBe(true);
    expect(roleCan("operator", "estop")).toBe(true);
    expect(roleCan("analyst", "estop")).toBe(false);
    expect(roleCan("viewer", "estop")).toBe(false);
  });
});

describe("roleBlockReason", () => {
  it("explains the operator-role requirement for motion", () => {
    expect(roleBlockReason("analyst", "dispatch")).toContain("Operator");
  });

  it("explains viewer is read-only", () => {
    expect(roleBlockReason("viewer", "confirm")).toContain("read-only");
  });
});

describe("toArbiterRole", () => {
  it("maps operator roles to a site operator (motion authority)", () => {
    expect(toArbiterRole("noc_admin")).toBe("site_operator");
    expect(toArbiterRole("operator")).toBe("site_operator");
  });

  it("maps analyst and viewer to the arbiter viewer role (no motion authority)", () => {
    expect(toArbiterRole("analyst")).toBe("viewer");
    expect(toArbiterRole("viewer")).toBe("viewer");
  });
});

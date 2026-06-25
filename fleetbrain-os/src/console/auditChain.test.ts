import { describe, expect, it } from "vitest";
import { OperatorAuditChain, verifyAuditChain } from "./auditChain";

function seededChain() {
  const chain = new OperatorAuditChain();
  chain.append({ id: "op-1", timestamp: "2026-06-19T06:00:00Z", actor: "operator", action: "dispatch_unit", subjectRef: "dec-1", detail: "verify perimeter", allowed: true });
  chain.append({ id: "op-2", timestamp: "2026-06-19T06:01:00Z", actor: "operator", action: "arbiter_decision", subjectRef: "dec-2", detail: "deny UGV", allowed: false, deniedByGate: "geofence" });
  chain.append({ id: "op-3", timestamp: "2026-06-19T06:02:00Z", actor: "operator", action: "confirm", subjectRef: "dec-1", detail: "closed" });
  return chain;
}

describe("verifyAuditChain", () => {
  it("verifies an intact chain and reports the head", () => {
    const records = seededChain().list();
    const result = verifyAuditChain(records);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.head).toBe(records[records.length - 1].hash);
    expect(result.brokenAt).toBeUndefined();
  });

  it("treats an empty chain as verified with the GENESIS head", () => {
    const result = verifyAuditChain([]);
    expect(result).toEqual({ ok: true, count: 0, head: "GENESIS" });
  });

  it("detects a tampered record and names where it breaks", () => {
    const records = seededChain().list().map((r) => ({ ...r }));
    records[1] = { ...records[1], detail: "TAMPERED" }; // edit content, leave stored hash
    const result = verifyAuditChain(records);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe("op-2");
  });

  it("detects a broken link (reordered/removed record)", () => {
    const records = seededChain().list();
    const broken = [records[0], records[2]]; // drop op-2, leaving op-3.prevHash dangling
    const result = verifyAuditChain(broken);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe("op-3");
  });

  it("agrees with the chain instance's own verify()", () => {
    const chain = seededChain();
    expect(chain.verify()).toBe(verifyAuditChain(chain.list()).ok);
  });
});

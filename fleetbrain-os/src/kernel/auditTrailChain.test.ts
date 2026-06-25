import { describe, expect, it } from "vitest";
import type { AuditEntry } from "../domain/types";
import { chainAuditTrail, verifyAuditTrail } from "./auditTrailChain";

function entry(over: Partial<AuditEntry> & Pick<AuditEntry, "id" | "timestamp">): AuditEntry {
  return {
    actor: "system",
    action: "ingest",
    subjectRef: "site-1",
    detail: "ingested events",
    ...over
  };
}

describe("chainAuditTrail", () => {
  it("orders by timestamp and links each entry off the previous hash from GENESIS", () => {
    const chained = chainAuditTrail([
      entry({ id: "b", timestamp: "2026-06-19T06:01:00Z" }),
      entry({ id: "a", timestamp: "2026-06-19T06:00:00Z" })
    ]);
    expect(chained.map((e) => e.id)).toEqual(["a", "b"]);
    expect(chained[0].prevHash).toBe("GENESIS");
    expect(chained[1].prevHash).toBe(chained[0].hash);
  });

  it("breaks timestamp ties deterministically by id, regardless of input order", () => {
    const ts = "2026-06-19T06:00:00Z";
    const forward = chainAuditTrail([
      entry({ id: "b", timestamp: ts }),
      entry({ id: "a", timestamp: ts })
    ]);
    const reversed = chainAuditTrail([
      entry({ id: "a", timestamp: ts }),
      entry({ id: "b", timestamp: ts })
    ]);
    expect(forward.map((e) => e.id)).toEqual(["a", "b"]);
    expect(reversed.map((e) => e.id)).toEqual(["a", "b"]);
    expect(forward).toEqual(reversed);
  });

  it("is deterministic — same input yields the same chain", () => {
    const input = [
      entry({ id: "a", timestamp: "2026-06-19T06:00:00Z" }),
      entry({ id: "b", timestamp: "2026-06-19T06:01:00Z" })
    ];
    expect(chainAuditTrail(input)).toEqual(chainAuditTrail(input));
  });
});

describe("verifyAuditTrail", () => {
  function seeded(): AuditEntry[] {
    return chainAuditTrail([
      entry({ id: "a", timestamp: "2026-06-19T06:00:00Z" }),
      entry({ id: "b", timestamp: "2026-06-19T06:01:00Z" }),
      entry({ id: "c", timestamp: "2026-06-19T06:02:00Z" })
    ]);
  }

  it("verifies an intact trail and reports the head", () => {
    const records = seeded();
    const result = verifyAuditTrail(records);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.head).toBe(records[records.length - 1].hash);
  });

  it("treats an empty trail as verified with the GENESIS head", () => {
    expect(verifyAuditTrail([])).toEqual({ ok: true, count: 0, head: "GENESIS" });
  });

  it("detects a tampered entry and names where it breaks", () => {
    const records = seeded();
    records[1] = { ...records[1], detail: "TAMPERED" };
    const result = verifyAuditTrail(records);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe("b");
  });

  it("detects a dropped entry (dangling link)", () => {
    const records = seeded();
    const result = verifyAuditTrail([records[0], records[2]]);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe("c");
  });
});

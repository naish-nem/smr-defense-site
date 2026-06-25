import { resolveImage, type DecisionItem } from "./queue";
import { verifyAuditChain, type OperatorAuditRecord } from "./auditChain";
import { verifyAuditTrail } from "../kernel/auditTrailChain";
import type { SiteRecord } from "../domain/types";
import type { ScenarioId } from "../data/scenarios";

/**
 * Proof — the deliverable. The signed coverage + evidence record for the selected
 * situation: a clean coverage summary, the evidence list with thumbnails + review
 * state, and the immutable hash-chained audit timeline (including operator actions
 * just taken). Customer/auditor-facing — clean, no operator chrome. Exportable.
 */
export function ProofView(props: {
  situations: Array<{ id: ScenarioId; label: string }>;
  selected: ScenarioId;
  onSelect: (id: ScenarioId) => void;
  record: SiteRecord | undefined;
  decisions: DecisionItem[];
  operatorAudit: OperatorAuditRecord[];
}) {
  const { situations, selected, onSelect, record, decisions, operatorAudit } = props;
  const label = situations.find((s) => s.id === selected)?.label ?? selected;

  if (!record) return <div className="cx-boot">Loading proof…</div>;

  const covered = record.coverageZones.filter((z) => z.state === "covered").length;
  const total = record.coverageZones.length;

  // Tamper-evidence: re-verify the operator audit chain (append order, not the
  // time-sorted timeline). This is the moat made visible — the customer/auditor
  // can confirm the signed record is intact, including any denied commands.
  const integrity = verifyAuditChain(operatorAudit);

  // Same tamper-evidence check over the site's system audit trail (the
  // hash-chained AuditEntry[] on the record), proving the system-side links
  // recompute link-for-link from GENESIS.
  const trailIntegrity = verifyAuditTrail(record.auditTrail);

  // The audit timeline = the site-record audit (system) + the operator chain.
  const timeline = [
    ...record.auditTrail.map((a) => ({
      id: a.id,
      at: a.timestamp,
      actor: a.actor,
      action: a.action.replace(/_/g, " "),
      detail: a.detail,
      hash: a.hash
    })),
    ...operatorAudit.map((a) => ({
      id: a.id,
      at: a.timestamp,
      actor: a.actor,
      action: a.action.replace(/_/g, " "),
      detail: a.detail,
      hash: a.hash
    }))
  ].sort((a, b) => a.at.localeCompare(b.at));

  function exportJson() {
    const payload = {
      generatedAt: record!.generatedAt,
      situation: { id: selected, label },
      site: record!.site,
      coverage: {
        coveredZones: covered,
        totalZones: total,
        zones: record!.coverageZones.map((z) => ({ name: z.name, state: z.state, lastCheckedAt: z.lastCheckedAt }))
      },
      evidence: record!.latestEvidence,
      operatorAudit,
      chainIntegrity: {
        verified: integrity.ok,
        signedRecords: integrity.count,
        chainHead: integrity.head,
        brokenAt: integrity.brokenAt
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fleetbrain-proof-${selected}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="cx-proof">
      <div className="cx-proof-head">
        <div className="cx-picker">
          {situations.map((s) => (
            <button key={s.id} type="button" className={s.id === selected ? "active" : ""} onClick={() => onSelect(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <button className="cx-export" type="button" onClick={exportJson}>
          Export signed record (JSON)
        </button>
      </div>

      <div className="cx-proof-doc">
        <header>
          <p className="cx-kicker">Signed coverage record</p>
          <h1>{record.site.name}</h1>
          <p className="cx-sub">
            {label} · generated {formatDateTime(record.generatedAt)}
          </p>
        </header>

        <section className="cx-coverage-summary">
          <div className="cx-cov-big">
            <strong>{covered}/{total}</strong>
            <span>zones covered</span>
          </div>
          <ul>
            {record.coverageZones.map((z) => (
              <li key={z.id}>
                <span className={`cx-pill tone-${z.state === "covered" ? "ok" : z.state === "exception" ? "bad" : "warn"}`}>
                  {z.state === "covered" ? "Covered" : z.state === "exception" ? "Exception" : "Stale"}
                </span>
                {z.name}
              </li>
            ))}
          </ul>
        </section>

        <section className="cx-evidence-list">
          <h2>Evidence ({record.latestEvidence.length})</h2>
          <div className="cx-evidence-grid">
            {record.latestEvidence.map((ev) => (
              <figure key={ev.id}>
                {resolveImage(ev.artifactRefs[0]) ? (
                  <img src={resolveImage(ev.artifactRefs[0])} alt="" />
                ) : (
                  <div className="cx-evidence-noframe">No visual frame · sensor only</div>
                )}
                <figcaption>
                  <strong>{ev.zoneId} · {ev.result}</strong>
                  <span>{ev.sourceMachineId} · {formatTime(ev.checkedAt)}</span>
                  <small className={`cx-review ${ev.reviewState}`}>{ev.reviewState.replace(/_/g, " ")}</small>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="cx-audit">
          <h2>Audit timeline · hash-chained</h2>
          <div className={`cx-integrity ${integrity.ok ? "ok" : "broken"}`} role="status">
            <span className="cx-integrity-dot" />
            {integrity.ok ? (
              <span>
                <strong>Chain verified</strong> · {integrity.count} signed operator record{integrity.count === 1 ? "" : "s"}
                {integrity.count > 0 ? <> · head <code className="cx-hash">{integrity.head}</code></> : null}
              </span>
            ) : (
              <span>
                <strong>Chain broken</strong> · tamper detected at record <code className="cx-hash">{integrity.brokenAt}</code>
              </span>
            )}
          </div>
          <div className={`cx-integrity ${trailIntegrity.ok ? "ok" : "broken"}`} role="status">
            <span className="cx-integrity-dot" />
            {trailIntegrity.ok ? (
              <span>
                <strong>Audit trail intact</strong> · {trailIntegrity.count} system record{trailIntegrity.count === 1 ? "" : "s"}
                {trailIntegrity.count > 0 ? <> · head <code className="cx-hash">{trailIntegrity.head}</code></> : null}
              </span>
            ) : (
              <span>
                <strong>Audit trail broken</strong> · tamper detected at record <code className="cx-hash">{trailIntegrity.brokenAt}</code>
              </span>
            )}
          </div>
          {timeline.length === 0 ? (
            <p className="cx-sub">No recorded actions for this situation yet.</p>
          ) : (
            <ol className="cx-audit-list">
              {timeline.map((t) => (
                <li key={t.id}>
                  <time>{formatDateTime(t.at)}</time>
                  <div>
                    <strong>{t.action}</strong>
                    <span>{t.actor} · {t.detail}</span>
                  </div>
                  {t.hash ? <code className="cx-hash">{t.hash}</code> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function formatDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

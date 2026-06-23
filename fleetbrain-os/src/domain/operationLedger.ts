import type { FleetException, SiteRecord } from "./types";

export type WorkOrderStatus = "open" | "assigned" | "reviewed" | "escalated";

export interface WorkOrder {
  id: string;
  exceptionId: string;
  type: FleetException["type"];
  severity: FleetException["severity"];
  siteId: string;
  location: string;
  status: WorkOrderStatus;
  owner: string;
  nextAction: string;
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export type WorkOrderAction =
  | {
      type: "assign";
      workOrderId: string;
      owner: string;
      at: string;
    }
  | {
      type: "mark_reviewed";
      workOrderId: string;
      at: string;
    }
  | {
      type: "escalate";
      workOrderId: string;
      at: string;
    };

export interface LedgerAuditEvent {
  id: string;
  timestamp: string;
  actor: "operator" | "FleetBrainKernel";
  action: string;
  detail: string;
}

export interface OperationLedger {
  workOrders: WorkOrder[];
  audit: LedgerAuditEvent[];
}

export function deriveWorkOrders(record: SiteRecord): WorkOrder[] {
  return record.openExceptions.map((exception) => ({
    id: `wo-${exception.id}`,
    exceptionId: exception.id,
    type: exception.type,
    severity: exception.severity,
    siteId: record.site.id,
    location: exception.location,
    status: exception.status === "assigned" ? "assigned" : "open",
    owner: exception.owner,
    nextAction: exception.nextAction,
    evidenceRefs: exception.evidenceRefs,
    createdAt: record.generatedAt,
    updatedAt: record.generatedAt
  }));
}

export function mergeDerivedWorkOrders(current: WorkOrder[], derived: WorkOrder[]): WorkOrder[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  return derived.map((item) => {
    const existing = currentById.get(item.id);
    if (!existing) return item;
    return {
      ...item,
      status: existing.status,
      owner: existing.owner,
      updatedAt: existing.updatedAt
    };
  });
}

export function createInitialLedger(record: SiteRecord): OperationLedger {
  return {
    workOrders: deriveWorkOrders(record),
    audit: [
      {
        id: `audit-${record.site.id}-${record.generatedAt}`,
        timestamp: record.generatedAt,
        actor: "FleetBrainKernel",
        action: "work_orders_derived",
        detail: "Open exceptions converted into human-reviewable work orders."
      }
    ]
  };
}

export function applyWorkOrderAction(ledger: OperationLedger, action: WorkOrderAction): OperationLedger {
  const workOrders = ledger.workOrders.map((item) => {
    if (item.id !== action.workOrderId) return item;

    if (action.type === "assign") {
      return {
        ...item,
        status: "assigned" as const,
        owner: action.owner,
        updatedAt: action.at
      };
    }

    if (action.type === "mark_reviewed") {
      return {
        ...item,
        status: "reviewed" as const,
        updatedAt: action.at
      };
    }

    const escalatedSeverity: WorkOrder["severity"] = item.severity === "critical" ? "critical" : "high";
    return {
      ...item,
      status: "escalated" as const,
      severity: escalatedSeverity,
      updatedAt: action.at
    };
  });

  return {
    workOrders,
    audit: [
      {
        id: `audit-${action.workOrderId}-${action.type}-${action.at}`,
        timestamp: action.at,
        actor: "operator",
        action: action.type,
        detail: describeAction(action)
      },
      ...ledger.audit
    ]
  };
}

function describeAction(action: WorkOrderAction): string {
  if (action.type === "assign") return `${action.workOrderId} assigned to ${action.owner}.`;
  if (action.type === "mark_reviewed") return `${action.workOrderId} marked reviewed.`;
  return `${action.workOrderId} escalated for human response.`;
}

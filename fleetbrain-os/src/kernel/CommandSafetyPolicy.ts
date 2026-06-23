import type { MachineAdapter, SiteRecord } from "../domain/types";

export interface CommandIntent {
  id: string;
  type: "dispatch_machine" | "upload_route" | "start_livestream" | "recall_machine";
  targetMachineId: string;
  reason: string;
}

export interface CommandDecision {
  allowed: boolean;
  reasons: string[];
  intent: CommandIntent;
}

export function evaluateCommandIntent(params: {
  intent: CommandIntent;
  record: SiteRecord;
  adapters: MachineAdapter[];
}): CommandDecision {
  const reasons: string[] = [];

  if (params.record.readiness.commandAuthority !== "guarded" && params.record.readiness.commandAuthority !== "autonomous") {
    reasons.push(`Site record command authority is ${params.record.readiness.commandAuthority}.`);
  }

  if (!params.adapters.some((adapter) => adapter.capabilities.commandHardware)) {
    reasons.push("No registered adapter exposes hardware command capability.");
  }

  if (params.record.openExceptions.some((exception) => exception.status === "open")) {
    reasons.push("Open exceptions require human review before hardware commands.");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    intent: params.intent
  };
}

import type { FreshnessState, TelemetryEnvelope } from "./types";

export function assessFreshness(envelope: Pick<TelemetryEnvelope, "observedAt" | "ttlSeconds">, now: string): FreshnessState {
  const observed = new Date(envelope.observedAt).getTime();
  const current = new Date(now).getTime();
  if (Number.isNaN(observed) || Number.isNaN(current)) return "unknown";

  const ageSeconds = Math.max(0, (current - observed) / 1000);
  if (ageSeconds > envelope.ttlSeconds) return "stale";
  if (ageSeconds > envelope.ttlSeconds * 0.7) return "aging";
  return "fresh";
}

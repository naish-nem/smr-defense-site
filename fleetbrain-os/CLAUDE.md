# FleetBrain OS — Agent Working Notes

This is the buildable FleetBrain control plane (not the static `SMRDefense_FleetBrain (10).html` simulation, which is only a clickable spec). Read `../docs/fleetbrain_direction_2026-06-18.md` for the strategy and `../docs/plans/fleetbrain-all-phases-2026-06-18.md` for the build plan.

## What FleetBrain is
Internal operations control plane for a managed robotic-fleet service on energy sites. Organized around **Site → Zone → Asset → InspectionPoint, Mission, Event, Evidence, Exception** — NOT robot-first. The robot is a data-collection body; the product is *proof a place was inspected* + a signed audit trail.

## Architecture (three planes)
- **Cloud control plane** — registry, missions, telemetry history, evidence index, immutable audit log. No real-time robot loop.
- **Site edge gateway** — command arbiter + safety watchdog (deterministic, local), vendor adapters, store-and-forward. Real-time safety lives HERE, never across the WAN.
- **Media/spatial/intelligence** — video, coordinate transforms, geofence eval, perception.

## Non-negotiable invariants (the compounding rules)
1. **Telemetry-first, command-later.** Read-only adapters set `commandHardware: false`. A command-capable adapter must go through the arbiter; nothing else may move a robot.
2. **Audit everything.** Every state change and every command decision (allow OR deny) emits an `AuditEntry` with a deterministic id. Audit is append-only and signed (hash-chained) for command decisions.
3. **Deterministic + pure.** Domain/kernel code takes timestamps as inputs — never call `Date.now()`/`new Date()` inside domain logic (it breaks determinism and tests). Simulators are scenario-driven and reproducible.
4. **Evidence promotion rule.** An `Event` becomes `CoverageEvidence` only if it has a `zoneId` and is a coverage event type. Telemetry is not evidence.
5. **DJI ≠ Unitree safety class.** Unitree/DEEP `safe_state` is a deterministic LAN call. DJI `safe_state` is a mediated request; the real failsafe is aircraft firmware RTH which we *observe*, not *own*. Model these as different classes — never pretend one interface.
6. **Zero new runtime deps** without explicit reason. TS strict, ES modules, vitest for tests.

## Layout
```
src/domain/    pure types + builders (the spine — change carefully, many things depend on it)
src/adapters/  vendor adapters implementing MachineAdapter (read-only) / CommandCapableAdapter (guarded)
src/kernel/    control-plane services (ingestion, store, kernel, command arbiter)
src/mission/   Phase 1 — mission lifecycle service
src/edge/      Phase 2 — edge gateway, store-and-forward, link health, soak harness
src/arbiter/   Phase 3 — command arbiter + guarded adapter + HIL tests
src/autonomy/  Phase 4 — patrol-loop + perception interfaces (sim)
src/demo/      Phase 0 — July-21 demo orchestrator (live signal + recorded fallback)
src/console/   operator console surfaces (Queue, Site Truth, Proof, Incident) + device detail, incident replay, operator audit chain
src/app/       React shell entry
```

## Conventions
- Services are classes; domain transforms are pure functions.
- New cross-module types live in `domain/types.ts` only if widely shared; otherwise co-locate in the owning module.
- Test files: `*.test.ts` colocated or under `tests/`. Run `npm test` (vitest) and `npx tsc --noEmit`.
- Deterministic IDs: `audit-<action>-<subject>-<timestamp>` style.

## How to extend (compounded shortcuts)
- **Add a vendor adapter:** implement `MachineAdapter`; set capabilities; map vendor telemetry into `MachineEvent` with a `TelemetryEnvelope` (stamp `source_vendor`, frame, freshness). Register in `AdapterRegistry`.
- **Add a mission type:** extend the mission `taskType` union in `src/mission/`; add a validator; the lifecycle state machine is shared.
- **Add an arbiter gate:** add a `Gate` to the ordered gate list in `src/arbiter/`; each gate is a pure `(ctx) => GateResult`. Order matters (cheapest/safety-first).
- **Extend incident replay:** reconstruction lives in `src/console/replay.ts` (pure — timestamps in, never `Date.now()`). `buildReplayTimeline` merges a device's trail + activity into one keyframe stream; `reconstructAt(timeline, atMs)` returns the last-known position + everything observed up to T; `buildIncidentPackage` emits a signed `fleetbrain.incident-replay.v1` package whose `packageDigest` is `fnv1a` over the body (same linker as the audit chain — invariant 2). Every keyframe keeps its SourceTag. The scrubber UI is `IncidentReplay.tsx`, mounted in `DeviceDetailPanel`. To add a new evidence source, give it an `at` + a SourceTag and fold it into the timeline.

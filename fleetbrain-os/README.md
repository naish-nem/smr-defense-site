# FleetBrain OS

FleetBrain OS is the real software seed for a read-only machine orchestration layer.

It starts with one hard product promise: turn machine inputs into a trusted site record before attempting dispatch, autonomy, or multi-site fleet control.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal.

## What Exists Now

- TypeScript domain contracts for `MachineEvent`, `CoverageEvidence`, `FleetException`, `SiteRecord`, and `MachineAdapter`.
- `FleetBrainKernel`, which reads adapter state/events/health and builds a current site record.
- `FleetBrainStore`, an in-memory event/audit/site-record store shaped like a future durable append log.
- `EventIngestionService`, which dedupes adapter events before projection.
- `AdapterRegistry`, which tracks active adapters and health by site.
- `OperationLedger`, which turns exceptions into human-owned work orders.
- `CommandSafetyPolicy`, which blocks hardware command intent while FleetBrain is read-only.
- `ReadinessDecision`, which evaluates pass/warn/fail gates for operational closure.
- `SimulatorAdapter`, which provides deterministic machine scenarios.
- `DjiCloudReadOnlyAdapter` and `UnitreeReadOnlyAdapter` stubs with explicit missing inputs.
- React operating surface for coverage, exceptions, evidence, raw events, adapter readiness, and command authority.
- Device detail with live/recorded stream descriptor, location trail, and a hash-stamped activity record.
- **Incident replay** (`src/console/replay.ts` + `IncidentReplay.tsx`): scrub a device to any moment T and reconstruct where it was, what it had captured, and which operator actions had fired by then — then export a signed `fleetbrain.incident-replay.v1` evidence package (`fnv1a` digest, every keyframe source-tagged).
- Vitest regression tests for deterministic site-record behavior, read-only adapter boundaries, and replay reconstruction/package integrity.

## What We Do Not Have Yet

- DJI Cloud workspace credentials, MQTT broker details, device serials, media library access, and OSD/property normalization.
- Unitree robot network access, selected SDK mode, local telemetry schema, and patrol event mapping.
- Site geometry, zone polygons, inspection SLAs, and real artifact storage.
- User identity, assignment workflow, audit retention, and permissions.
- Safety case for hardware command authority.
- Real telemetry envelopes: observed time, received time, clock skew, sequence IDs, drop counts.
- Site coordinate frames, transforms, zone polygons, dock locations, and inspection waypoints.
- Artifact integrity: capture pose, hash, retention, review state, chain of custody.

Until those exist, FleetBrain remains read-only by design.

## Future Build Order

1. Replace simulator fixtures with recorded DJI Cloud read-only telemetry.
2. Normalize DJI device/media/task events into `MachineEvent`.
3. Add Unitree read-only status and patrol-pass mapping.
4. Add persistent site-record storage and audit trail.
5. Add assignment workflow for exceptions.
6. Only after the evidence layer is trusted, design guarded command authority.

import { useMemo, useRef, useState } from "react";
import type { AdapterHealth, Machine } from "../domain/types";
import { AdapterRegistry } from "../adapters/AdapterRegistry";
import type { UnitreeConfig } from "../adapters/UnitreeReadOnlyAdapter";
import type { DjiCloudConfig } from "../adapters/DjiCloudReadOnlyAdapter";
import type { SiteBlueprint } from "../onboarding/siteBlueprint";
import { fortPierceBlueprint } from "../onboarding/fortPierceBlueprint";
import { validateBlueprint } from "../onboarding/validateBlueprint";
import { bootstrapSite } from "../onboarding/bootstrapSite";
import { HARDWARE_PROFILES, type HardwareProfileId } from "../onboarding/hardwareProfile";
import { onboardHardware } from "../onboarding/onboardHardware";

/**
 * Onboarding surface — the operator-facing front door for standing up a site
 * and registering hardware. It is a thin shell over the pure onboarding engine
 * (validateBlueprint / bootstrapSite / onboardHardware); all logic lives there.
 * Additive only: this does not touch the single-site live data path.
 */

type Mode = "site" | "hardware";

const SITE_ID = "SITE-NEW-01";

export function OnboardingView(props: { nowIso: string }) {
  const [mode, setMode] = useState<Mode>("site");
  return (
    <div className="cx-onboarding">
      <div className="cx-onboard-tabs" role="tablist" aria-label="Onboarding mode">
        <button type="button" className={mode === "site" ? "active" : ""} onClick={() => setMode("site")}>
          New site
        </button>
        <button type="button" className={mode === "hardware" ? "active" : ""} onClick={() => setMode("hardware")}>
          Add hardware
        </button>
      </div>
      {mode === "site" ? <NewSitePanel nowIso={props.nowIso} /> : <AddHardwarePanel nowIso={props.nowIso} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New site
// ---------------------------------------------------------------------------

function NewSitePanel({ nowIso }: { nowIso: string }) {
  const [text, setText] = useState(() => JSON.stringify(fortPierceBlueprint, null, 2));
  const [bootstrapped, setBootstrapped] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      return { blueprint: JSON.parse(text) as SiteBlueprint, error: null as string | null };
    } catch (e) {
      return { blueprint: null, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  }, [text]);

  const validation = useMemo(
    () => (parsed.blueprint ? validateBlueprint(parsed.blueprint) : null),
    [parsed.blueprint]
  );

  return (
    <div className="cx-onboard-cols">
      <section className="cx-onboard-panel">
        <div className="cx-onboard-panel-head">
          <h2>Site blueprint</h2>
          <button
            type="button"
            className="cx-back"
            onClick={() => {
              setText(JSON.stringify(fortPierceBlueprint, null, 2));
              setBootstrapped(null);
            }}
          >
            Load Fort Pierce example
          </button>
        </div>
        <textarea
          className="cx-onboard-editor"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setBootstrapped(null);
          }}
          aria-label="Site blueprint JSON"
        />

        {parsed.error ? (
          <p className="cx-issue error">JSON parse error: {parsed.error}</p>
        ) : validation ? (
          <div className="cx-issues">
            {validation.ok ? (
              <p className="cx-issue ok">Blueprint validates — {parsed.blueprint!.zones.length} zones, ready to bootstrap.</p>
            ) : (
              validation.errors.map((issue, i) => (
                <p key={`e${i}`} className="cx-issue error">
                  {issue.ref ? <code>{issue.ref}</code> : null} {issue.message}
                </p>
              ))
            )}
            {validation.warnings.map((issue, i) => (
              <p key={`w${i}`} className="cx-issue warn">
                {issue.ref ? <code>{issue.ref}</code> : null} {issue.message}
              </p>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className="cx-primary"
          disabled={!validation?.ok}
          onClick={() => {
            if (!parsed.blueprint) return;
            const result = bootstrapSite(parsed.blueprint, { siteId: SITE_ID, now: nowIso });
            setBootstrapped(
              `Bootstrapped ${result.site.name} (${result.site.id}): ${result.coverageZones.length} zones, ` +
                `${result.geometry.dockLocations.length} docks. Audit: ${result.audit[0].id}`
            );
          }}
        >
          Bootstrap site
        </button>
        {bootstrapped ? <p className="cx-issue ok">{bootstrapped}</p> : null}
      </section>

      <section className="cx-onboard-panel">
        <h2>Traced preview</h2>
        {parsed.blueprint ? <BlueprintPreview blueprint={parsed.blueprint} /> : <p className="cx-issue error">No valid blueprint to preview.</p>}
      </section>
    </div>
  );
}

function BlueprintPreview({ blueprint }: { blueprint: SiteBlueprint }) {
  const boundary = blueprint.boundary ?? [];
  if (boundary.length < 3) return <p className="cx-issue error">Boundary needs at least 3 vertices to preview.</p>;

  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;
  const W = 360;
  const scale = W / spanX;
  const H = spanY * scale;
  // ENU y is up; SVG y is down — flip.
  const sx = (x: number) => (x - minX) * scale;
  const sy = (y: number) => H - (y - minY) * scale;
  const toPoints = (verts: Array<{ x: number; y: number }>) => verts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ");

  return (
    <svg className="cx-onboard-svg" viewBox={`-8 -8 ${W + 16} ${H + 16}`} role="img" aria-label="Blueprint geometry preview">
      <polygon points={toPoints(boundary)} className="cx-bp-boundary" />
      {(blueprint.zones ?? []).map((zone, i) => (
        // Keyed by index, not zone id — a draft blueprint may transiently have
        // duplicate ids (which validation flags); the preview must still render.
        <g key={`zone-${i}`}>
          <polygon points={toPoints(zone.vertices)} className="cx-bp-zone" />
          {zone.waypoint ? <circle cx={sx(zone.waypoint.point.x)} cy={sy(zone.waypoint.point.y)} r={3} className="cx-bp-wp" /> : null}
        </g>
      ))}
      {(blueprint.noGoZones ?? []).map((noGo, i) => (
        <polygon key={`nogo-${i}`} points={toPoints(noGo.vertices)} className="cx-bp-nogo" />
      ))}
      {(blueprint.docks ?? []).map((dock, i) => (
        <rect key={`dock-${i}`} x={sx(dock.point.x) - 3} y={sy(dock.point.y) - 3} width={6} height={6} className="cx-bp-dock" />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Add hardware
// ---------------------------------------------------------------------------

interface OnboardedUnit {
  machine: Machine;
  safetyClass: string;
  missingKeys: string[];
  health: AdapterHealth;
}

const PROFILE_IDS = Object.keys(HARDWARE_PROFILES) as HardwareProfileId[];

function AddHardwarePanel({ nowIso }: { nowIso: string }) {
  const registry = useRef(new AdapterRegistry()).current;
  const [profileId, setProfileId] = useState<HardwareProfileId>("unitree-go2");
  const [machineId, setMachineId] = useState("");
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<OnboardedUnit[]>([]);
  const [busy, setBusy] = useState(false);

  const profile = HARDWARE_PROFILES[profileId];
  const duplicate = units.some((u) => u.machine.id === machineId);
  const canSubmit = machineId.trim().length > 0 && !duplicate && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const base = { machineId, label };
      const result =
        profileId === "unitree-go2"
          ? onboardHardware({ ...base, profileId, config: config as unknown as UnitreeConfig }, { siteId: SITE_ID, now: nowIso, registry })
          : onboardHardware({ ...base, profileId, config: config as unknown as DjiCloudConfig }, { siteId: SITE_ID, now: nowIso, registry });
      const health = await result.adapter.reportAdapterHealth();
      setUnits((prev) => [
        ...prev,
        { machine: result.machine, safetyClass: result.safetyClass, missingKeys: result.validation.missingKeys, health }
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cx-onboard-cols">
      <section className="cx-onboard-panel">
        <h2>Register a unit</h2>
        <label className="cx-field">
          <span>Profile</span>
          <select
            value={profileId}
            onChange={(e) => {
              setProfileId(e.target.value as HardwareProfileId);
              // Reset everything unit-specific so a new profile can't inherit
              // the previous vendor's id/label/config.
              setConfig({});
              setMachineId("");
              setLabel("");
            }}
          >
            {PROFILE_IDS.map((id) => (
              <option key={id} value={id}>
                {HARDWARE_PROFILES[id].vendor} {HARDWARE_PROFILES[id].model}
              </option>
            ))}
          </select>
        </label>
        <p className="cx-onboard-note">
          {profile.kind} · safety class <strong>{profile.safetyClass}</strong> · read-only
        </p>

        <label className="cx-field">
          <span>Machine id</span>
          <input value={machineId} placeholder="e.g. M-UGV-02" onChange={(e) => setMachineId(e.target.value)} />
        </label>
        <label className="cx-field">
          <span>Label</span>
          <input value={label} placeholder="e.g. Ground Unit FOX" onChange={(e) => setLabel(e.target.value)} />
        </label>

        {profile.requiredConfigKeys.map((key) => {
          const options = profile.configOptions?.[key];
          return (
            <label className="cx-field" key={key}>
              <span>{key}</span>
              {options ? (
                <select
                  value={config[key] ?? ""}
                  onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                >
                  <option value="">—</option>
                  {options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={config[key] ?? ""}
                  onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              )}
            </label>
          );
        })}

        {duplicate ? <p className="cx-issue error">A unit with id "{machineId}" is already onboarded.</p> : null}
        <button type="button" className="cx-primary" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "Onboarding…" : "Onboard unit"}
        </button>
      </section>

      <section className="cx-onboard-panel">
        <h2>Onboarded units ({units.length})</h2>
        {units.length === 0 ? (
          <p className="cx-onboard-note">No units yet. Register a unit to register its read-only adapter.</p>
        ) : (
          <ul className="cx-onboard-units">
            {units.map((unit, i) => (
              <li key={`${unit.machine.id}-${i}`} className="cx-onboard-unit">
                <div>
                  <strong>{unit.machine.label}</strong> <code>{unit.machine.id}</code>
                  <span className={`cx-safety ${unit.safetyClass}`}>{unit.safetyClass}</span>
                </div>
                <div className={`cx-health ${unit.health.status}`}>
                  {unit.machine.vendor} {unit.machine.model} — {unit.health.status}
                  {unit.missingKeys.length ? <em> · awaiting: {unit.missingKeys.join(", ")}</em> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

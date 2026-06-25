import type { BlueprintZone } from "./siteBlueprint";

/**
 * Deterministic id helpers shared by `validateBlueprint` and `bootstrapSite`,
 * so both agree on the id a zone resolves to. Pure.
 */

/** Slugify a zone name into a stable fallback id, e.g. "BESS Yard" -> "Z-BESS-YARD". */
export function slugifyZoneId(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `Z-${slug}`;
}

/** A zone's resolved id: its explicit `id` if given, else a slug of its name. */
export function resolveZoneId(zone: BlueprintZone): string {
  return zone.id?.trim() || slugifyZoneId(zone.name);
}

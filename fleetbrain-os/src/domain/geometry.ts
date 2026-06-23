import type { SitePoint, ZonePolygon } from "./types";

export function pointInPolygon(point: SitePoint, polygon: ZonePolygon): boolean {
  let inside = false;
  const vertices = polygon.vertices;

  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

export function zoneContainsPoint(zoneId: string, point: SitePoint, zones: ZonePolygon[]): boolean {
  const zone = zones.find((candidate) => candidate.zoneId === zoneId);
  return zone ? pointInPolygon(point, zone) : false;
}

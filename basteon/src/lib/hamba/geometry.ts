import type { GeoPoint } from "./types";

const radians = (value: number) => value * Math.PI / 180;
export function distanceM(a: GeoPoint, b: GeoPoint) {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function distanceToPolylineM(point: GeoPoint, line: GeoPoint[]) {
  if (line.length < 2) return Infinity;
  const latitudeScale = 111_320;
  const longitudeScale = Math.cos(radians(point.lat)) * 111_320;
  const toPlane = (value: GeoPoint) => ({ x: (value.lng - point.lng) * longitudeScale, y: (value.lat - point.lat) * latitudeScale });
  return line.slice(1).reduce((best, end, index) => {
    const start = toPlane(line[index]);
    const target = toPlane(end);
    const lengthSquared = (target.x - start.x) ** 2 + (target.y - start.y) ** 2;
    const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (-(start.x) * (target.x - start.x) + -(start.y) * (target.y - start.y)) / lengthSquared));
    const x = start.x + ratio * (target.x - start.x);
    const y = start.y + ratio * (target.y - start.y);
    return Math.min(best, Math.hypot(x, y));
  }, Infinity);
}
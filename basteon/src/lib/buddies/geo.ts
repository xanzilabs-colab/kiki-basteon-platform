import type { LatLng } from "./types";

const EARTH_R = 6_371_008.8;
const M_PER_DEG_LAT = 111_132;
const M_PER_DEG_LNG = 111_320;
export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function xy(p: LatLng, o: LatLng) {
  return { x: (p.lng - o.lng) * Math.cos(rad(o.lat)) * M_PER_DEG_LNG, y: (p.lat - o.lat) * M_PER_DEG_LAT };
}

export function polylineLengthM(line: LatLng[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += haversineM(line[i - 1], line[i]);
  return s;
}

/** Evenly spaced points along a polyline. */
export function resample(line: LatLng[], stepM: number): LatLng[] {
  if (line.length < 2) return [...line];
  const out: LatLng[] = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const segLen = haversineM(a, b);
    if (segLen === 0) continue;
    let d = stepM - carry;
    while (d <= segLen) {
      const t = d / segLen;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      d += stepM;
    }
    carry = segLen - (d - stepM);
  }
  const last = line[line.length - 1];
  if (haversineM(out[out.length - 1], last) > stepM * 0.25) out.push(last);
  return out;
}

/** Distance from p to the polyline, plus the bearing of the nearest segment. */
export function nearestOnPolyline(p: LatLng, line: LatLng[]): { distM: number; bearing: number } {
  let best = { distM: Infinity, bearing: 0 };
  for (let i = 1; i < line.length; i++) {
    const a = xy(line[i - 1], p);
    const b = xy(line[i], p);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(a.x * dx + a.y * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (d < best.distM) best = { distM: d, bearing: (deg(Math.atan2(dx, dy)) + 360) % 360 };
  }
  return best;
}

/** Snap a point to a fixed grid. Everything below cell size is invisible to any observer. */
export function snapToCell(p: LatLng, sizeM: number): { id: string; center: LatLng } {
  const latStep = sizeM / M_PER_DEG_LAT;
  const row = Math.floor(p.lat / latStep);
  const centerLat = (row + 0.5) * latStep;
  const lngStep = sizeM / (M_PER_DEG_LNG * Math.cos(rad(centerLat)));
  const col = Math.floor(p.lng / lngStep);
  return { id: `${sizeM}:${row}:${col}`, center: { lat: centerLat, lng: (col + 0.5) * lngStep } };
}

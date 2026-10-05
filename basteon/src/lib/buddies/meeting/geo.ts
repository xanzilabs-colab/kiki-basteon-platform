// lib/buddies/meeting/geo.ts
// Small geometry helpers. No dependencies.
import type { LatLng } from "./types";

const R = 6371000;
const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line distance x circuity. Cheap stand-in for a routing engine (see README: swap for OSRM later). */
export function roadDistanceM(a: LatLng, b: LatLng, circuity = 1.3): number {
  return haversineM(a, b) * circuity;
}

type XY = { x: number; y: number };

function toXY(p: LatLng, ref: LatLng): XY {
  return { x: rad(p.lng - ref.lng) * R * Math.cos(rad(ref.lat)), y: rad(p.lat - ref.lat) * R };
}

function fromXY(p: XY, ref: LatLng): LatLng {
  return {
    lat: ref.lat + deg(p.y / R),
    lng: ref.lng + deg(p.x / (R * Math.cos(rad(ref.lat)))),
  };
}

export function centroid(points: LatLng[]): LatLng {
  if (points.length === 0) throw new Error("centroid of nothing");
  const ref = points[0];
  const xy = points.map((p) => toXY(p, ref));
  const x = xy.reduce((s, p) => s + p.x, 0) / xy.length;
  const y = xy.reduce((s, p) => s + p.y, 0) / xy.length;
  return fromXY({ x, y }, ref);
}

/** Weiszfeld iteration: the point minimising total distance to all points (fairer than the plain average for 3+ people). */
export function geometricMedian(points: LatLng[], iterations = 60): LatLng {
  if (points.length === 0) throw new Error("median of nothing");
  if (points.length <= 2) return centroid(points);
  const ref = centroid(points);
  const xy = points.map((p) => toXY(p, ref));
  let cur: XY = { x: 0, y: 0 };
  for (let i = 0; i < iterations; i++) {
    let nx = 0;
    let ny = 0;
    let w = 0;
    for (const p of xy) {
      const d = Math.max(Math.hypot(p.x - cur.x, p.y - cur.y), 1); // avoid /0
      nx += p.x / d;
      ny += p.y / d;
      w += 1 / d;
    }
    const next = { x: nx / w, y: ny / w };
    if (Math.hypot(next.x - cur.x, next.y - cur.y) < 1) {
      cur = next;
      break;
    }
    cur = next;
  }
  return fromXY(cur, ref);
}

export function bboxAround(center: LatLng, radiusM: number): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  const dLat = deg(radiusM / R);
  const dLng = deg(radiusM / (R * Math.max(Math.cos(rad(center.lat)), 0.1)));
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}

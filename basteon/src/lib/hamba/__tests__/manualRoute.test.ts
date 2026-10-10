import { describe, expect, it } from "vitest";
import { buildManualRoute, checkpointTimes, thin } from "../manualRoute";

const o = { lat: 0, lng: 0 };
const d = { lat: 0, lng: 0.02 };

describe("manual route", () => {
  it("combines stops and drawn points in order", () => {
    const r = buildManualRoute(o, d, "walk", [{ lat: 0, lng: 0.005 }], [{ lat: 0, lng: 0.01 }]);
    expect(r.points).toHaveLength(4);
    expect(r.distanceM).toBeGreaterThan(2000);
  });
  it("cycling is faster than walking over the same line", () => {
    expect(buildManualRoute(o, d, "cycling", [], []).durationS).toBeLessThan(buildManualRoute(o, d, "walk", [], []).durationS);
  });
  it("orders stop ETAs along the route", () => {
    const stops = [{ lat: 0, lng: 0.005 }, { lat: 0, lng: 0.015 }];
    const r = buildManualRoute(o, d, "walk", stops, []);
    const [a, b] = checkpointTimes(r, stops, 0);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(r.durationS * 1000);
  });
  it("thins long lines keeping the ends", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const t = thin(items, 10);
    expect(t).toHaveLength(10);
    expect(t[0]).toBe(0);
    expect(t.at(-1)).toBe(99);
  });
});

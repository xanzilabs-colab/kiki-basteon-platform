import { describe, expect, it } from "vitest";
import { evaluateRouteWatch } from "../routeWatch";
import type { GeoPoint, PlannedRoute } from "../types";

const start = Date.UTC(2026, 9, 4, 8, 0, 0);
const point = (lat: number, lng: number, seconds: number): GeoPoint => ({ lat, lng, timestamp: start + seconds * 1_000, accuracyM: 12 });
const route: PlannedRoute = { points: [point(-26.2041, 28.0473, 0), point(-26.2041, 28.0673, 900)], distanceM: 2_000, durationS: 900, alternatives: [] };
const watch = (fixes: GeoPoint[]) => evaluateRouteWatch({ mode: "taxi", route, fixes, startedAt: start, expectedArrivalAt: start + 900_000, now: fixes.at(-1)?.timestamp ?? start });

describe("Route Watch GPX simulations", () => {
  it("normal trip never reaches Alert", () => {
    const result = watch([point(-26.2041, 28.049, 60), point(-26.2041, 28.055, 240)]);
    expect(result.state).toBe("normal");
  });

  it("traffic jam never reaches Alert", () => {
    const result = watch([point(-26.2041, 28.052, 0), point(-26.2041, 28.0521, 420)]);
    expect(result.state).not.toBe("alert");
  });

  it("legitimate detour that rejoins remains below Alert", () => {
    const result = watch([point(-26.201, 28.054, 90), point(-26.2041, 28.058, 240)]);
    expect(result.state).not.toBe("alert");
  });

  it("detour leading away reaches Alert with corroborated reasons", () => {
    const result = watch([point(-26.2041, 28.060, 90), point(-26.198, 28.050, 240)]);
    expect(result.state).toBe("alert");
    expect(result.reasons.map((item) => item.signal)).toEqual(expect.arrayContaining(["off_route", "moving_away"]));
  });

  it("long stop is a watch signal, not proof of danger", () => {
    const result = watch([point(-26.2041, 28.054, 0), point(-26.2041, 28.054, 380)]);
    expect(result.state).not.toBe("alert");
    expect(result.reasons.map((item) => item.signal)).toContain("unexpected_stop");
  });

  it("tunnel GPS loss is treated as uncertainty", () => {
    const result = watch([point(-26.2041, 28.054, 0), point(-26.2041, 28.058, 240)]);
    expect(result.state).not.toBe("alert");
    expect(result.reasons.map((item) => item.signal)).toContain("signal_loss");
  });

  it("night-time route uses the same evidence threshold without reputation data", () => {
    const result = watch([point(-26.2041, 28.050, 60), point(-26.2041, 28.057, 180)]);
    expect(result.score).toBeLessThan(30);
  });
});
import { describe, expect, it } from "vitest";
import { estimateResponseRoute, formatResponseEta } from "../responseRoute";

describe("responder route fallback", () => {
  it("estimates a conservative road distance and ETA without drawing a straight-line route", () => {
    const estimate = estimateResponseRoute(
      { lat: -26.2041, lng: 28.0473 },
      { lat: -26.2141, lng: 28.0473 },
    );

    expect(estimate.distanceM).toBeGreaterThan(1_000);
    expect(estimate.durationS).toBeGreaterThan(60);
    expect(estimate.points).toEqual([]);
    expect(estimate.roadRoute).toBe(false);
    expect(formatResponseEta(estimate, "en_route")).toContain("estimated");
  });

  it("uses routed travel time when a street route is available", () => {
    expect(formatResponseEta({
      points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
      distanceM: 2_000,
      durationS: 420,
      roadRoute: true,
    }, "en_route")).toBe("~7 min");
  });

  it("reports on-scene status rather than an ETA", () => {
    expect(formatResponseEta(undefined, "on_scene")).toBe("On scene");
  });

  it("estimates arrival if a routing provider omits its duration", () => {
    expect(formatResponseEta({
      points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
      distanceM: 2_000,
      durationS: null,
      roadRoute: true,
    })).toContain("estimated");
  });
});

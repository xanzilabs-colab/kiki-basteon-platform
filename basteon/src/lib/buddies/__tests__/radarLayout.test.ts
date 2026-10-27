import { describe, expect, it } from "vitest";
import { radarMarkerPosition } from "../radarLayout";

describe("radar marker layout", () => {
  it("keeps all markers inside the radar regardless of their radial value", () => {
    for (const angle of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const position = radarMarkerPosition(angle, 1);
      expect(position.left).toBeGreaterThanOrEqual(26);
      expect(position.left).toBeLessThanOrEqual(74);
      expect(position.top).toBeGreaterThanOrEqual(26);
      expect(position.top).toBeLessThanOrEqual(74);
    }
  });

  it("clamps malformed radial values and handles non-finite angles", () => {
    expect(radarMarkerPosition(90, 5)).toEqual(radarMarkerPosition(90, 1));
    expect(radarMarkerPosition(Number.NaN, Number.NaN)).toEqual(radarMarkerPosition(0, 0));
  });
});

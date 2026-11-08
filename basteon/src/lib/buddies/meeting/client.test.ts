import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/location", () => ({
  getCurrentLocation: vi.fn(),
  locationErrorMessage: vi.fn(() => "Location permission is blocked."),
}));

import { getCurrentLocation } from "@/lib/platform/location";
import { currentMeetingLocation } from "./client";

describe("currentMeetingLocation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the shared platform location service and returns only coordinates", async () => {
    vi.mocked(getCurrentLocation).mockResolvedValue({
      lat: -26.2,
      lng: 28,
      accuracy: 80,
      capturedAt: 1_800_000_000_000,
    });

    await expect(currentMeetingLocation()).resolves.toEqual({ lat: -26.2, lng: 28 });
    expect(getCurrentLocation).toHaveBeenCalledWith({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    });
  });

  it("keeps actionable permission guidance when location cannot be read", async () => {
    vi.mocked(getCurrentLocation).mockRejectedValue(new Error("denied"));

    await expect(currentMeetingLocation()).rejects.toThrow("Location permission is blocked.");
  });
});

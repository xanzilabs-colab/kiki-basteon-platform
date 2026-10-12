import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeAddress, searchAddresses } from "./geocoding";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("address geocoding", () => {
  it("converts an address into server-validated coordinates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { display_name: "12 Main Road, Johannesburg", lat: "-26.2", lon: "28.0" },
    ]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeAddress("12 Main Road, Johannesburg")).resolves.toEqual({
      label: "12 Main Road, Johannesburg",
      lat: -26.2,
      lng: 28,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("countrycodes=za");
  });

  it("returns address suggestions and rejects missing or invalid coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { display_name: "Valid address", lat: "-26.2", lon: "28" },
      { display_name: "Invalid address", lat: "91", lon: "28" },
    ]), { status: 200 })));
    await expect(searchAddresses("a valid address")).resolves.toEqual([
      { label: "Valid address", lat: -26.2, lng: 28 },
    ]);
  });

  it("reports no-match and provider failures clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", { status: 200 })));
    await expect(geocodeAddress("unknown address")).rejects.toThrow("address_not_found");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(searchAddresses("provider error")).rejects.toThrow("geocoding_unavailable");
  });
});

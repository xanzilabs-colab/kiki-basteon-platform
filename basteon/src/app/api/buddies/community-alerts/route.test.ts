import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  geocodeAddress: vi.fn(),
}));

vi.mock("../_meeting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_meeting")>();
  return {
    ...actual,
    meetingSession: mocks.session,
    meetingRpc: mocks.rpc,
    meetingBody: async (request: Request, schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } }) => {
      const parsed = schema.safeParse(await request.json().catch(() => null));
      return parsed.success ? parsed.data : null;
    },
  };
});
vi.mock("@/lib/geocoding", () => ({ geocodeAddress: mocks.geocodeAddress }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  }),
}));

import { POST } from "./route";

const ORIGIN = "https://kiki.example";

function request(body: unknown) {
  return new Request(`${ORIGIN}/api/buddies/community-alerts`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("community report locations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ client: {}, user: { id: "reporter" } });
    mocks.rpc.mockResolvedValue("00000000-0000-4000-8000-000000000001");
    mocks.geocodeAddress.mockResolvedValue({ lat: -26.2, lng: 28.1, label: "Found address" });
  });

  it("submits a real but ungeocoded address using the selected map pin", async () => {
    const response = await POST(request({
      kind: "road_hazard",
      address: "Known intersection that the address search cannot resolve",
      lat: -26.2041,
      lng: 28.0473,
      detail: "The crossing has a dangerous pothole.",
    }));
    expect(response.status).toBe(201);
    expect(mocks.geocodeAddress).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith({}, "report_community_alert_detail", expect.objectContaining({
      p_lat: -26.2041,
      p_lng: 28.0473,
      p_location_label: "Known intersection that the address search cannot resolve",
      p_region: null,
    }));
  });

  it("stores drawn areas with coarsened ring coordinates", async () => {
    const response = await POST(request({
      kind: "unsafe_area",
      lat: -26.2,
      lng: 28.1,
      region: { type: "Polygon", coordinates: [[[28.12345, -26.12345], [28.2, -26.12], [28.2, -26.2], [28.12345, -26.12345]]] },
      detail: "Please avoid this poorly lit block.",
    }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith({}, "report_community_alert_detail", expect.objectContaining({
      p_location_label: "Area selected on map",
      p_region: { type: "Polygon", coordinates: [[[28.123, -26.123], [28.2, -26.12], [28.2, -26.2], [28.123, -26.123]]] },
    }));
  });

  it("continues to geocode address-only reports", async () => {
    const response = await POST(request({
      kind: "harassment",
      address: "12 Main Road, Johannesburg",
      detail: "A threatening incident was reported.",
    }));
    expect(response.status).toBe(201);
    expect(mocks.geocodeAddress).toHaveBeenCalledWith("12 Main Road, Johannesburg");
    expect(mocks.rpc).toHaveBeenCalledWith({}, "report_community_alert_detail", expect.objectContaining({
      p_lat: -26.2,
      p_lng: 28.1,
    }));
  });
});

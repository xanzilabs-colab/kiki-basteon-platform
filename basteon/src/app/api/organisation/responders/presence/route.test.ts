import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  currentUserId: vi.fn(),
  access: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@/lib/organisation", () => ({
  currentUserId: mocks.currentUserId,
  requireOrganisationAccess: mocks.access,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { POST } from "./route";

const organisationId = "00000000-0000-0000-0000-000000000001";
const userId = "00000000-0000-0000-0000-000000000002";

describe("POST responder presence heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUserId.mockResolvedValue(userId);
    mocks.access.mockResolvedValue({
      memberships: [{ organisation_id: organisationId, role: "responder" }],
    });
  });

  it("refreshes GPS freshness whenever a fresh location is published, even when the coordinates are unchanged", async () => {
    const db = fakeSupabase((call: FakeCall) =>
      call.table === "responder_presence" ? { data: [{ availability: "available" }] } : { data: null },
    );
    mocks.admin.mockReturnValue(db.client);

    const response = await POST(jsonRequest("http://localhost/api/organisation/responders/presence", {
      organisationId,
      lat: -26.2,
      lng: 28,
      accuracyM: 6.8,
    }));

    const update = db.calls.find((call) => call.table === "responder_presence" && call.action === "update");
    expect(response.status).toBe(200);
    expect(update?.payload).toMatchObject({
      last_lat: -26.2,
      last_lng: 28,
      last_accuracy_m: 6.8,
    });
    expect(update?.payload).toHaveProperty("last_location_at");
    expect(update?.payload).toHaveProperty("last_seen_at");
  });

  it("does not make a heartbeat without coordinates look like a fresh GPS fix", async () => {
    const db = fakeSupabase((call: FakeCall) =>
      call.table === "responder_presence" ? { data: [{ availability: "available" }] } : { data: null },
    );
    mocks.admin.mockReturnValue(db.client);

    const response = await POST(jsonRequest("http://localhost/api/organisation/responders/presence", {
      organisationId,
    }));

    const update = db.calls.find((call) => call.table === "responder_presence" && call.action === "update");
    expect(response.status).toBe(200);
    expect(update?.payload).toEqual({ last_seen_at: expect.any(String) });
  });
});

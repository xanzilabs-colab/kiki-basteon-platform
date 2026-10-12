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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.admin,
}));

import { PATCH } from "./route";

const organisationId = "00000000-0000-0000-0000-000000000001";
const userId = "00000000-0000-0000-0000-000000000002";

describe("PATCH responder availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUserId.mockResolvedValue(userId);
    mocks.access.mockResolvedValue({
      memberships: [{ organisation_id: organisationId, role: "responder", branch_id: null }],
    });
  });

  it("preserves the last GPS fix when availability changes without a new location", async () => {
    const db = fakeSupabase((call: FakeCall) => {
      if (call.table === "responder_presence" && call.action === "select") {
        return { data: { last_lat: -26.2, last_lng: 28.0, unit_id: null } };
      }
      return { data: { user_id: userId }, error: null };
    });
    mocks.admin.mockReturnValue(db.client);

    const response = await PATCH(jsonRequest("http://localhost/api/organisation/responders/availability", {
      organisationId,
      availability: "available",
    }));

    const saved = db.calls.find((call) => call.table === "responder_presence" && call.action === "upsert");
    expect(response.status).toBe(200);
    expect(saved?.payload).toMatchObject({ last_lat: -26.2, last_lng: 28.0, availability: "available" });
  });
});

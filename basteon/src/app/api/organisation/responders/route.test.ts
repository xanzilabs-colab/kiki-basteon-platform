import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@/lib/organisation", () => ({ requireOrganisationAccess: mocks.access }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { GET } from "./route";

const organisationId = "00000000-0000-0000-0000-000000000001";
const responderId = "00000000-0000-0000-0000-000000000002";

describe("GET /api/organisation/responders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({
      userId: "00000000-0000-0000-0000-000000000003",
      memberships: [{ organisation_id: organisationId }],
    });
  });

  it("loads member profiles separately instead of relying on an ambiguous relationship embed", async () => {
    const db = fakeSupabase((call: FakeCall) => {
      if (call.table === "organisation_memberships" && call.action === "select") {
        return {
          data: [{
            id: "membership-1",
            user_id: responderId,
            branch_id: null,
            membership_type: "responder",
            role: "responder",
            status: "active",
          }],
        };
      }
      if (call.table === "profiles" && call.action === "select") {
        return { data: [{ id: responderId, full_name: "Responder One", phone: "555-0100" }] };
      }
      return {};
    });
    mocks.admin.mockReturnValue(db.client);

    const response = await GET(new Request(`http://localhost/api/organisation/responders?organisationId=${organisationId}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{
      id: "membership-1",
      user_id: responderId,
      branch_id: null,
      membership_type: "responder",
      role: "responder",
      status: "active",
      profiles: { full_name: "Responder One", phone: "555-0100" },
    }]);
    expect(db.calls.find((call) => call.table === "organisation_memberships")?.selection)
      .not.toContain("profiles(");
  });
});

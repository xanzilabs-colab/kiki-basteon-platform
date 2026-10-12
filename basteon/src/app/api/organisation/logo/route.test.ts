import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@/lib/organisation", () => ({ requireOrganisationAccess: mocks.access }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { PATCH } from "./route";

const organisationId = "00000000-0000-4000-8000-000000000001";
const managerId = "00000000-0000-4000-8000-000000000002";

describe("PATCH /api/organisation/logo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({
      userId: managerId,
      memberships: [{ organisation_id: organisationId, role: "manager" }],
    });
  });

  it("persists an organisation logo URL for an authorised manager", async () => {
    const db = fakeSupabase((call: FakeCall) =>
      call.table === "organisations" && call.action === "update"
        ? { data: { logo_url: "https://images.example.org/logo.webp" } }
        : { data: null },
    );
    mocks.admin.mockReturnValue(db.client);

    const response = await PATCH(jsonRequest("http://localhost/api/organisation/logo", {
      organisationId,
      logoUrl: "https://images.example.org/logo.webp",
    }, "PATCH"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ logoUrl: "https://images.example.org/logo.webp" });
    expect(db.calls.find((call) => call.table === "organisations" && call.action === "update")?.payload)
      .toEqual({ logo_url: "https://images.example.org/logo.webp" });
  });

  it("rejects non-web URLs without writing the database", async () => {
    const db = fakeSupabase(() => ({ data: null }));
    mocks.admin.mockReturnValue(db.client);

    const response = await PATCH(jsonRequest("http://localhost/api/organisation/logo", {
      organisationId,
      logoUrl: "javascript:alert(1)",
    }, "PATCH"));

    expect(response.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it("rejects users without membership in the target organisation", async () => {
    mocks.access.mockResolvedValue({ userId: managerId, memberships: [] });
    const db = fakeSupabase(() => ({ data: null }));
    mocks.admin.mockReturnValue(db.client);

    const response = await PATCH(jsonRequest("http://localhost/api/organisation/logo", {
      organisationId,
      logoUrl: null,
    }, "PATCH"));

    expect(response.status).toBe(403);
    expect(db.calls).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@/lib/organisation", () => ({
  requireOrganisationAccess: mocks.access,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.admin,
}));

import { PATCH } from "./route";

const organisationId = "00000000-0000-0000-0000-000000000001";
const userId = "00000000-0000-0000-0000-000000000002";

describe("PATCH /api/organisation/branding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({
      userId,
      memberships: [{ organisation_id: organisationId, role: "admin" }],
    });
  });

  it("rejects malformed colours before updating the organisation", async () => {
    const response = await PATCH(jsonRequest("http://localhost/api/organisation/branding", {
      organisationId,
      primaryColor: "#abc",
      accentColor: null,
    }));

    expect(response.status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("does not allow an administrator to update another organisation", async () => {
    mocks.access.mockResolvedValue({ userId, memberships: [] });

    const response = await PATCH(jsonRequest("http://localhost/api/organisation/branding", {
      organisationId,
      primaryColor: "#663399",
      accentColor: null,
    }));

    expect(response.status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("server-adjusts a low contrast primary before saving", async () => {
    const db = fakeSupabase((call: FakeCall) => {
      const payload = call.payload as { brand_primary_color?: string | null; brand_accent_color?: string | null } | undefined;
      return { data: payload ?? {}, error: null };
    });
    mocks.admin.mockReturnValue(db.client);

    const response = await PATCH(jsonRequest("http://localhost/api/organisation/branding", {
      organisationId,
      primaryColor: "#111111",
      accentColor: "#AABBCC",
    }));
    const update = db.calls.find((call) => call.table === "organisations" && call.action === "update");
    const saved = update?.payload as { brand_primary_color: string; brand_accent_color: string };

    expect(response.status).toBe(200);
    expect(saved.brand_primary_color).not.toBe("#111111");
    expect(saved.brand_accent_color).toBe("#AABBCC");
    expect((await response.json()).primaryColor).toBe(saved.brand_primary_color);
  });
});

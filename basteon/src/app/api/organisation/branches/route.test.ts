import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fakeSupabase";

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
const branchId = "00000000-0000-0000-0000-000000000002";
const userId = "00000000-0000-0000-0000-000000000003";

function request(payload: Record<string, unknown>) {
  return new Request("https://kiki.test/api/organisation/branches", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("PATCH /api/organisation/branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({
      userId,
      memberships: [{ organisation_id: organisationId }],
    });
    const db = fakeSupabase((call) => call.table === "organisation_branches" && call.action === "update"
      ? { data: { id: branchId, name: "North Branch" } }
      : {});
    mocks.admin.mockReturnValue(db.client);
  });

  it("updates branch configuration within the user's organisation", async () => {
    const response = await PATCH(request({
      organisationId,
      branchId,
      name: "North Branch",
      code: "NORTH",
      address: "10 Main Road",
      city: "Pretoria",
      lat: -25.7461,
      lng: 28.1881,
      geofenceGeojson: null,
      isHq: true,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: branchId, name: "North Branch" });
  });

  it("rejects out-of-range coordinates", async () => {
    const response = await PATCH(request({
      organisationId,
      branchId,
      name: "North Branch",
      lat: -91,
    }));

    expect(response.status).toBe(400);
  });

  it("rejects attempts to edit a branch in another organisation", async () => {
    const response = await PATCH(request({
      organisationId: "00000000-0000-0000-0000-000000000004",
      branchId,
      name: "North Branch",
    }));

    expect(response.status).toBe(403);
  });
});

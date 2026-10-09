import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET } from "./route";

describe("GET /api/organisation/roster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks authenticated users who are not org owner/admin/manager", async () => {
    mocks.access.mockResolvedValue({ userId: "user-1", memberships: [] });
    const response = await GET(new Request("http://localhost/api/organisation/roster?organisationId=00000000-0000-0000-0000-000000000001", {
      method: "GET",
      headers: { origin: "http://localhost", "x-forwarded-host": "localhost" },
    }));
    expect(response.status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});

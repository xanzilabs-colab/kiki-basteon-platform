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

import { GET, POST } from "./route";

describe("organisation link request access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ userId: "user-1", memberships: [] });
  });

  it("does not expose pending requests to users without organisation manager access", async () => {
    const response = await GET(new Request("http://localhost/api/organisation/link-requests?organisationId=00000000-0000-0000-0000-000000000001"));
    expect(response.status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("does not allow users without organisation manager access to resolve requests", async () => {
    const response = await POST(new Request("http://localhost/api/organisation/link-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId: "00000000-0000-0000-0000-000000000001",
        linkId: "00000000-0000-0000-0000-000000000002",
        action: "approve",
      }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});

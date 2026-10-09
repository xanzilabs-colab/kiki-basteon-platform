import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  profile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ single: mocks.profile }),
      }),
    }),
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.admin,
}));

import { DELETE } from "./route";

describe("DELETE /api/admin/organisations/[id]", () => {
  const originalPassword = process.env.ADMIN_CONTROL_PASSWORD;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile.mockResolvedValue({ data: { role: "admin" } });
  });

  afterEach(() => {
    if (originalPassword === undefined) delete process.env.ADMIN_CONTROL_PASSWORD;
    else process.env.ADMIN_CONTROL_PASSWORD = originalPassword;
  });

  it("rejects an incorrect admin control password without deleting", async () => {
    process.env.ADMIN_CONTROL_PASSWORD = "correct-secret";
    const response = await DELETE(new Request("http://localhost/api/admin/organisations/org-1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminPassword: "wrong-secret" }),
    }), { params: Promise.resolve({ id: "org-1" }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Admin password incorrect." });
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("fails closed when admin control password is not configured", async () => {
    delete process.env.ADMIN_CONTROL_PASSWORD;
    const response = await DELETE(new Request("http://localhost/api/admin/organisations/org-1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminPassword: "anything" }),
    }), { params: Promise.resolve({ id: "org-1" }) });

    expect(response.status).toBe(503);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});

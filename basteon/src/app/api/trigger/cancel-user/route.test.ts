import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.user } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { POST } from "./route";

const userId = "00000000-0000-0000-0000-000000000001";
const pendingId = "00000000-0000-0000-0000-000000000002";

describe("POST /api/trigger/cancel-user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  });

  it("cancels by the authenticated owner and is safe to retry", async () => {
    const db = fakeSupabase(() => ({}), () => ({ data: { ok: true, cancelled: true } }));
    mocks.admin.mockReturnValue(db.client);

    const response = await POST(jsonRequest("http://localhost/api/trigger/cancel-user", { pendingId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, cancelled: true });
    expect(db.rpc).toHaveBeenCalledWith("trigger_pending_cancel_user", {
      p_user_id: userId,
      p_pending_id: pendingId,
    });
  });

  it("requires same-origin authenticated requests with a valid pending ID", async () => {
    const db = fakeSupabase(() => ({}));
    mocks.admin.mockReturnValue(db.client);
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(jsonRequest("http://localhost/api/trigger/cancel-user", { pendingId }))).status).toBe(401);

    mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    const crossOrigin = new Request("http://localhost/api/trigger/cancel-user", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ pendingId }),
    });
    expect((await POST(crossOrigin)).status).toBe(403);
    expect((await POST(jsonRequest("http://localhost/api/trigger/cancel-user", { pendingId: "bad" }))).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("does not treat an unknown or promoted pending alert as cancellable", async () => {
    const db = fakeSupabase(() => ({}), () => ({ data: { ok: false } }));
    mocks.admin.mockReturnValue(db.client);
    const response = await POST(jsonRequest("http://localhost/api/trigger/cancel-user", { pendingId }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "pending_not_cancellable" });
  });
});

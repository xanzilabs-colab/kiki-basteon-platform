import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.user } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { DELETE, GET, POST } from "./route";

const userId = "00000000-0000-0000-0000-000000000001";
const tokenId = "00000000-0000-0000-0000-000000000002";

describe("/api/trigger/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  });

  it("creates an android shell token once and stores only its digest", async () => {
    const db = fakeSupabase(() => ({}), (name) => (
      name === "trigger_token_create" ? { data: { id: tokenId } } : {}
    ));
    mocks.admin.mockReturnValue(db.client);

    const response = await POST(jsonRequest("http://localhost/api/trigger/token", {
      label: "Car media keys",
      kind: "android_shell",
      countdown_s: 60,
      discreet: true,
      allow_medical: true,
    }));
    const body = await response.json();
    const call = db.rpc.mock.calls[0];

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: tokenId });
    expect(Object.keys(body).sort()).toEqual(["id", "token"]);
    expect(body.token).toMatch(/^ktk_[0-9a-f]{64}$/);
    expect(call[0]).toBe("trigger_token_create");
    expect(call[1]).toMatchObject({
      p_user_id: userId,
      p_label: "Car media keys",
      p_kind: "android_shell",
      p_countdown_s: 60,
      p_discreet: true,
      p_allow_medical: true,
    });
    expect(call[1].p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(call[1])).not.toContain(body.token);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("deletes only the authenticated caller's token", async () => {
    const db = fakeSupabase(() => ({}), (name) => (
      name === "trigger_token_revoke" ? { data: true } : {}
    ));
    mocks.admin.mockReturnValue(db.client);

    const response = await DELETE(jsonRequest("http://localhost/api/trigger/token", { id: tokenId }, "DELETE"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.rpc).toHaveBeenCalledWith("trigger_token_revoke", { p_user_id: userId, p_token_id: tokenId });
  });

  it("returns safe token and shell state without a raw token", async () => {
    const safeTokens = [{ id: tokenId, label: "Car media keys", kind: "android_shell", revoked_at: null }];
    const db = fakeSupabase(() => ({ data: [] }), (name) => (
      name === "trigger_token_list" ? { data: safeTokens } : {}
    ));
    mocks.admin.mockReturnValue(db.client);

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.tokens).toEqual(safeTokens);
    expect(body.shell_status).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/ktk_[0-9a-f]{64}/);
  });

  it("requires authentication and rejects malformed create input", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(jsonRequest("http://localhost/api/trigger/token", {
      label: "Car",
      kind: "android_shell",
    }))).status).toBe(401);

    mocks.user.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    expect((await POST(jsonRequest("http://localhost/api/trigger/token", {
      label: "",
      kind: "android_shell",
    }))).status).toBe(400);
  });
});

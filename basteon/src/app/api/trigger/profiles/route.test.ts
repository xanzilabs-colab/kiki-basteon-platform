import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET, PUT } from "./route";

const profile = {
  id: "profile-1234",
  name: "Living room earbuds",
  kind: "earbuds",
  deviceRef: null,
  gapMs: 650,
  settleMs: 900,
  mapping: { TTT: "sos", "PPPP": "cancel" },
  library: [{ prompted: 3, sig: "TTT", presses: 3, gaps: [100, 120] }],
  verifiedAt: 1_800_000_000_000,
  appVersion: "1.1",
  androidSdk: 35,
};

describe("trigger profile backup routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    });
  });

  it("requires an authenticated session", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("reports an unapplied profile-backup migration as service unavailable", async () => {
    const db = fakeSupabase(() => ({ error: { code: "PGRST205" } }));
    mocks.admin.mockReturnValue(db.client);
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "profile_backup_not_ready" });
  });

  it("stores validated profiles under the user's active Android trigger without tokens", async () => {
    const db = fakeSupabase((call) => {
      if (call.table === "trigger_tokens") return { data: { id: "token-id" } };
      return {};
    });
    mocks.admin.mockReturnValue(db.client);
    const response = await PUT(new Request("http://localhost/api/trigger/profiles", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profiles: [profile] }),
    }));
    expect(response.status).toBe(200);
    const saved = db.calls.find((call) => call.table === "trigger_profiles");
    expect(saved?.action).toBe("upsert");
    expect(saved?.payload).toEqual([expect.objectContaining({
      user_id: "user-1",
      token_id: "token-id",
      local_id: profile.id,
      mapping: profile.mapping,
    })]);
    expect(JSON.stringify(saved?.payload)).not.toContain("ktk_");
  });

  it("reports a missing profile table during save as service unavailable", async () => {
    const db = fakeSupabase((call) => {
      if (call.table === "trigger_tokens") return { data: { id: "token-id" } };
      if (call.table === "trigger_profiles" && call.action === "upsert") {
        return { error: { code: "42P01" } };
      }
      return {};
    });
    mocks.admin.mockReturnValue(db.client);
    const response = await PUT(new Request("http://localhost/api/trigger/profiles", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profiles: [profile] }),
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "profile_backup_not_ready" });
  });

  it("rejects duplicate actions and out-of-range timing", async () => {
    const db = fakeSupabase(() => ({ data: { id: "token-id" } }));
    mocks.admin.mockReturnValue(db.client);
    const invalid = await PUT(new Request("http://localhost/api/trigger/profiles", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profiles: [{ ...profile, gapMs: 100, mapping: { TTT: "sos", PPPP: "sos" } }],
      }),
    }));
    expect(invalid.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });
});

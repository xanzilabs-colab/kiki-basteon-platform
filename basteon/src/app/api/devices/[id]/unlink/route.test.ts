import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest, type FakeCall, type FakeResult } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({ user: vi.fn(), profile: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.user },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { hashDevicePin } from "@/lib/devicePin.server";
import { POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const URL = `http://localhost/api/devices/${ID}/unlink`;
const context = { params: Promise.resolve({ id: ID }) };

function setup(device: { device_id: string; user_id: string | null; pin_locked: boolean }, options: { activeAlerts?: number; attempt?: FakeResult["data"] } = {}) {
  const db = fakeSupabase((call: FakeCall) => {
    if (call.table === "devices" && call.action === "select") return { data: device };
    if (call.table === "devices" && call.action === "update") return { data: [{ id: ID }] };
    if (call.table === "alerts") return { count: options.activeAlerts ?? 0 };
    return {};
  }, (name) => (name === "device_pin_begin_attempt" ? { data: options.attempt ?? [] } : { data: null }));
  mocks.admin.mockReturnValue(db.client);
  return db;
}

const unlinked = (db: ReturnType<typeof setup>) => db.calls.find((call) => call.table === "devices" && call.action === "update");

describe("POST /api/devices/[id]/unlink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ data: { user: { id: "owner" } } });
    mocks.profile.mockResolvedValue({ data: { role: "user" } });
  });

  it("unlinks an unlocked band for its owner, scoped to that owner", async () => {
    const db = setup({ device_id: "DEV1", user_id: "owner", pin_locked: false });
    expect((await POST(jsonRequest(URL, {}), context)).status).toBe(200);
    expect(unlinked(db)?.filters).toContainEqual(["eq", "user_id", "owner"]);
  });

  it("requires the PIN for a locked band", async () => {
    const db = setup({ device_id: "DEV1", user_id: "owner", pin_locked: true });
    const response = await POST(jsonRequest(URL, {}), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "pin_required" });
    expect(unlinked(db)).toBeUndefined();
  });

  it("refuses a wrong PIN", async () => {
    const db = setup({ device_id: "DEV1", user_id: "owner", pin_locked: true }, { attempt: [{ result: "ok", pin_hash: await hashDevicePin("482915"), attempts_left: 4, retry_after: null }] });
    expect((await POST(jsonRequest(URL, { pin: "999000" }), context)).status).toBe(403);
    expect(unlinked(db)).toBeUndefined();
  });

  it("unlinks with the correct PIN", async () => {
    const db = setup({ device_id: "DEV1", user_id: "owner", pin_locked: true }, { attempt: [{ result: "ok", pin_hash: await hashDevicePin("482915"), attempts_left: 4, retry_after: null }] });
    expect((await POST(jsonRequest(URL, { pin: "482915" }), context)).status).toBe(200);
    expect(unlinked(db)?.payload).toMatchObject({ user_id: null });
  });

  it("blocks owners during an active alert", async () => {
    const db = setup({ device_id: "DEV1", user_id: "owner", pin_locked: false }, { activeAlerts: 1 });
    expect((await POST(jsonRequest(URL, {}), context)).status).toBe(409);
    expect(unlinked(db)).toBeUndefined();
  });

  it("forbids other users and lets admins bypass the PIN", async () => {
    setup({ device_id: "DEV1", user_id: "someone-else", pin_locked: true });
    expect((await POST(jsonRequest(URL, {}), context)).status).toBe(403);

    mocks.profile.mockResolvedValue({ data: { role: "admin" } });
    const db = setup({ device_id: "DEV1", user_id: "someone-else", pin_locked: true });
    expect((await POST(jsonRequest(URL, {}), context)).status).toBe(200);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

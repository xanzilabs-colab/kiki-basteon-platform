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

const URL = "http://localhost/api/devices/link/start";
type Device = { device_id: string; user_id: string | null; active: boolean; pin_locked: boolean };

function setup(device: Device | null, options: { activeAlerts?: number; attempt?: FakeResult["data"] } = {}) {
  const db = fakeSupabase((call: FakeCall) => {
    if (call.table === "devices") return { data: device };
    if (call.table === "alerts") return { count: options.activeAlerts ?? 0 };
    if (call.table === "device_link_tokens" && call.action === "select") return { count: 0 };
    return {};
  }, (name) => (name === "device_pin_begin_attempt" ? { data: options.attempt ?? [] } : { data: null }));
  mocks.admin.mockReturnValue(db.client);
  return db;
}

describe("POST /api/devices/link/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ data: { user: { id: "new-owner" } } });
    mocks.profile.mockResolvedValue({ data: { full_name: "Lerato", phone: "+27000000000" } });
  });

  it("links an unowned band without a PIN", async () => {
    const db = setup({ device_id: "DEV1", user_id: null, active: true, pin_locked: false });
    const response = await POST(jsonRequest(URL, { device_id: "DEV1" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.token).toMatch(/^[0-9a-f]{32}$/);
    expect(body.transfer).toBe(false);
    const insert = db.calls.find((call) => call.table === "device_link_tokens" && call.action === "insert");
    expect(insert?.payload).toMatchObject({ transfer_from: null, pin_verified_at: null });
    expect(JSON.stringify(insert?.payload)).not.toContain(body.token);
  });

  it("never lets another account take an owned band that has no PIN", async () => {
    const db = setup({ device_id: "DEV1", user_id: "old-owner", active: true, pin_locked: false });
    const response = await POST(jsonRequest(URL, { device_id: "DEV1", pin: "482915" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "already_owned" });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("asks for the PIN of an owned, locked band", async () => {
    setup({ device_id: "DEV1", user_id: "old-owner", active: true, pin_locked: true });
    const response = await POST(jsonRequest(URL, { device_id: "DEV1" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "pin_required" });
  });

  it("blocks a transfer while the band has an active alert, before any PIN attempt", async () => {
    const db = setup({ device_id: "DEV1", user_id: "old-owner", active: true, pin_locked: true }, { activeAlerts: 1 });
    const response = await POST(jsonRequest(URL, { device_id: "DEV1", pin: "482915" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "active_alert" });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects a wrong PIN with the remaining attempts and no token", async () => {
    const pinHash = await hashDevicePin("482915");
    const db = setup({ device_id: "DEV1", user_id: "old-owner", active: true, pin_locked: true }, { attempt: [{ result: "ok", pin_hash: pinHash, attempts_left: 3, retry_after: null }] });
    const response = await POST(jsonRequest(URL, { device_id: "DEV1", pin: "111222" }));
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "bad_pin", attempts_left: 3 });
    expect(JSON.stringify(body)).not.toContain("scrypt");
    expect(db.calls.some((call) => call.table === "device_link_tokens" && call.action === "insert")).toBe(false);
  });

  it("returns 429 while the PIN is locked out", async () => {
    setup({ device_id: "DEV1", user_id: "old-owner", active: true, pin_locked: true }, { attempt: [{ result: "locked_out", pin_hash: null, attempts_left: 0, retry_after: 300 }] });
    const response = await POST(jsonRequest(URL, { device_id: "DEV1", pin: "482915" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("300");
  });

  it("issues a transfer token after the correct PIN", async () => {
    const pinHash = await hashDevicePin("482915");
    const db = setup({ device_id: "DEV1", user_id: "old-owner", active: true, pin_locked: true }, { attempt: [{ result: "ok", pin_hash: pinHash, attempts_left: 4, retry_after: null }] });
    const response = await POST(jsonRequest(URL, { device_id: "DEV1", pin: "482915" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.transfer).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/482915|scrypt/);
    const insert = db.calls.find((call) => call.table === "device_link_tokens" && call.action === "insert");
    expect(insert?.payload).toMatchObject({ user_id: "new-owner", transfer_from: "old-owner" });
    expect((insert?.payload as { pin_verified_at: string }).pin_verified_at).toBeTruthy();
    expect(db.rpc).toHaveBeenCalledWith("device_pin_attempt_succeeded", { p_device_id: "DEV1" });
  });

  it("rejects cross-site requests and malformed PINs", async () => {
    setup({ device_id: "DEV1", user_id: null, active: true, pin_locked: false });
    const crossSite = new Request(URL, { method: "POST", headers: { origin: "https://evil.example", host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ device_id: "DEV1" }) });
    expect((await POST(crossSite)).status).toBe(403);
    expect((await POST(jsonRequest(URL, { device_id: "DEV1", pin: "12" }))).status).toBe(400);
  });
});

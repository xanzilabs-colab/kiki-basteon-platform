import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { hashDevicePin, verifyDevicePinHash } from "@/lib/devicePin.server";
import { DELETE, POST, PUT } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const URL = `http://localhost/api/devices/${ID}/pin`;
const context = { params: Promise.resolve({ id: ID }) };

function setup(device: { device_id: string; user_id: string; pin_locked: boolean }, rpc: (name: string, args: Record<string, unknown>) => { data?: unknown; error?: unknown } = () => ({ data: "ok" })) {
  const db = fakeSupabase((call: FakeCall) => (call.table === "devices" ? { data: device } : {}), rpc);
  mocks.admin.mockReturnValue(db.client);
  return db;
}

describe("/api/devices/[id]/pin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ data: { user: { id: "owner" } } });
  });

  it("stores only a scrypt hash when the owner sets a PIN", async () => {
    const db = setup({ device_id: "DEV1", user_id: "owner", pin_locked: false });
    const response = await POST(jsonRequest(URL, { pin: "482915" }), context);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toMatch(/482915|scrypt/);
    const [, args] = db.rpc.mock.calls[0] as [string, Record<string, string>];
    expect(args).toMatchObject({ p_device_id: "DEV1", p_owner: "owner", p_mode: "create" });
    expect(args.p_pin_hash).not.toContain("482915");
    expect(await verifyDevicePinHash("482915", args.p_pin_hash)).toBe(true);
  });

  it("rejects weak PINs, non-owners and existing PINs", async () => {
    setup({ device_id: "DEV1", user_id: "owner", pin_locked: false });
    const weak = await POST(jsonRequest(URL, { pin: "1234" }), context);
    expect(weak.status).toBe(400);
    expect(await weak.json()).toEqual({ error: "weak_pin" });

    setup({ device_id: "DEV1", user_id: "owner", pin_locked: true });
    expect((await POST(jsonRequest(URL, { pin: "482915" }), context)).status).toBe(409);

    setup({ device_id: "DEV1", user_id: "someone-else", pin_locked: false });
    expect((await POST(jsonRequest(URL, { pin: "482915" }), context)).status).toBe(403);
  });

  it("changes the PIN only after verifying the current one", async () => {
    const current = await hashDevicePin("482915");
    const db = setup({ device_id: "DEV1", user_id: "owner", pin_locked: true }, (name) =>
      name === "device_pin_begin_attempt" ? { data: [{ result: "ok", pin_hash: current, attempts_left: 4, retry_after: null }] } : { data: "ok" });
    expect((await PUT(jsonRequest(URL, { current_pin: "000111", new_pin: "582916" }, "PUT"), context)).status).toBe(403);
    expect(db.rpc).not.toHaveBeenCalledWith("device_pin_store", expect.anything());

    expect((await PUT(jsonRequest(URL, { current_pin: "482915", new_pin: "582916" }, "PUT"), context)).status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("device_pin_store", expect.objectContaining({ p_mode: "replace" }));
  });

  it("removes the PIN with the current PIN", async () => {
    const current = await hashDevicePin("482915");
    const db = setup({ device_id: "DEV1", user_id: "owner", pin_locked: true }, (name) =>
      name === "device_pin_begin_attempt" ? { data: [{ result: "ok", pin_hash: current, attempts_left: 4, retry_after: null }] } : { data: null });
    expect((await DELETE(jsonRequest(URL, { pin: "482915" }, "DELETE"), context)).status).toBe(200);
    const removal = db.calls.find((call) => call.table === "device_pins" && call.action === "delete");
    expect(removal?.filters).toEqual(expect.arrayContaining([["eq", "device_id", "DEV1"], ["eq", "owner_id", "owner"]]));
  });
});

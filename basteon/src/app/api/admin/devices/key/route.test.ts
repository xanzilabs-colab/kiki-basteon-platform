import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.session }));
vi.mock("@/lib/devicePin.server", () => ({ logDeviceEvent: vi.fn() }));

import { POST } from "./route";

const adminId = "00000000-0000-0000-0000-000000000001";

function setup(role: string | null = "admin") {
  const db = fakeSupabase((call: FakeCall) => {
    if (call.table === "profiles") return { data: { role } };
    if (call.table === "devices" && call.action === "select") return { data: { device_id: "KIKI-1", last_ctr: 12 } };
    return {};
  });
  mocks.admin.mockReturnValue(db.client);
  mocks.session.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: adminId } } }) },
    from: db.client.from,
  });
  return db;
}

describe("POST /api/admin/devices/key", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rotates an existing device key and returns the replacement once", async () => {
    const db = setup();
    const response = await POST(new Request("http://localhost/api/admin/devices/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: "KIKI-1" }),
    }));
    const result = await response.json();
    const savedKey = db.calls.find((call) => call.table === "device_secrets" && call.action === "upsert");

    expect(response.status).toBe(200);
    expect(Buffer.from(result.key_b64, "base64")).toHaveLength(32);
    expect(result.last_ctr).toBe(12);
    expect(savedKey?.payload).toMatchObject({ device_id: "KIKI-1", key_b64: result.key_b64 });
  });

  it("does not allow non-admin users to rotate a key", async () => {
    const db = setup("responder");
    const response = await POST(new Request("http://localhost/api/admin/devices/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: "KIKI-1" }),
    }));

    expect(response.status).toBe(403);
    expect(db.calls.some((call) => call.table === "device_secrets")).toBe(false);
  });
});

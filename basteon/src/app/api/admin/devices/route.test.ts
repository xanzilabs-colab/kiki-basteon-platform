import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.session }));
vi.mock("@/lib/devicePin.server", () => ({ logDeviceEvent: vi.fn() }));

import { GET } from "./route";

const adminId = "00000000-0000-0000-0000-000000000001";

function setup(deviceError?: { code?: string; message: string }) {
  const db = fakeSupabase((call: FakeCall) => {
    if (call.table === "profiles" && call.action === "select") return { data: { role: "admin" } };
    if (call.table === "devices" && call.action === "select") {
      if (deviceError && call.selection?.includes("last_hdop")) return { error: deviceError };
      return {
        data: [{
          id: "device-row-1",
          device_id: "KIKI-1",
          user_id: null,
          created_at: "2026-10-13T00:00:00.000Z",
          last_satellites: null,
          last_speed_kmh: null,
          last_heading_deg: null,
        }],
      };
    }
    if (call.table === "device_pins") return { data: [] };
    return {};
  });
  mocks.admin.mockReturnValue(db.client);
  mocks.session.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: adminId } } }) },
    from: db.client.from,
  });
  return db;
}

describe("GET /api/admin/devices", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retries without missing optional telemetry and reports null telemetry values", async () => {
    const db = setup({ code: "42703", message: "column devices.last_hdop does not exist" });

    const response = await GET();
    const devices = await response.json();
    const deviceQueries = db.calls.filter((call) => call.table === "devices");

    expect(response.status).toBe(200);
    expect(deviceQueries).toHaveLength(2);
    expect(deviceQueries[0].selection).toContain("last_hdop");
    expect(deviceQueries[1].selection).not.toContain("last_hdop");
    expect(devices[0]).toMatchObject({
      last_hdop: null,
      last_satellites: null,
      last_speed_kmh: null,
      last_heading_deg: null,
      device_id: "KIKI-1",
    });
  });

  it("does not hide unrelated device query errors", async () => {
    setup({ code: "42703", message: "column devices.device_name does not exist" });

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "column devices.device_name does not exist" });
  });
});

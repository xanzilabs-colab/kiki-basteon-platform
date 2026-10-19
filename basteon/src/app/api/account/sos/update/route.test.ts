import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.user } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { POST } from "./route";

const alertId = "00000000-0000-0000-0000-000000000001";
const userId = "00000000-0000-0000-0000-000000000002";
let database: ReturnType<typeof fakeSupabase>["client"];

describe("POST /api/account/sos/update location accuracy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ data: { user: { id: userId } } });
    database = fakeSupabase((call: FakeCall) => {
      if (call.table === "alerts") return { data: { id: alertId, device_id: "device-1", status: "new" } };
      if (call.table === "devices") return { data: { user_id: userId } };
      return {};
    }, () => ({ data: "recorded" })).client;
    mocks.admin.mockReturnValue(database);
  });

  it("persists the location provider's actual horizontal accuracy", async () => {
    const response = await POST(jsonRequest("http://localhost/api/account/sos/update", {
      alert_id: alertId,
      lat: -26.2,
      lng: 28,
      accuracy_m: 4.7,
    }));

    expect(response.status).toBe(200);
    expect(database.rpc).toHaveBeenCalledWith("record_panic_update", expect.objectContaining({
      p_accuracy_m: 4.7,
      p_lat: -26.2,
      p_lng: 28,
    }));
  });

  it("rejects out-of-range reported accuracy", async () => {
    const response = await POST(jsonRequest("http://localhost/api/account/sos/update", {
      alert_id: alertId,
      lat: -26.2,
      lng: 28,
      accuracy_m: 100001,
    }));

    expect(response.status).toBe(400);
  });
});

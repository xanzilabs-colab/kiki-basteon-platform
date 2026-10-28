import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  profile: vi.fn(),
  admin: vi.fn(),
  routeAlert: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.user },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/alertRouting", () => ({ routeAlertAndNotify: mocks.routeAlert }));

import { POST } from "./route";

const userId = "00000000-0000-0000-0000-000000000002";
const virtualDeviceId = `PHONE-SOS-${userId.replaceAll("-", "").toUpperCase()}`;
const alertId = "00000000-0000-0000-0000-000000000003";
let database: ReturnType<typeof fakeSupabase>["client"];
let calls: FakeCall[];
let linkedDevice: { device_id: string; device_name: string; is_virtual: boolean } | null;
let phoneDevice: { device_id: string; device_name: string; user_id: string; active: boolean; is_virtual: boolean } | null;

function request() {
  return jsonRequest("http://localhost/api/account/sos", {
    lat: -26.2,
    lng: 28,
    type_code: "general",
    request_id: "00000000-0000-0000-0000-000000000004",
  });
}

describe("POST /api/account/sos Kiki-device requirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("REQUIRE_KIKI_LINK", "false");
    linkedDevice = null;
    phoneDevice = null;
    mocks.user.mockResolvedValue({ data: { user: { id: userId } } });
    mocks.profile.mockResolvedValue({ data: { role: "user" } });
    const fake = fakeSupabase((call: FakeCall) => {
      if (call.table === "devices" && call.action === "select") {
        const deviceIdFilter = call.filters.find((filter) => filter[1] === "device_id")?.[2];
        return { data: deviceIdFilter === virtualDeviceId ? phoneDevice : linkedDevice };
      }
      if (call.table === "devices" && call.action === "insert") {
        const inserted = call.payload as typeof phoneDevice;
        phoneDevice = inserted;
        return { data: inserted };
      }
      if (call.table === "alerts" && call.action === "insert") return { data: { id: alertId } };
      return {};
    }, (name) => name === "resolve_emergency_type" ? { data: "general" } : {});
    database = fake.client;
    calls = fake.calls;
    mocks.admin.mockReturnValue(database);
    mocks.routeAlert.mockResolvedValue({ targets: 0, recipients: 0 });
  });

  it("sends a phone SOS without a band when REQUIRE_KIKI_LINK is false", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ ok: true, id: alertId, type_code: "general" });
    expect(phoneDevice).toMatchObject({
      device_id: virtualDeviceId,
      device_name: "Phone SOS",
      user_id: userId,
      is_virtual: true,
    });
    expect(calls.find((call) => call.table === "alerts")?.payload).toMatchObject({ device_id: virtualDeviceId });
    expect(mocks.routeAlert).toHaveBeenCalledWith(alertId);
  });

  it("requires a physical linked device when REQUIRE_KIKI_LINK is true", async () => {
    vi.stubEnv("REQUIRE_KIKI_LINK", "true");

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "no_active_device" });
    expect(phoneDevice).toBeNull();
    expect(calls.some((call) => call.table === "alerts" && call.action === "insert")).toBe(false);
    expect(mocks.routeAlert).not.toHaveBeenCalled();
  });

  it("uses a linked physical Kiki device when one exists", async () => {
    vi.stubEnv("REQUIRE_KIKI_LINK", "true");
    linkedDevice = { device_id: "KIKI-BAND-1", device_name: "My Kiki Band", is_virtual: false };

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(phoneDevice).toBeNull();
    expect(calls.find((call) => call.table === "alerts")?.payload).toMatchObject({ device_id: "KIKI-BAND-1" });
    expect(mocks.routeAlert).toHaveBeenCalledWith(alertId);
  });
});

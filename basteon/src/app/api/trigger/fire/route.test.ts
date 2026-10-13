import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fakeSupabase";
import { sha256 } from "@/lib/triggerRoute";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), push: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/push", () => ({ sendPushNotificationsToUser: mocks.push }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

import { POST as fire } from "./route";
import { POST as cancel } from "../cancel/route";
import { POST as heartbeat } from "../heartbeat/route";

const token = `ktk_${"a".repeat(64)}`;
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

function request(path: string, body: unknown, headers: Record<string, string> = auth) {
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("trigger bearer routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.push.mockResolvedValue({ status: "accepted", attempted: 1, accepted: 1, failed: 0 });
  });

  it("fires a validated trigger, stores only the token hash, and sends the cancel-window push", async () => {
    const db = fakeSupabase(() => ({}), (name) => (
      name === "trigger_fire"
        ? { data: { ok: true, user_id: "user-1", pending_id: "pending-1", countdown_s: 10 } }
        : {}
    ));
    mocks.admin.mockReturnValue(db.client);

    const response = await fire(request("/api/trigger/fire", {
      type: "sos",
      lat: -26.2,
      lng: 28.0,
      accuracy_m: 12,
      src: "bt_media",
      pattern: "triple",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      pending_id: "pending-1",
      countdown_s: 10,
      delivery: { status: "accepted", attempted: 1, accepted: 1, failed: 0 },
    });
    expect(db.rpc).toHaveBeenCalledWith("trigger_fire", {
      p_token_hash: sha256(token),
      p_payload: expect.objectContaining({ src: "bt_media", pattern: "triple" }),
    });
    expect(mocks.push).toHaveBeenCalledWith("user-1", expect.objectContaining({
      body: "Alert starts in 10 seconds. Tap to cancel.",
      actions: [{ action: "cancel-alert", title: "Cancel alert" }],
      data: { pendingId: "pending-1" },
    }));
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.push.mock.calls)).not.toContain("-26.2");
  });

  it("accepts bounded gesture profile evidence without changing alert semantics", async () => {
    const db = fakeSupabase(() => ({}), () => ({
      data: { ok: true, user_id: "user-1", pending_id: "pending-1", countdown_s: 10 },
    }));
    mocks.admin.mockReturnValue(db.client);
    const response = await fire(request("/api/trigger/fire", {
      type: "sos",
      src: "bt_media",
      pattern: "TTT",
      profile: "profile-123",
      sig_verified: true,
    }));
    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("trigger_fire", expect.objectContaining({
      p_payload: expect.objectContaining({
        profile: "profile-123",
        sig_verified: true,
      }),
    }));
  });

  it("does not notify or create an alert for a test fire", async () => {
    const db = fakeSupabase(() => ({}), () => ({ data: { ok: true, test: true } }));
    mocks.admin.mockReturnValue(db.client);

    const response = await fire(request("/api/trigger/fire", { test: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, test: true });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("rejects invalid bearer tokens and mismatched coordinates before the RPC", async () => {
    const db = fakeSupabase(() => ({}));
    mocks.admin.mockReturnValue(db.client);

    expect((await fire(request("/api/trigger/fire", {}, { "content-type": "application/json" }))).status).toBe(401);
    expect((await fire(request("/api/trigger/fire", { lat: 10 }))).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects BT names and addresses in the fire payload", async () => {
    const db = fakeSupabase(() => ({}));
    mocks.admin.mockReturnValue(db.client);
    const response = await fire(request("/api/trigger/fire", { src: "bt_media", device_hint: "Headphones ABC" }));
    expect(response.status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("accepts and forwards the documented heartbeat device fields", async () => {
    const db = fakeSupabase(() => ({}), () => ({ data: { ok: true } }));
    mocks.admin.mockReturnValue(db.client);
    const devices = [{
      ref: "local-ref-1",
      kind: "earbuds",
      label: "Everyday earbuds",
      status: "connected",
      battery: 64,
      verified_at: "2026-10-13T00:00:00.000Z",
    }];
    const response = await heartbeat(request("/api/trigger/heartbeat", {
      armed: true,
      test: false,
      app_version: "1.2.3",
      sdk: 35,
      model: "Pixel",
      battery_unrestricted: true,
      events: [{ pattern: "triple", origin: "key", keys: [85], device_hint: "media key" }],
      devices,
    }));

    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenNthCalledWith(1, "trigger_heartbeat", {
      p_token_hash: sha256(token),
      p_payload: expect.objectContaining({
        armed: true,
        app_version: "1.2.3",
        sdk: 35,
        model: "Pixel",
        battery_unrestricted: true,
      }),
    });
    expect(db.rpc).toHaveBeenNthCalledWith(2, "trigger_devices_sync", {
      p_token_hash: sha256(token),
      p_devices: devices,
    });
  });

  it("accepts Kotlin's other device kind and rejects unknown kinds or top-level battery_pct", async () => {
    const db = fakeSupabase(() => ({}), () => ({ data: { ok: true } }));
    mocks.admin.mockReturnValue(db.client);
    const valid = await heartbeat(request("/api/trigger/heartbeat", {
      armed: true,
      devices: [{
        ref: "other-ref",
        kind: "other",
        label: "Other device",
        status: "untracked",
      }],
    }));
    expect(valid.status).toBe(200);

    const staleKind = await heartbeat(request("/api/trigger/heartbeat", {
      armed: true,
      devices: [{
        ref: "old-kind",
        kind: "unknown",
        label: "Unknown device",
        status: "untracked",
      }],
    }));
    const batteryPct = await heartbeat(request("/api/trigger/heartbeat", {
      armed: true,
      battery_pct: 80,
    }));
    expect(staleKind.status).toBe(400);
    expect(batteryPct.status).toBe(400);
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });

  it("maps trigger RPC invalid-token and rate-limit errors to their API status codes", async () => {
    const invalidTokenDb = fakeSupabase(() => ({}), () => ({ error: { message: "invalid_token" } }));
    mocks.admin.mockReturnValue(invalidTokenDb.client);
    expect((await fire(request("/api/trigger/fire", {}))).status).toBe(401);

    const noDeviceDb = fakeSupabase(() => ({}), () => ({ error: { message: "no_active_device" } }));
    mocks.admin.mockReturnValue(noDeviceDb.client);
    const noDevice = await fire(request("/api/trigger/fire", {}));
    expect(noDevice.status).toBe(409);
    expect(await noDevice.json()).toEqual({ ok: false, error: "no_active_device" });

    const limitedDb = fakeSupabase(() => ({}), () => ({ data: { ok: false, error: "rate_limited" } }));
    mocks.admin.mockReturnValue(limitedDb.client);
    const limited = await fire(request("/api/trigger/fire", {}));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ ok: false, error: "rate_limited" });
  });

  it("does not hide a failed heartbeat device sync", async () => {
    const db = fakeSupabase(() => ({}), (name) => (
      name === "trigger_devices_sync" ? { error: { message: "sync failed" } } : { data: { ok: true } }
    ));
    mocks.admin.mockReturnValue(db.client);

    const response = await heartbeat(request("/api/trigger/heartbeat", {
      armed: true,
      events: [],
      devices: [],
    }));
    expect(response.status).toBe(500);
    expect(db.rpc).toHaveBeenNthCalledWith(1, "trigger_heartbeat", expect.any(Object));
    expect(db.rpc).toHaveBeenNthCalledWith(2, "trigger_devices_sync", {
      p_token_hash: sha256(token),
      p_devices: [],
    });
  });

  it("maps a missing cancellable countdown to not found", async () => {
    const db = fakeSupabase(() => ({}), () => ({ data: { ok: false } }));
    mocks.admin.mockReturnValue(db.client);
    const response = await cancel(request("/api/trigger/cancel", {}));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false });
  });
});

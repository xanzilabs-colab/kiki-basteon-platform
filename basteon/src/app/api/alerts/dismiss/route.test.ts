import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  currentUserId: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@/lib/organisation", () => ({ currentUserId: mocks.currentUserId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { GET, POST } from "./route";

const alertId = "00000000-0000-0000-0000-000000000001";
const userId = "00000000-0000-0000-0000-000000000002";
const organisationId = "00000000-0000-0000-0000-000000000003";
const branchId = "00000000-0000-0000-0000-000000000004";

describe("/api/alerts/dismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUserId.mockResolvedValue(userId);
  });

  it("loads only the authenticated responder's dismissed alert IDs", async () => {
    const db = fakeSupabase((call) => call.table === "responder_alert_dismissals"
      ? { data: [{ alert_id: alertId }] }
      : {});
    mocks.admin.mockReturnValue(db.client);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ dismissedAlertIds: [alertId] });
    expect(db.calls[0].filters).toContainEqual(["eq", "user_id", userId]);
  });

  it("persists a personal dismissal without changing the shared incident status", async () => {
    const db = fakeSupabase((call) => {
      if (call.table === "alerts") return { data: { id: alertId, status: "new" } };
      if (call.table === "organisation_memberships") return { data: [{ organisation_id: organisationId, branch_id: branchId }] };
      if (call.table === "alert_dispatch_targets") return { data: [{ organisation_id: organisationId, branch_id: branchId }] };
      return {};
    });
    mocks.admin.mockReturnValue(db.client);

    const response = await POST(jsonRequest("http://localhost/api/alerts/dismiss", { alertId }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alertId });
    expect(db.calls.find((call) => call.table === "responder_alert_dismissals")?.action).toBe("upsert");
    expect(db.calls.some((call) => call.table === "alerts" && call.action === "update")).toBe(false);
  });

  it("does not allow a responder to dismiss an alert outside their dispatch scope", async () => {
    const db = fakeSupabase((call) => {
      if (call.table === "alerts") return { data: { id: alertId, status: "new" } };
      if (call.table === "organisation_memberships") return { data: [{ organisation_id: "other-org", branch_id: branchId }] };
      if (call.table === "alert_dispatch_targets") return { data: [{ organisation_id: organisationId, branch_id: branchId }] };
      return {};
    });
    mocks.admin.mockReturnValue(db.client);

    const response = await POST(jsonRequest("http://localhost/api/alerts/dismiss", { alertId }));

    expect(response.status).toBe(403);
    expect(db.calls.some((call) => call.table === "responder_alert_dismissals")).toBe(false);
  });

  it("rejects requests without a same-origin header", async () => {
    const db = fakeSupabase(() => ({}));
    mocks.admin.mockReturnValue(db.client);
    const request = new Request("http://localhost/api/alerts/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alertId }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(db.calls).toHaveLength(0);
  });
});

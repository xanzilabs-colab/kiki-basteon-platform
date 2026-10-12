import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest, type FakeCall } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  currentUserId: vi.fn(),
  admin: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock("@/lib/organisation", () => ({ currentUserId: mocks.currentUserId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/notifications", () => ({ createNotification: mocks.createNotification }));

import { POST } from "./route";

const alertId = "00000000-0000-0000-0000-000000000001";
const responderId = "00000000-0000-0000-0000-000000000002";
const ownerId = "00000000-0000-0000-0000-000000000003";
const organisationId = "00000000-0000-0000-0000-000000000004";
const branchId = "00000000-0000-0000-0000-000000000005";
const assignmentId = "00000000-0000-0000-0000-000000000006";

function setup(statusEvent: Record<string, unknown> | null) {
  const db = fakeSupabase((call: FakeCall) => {
    if (call.table === "alerts") return { data: { id: alertId, status: "acknowledged", assigned_to: responderId, device_id: "device-1" } };
    if (call.table === "organisation_memberships") return { data: [{ organisation_id: organisationId, branch_id: branchId, role: "responder" }] };
    if (call.table === "alert_dispatch_targets") return { data: [{ id: "target-1", organisation_id: organisationId, branch_id: branchId }] };
    if (call.table === "alert_assignment_events") return { data: statusEvent };
    if (call.table === "alert_assignments") return { data: { status: "en_route" } };
    if (call.table === "devices") return { data: { user_id: ownerId } };
    if (call.table === "profiles") return { data: { full_name: "Sam Responder" } };
    return { data: null };
  }, () => ({ data: assignmentId }));
  mocks.admin.mockReturnValue(db.client);
  return db;
}

describe("POST /api/alerts/respond status notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUserId.mockResolvedValue(responderId);
    mocks.createNotification.mockResolvedValue(["notification-1"]);
  });

  it("persists and pushes an owner notification when the responder advances en route", async () => {
    setup({ from_status: "acknowledged", to_status: "en_route" });

    const response = await POST(jsonRequest("http://localhost/api/alerts/respond", { alertId, action: "en_route" }));

    expect(response.status).toBe(200);
    expect(mocks.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: ownerId,
      type: "system",
      title: "Responder status updated",
      body: "Sam Responder is on the way to you.",
      href: "/account",
      payload: { alertId, assignmentId, status: "en_route" },
    }), expect.anything());
  });

  it("does not notify again when the responder status did not change", async () => {
    setup({ from_status: "en_route", to_status: "en_route" });

    const response = await POST(jsonRequest("http://localhost/api/alerts/respond", { alertId, action: "en_route" }));

    expect(response.status).toBe(200);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("does not send status notifications for live location updates", async () => {
    const db = setup(null);

    const response = await POST(jsonRequest("http://localhost/api/alerts/respond", {
      alertId,
      action: "location",
      lat: -26.2,
      lng: 28,
    }));

    expect(response.status).toBe(200);
    expect(db.calls.some((call) => call.table === "alert_assignment_events")).toBe(false);
    expect(mocks.createNotification).not.toHaveBeenCalled();
  });
});

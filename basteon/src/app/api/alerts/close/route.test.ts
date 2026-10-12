import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, jsonRequest } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({
  currentUserId: vi.fn(),
  access: vi.fn(),
  admin: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/organisation", () => ({
  currentUserId: mocks.currentUserId,
  requireOrganisationAccess: mocks.access,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.admin,
}));
vi.mock("@/lib/push", () => ({
  sendPushNotificationsToUser: mocks.push,
}));

import { POST } from "./route";

const alertId = "00000000-0000-0000-0000-000000000001";
const userId = "00000000-0000-0000-0000-000000000002";

describe("POST /api/alerts/close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUserId.mockResolvedValue(userId);
    mocks.push.mockResolvedValue(undefined);
  });

  it("uses the responder-specific resolver without granting operations access", async () => {
    const db = fakeSupabase(() => ({ data: null }), () => ({ data: [], error: null }));
    mocks.admin.mockReturnValue(db.client);

    const response = await POST(jsonRequest("http://localhost/api/alerts/close", {
      alertId,
      source: "responder",
    }));

    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("resolve_alert_for_responder", {
      p_alert_id: alertId,
      p_actor_id: userId,
      p_note: null,
    });
    expect(mocks.access).not.toHaveBeenCalled();
  });
});

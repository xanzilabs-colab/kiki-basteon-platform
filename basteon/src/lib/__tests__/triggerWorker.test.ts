import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fakeSupabase";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), routeAlert: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/alertRouting", () => ({ routeAlertAndNotify: mocks.routeAlert }));

import { processTriggerWork } from "@/lib/triggerWorker";

describe("trigger worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.routeAlert.mockResolvedValue({ targets: 1, recipients: 1 });
  });

  it("promotes, routes pending trigger alerts, and prunes diagnostics when scheduled", async () => {
    const alertId = "00000000-0000-0000-0000-000000000001";
    const db = fakeSupabase((call) => (
      call.table === "alerts" ? { data: [{ id: alertId }], error: null } : { data: [] }
    ), (name) => (
      name === "trigger_promote_due"
        ? { data: { count: 1, alert_ids: [alertId] } }
        : { data: { diagnostics_pruned: 3 } }
    ));
    mocks.admin.mockReturnValue(db.client);

    await expect(processTriggerWork(true)).resolves.toEqual({ promoted: 1, routed: 1, pruned: 3 });
    expect(db.rpc).toHaveBeenNthCalledWith(1, "trigger_promote_due");
    expect(db.rpc).toHaveBeenNthCalledWith(2, "trigger_prune_diagnostics");
    expect(mocks.routeAlert).toHaveBeenCalledWith(alertId);
  });

  it("surfaces promotion failures instead of treating failed DB work as success", async () => {
    const db = fakeSupabase(() => ({}), () => ({ error: { message: "database unavailable" } }));
    mocks.admin.mockReturnValue(db.client);
    await expect(processTriggerWork()).rejects.toThrow("trigger_promotion_failed");
    expect(mocks.routeAlert).not.toHaveBeenCalled();
  });
});

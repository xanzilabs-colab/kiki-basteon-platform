import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushNotificationsToUser: mocks.push }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createNotifications, safeHref } from "../notifications";

describe("notifications", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.push.mockResolvedValue(undefined); });

  it("only keeps same-site relative links", () => {
    expect(safeHref("/account/buddies/bubble/abc")).toBe("/account/buddies/bubble/abc");
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("https://evil.example")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
  });

  it("persists notifications and sends a user-specific push for each", async () => {
    const rows = [{ id: "n1", user_id: "u1", href: "/account", title: "Hi", body: "There" }];
    const select = vi.fn().mockResolvedValue({ data: rows, error: null });
    mocks.insert.mockReturnValue({ select });
    const db = { from: vi.fn(() => ({ insert: mocks.insert })) };
    const ids = await createNotifications([{ userId: "u1", type: "buddy_bubble", title: "Hi", body: "There", href: "//evil.example" }], db as never);
    expect(ids).toEqual(["n1"]);
    expect(mocks.insert).toHaveBeenCalledWith([expect.objectContaining({ user_id: "u1", href: null, payload: {} })]);
    expect(mocks.push).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "Hi", url: "/account", tag: "kiki-notification-n1" }));
  });

  it("adds a push acknowledgement action to safety intelligence alerts", async () => {
    const rows = [{
      id: "n2",
      user_id: "u1",
      href: "/account/buddies",
      title: "Community report nearby",
      body: "A report is close to you.",
      type: "safety_intel",
      payload: { recordId: "11111111-1111-4111-8111-111111111111", zone: "near" },
    }];
    mocks.insert.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: rows, error: null }) });
    await createNotifications([{
      userId: "u1",
      type: "safety_intel",
      title: rows[0].title,
      body: rows[0].body,
      href: rows[0].href,
      payload: rows[0].payload,
    }], { from: () => ({ insert: mocks.insert }) } as never);
    expect(mocks.push).toHaveBeenCalledWith("u1", expect.objectContaining({
      tag: `kiki-safety-intel-${rows[0].payload.recordId}`,
      actions: [{ action: "acknowledge-safety-alert", title: "Acknowledge" }],
      data: { recordId: rows[0].payload.recordId },
    }));
  });

  it("does not fail when push delivery fails", async () => {
    mocks.push.mockRejectedValue(new Error("offline"));
    mocks.insert.mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: "n2", user_id: "u2", href: null, title: "T", body: "" }], error: null }) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(createNotifications([{ userId: "u2", type: "system", title: "T", body: "" }], { from: () => ({ insert: mocks.insert }) } as never)).resolves.toEqual(["n2"]);
  });
});

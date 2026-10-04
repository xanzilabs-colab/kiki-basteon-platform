import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), view: vi.fn(), resolveRef: vi.fn(), notify: vi.fn(), rpc: vi.fn(), inserts: [] as Array<{ table: string; row: unknown }> }));
vi.mock("../_shared", () => ({ requireBuddyUser: mocks.access, currentBuddyView: mocks.view, buddyHmacSecret: () => "secret" }));
vi.mock("@/lib/buddies", async (original) => ({ ...(await original<typeof import("@/lib/buddies")>()), resolveRef: mocks.resolveRef }));
vi.mock("@/lib/verification/config", () => ({ BUDDIES_REQUIRE_VERIFICATION: false }));
vi.mock("@/lib/verification/service", () => ({ requireFreshFaceProof: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: mocks.notify }));
import { POST as handler } from "./route";

async function POST(request: Request) {
  const response = await handler(request);
  if (!response) throw new Error("Join did not return a response");
  return response;
}

const BUBBLE = "11111111-1111-4111-8111-111111111111";

function db(members: string[]) {
  return {
    rpc: mocks.rpc,
    from: vi.fn((table: string) => {
      const result = table === "buddy_bubble_members" ? { data: members.map((user_id) => ({ user_id })) } : { data: null, count: 0, error: null };
      const builder: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
      for (const method of ["select", "eq", "gte", "not", "order", "limit"]) builder[method] = vi.fn(() => builder);
      builder.maybeSingle = vi.fn(async () => result);
      builder.insert = vi.fn(async (row: unknown) => { mocks.inserts.push({ table, row }); return { error: null }; });
      return builder;
    }),
  };
}

function request(body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/buddies/join", { method: "POST", headers: { origin, "x-forwarded-host": "localhost", "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("join buddy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts.length = 0;
    mocks.access.mockResolvedValue({ user: { id: "joiner" }, db: db(["joiner", "target"]) });
    mocks.view.mockResolvedValue({ trip: { id: "joiner-trip" }, viewer: { nickname: "Kind Comet" }, result: { avatars: [] }, candidates: [] });
    mocks.resolveRef.mockReturnValue({ userId: "target", tripId: "target-trip", nickname: "Calm River" });
    mocks.rpc.mockResolvedValue({ data: [{ joined_bubble_id: BUBBLE, created: true, already_member: false }], error: null });
  });

  it("creates a fresh direct bubble and notifies only the selected Buddy", async () => {
    const response = await POST(request({ ref: "a".repeat(16) }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ joined: true, bubbleId: BUBBLE, created: true, alreadyMember: false });
    expect(JSON.stringify(body)).not.toMatch(/target|joiner/);
    expect(mocks.rpc).toHaveBeenCalledWith("join_buddy_bubble", expect.objectContaining({ p_joiner: "joiner", p_joiner_trip: "joiner-trip", p_target: "target", p_target_trip: "target-trip" }));
    expect(mocks.inserts).toContainEqual({ table: "buddy_pings", row: expect.objectContaining({ from_trip_id: "joiner-trip", to_trip_id: "target-trip", status: "accepted" }) });
    const [notifications] = mocks.notify.mock.calls[0];
    expect(notifications.map((item: { userId: string }) => item.userId)).toEqual(["joiner", "target"]);
    for (const item of notifications) {
      expect(item).toMatchObject({ type: "buddy_bubble", href: `/account/buddies/bubble/${BUBBLE}`, payload: { bubbleId: BUBBLE } });
    }
    expect(notifications[1].body).toContain("Kind Comet");
  });

  it("does not notify unrelated members returned by a stale Bubble membership query", async () => {
    mocks.access.mockResolvedValue({ user: { id: "joiner" }, db: db(["joiner", "target", "other-member"]) });
    await POST(request({ ref: "a".repeat(16) }));
    const [notifications] = mocks.notify.mock.calls[0];
    expect(notifications.map((item: { userId: string }) => item.userId)).toEqual(["joiner", "target"]);
  });

  it("is idempotent when already sharing a bubble", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ joined_bubble_id: BUBBLE, created: false, already_member: true }], error: null });
    const body = await (await POST(request({ ref: "a".repeat(16) }))).json();
    expect(body.alreadyMember).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.inserts).toHaveLength(0);
  });

  it("rejects refs outside the current view", async () => {
    mocks.resolveRef.mockReturnValue(null);
    const response = await POST(request({ ref: "b".repeat(16) }));
    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(request({ ref: "a".repeat(16) }, "https://evil.example"));
    expect(response.status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled();
  });
});

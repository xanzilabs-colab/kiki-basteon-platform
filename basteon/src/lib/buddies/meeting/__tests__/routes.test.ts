import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), profile: vi.fn(), enabled: vi.fn(), admin: vi.fn(), engine: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/buddies/server/runtime", () => ({ requireBuddiesEnabled: mocks.enabled }));
vi.mock("../server", () => ({ runMeetingEngine: mocks.engine }));

import { GET as spotsGet, POST as spotsPost } from "@/app/api/buddies/safe-places/route";
import { POST as optionsPost } from "@/app/api/buddies/bubble/[id]/spot-options/route";
import { GET as adminGet } from "@/app/api/admin/buddy-places/route";
import { POST as feedbackPost } from "@/app/api/buddies/bubble/[id]/spot-feedback/route";

const bubbleId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: bubbleId }) };
const request = (path: string, body: unknown, origin = "https://kiki.test") => new Request(`https://kiki.test${path}`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-one" } } });
  mocks.profile.mockResolvedValue({ data: { role: "user", verification_status: "verified" }, error: null });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.admin.mockReturnValue({ service: true });
  mocks.engine.mockResolvedValue({ status: "ok", round: 1, count: 3 });
});

describe("authenticated Buddy place routes", () => {
  it("rejects anonymous and suspended callers", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await spotsGet(new Request("https://kiki.test/api/buddies/safe-places?lat=-26&lng=28"))).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-one" } } });
    mocks.profile.mockResolvedValue({ data: { role: "user", verification_status: "suspended" }, error: null });
    expect((await spotsGet(new Request("https://kiki.test/api/buddies/safe-places?lat=-26&lng=28"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes and malformed JSON", async () => {
    expect((await spotsPost(request("/api/buddies/safe-places", {}, "https://other.test"))).status).toBe(403);
    const bad = new Request("https://kiki.test/api/buddies/safe-places", { method: "POST", headers: { origin: "https://kiki.test" }, body: "{" });
    expect((await spotsPost(bad)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates locations and keeps responses uncached", async () => {
    expect((await spotsGet(new Request("https://kiki.test/api/buddies/safe-places"))).status).toBe(400);
    const response = await spotsGet(new Request("https://kiki.test/api/buddies/safe-places?lat=-26&lng=28"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("list_meetup_candidates_near", { p_lat: -26, p_lng: 28, p_radius_m: 3000 });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("uses the authenticated RPC for suggestions and votes", async () => {
    expect((await spotsPost(request("/api/buddies/safe-places", { name: "Cafe", category: "cafe_restaurant", lat: -26, lng: 28 }))).status).toBe(201);
    expect((await optionsPost(request("/api/buddies/bubble/options", { action: "vote", round: 1, candidateId: bubbleId }), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("vote_bubble_spot", { p_bubble_id: bubbleId, p_round: 1, p_candidate_id: bubbleId });
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("checks membership before constructing the engine service client", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "not_member" } });
    expect((await optionsPost(request("/api/buddies/bubble/options", { action: "generate" }), context)).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.engine).not.toHaveBeenCalled();
  });
  it("passes authenticated identity and defaults to the engine", async () => {
    expect((await optionsPost(request("/api/buddies/bubble/options", { action: "generate" }), context)).status).toBe(200);
    expect(mocks.engine).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-one", bubbleId, regenerate: false, serviceClient: { service: true } }));
  });
  it("reuses a current round without calling external sources again", async () => {
    mocks.rpc.mockResolvedValue({ data: { round: 2, candidates: [{ id: bubbleId }], membershipChanged: false }, error: null });
    const response = await optionsPost(request("/api/buddies/bubble/options", { action: "generate" }), context);
    expect(await response.json()).toEqual({ status: "ok", round: 2, count: 1 });
    expect(mocks.engine).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("forces a fresh round when membership changed", async () => {
    mocks.rpc.mockResolvedValue({ data: { round: 2, candidates: [], membershipChanged: true }, error: null });
    expect((await optionsPost(request("/api/buddies/bubble/options", { action: "generate" }), context)).status).toBe(200);
    expect(mocks.engine).toHaveBeenCalledWith(expect.objectContaining({ regenerate: true }));
  });
  it("denies user access to admin routes and handles stale feedback", async () => {
    expect((await adminGet(new Request("https://kiki.test/api/admin/buddy-places"))).status).toBe(403);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "stale_round" } });
    expect((await feedbackPost(request("/api/buddies/bubble/feedback", { round: 1, candidateId: bubbleId, reason: "closed" }), context)).status).toBe(409);
  });
  it("does not expose database internals on failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private database details" } });
    const response = await spotsGet(new Request("https://kiki.test/api/buddies/safe-places?lat=-26&lng=28"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
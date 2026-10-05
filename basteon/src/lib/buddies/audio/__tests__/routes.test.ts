import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
vi.mock("@/lib/verification/http", () => ({ sameOrigin: (request: Request) => request.headers.get("origin") === "https://example.test" }));
import { POST } from "@/app/api/buddies/bubble/[id]/virtual-walk/route";
import { GET as ice } from "@/app/api/buddies/bubble/[id]/virtual-walk/ice/route";
import { GET as bubble } from "@/app/api/buddies/bubble/[id]/route";

const bubbleId = "11111111-1111-4111-8111-111111111111";
const walkId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const peerId = "44444444-4444-4444-8444-444444444444";
const params = { params: Promise.resolve({ id: bubbleId }) };
const request = (body: unknown, origin = "https://example.test") => new Request(`https://example.test/api/buddies/bubble/${bubbleId}/virtual-walk`, {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllEnvs();
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.rpc.mockResolvedValue({ data: { id: walkId, status: "active" }, error: null });
});

describe("authenticated Virtual Walk API", () => {
  it.each(["start", "answer", "end", "heartbeat"])("routes %s exclusively through the authenticated RPC", async (action) => {
    const response = await POST(request({ action, ...(action === "start" ? {} : { walkId }) }), params);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(`${action}_buddy_virtual_walk`, { p_bubble_id: bubbleId, ...(action === "start" ? {} : { p_walk_id: walkId }) });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects cross-origin requests before any RPC", async () => {
    expect((await POST(request({ action: "start" }, "https://other.test"), params)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires a precise walk id when answering or ending", async () => {
    expect((await POST(request({ action: "answer" }), params)).status).toBe(400);
    expect((await POST(request({ action: "end", walkId: "invalid" }), params)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects signed-out users", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request({ action: "start" }), params)).status).toBe(401);
  });
  it("surfaces an atomic answer conflict", async () => {
    mocks.rpc.mockResolvedValue({ data: { error: "call_already_answered_or_ended" }, error: null });
    expect((await POST(request({ action: "answer", walkId }), params)).status).toBe(409);
  });
  it("denies nonmembers without exposing database messages", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "not_bubble_member private detail" } });
    const response = await POST(request({ action: "start" }), params);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });
});

describe("ICE authorization", () => {
  const iceRequest = () => new Request(`https://example.test/api/buddies/bubble/${bubbleId}/virtual-walk/ice?walkId=${walkId}`);
  it("does not disclose TURN credentials to a nonparticipant", async () => {
    vi.stubEnv("BUDDY_TURN_URLS", "turn:relay.example.test:3478");
    vi.stubEnv("BUDDY_TURN_USERNAME", "private-user"); vi.stubEnv("BUDDY_TURN_CREDENTIAL", "secret");
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await ice(iceRequest(), params);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("secret");
  });
  it("always supplies STUN to an authorized participant", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const response = await ice(iceRequest(), params);
    expect(mocks.rpc).toHaveBeenCalledWith("buddy_can_use_audio_topic", { p_topic: `buddy-audio:${bubbleId}:${walkId}:${userId}`, p_send: true });
    expect((await response.json()).iceServers[0].urls).toMatch(/^stun:/);
  });
  it("adds configured TURN only after successful authorization", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    vi.stubEnv("BUDDY_TURN_URLS", "turn:relay.example.test:3478, turns:relay.example.test:5349");
    vi.stubEnv("BUDDY_TURN_USERNAME", "private-user"); vi.stubEnv("BUDDY_TURN_CREDENTIAL", "secret");
    const result = await (await ice(iceRequest(), params)).json();
    expect(result.turnConfigured).toBe(true);
    expect(result.iceServers[1].credential).toBe("secret");
  });
});

describe("Bubble live call mapping", () => {
  it("includes the peer identity, incoming flag, and stale cleanup status", async () => {
    mocks.rpc.mockResolvedValue({ data: { members: [], messages: [], stale: true,
      virtualWalk: { id: walkId, status: "ringing", callerId: peerId, calleeId: null, stale: false } }, error: null });
    const result = await (await bubble(new Request("https://example.test"), params)).json();
    expect(result.userId).toBe(userId); expect(result.stale).toBe(true);
    expect(result.virtualWalk).toEqual({ id: walkId, status: "ringing", callerId: peerId, calleeId: null, stale: false, incoming: true });
  });
});
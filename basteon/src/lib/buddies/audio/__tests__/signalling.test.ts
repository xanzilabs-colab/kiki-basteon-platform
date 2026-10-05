import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
import { openSignalling } from "../signalling";

const bubbleId = "11111111-1111-4111-8111-111111111111";
const walkId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const peerId = "44444444-4444-4444-8444-444444444444";

function fakeChannel() {
  let listener: ((event: { payload: unknown }) => void) | null = null;
  const channel = {
    on: vi.fn((_kind: string, _filter: unknown, callback: typeof listener) => { listener = callback; return channel; }),
    subscribe: vi.fn((callback: (status: string) => void) => { callback("SUBSCRIBED"); return channel; }),
    send: vi.fn(async () => "ok"),
    receive: (payload: unknown) => listener?.({ payload }),
  };
  return channel;
}
function setup() {
  const outgoing = fakeChannel(); const incoming = fakeChannel();
  const client = {
    channel: vi.fn().mockReturnValueOnce(outgoing).mockReturnValueOnce(incoming),
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "test-token" } } })) },
    realtime: { setAuth: vi.fn() }, removeChannel: vi.fn(),
  };
  mocks.createClient.mockReturnValue(client);
  const onSignal = vi.fn(); const onFailure = vi.fn();
  const signalling = openSignalling({ bubbleId, walkId, userId, peerId, onSignal, onFailure });
  return { outgoing, incoming, client, signalling, onSignal, onFailure };
}
beforeEach(() => vi.resetAllMocks());

describe("private audio signalling", () => {
  it("authenticates and subscribes to separate private sender topics", async () => {
    const { client, signalling } = setup(); await signalling.ready();
    expect(client.realtime.setAuth).toHaveBeenCalledWith("test-token");
    expect(client.channel.mock.calls.map(([topic, config]) => [topic, config.config.private])).toEqual([
      [`buddy-audio:${bubbleId}:${walkId}:${userId}`, true], [`buddy-audio:${bubbleId}:${walkId}:${peerId}`, true],
    ]);
  });
  it("accepts only strictly parsed signals from the selected peer and call", async () => {
    const { signalling, incoming, onSignal } = setup(); await signalling.ready();
    const signal = { version: 1, kind: "ready", walkId, senderId: peerId };
    incoming.receive({ ...signal, senderId: userId }); incoming.receive({ ...signal, walkId: bubbleId });
    incoming.receive({ ...signal, extra: "not allowed" }); incoming.receive(signal);
    expect(onSignal).toHaveBeenCalledExactlyOnceWith(signal);
  });
  it("removes both channels and ignores late messages after cleanup", async () => {
    const { signalling, incoming, outgoing, client, onSignal } = setup(); await signalling.ready();
    signalling.close(); incoming.receive({ version: 1, kind: "ready", walkId, senderId: peerId });
    expect(client.removeChannel).toHaveBeenCalledWith(incoming); expect(client.removeChannel).toHaveBeenCalledWith(outgoing);
    expect(onSignal).not.toHaveBeenCalled();
  });
  it("fails instead of silently dropping a failed broadcast", async () => {
    const { signalling, outgoing } = setup(); await signalling.ready(); outgoing.send.mockResolvedValue("error");
    await expect(signalling.send({ version: 1, kind: "ready", walkId, senderId: userId })).rejects.toThrow("interrupted");
  });
});
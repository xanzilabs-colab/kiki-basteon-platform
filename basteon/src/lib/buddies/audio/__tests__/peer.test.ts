import { afterEach, describe, expect, it, vi } from "vitest";
import { createAudioPeer } from "../peer";

class FakeConnection {
  static latest: FakeConnection;
  remoteDescription: unknown = null;
  localDescription = { sdp: "local-sdp" };
  onicecandidate: unknown; ontrack: unknown; onconnectionstatechange: unknown; ondatachannel: unknown;
  addTrack = vi.fn(); addIceCandidate = vi.fn(); close = vi.fn();
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer-sdp" }));
  createAnswer = vi.fn(async () => ({ type: "answer", sdp: "answer-sdp" }));
  setLocalDescription = vi.fn();
  setRemoteDescription = vi.fn(async (description: unknown) => { this.remoteDescription = description; });
  data = { label: "mic-mode", readyState: "open", onopen: null, onmessage: null, send: vi.fn(), close: vi.fn() };
  createDataChannel = vi.fn(() => this.data);
  constructor() { FakeConnection.latest = this; }
}
const options = (caller = true) => ({ iceServers: [], stream: { getAudioTracks: () => [{ kind: "audio" }] } as unknown as MediaStream,
  caller, onIce: vi.fn(), onRemote: vi.fn(), onConnection: vi.fn(), onMode: vi.fn(), onDataOpen: vi.fn() });
afterEach(() => vi.unstubAllGlobals());

describe("audio peer", () => {
  it("buffers ICE until remote SDP and drains it in order", async () => {
    vi.stubGlobal("RTCPeerConnection", FakeConnection);
    const peer = createAudioPeer(options());
    await peer.addIce({ candidate: "first" }); await peer.addIce({ candidate: "second" });
    expect(FakeConnection.latest.addIceCandidate).not.toHaveBeenCalled();
    await peer.acceptAnswer("remote-sdp");
    expect(FakeConnection.latest.addIceCandidate.mock.calls).toEqual([[{ candidate: "first" }], [{ candidate: "second" }]]);
  });
  it("creates the status channel only on the caller and sends local mode", () => {
    vi.stubGlobal("RTCPeerConnection", FakeConnection);
    const peer = createAudioPeer(options());
    const status = { version: 1 as const, kind: "mode" as const, mode: "walkie-talkie" as const, transmitting: true };
    peer.sendMode(status);
    expect(FakeConnection.latest.data.send).toHaveBeenCalledWith(JSON.stringify(status));
    createAudioPeer(options(false));
    expect(FakeConnection.latest.createDataChannel).not.toHaveBeenCalled();
  });
  it("closes the connection and data channel without changing track enabled", () => {
    vi.stubGlobal("RTCPeerConnection", FakeConnection);
    const peer = createAudioPeer(options());
    peer.close();
    expect(FakeConnection.latest.close).toHaveBeenCalled(); expect(FakeConnection.latest.data.close).toHaveBeenCalled();
    expect(FakeConnection.latest.onicecandidate).toBeNull();
  });
});
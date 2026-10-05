import { parseModeStatus, type ModeStatus } from "./types";

export function createAudioPeer(options: {
  iceServers: RTCIceServer[]; stream: MediaStream; caller: boolean;
  onIce: (candidate: RTCIceCandidateInit) => void;
  onRemote: (stream: MediaStream) => void;
  onConnection: (state: RTCPeerConnectionState) => void;
  onMode: (status: ModeStatus) => void; onDataOpen: () => void;
}) {
  const connection = new RTCPeerConnection({ iceServers: options.iceServers });
  let channel: RTCDataChannel | null = null;
  let candidates: RTCIceCandidateInit[] = [];
  let closed = false;
  for (const track of options.stream.getAudioTracks()) connection.addTrack(track, options.stream);
  connection.onicecandidate = ({ candidate }) => { if (candidate) options.onIce(candidate.toJSON()); };
  connection.ontrack = ({ track, streams }) => options.onRemote(streams[0] ?? new MediaStream([track]));
  connection.onconnectionstatechange = () => options.onConnection(connection.connectionState);
  function attach(data: RTCDataChannel) {
    if (data.label !== "mic-mode" || channel) { data.close(); return; }
    channel = data;
    data.onopen = options.onDataOpen;
    data.onmessage = ({ data: message }) => { const status = parseModeStatus(message); if (status) options.onMode(status); };
  }
  connection.ondatachannel = ({ channel: data }) => attach(data);
  if (options.caller) attach(connection.createDataChannel("mic-mode", { ordered: true }));
  async function remote(type: "offer" | "answer", sdp: string) {
    await connection.setRemoteDescription({ type, sdp });
    const pending = candidates; candidates = [];
    for (const candidate of pending) { if (!closed) await connection.addIceCandidate(candidate); }
  }
  return {
    async offer() {
      await connection.setLocalDescription(await connection.createOffer());
      return connection.localDescription!.sdp;
    },
    async answer(sdp: string) {
      await remote("offer", sdp);
      await connection.setLocalDescription(await connection.createAnswer());
      return connection.localDescription!.sdp;
    },
    acceptAnswer(sdp: string) { return remote("answer", sdp); },
    async addIce(candidate: RTCIceCandidateInit) {
      if (closed) return;
      if (connection.remoteDescription) await connection.addIceCandidate(candidate);
      else if (candidates.length < 128) candidates.push(candidate);
    },
    sendMode(status: ModeStatus) { if (channel?.readyState === "open") channel.send(JSON.stringify(status)); },
    close() {
      closed = true; candidates = [];
      connection.onicecandidate = null; connection.ontrack = null; connection.onconnectionstatechange = null;
      connection.ondatachannel = null;
      if (channel) { channel.onopen = null; channel.onmessage = null; channel.close(); }
      connection.close();
    },
  };
}
import { createClient } from "@/lib/supabase/client";
import { parseSignal, type AudioSignal } from "./types";

export function openSignalling(options: {
  bubbleId: string; walkId: string; userId: string; peerId: string;
  onSignal: (signal: AudioSignal) => void; onFailure: () => void;
}) {
  const client = createClient();
  const topic = (userId: string) => `buddy-audio:${options.bubbleId}:${options.walkId}:${userId}`;
  const outgoing = client.channel(topic(options.userId), { config: { private: true, broadcast: { ack: true, self: false } } });
  const incoming = client.channel(topic(options.peerId), { config: { private: true, broadcast: { self: false } } });
  let closed = false;
  incoming.on("broadcast", { event: "signal" }, ({ payload }) => {
    const signal = parseSignal(payload);
    if (!closed && signal?.walkId === options.walkId && signal.senderId === options.peerId) options.onSignal(signal);
  });
  function subscribe(channel: typeof outgoing) {
    return new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status) && !closed) {
          reject(new Error("Private audio signalling unavailable.")); options.onFailure();
        }
      });
    });
  }
  return {
    async ready() {
      const { data: { session } } = await client.auth.getSession();
      if (!session || closed) throw new Error("Please sign in again.");
      await client.realtime.setAuth(session.access_token);
      if (closed) throw new Error("Call ended.");
      await Promise.all([subscribe(incoming), subscribe(outgoing)]);
    },
    async send(signal: AudioSignal) {
      if (closed) return;
      if (await outgoing.send({ type: "broadcast", event: "signal", payload: signal }) !== "ok")
        throw new Error("Audio signalling was interrupted.");
    },
    close() {
      closed = true;
      void client.removeChannel(incoming); void client.removeChannel(outgoing);
    },
  };
}
"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react";
import { useBubbleAudio } from "@/hooks/useBubbleAudio";
import { voiceBeep } from "@/lib/buddies/audio/beeps";
import type { VirtualWalk } from "@/lib/buddies/audio/types";
import { MicModeSwitch } from "./MicModeSwitch";
import { HoldToTalkButton } from "./HoldToTalkButton";
import "./voice.css";

export function VoicePanel({ bubbleId, userId, walk, closed, stale, memberCount, refresh }: {
  bubbleId: string; userId: string; walk: VirtualWalk | null; closed: boolean; stale: boolean; memberCount: number;
  refresh: () => Promise<unknown>;
}) {
  const audio = useBubbleAudio({ bubbleId, userId, walk, closed, refresh });
  const player = useRef<HTMLAudioElement>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const occupied = !!walk && walk.status === "active" && walk.callerId !== userId && walk.calleeId !== userId;
  useEffect(() => {
    const element = player.current;
    if (!element) return;
    let disposed = false;
    element.srcObject = audio.remoteStream;
    setPlaybackBlocked(false);
    if (audio.remoteStream) void element.play().catch(() => { if (!disposed) setPlaybackBlocked(true); });
    return () => { disposed = true; element.pause(); element.srcObject = null; };
  }, [audio.remoteStream]);
  useEffect(() => {
    if (!walk?.incoming || closed) return;
    voiceBeep();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") voiceBeep(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [walk?.id, walk?.incoming, closed]);
  const status = occupied ? "Caller and first responding Buddy are in the room."
    : audio.state === "connected" ? "Connected to your Buddy"
    : audio.state === "connecting" ? "Connecting audio..."
    : walk?.incoming ? "Incoming Virtual Walk"
    : walk?.status === "ringing" ? "Waiting for the first Buddy to answer..."
    : walk?.status === "active" && !audio.ownsCall ? "Call is active on another device."
    : audio.state === "ended" ? "Virtual Walk ended"
    : "Audio room available";
  return <section className="buddies-panel buddy-voice">
    <h2>Virtual walk</h2>
    <p className="muted text-[12px]">One audio room for this Bubble. The caller speaks with the first Buddy who answers{memberCount > 2 ? "; other members are not connected to audio" : ""}. Nothing is recorded.</p>
    <p className="buddy-voice-status" role="status">{closed ? "Bubble closed" : status}</p>
    {(stale || walk?.stale) && <p className="muted text-[12px]">The previous call expired.</p>}
    <div className="buddy-voice-actions">
      {!walk && !audio.ownsCall && <button type="button" className="btn" disabled={closed || audio.pending || memberCount < 2} onClick={() => void audio.start()}><Phone size={16} />Start virtual walk</button>}
      {walk?.incoming && !audio.ownsCall && <button type="button" className="btn btn-primary" disabled={closed || audio.pending} onClick={() => void audio.answer()}><Phone size={16} />Answer</button>}
      {audio.ownsCall && <button type="button" className="btn" disabled={audio.pending} onClick={() => void audio.end()}><PhoneOff size={16} />End call</button>}
      {playbackBlocked && <button type="button" className="btn" onClick={() => { void player.current?.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true)); }}><Volume2 size={16} />Play Buddy audio</button>}
    </div>
    {audio.ownsCall && <>
      <MicModeSwitch mode={audio.mic.mode} onChange={(mode) => audio.dispatch({ type: "mode", mode })} />
      <div className="buddy-voice-actions">
        <button type="button" className="btn" aria-pressed={audio.mic.muted} onClick={() => audio.dispatch({ type: "mute", muted: !audio.mic.muted })}>
          {audio.mic.muted ? <MicOff size={16} /> : <Mic size={16} />}{audio.mic.muted ? "Unmute" : "Mute"}
        </button>
        {audio.mic.mode === "walkie-talkie" && <HoldToTalkButton held={audio.mic.held} disabled={!audio.mic.connected || !audio.mic.visible || audio.mic.muted} onHold={(held) => audio.dispatch({ type: "hold", held })} />}
      </div>
      <div className="buddy-voice-levels" aria-live="polite">
        <span data-live={audio.transmitting}>You: {audio.transmitting ? "mic live" : "mic quiet"}</span>
        <span data-live={audio.peerMode?.transmitting === true}>Buddy: {audio.peerMode ? `${audio.peerMode.mode === "open" ? "open mic" : "walkie-talkie"}, ${audio.peerMode.transmitting ? "mic live" : "mic quiet"}` : "connecting"}</span>
      </div>
      {!audio.mic.visible && <p className="muted text-[12px]">Microphone paused while this page is hidden.</p>}
    </>}
    {audio.turnConfigured === false && audio.ownsCall && <p className="muted text-[12px]">Relay unavailable. Some mobile or restricted networks may not connect.</p>}
    {audio.error && <p className="buddies-message" role="alert">{audio.error}</p>}
    <audio ref={player} autoPlay />
  </section>;
}
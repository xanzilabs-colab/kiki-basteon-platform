"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { initialMicState, isTransmitting, micReducer } from "@/lib/buddies/audio/mic";
import { unlockVoiceBeeps, voiceBeep } from "@/lib/buddies/audio/beeps";
import { openSignalling } from "@/lib/buddies/audio/signalling";
import { createAudioPeer } from "@/lib/buddies/audio/peer";
import type { AudioSignal, ModeStatus, VirtualWalk } from "@/lib/buddies/audio/types";

type AudioState = "idle" | "ringing" | "connecting" | "connected" | "ended" | "error";
export function useBubbleAudio({ bubbleId, userId, walk, closed, refresh }: {
  bubbleId: string; userId: string; walk: VirtualWalk | null; closed: boolean; refresh: () => Promise<unknown>;
}) {
  const [mic, dispatch] = useReducer(micReducer, initialMicState);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [ownedId, setOwnedId] = useState<string | null>(null);
  const [state, setState] = useState<AudioState>("idle");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [peerMode, setPeerMode] = useState<ModeStatus | null>(null);
  const [turnConfigured, setTurnConfigured] = useState<boolean | null>(null);
  const peerRef = useRef<ReturnType<typeof createAudioPeer> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ownedRef = useRef<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const seen = useRef(false);
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  const localStatus = useRef<ModeStatus>({ version: 1, kind: "mode", mode: "open", transmitting: false });
  const transmitting = isTransmitting(mic);

  async function post(action: "start" | "answer" | "end" | "heartbeat", walkId?: string, keepalive = false) {
    const response = await fetch(`/api/buddies/bubble/${bubbleId}/virtual-walk`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(walkId ? { walkId } : {}) }), keepalive,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error.replaceAll("_", " ") : "Call unavailable.");
    return data as { id: string; status: string };
  }
  function stopMedia() {
    peerRef.current?.close(); peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    ownedRef.current = null; seen.current = false;
    if (mounted.current) {
      setStream(null); setRemoteStream(null); setOwnedId(null); setPeerMode(null); dispatch({ type: "reset" });
    }
  }

  useEffect(() => {
    localStatus.current = { version: 1, kind: "mode", mode: mic.mode, transmitting };
    stream?.getAudioTracks().forEach((track) => { track.enabled = transmitting; });
    peerRef.current?.sendMode(localStatus.current);
  }, [stream, mic.mode, transmitting]);

  useEffect(() => {
    if (!mic.held) return;
    const timer = window.setTimeout(() => dispatch({ type: "hold", held: false }), 30_000);
    return () => window.clearTimeout(timer);
  }, [mic.held]);

  useEffect(() => {
    mounted.current = true;
    const release = () => dispatch({ type: "hold", held: false });
    const visibility = () => dispatch({ type: "visibility", visible: document.visibilityState === "visible" });
    const pageExit = () => {
      const walkId = ownedRef.current;
      stopMedia();
      if (walkId) void post("end", walkId, true).catch(() => undefined);
    };
    visibility();
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pageExit);
    return () => {
      mounted.current = false;
      window.removeEventListener("blur", release); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pageExit);
      const walkId = ownedRef.current;
      stopMedia();
      if (walkId) void post("end", walkId, true).catch(() => undefined);
    };
  }, [bubbleId]);

  useEffect(() => {
    if (!ownedId) return;
    if (walk?.id === ownedId) seen.current = true;
    if (closed || walk?.stale || (walk && walk.id !== ownedId) || (!walk && seen.current)) {
      stopMedia(); setState("ended");
    }
  }, [walk?.id, walk?.status, walk?.stale, closed, ownedId]);

  useEffect(() => {
    if (!ownedId) return;
    let disposed = false;
    let inFlight = false;
    let lastSuccess = Date.now();
    const heartbeat = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await post("heartbeat", ownedId); lastSuccess = Date.now(); }
      catch {
        if (!disposed) {
          dispatch({ type: "connection", connected: false });
          setError("Call connection lost. Start again when you are online."); stopMedia(); setState("error");
        }
      } finally { inFlight = false; }
    };
    const timer = window.setInterval(() => void heartbeat(), 10_000);
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastSuccess > 30_000) {
        setError("Call heartbeat timed out."); stopMedia(); setState("error");
      }
    }, 5_000);
    return () => { disposed = true; window.clearInterval(timer); window.clearInterval(watchdog); };
  }, [ownedId, bubbleId]);

  const activeId = !closed && !walk?.stale && walk?.status === "active" && walk.id === ownedId ? walk.id : null;
  const peerId = walk?.callerId === userId ? walk?.calleeId : walk?.callerId;
  useEffect(() => {
    if (!activeId || !stream || !peerId || !userId) return;
    const callId = activeId;
    const localStream = stream;
    const remoteUserId = peerId;
    let disposed = false;
    let offered = false;
    let answered = false;
    let acceptingAnswer = false;
    let queue = Promise.resolve();
    let readyTimer: number | undefined;
    let connectionTimer: number | undefined;
    let signalling: ReturnType<typeof openSignalling> | null = null;
    let peer: ReturnType<typeof createAudioPeer> | null = null;
    const caller = walk?.callerId === userId;
    const envelope = { version: 1 as const, walkId: activeId, senderId: userId };
    const fail = () => {
      if (disposed) return;
      disposed = true;
      signalling?.close(); peer?.close();
      window.clearInterval(readyTimer); window.clearTimeout(connectionTimer);
      setError("Audio could not connect. Check microphone access and network, then start again.");
      stopMedia(); setState("error");
      void post("end", activeId).catch(() => undefined);
      void refreshRef.current();
    };
    async function send(signal: AudioSignal) { if (!disposed) await signalling?.send(signal); }
    async function receive(signal: AudioSignal) {
      if (disposed || !peer) return;
      if (signal.kind === "ready" && caller && !offered) {
        offered = true;
        await send({ ...envelope, kind: "offer", sdp: await peer.offer() });
      } else if (signal.kind === "offer" && !caller && !answered) {
        answered = true;
        await send({ ...envelope, kind: "answer", sdp: await peer.answer(signal.sdp) });
      } else if (signal.kind === "answer" && caller && offered && !acceptingAnswer) {
        acceptingAnswer = true; await peer.acceptAnswer(signal.sdp);
      } else if (signal.kind === "ice") await peer.addIce(signal.candidate);
    }
    async function connect() {
      setState("connecting"); setError("");
      const response = await fetch(`/api/buddies/bubble/${bubbleId}/virtual-walk/ice?walkId=${activeId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Audio access denied.");
      const ice = await response.json() as { iceServers: RTCIceServer[]; turnConfigured: boolean };
      if (disposed) return;
      setTurnConfigured(ice.turnConfigured);
      peer = createAudioPeer({
        iceServers: ice.iceServers, stream: localStream, caller,
        onIce: (candidate) => {
          if (candidate.candidate) void send({ ...envelope, kind: "ice", candidate: { ...candidate, candidate: candidate.candidate } }).catch(fail);
        },
        onRemote: (remote) => { if (!disposed) setRemoteStream(remote); },
        onMode: (mode) => { if (!disposed) setPeerMode(mode); },
        onDataOpen: () => peer?.sendMode(localStatus.current),
        onConnection: (connection) => {
          if (disposed) return;
          dispatch({ type: "connection", connected: connection === "connected" });
          if (connection === "connected") { setState("connected"); window.clearTimeout(connectionTimer); voiceBeep(); }
          else if (connection === "failed" || connection === "disconnected") fail();
        },
      });
      peerRef.current = peer;
      signalling = openSignalling({ bubbleId, walkId: callId, userId, peerId: remoteUserId, onFailure: fail,
        onSignal: (signal) => { queue = queue.then(() => receive(signal)).catch(fail); },
      });
      await signalling.ready();
      if (disposed) return;
      await send({ ...envelope, kind: "ready" });
      readyTimer = window.setInterval(() => { void send({ ...envelope, kind: "ready" }).catch(fail); }, 2_000);
    }
    connectionTimer = window.setTimeout(fail, 30_000);
    void connect().catch(fail);
    return () => {
      disposed = true; window.clearInterval(readyTimer); window.clearTimeout(connectionTimer);
      signalling?.close(); peer?.close();
      if (peerRef.current === peer) peerRef.current = null;
      dispatch({ type: "connection", connected: false }); setRemoteStream(null);
    };
  }, [activeId, peerId, userId, stream, bubbleId]);

  async function begin(action: "start" | "answer") {
    if (busy.current || closed || ownedRef.current) return;
    busy.current = true; setPending(true); setError("");
    let acquired: MediaStream | null = null;
    let startedId: string | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined")
        throw new Error("Voice needs a supported browser on HTTPS or localhost.");
      void unlockVoiceBeeps();
      acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!mounted.current) { acquired.getTracks().forEach((track) => track.stop()); return; }
      const result = await post(action, action === "answer" ? walk?.id : undefined);
      startedId = result.id;
      if (!mounted.current) { acquired.getTracks().forEach((track) => track.stop()); void post("end", result.id, true).catch(() => undefined); return; }
      streamRef.current = acquired; ownedRef.current = result.id; seen.current = false;
      dispatch({ type: "reset" }); dispatch({ type: "visibility", visible: document.visibilityState === "visible" });
      setStream(acquired); setOwnedId(result.id); setState(action === "start" ? "ringing" : "connecting");
      acquired.getAudioTracks().forEach((track) => track.addEventListener("ended", () => {
        if (ownedRef.current === result.id) {
          stopMedia(); setState("error"); setError("Microphone disconnected."); void post("end", result.id).catch(() => undefined);
        }
      }, { once: true }));
      await refreshRef.current();
    } catch (cause) {
      acquired?.getTracks().forEach((track) => track.stop());
      if (startedId) { stopMedia(); void post("end", startedId).catch(() => undefined); }
      if (mounted.current) { setError(cause instanceof Error ? cause.message : "Microphone unavailable."); setState("error"); }
    } finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  async function end() {
    const walkId = ownedRef.current;
    if (!walkId || busy.current) return;
    stopMedia(); setState("ended"); voiceBeep();
    try { await post("end", walkId); await refreshRef.current(); }
    catch { setError("Audio stopped locally. The room will expire if the server is unreachable."); }
  }
  return { mic, dispatch, transmitting, remoteStream, peerMode, state, error, pending, turnConfigured,
    ownsCall: !!ownedId,
    participating: ownedId === walk?.id && !!ownedId,
    start: () => begin("start"), answer: () => begin("answer"), end };
}
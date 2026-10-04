"use client";
import { useEffect, useState } from "react";
import { Flag, Handshake, Mic, PhoneOff, ShieldAlert } from "lucide-react";

type Bubble = { meetingCode: string; closed: boolean; members: Array<{ arrived: boolean; met: boolean; you: boolean }>; messages: Array<{ message_key: string; created_at: string }>; virtualWalk: { id: string; status: string; incoming: boolean } | null };
const labels: Record<string, string> = { on_my_way: "On my way", at_the_meeting_point: "At the meeting point", running_late: "Running late", i_need_help: "I need help", i_arrived: "I've arrived" };

export default function BubblePage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState(""); const [bubble, setBubble] = useState<Bubble | null>(null); const [message, setMessage] = useState(""); const [pending, setPending] = useState(false);
  const load = async (bubbleId: string, showError = true) => {
    try {
      const response = await fetch(`/api/buddies/bubble/${bubbleId}`);
      if (!response.ok) {
        if (showError && !bubble) setMessage("Bubble is unavailable.");
        return false;
      }
      setBubble(await response.json());
      if (showError) setMessage("");
      return true;
    } catch {
      if (showError && !bubble) setMessage("Could not load this Buddy bubble.");
      return false;
    }
  };
  useEffect(() => { void params.then(({ id: bubbleId }) => { setId(bubbleId); void load(bubbleId); }); }, [params]);
  const post = async (path: string, body?: object) => {
    if (pending) return;
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/buddies/bubble/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error ?? "Could not update."); return; }
      setMessage("Updated.");
      await load(id, false);
    } catch { setMessage("Could not update. Check your connection and try again."); } finally { setPending(false); }
  };
  if (!bubble) return <p className="muted">{message || "Loading Buddy bubble..."}</p>;
  return <div className="buddies-page space-y-4"><div className="buddies-heading"><div><p className="eyebrow">Buddy bubble</p><h1 className="page-title">Meet safely</h1></div><span><Handshake size={17} /> Private bubble</span></div><section className="buddies-panel"><h2>Meeting handshake</h2><p className="muted text-[12px]">The arriving person says this code. The waiting person listens first and confirms it. Never read it out first.</p><b className="block mt-3 text-[20px]">{bubble.meetingCode}</b><button className="btn btn-primary mt-4" disabled={pending} onClick={() => void post("arrived")}>I&apos;ve met my Buddy safely</button><p className="muted text-[11px] mt-2">{bubble.members.filter((member) => member.met).length} of {bubble.members.length} members confirmed.</p></section><section className="buddies-panel"><h2>Quick updates</h2><div className="buddies-modes">{Object.entries(labels).map(([key, label]) => <button key={key} disabled={pending} onClick={() => void post("message", { key })}>{label}</button>)}</div>{bubble.messages.map((item, index) => <p className="muted text-[12px]" key={`${item.created_at}-${index}`}>{labels[item.message_key] ?? item.message_key}</p>)}</section><section className="buddies-panel"><h2>Virtual walk</h2><p className="muted text-[12px]">Audio-only safety check. Nothing is recorded.</p>{bubble.virtualWalk?.incoming ? <button className="btn btn-primary mt-3" disabled={pending} onClick={() => void post("virtual-walk", { action: "answer" })}><Mic size={16} /> Answer</button> : bubble.virtualWalk ? <button className="btn mt-3" disabled={pending} onClick={() => void post("virtual-walk", { action: "end" })}><PhoneOff size={16} /> End call</button> : <button className="btn mt-3" disabled={pending} onClick={() => void post("virtual-walk", { action: "start" })}><Mic size={16} /> Start virtual walk</button>}</section><section className="buddies-panel"><h2>Something feels off?</h2><div className="flex gap-2 flex-wrap"><button className="btn" disabled={pending} onClick={() => void post("safety", { action: "report", reason: "something_feels_off" })}><Flag size={16} /> Report</button><button className="btn btn-danger" disabled={pending} onClick={() => void post("safety", { action: "block" })}><ShieldAlert size={16} /> Block Buddy</button></div></section>{message && <p className="buddies-message">{message}</p>}</div>;
}
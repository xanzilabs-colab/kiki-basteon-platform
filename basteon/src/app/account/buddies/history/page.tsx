"use client";

import Link from "next/link";
import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

type AuditEvent = { id: number; actor_alias: string | null; event: string; details: { key?: string } | null; created_at: string };
const labels: Record<string, string> = { trip_created: "Created a Buddy trip", bubble_created: "Created a Buddy bubble", member_joined: "Joined the bubble", quick_update: "Sent a quick update", meeting_confirmed: "Confirmed the meeting", virtual_walk_started: "Started a virtual walk", virtual_walk_answered: "Answered a virtual walk", virtual_walk_ended: "Ended a virtual walk", safety_reported: "Reported a safety concern", buddy_blocked: "Blocked a Buddy", member_left: "Left the bubble", bubble_closed: "Closed the bubble" };
const updates: Record<string, string> = { on_my_way: "On my way", at_the_meeting_point: "At the meeting point", running_late: "Running late", i_need_help: "I need help", i_arrived: "I've arrived" };

export default function BuddyHistoryPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]); const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/buddies/history").then(async (response) => response.ok ? setEvents((await response.json()).events ?? []) : setError("Buddy history is unavailable.")).catch(() => setError("Buddy history is unavailable.")); }, []);
  return <div className="buddies-page space-y-4"><div className="buddies-heading"><div><p className="eyebrow">Private record</p><h1 className="page-title">Buddy history</h1></div><Link className="btn" href="/account/buddies">Buddies</Link></div><section className="buddies-panel"><h2>Activity log</h2>{error && <p role="alert" className="text-[var(--crit)] text-[12px]">{error}</p>}{!error && events.length === 0 && <p className="muted text-[12px]">No Buddy activity has been recorded yet.</p>}<div className="buddies-history">{events.map((item) => <div key={item.id}><Clock3 size={15} /><p><b>{item.actor_alias ?? "Buddy"}</b> {labels[item.event] ?? item.event.replaceAll("_", " ")}{item.event === "quick_update" && item.details?.key ? `: ${updates[item.details.key] ?? item.details.key}` : ""}</p><time>{new Date(item.created_at).toLocaleString()}</time></div>)}</div></section></div>;
}
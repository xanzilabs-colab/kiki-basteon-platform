"use client";

import "./buddyPlaces.css";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, Flag, LocateFixed, MapPin, Navigation, RefreshCw } from "lucide-react";
import { categoryLabel, currentMeetingLocation, directionsUrl, meetingFetch, type MeetingView } from "@/lib/buddies/meeting/client";
import { TOP_COLORS } from "@/lib/buddies/meeting/schemas";

export function BuddyMeeting({ id }: { id: string }) {
  const [view, setView] = useState<MeetingView | null>(null); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [allowLandmarks, setAllowLandmarks] = useState(false); const [consent, setConsent] = useState(false);
  const [topColor, setTopColor] = useState(""); const [bag, setBag] = useState(""); const [reasons, setReasons] = useState<Record<string, string>>({});
  const initialized = useRef(false);
  const base = `/api/buddies/bubble/${id}`;
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await meetingFetch<MeetingView>(`${base}/spot-options`, undefined, controller.signal); setView(next);
        if (!initialized.current) {
          initialized.current = true;
          const own = next.lookFor.find((member) => member.you); setTopColor(own?.topColor ?? ""); setBag(own?.carryingBag == null ? "" : String(own.carryingBag));
        }
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Meeting unavailable."); }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [base]);
  async function action(path: string, body: object, confirmation: string) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await meetingFetch<{ status?: string; ready?: number; total?: number }>(`${base}/${path}`, body);
      setView(await meetingFetch<MeetingView>(`${base}/spot-options`));
      setMessage(result.status === "waiting_for_locations" ? `${result.ready} of ${result.total} current locations shared.` : result.status === "no_candidates" ? "No suitable spots found. Try again after reviewing location and landmark choices." : confirmation);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update meeting."); }
    finally { setBusy(false); }
  }
  async function shareLocation() {
    if (!consent || busy) return;
    setBusy(true); setMessage("");
    try {
      const point = await currentMeetingLocation();
      await meetingFetch(`${base}/spot-options`, { action: "location", ...point, allowLandmarks });
      setView(await meetingFetch<MeetingView>(`${base}/spot-options`)); setMessage("Meeting location shared.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not share location."); }
    finally { setBusy(false); }
  }
  function saveLook(event: FormEvent) {
    event.preventDefault();
    void action("look-for", { topColor: topColor || null, carryingBag: bag === "" ? null : bag === "true" }, "Look-for details updated.");
  }
  return <div className="buddy-places buddies-page space-y-4">
    <div className="buddies-heading"><div><p className="eyebrow">Buddy bubble</p><h1 className="page-title">Meeting spot</h1></div><Link className="btn" href={`/account/buddies/bubble/${id}`}>Back to Bubble</Link></div>
    <section className="buddies-panel"><h2><LocateFixed size={18} />Meeting location</h2><div className="mt-3 space-y-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />Share my current location for this meeting</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowLandmarks} onChange={(event) => setAllowLandmarks(event.target.checked)} />Share the meeting area with OpenStreetMap for unreviewed landmarks</label><button className="btn" disabled={!consent || busy || !view} onClick={() => void shareLocation()}><LocateFixed size={16} />Share current location</button><p className="muted text-xs">{view ? `${view.ready} of ${view.total} current locations shared` : "Loading meeting..."}</p></div></section>
    <section className="buddies-panel"><div className="flex flex-wrap items-center justify-between gap-3"><h2><MapPin size={18} />Spot options{view?.round ? ` · Round ${view.round}` : ""}</h2><button className="btn" disabled={busy || !view || view.ready !== view.total || view.total < 2} onClick={() => void action("spot-options", { action: "generate", regenerate: Boolean(view?.round) }, "Spot options ready.")}><RefreshCw size={16} />{view?.round ? "New options" : "Find spots"}</button></div>
      {view?.candidates.length === 0 && <p className="muted text-sm mt-3">No meeting spots selected yet.</p>}
      {view?.membershipChanged && <p className="buddies-message" role="status">Bubble membership changed. Find new options for the current group.</p>}
      <div className="divide-y divide-[var(--line)]">{view?.candidates.map((candidate) => <article key={candidate.id} className="py-4 space-y-2"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold break-words">{candidate.name}</h3>{view.selectedCandidateId === candidate.id && <span className="inline-flex items-center gap-1 text-sm text-[var(--ok)]"><Check size={16} />Agreed meeting spot</span>}</div><p className="muted text-xs capitalize">{categoryLabel(candidate.category)} · {candidate.source === "curated" ? "Reviewed" : "Unreviewed landmark"}</p><p className="muted text-xs break-words">{candidate.address}</p><p className="text-xs">About {Math.round(candidate.distanceM)} m from you · Longest estimated trip {Math.round(candidate.maxDistanceM)} m{candidate.balanced ? " · Balanced" : ""}</p><p className="text-xs">{candidate.votes} of {view.total} votes{candidate.rejected ? " · Not suitable" : ""}</p>
        <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy || candidate.rejected || candidate.yourVote} onClick={() => void action("spot-options", { action: "vote", round: view.round, candidateId: candidate.id }, "Vote saved.")}><Check size={16} />{candidate.yourVote ? "Your vote" : "Vote for spot"}</button><a className="btn" href={directionsUrl(candidate.lat, candidate.lng)} target="_blank" rel="noreferrer"><Navigation size={16} />Directions</a></div>
        <div className="flex flex-wrap items-center gap-2"><label className="field">Feedback<select value={reasons[candidate.id] ?? "not_suitable"} onChange={(event) => setReasons((current) => ({ ...current, [candidate.id]: event.target.value }))}>{["not_suitable", "too_far", "closed", "unsafe"].map((reason) => <option value={reason} key={reason}>{categoryLabel(reason)}</option>)}</select></label><button className="btn" disabled={busy || candidate.rejected} onClick={() => void action("spot-feedback", { round: view.round, candidateId: candidate.id, reason: reasons[candidate.id] ?? "not_suitable" }, "Feedback saved. This spot will not be offered again in this Bubble.")}><Flag size={16} />Not suitable</button></div>
      </article>)}</div>
    </section>
    <section className="buddies-panel"><h2><Eye size={18} />Look for</h2><form onSubmit={saveLook} className="mt-3 space-y-4"><fieldset><legend className="mb-2 text-xs font-semibold">Top colour</legend><div role="radiogroup" aria-label="Top colour" className="flex flex-wrap gap-3"><button type="button" role="radio" aria-checked={topColor === ""} aria-label="Not shared" title="Not shared" className="buddy-color buddy-color-light" onClick={() => setTopColor("")}><EyeOff size={15} /></button>{TOP_COLORS.map((color) => <button type="button" key={color} role="radio" aria-checked={topColor === color} aria-label={`${color} top`} title={`${color} top`} className={`buddy-color${["white", "yellow", "pink"].includes(color) ? " buddy-color-light" : ""}`} style={{ backgroundColor: color }} onClick={() => setTopColor(color)}>{topColor === color && <Check size={15} />}</button>)}</div></fieldset><div className="flex flex-wrap items-end gap-3"><label className="field">Bag<select value={bag} onChange={(event) => setBag(event.target.value)}><option value="">Not shared</option><option value="true">Carrying a bag</option><option value="false">No bag</option></select></label><button className="btn" disabled={busy || !view}><Check size={16} />Save</button></div></form><div className="mt-3 space-y-2">{view?.lookFor.map((member, index) => <p key={`${member.alias}-${index}`} className="text-sm break-words"><b>{member.alias}</b> · {member.topColor ? `${member.topColor} top` : "Top colour not shared"}{member.carryingBag === null ? "" : member.carryingBag ? " · Carrying a bag" : " · No bag"}</p>)}</div></section>
    {message && <p role="status" className="buddies-message">{message}</p>}
  </div>;
}
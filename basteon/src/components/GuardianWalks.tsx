"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Clock3, LocateFixed, MapPinned, Route, ShieldCheck, X } from "lucide-react";

const TripMap = dynamic(() => import("@/components/TripMap"), { ssr: false, loading: () => <div className="hamba-map hamba-map-loading">Loading shared walk...</div> });

type Buddy = { id: string; name: string; avatarUrl: string | null };
type GuardianInvitation = { id: string; tripId: string; status: "pending" | "accepted"; active: boolean; mode: string | null; createdAt: string; buddy: Buddy | null };
type Point = { lat: number; lng: number };
type SharedTrip = {
  id: string;
  status: string;
  destinationLabel: string;
  mode: string;
  plannedRoute: { points?: Point[] } | null;
  startedAt: string;
  expectedArrivalAt: string;
  nextCheckInAt: string | null;
  routeWatchState: string;
  riskScore: number;
  latestEvent: { event_type: string; state: string; reasons: { reason?: string }[] | null; created_at: string } | null;
  missedCheckIns: { label: string | null; expected_at: string | null; status: string; lat: number; lng: number }[];
  latestLocation: { lat: number; lng: number; accuracy_m: number | null; recorded_at: string } | null;
  owner: Buddy | null;
};

function dateLabel(value: string | null) {
  if (!value) return "Not scheduled";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function GuardianWalks() {
  const [invitations, setInvitations] = useState<GuardianInvitation[]>([]);
  const [selectedTripId, setSelectedTripId] = useState("");
  const [trip, setTrip] = useState<SharedTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const loadInvitations = useCallback(async () => {
    try {
      const response = await fetch("/api/trips/guardian-shares", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage("Your shared walks could not be loaded. Refresh and try again.");
        return;
      }
      const next = Array.isArray(data.invitations) ? data.invitations as GuardianInvitation[] : [];
      setInvitations(next);
      if (selectedTripId && !next.some((item) => item.tripId === selectedTripId && item.status === "accepted" && item.active)) {
        setSelectedTripId("");
        setTrip(null);
      }
    } catch {
      setMessage("Your shared walks could not be loaded. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [selectedTripId]);

  const loadTrip = useCallback(async (tripId: string) => {
    try {
      const response = await fetch(`/api/trips/guardian-shares/${encodeURIComponent(tripId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 410) {
          setMessage("This walk has ended. Live location is no longer available.");
          setTrip(null);
          setSelectedTripId("");
          void loadInvitations();
          return;
        }
        if (response.status === 403) {
          setMessage("You no longer have permission to view this walk.");
          setTrip(null);
          setSelectedTripId("");
          void loadInvitations();
          return;
        }
        setMessage("The shared walk could not be refreshed.");
        return;
      }
      setTrip(data.trip as SharedTrip);
      setMessage("");
    } catch {
      setMessage("The shared walk could not be refreshed. Check your connection.");
    }
  }, [loadInvitations]);

  useEffect(() => { void loadInvitations(); }, [loadInvitations]);

  useEffect(() => {
    if (selectedTripId || typeof window === "undefined") return;
    const requestedTripId = new URLSearchParams(window.location.search).get("trip");
    const invitation = invitations.find((item) => item.tripId === requestedTripId && item.status === "accepted" && item.active);
    if (invitation) setSelectedTripId(invitation.tripId);
  }, [invitations, selectedTripId]);

  useEffect(() => {
    if (!selectedTripId) return;
    void loadTrip(selectedTripId);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadTrip(selectedTripId);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [selectedTripId, loadTrip]);

  async function respond(invitationId: string, action: "accept" | "decline") {
    setBusy(invitationId);
    try {
      const response = await fetch("/api/trips/guardian-shares", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitationId, action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error === "trip_ended" ? "This walk has already ended." : data.error === "not_buddies" ? "This invitation is no longer available because you are not connected as buddies." : "The invitation could not be answered.");
        await loadInvitations();
        return;
      }
      await loadInvitations();
      if (action === "accept" && typeof data.tripId === "string") {
        setSelectedTripId(data.tripId);
        setMessage("Accepted. The live route is available only while the trip is active.");
      } else {
        setMessage("Walk guardian invitation declined.");
      }
    } catch {
      setMessage("The invitation could not be answered. Check your connection.");
    } finally {
      setBusy("");
    }
  }

  async function stopViewing(tripId: string) {
    setBusy(tripId);
    try {
      const response = await fetch(`/api/trips/guardian-shares/${encodeURIComponent(tripId)}`, { method: "DELETE" });
      if (!response.ok) {
        setMessage("Your access could not be stopped. Please try again.");
        return;
      }
      setSelectedTripId("");
      setTrip(null);
      setMessage("You stopped viewing this walk. The trip owner has been notified.");
      await loadInvitations();
    } catch {
      setMessage("Your access could not be stopped. Check your connection.");
    } finally {
      setBusy("");
    }
  }

  const routePoints = trip?.plannedRoute?.points ?? [];
  const firstMissed = trip?.missedCheckIns?.[0] ?? null;
  const latestReason = trip?.latestEvent?.reasons?.find((reason) => typeof reason.reason === "string")?.reason;
  const attention = trip?.status === "concern" || trip?.status === "alert" || trip?.routeWatchState === "concern" || trip?.routeWatchState === "alert";

  return <main className="hamba-page">
    <header className="hamba-heading">
      <div><p className="eyebrow">Consent-based safety sharing</p><h1 className="page-title">Shared walks</h1></div>
      <Link href="/account/trips" className="btn"><Route size={16} />My trips</Link>
    </header>
    <p className="mb-4 text-sm text-[#756583]">Only walks you have accepted appear here. Location access ends when a trip ends or the owner revokes sharing.</p>
    {loading ? <p className="hamba-empty">Loading walk invitations...</p> : invitations.length === 0 ? <section className="hamba-recent"><p className="hamba-empty">No buddy walk invitations yet.</p></section> : <section className="grid gap-3">
      {invitations.map((invitation) => <article key={invitation.id} className="rounded-2xl border border-[#e8deed] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-semibold">{invitation.buddy?.name ?? "A buddy"} invited you as a walk guardian</h2><p className="mt-1 text-sm text-[#756583]">{invitation.mode ? `${invitation.mode} · ` : ""}{dateLabel(invitation.createdAt)}</p></div>
          <span className={`hamba-engine ${invitation.active ? "text-emerald-700" : "text-[#756583]"}`}>{invitation.active ? invitation.status === "accepted" ? "Trip active" : "Awaiting your response" : "Trip ended"}</span>
        </div>
        {invitation.status === "pending" && <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={Boolean(busy) || !invitation.active} onClick={() => void respond(invitation.id, "accept")}><Check size={16} />{busy === invitation.id ? "Please wait..." : "Accept live sharing"}</button>
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void respond(invitation.id, "decline")}><X size={16} />Decline</button>
        </div>}
        {invitation.status === "accepted" && invitation.active && <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => { setSelectedTripId(invitation.tripId); void loadTrip(invitation.tripId); }}><MapPinned size={16} />View live walk</button>
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void stopViewing(invitation.tripId)}>Stop viewing</button>
        </div>}
        {invitation.status === "accepted" && !invitation.active && <p className="mt-3 text-sm text-[#756583]">The owner’s trip has ended; live location is no longer available.</p>}
      </article>)}
    </section>}

    {trip && selectedTripId && <section className="mt-5 overflow-hidden rounded-3xl border border-[#e8deed] bg-white shadow-sm">
      <div className="hamba-map-stage">
        <TripMap points={routePoints} position={trip.latestLocation} avatarUrl={trip.owner?.avatarUrl} initial={trip.owner?.name?.slice(0, 1) ?? "B"} />
        <div className="hamba-map-overlay"><span className="hamba-overlay-icon"><ShieldCheck size={18} /></span><div><h2>{trip.owner?.name ?? "Buddy"} · {trip.destinationLabel}</h2><p>{trip.mode} · Trip {trip.status}</p></div></div>
      </div>
      <div className="grid gap-4 p-4">
        {attention && <div role="alert" className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><AlertTriangle size={19} /><div><b>Trip needs attention</b><p className="mt-1 text-sm">{latestReason ?? "The safety monitor is requesting a check-in."}</p></div></div>}
        {firstMissed && <div role="status" className="flex gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-orange-950"><Clock3 size={18} /><div><b>{trip.owner?.name ?? "Your buddy"} missed their check-in at {firstMissed.label ?? "a planned stop"}</b><p className="mt-1 text-sm">{firstMissed.expected_at ? `Expected ${dateLabel(firstMissed.expected_at)}.` : "The check-in is overdue."} You can try contacting them directly.</p></div></div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-[#f8f5fa] p-3"><span className="text-sm text-[#756583]">Next check-in</span><b className="mt-1 block">{dateLabel(trip.nextCheckInAt)}</b></div>
          <div className="rounded-2xl bg-[#f8f5fa] p-3"><span className="text-sm text-[#756583]">Last location update</span><b className="mt-1 block">{dateLabel(trip.latestLocation?.recorded_at ?? null)}</b></div>
        </div>
        {!trip.latestLocation && <p className="flex items-center gap-2 text-sm text-[#756583]"><LocateFixed size={16} />Waiting for the first location update from this trip.</p>}
        {trip.missedCheckIns.length > 1 && <div><h3 className="mb-2 font-semibold">Missed check-ins</h3><ul className="grid gap-2">{trip.missedCheckIns.map((checkpoint, index) => <li key={`${checkpoint.expected_at}-${index}`} className="rounded-xl bg-[#fff8f1] px-3 py-2 text-sm"><b>{checkpoint.label ?? "Planned stop"}</b>{checkpoint.expected_at ? ` · ${dateLabel(checkpoint.expected_at)}` : ""}</li>)}</ul></div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => { setSelectedTripId(""); setTrip(null); }}>Close live view</button>
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void stopViewing(trip.id)}>Stop viewing and revoke my access</button>
        </div>
      </div>
    </section>}
    {message && <p className="hamba-message" role="status">{message}</p>}
  </main>;
}

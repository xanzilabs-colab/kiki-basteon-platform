"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Clock3, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { CachedProfileImage } from "@/components/CachedProfileImage";

type BuddyTrip = {
  id: string;
  destination: string;
  mode: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  relation: string;
  createdAt: string;
};
type BuddyDetailsData = {
  buddy: { id: string; name: string; kikiId: string; avatarUrl: string | null };
  sharing: { theyShareWithMe: boolean; iShareWithThem: boolean; theyHaveLiveLocationEnabled: boolean };
  location: { lat: number; lng: number; recordedAt: string } | null;
  trips: BuddyTrip[];
};

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function BuddyDetails() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const [data, setData] = useState<BuddyDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/account/buddies/${encodeURIComponent(userId)}`, { cache: "no-store" });
        const result = await response.json() as BuddyDetailsData & { error?: string };
        if (!response.ok) throw new Error(result.error === "not_connected" ? "This person is no longer on your buddy list." : "Buddy details could not be loaded.");
        if (active) {
          setData(result);
          setError("");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Buddy details could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [userId]);

  async function setLocationAccess(enabled: boolean) {
    if (!data || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/account/buddies/${encodeURIComponent(userId)}/location-access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error === "not_connected" ? "This person is no longer on your buddy list." : "Location access could not be updated. Try again.");
      }
      setData((current) => current ? {
        ...current,
        sharing: { ...current.sharing, iShareWithThem: enabled },
      } : current);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Location access could not be updated. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="kiki-setting-page kiki-buddy-detail"><p role="status">Loading buddy details…</p></div>;
  if (!data) return <div className="kiki-setting-page kiki-buddy-detail"><Link className="kiki-buddy-detail-back" href="/account/profile/buddies"><ArrowLeft size={17} /> My Buddies</Link><p role="alert">{error || "Buddy details are unavailable."}</p></div>;

  const locationUrl = data.location
    ? `https://www.google.com/maps/dir/?api=1&destination=${data.location.lat},${data.location.lng}`
    : null;
  return <div className="kiki-setting-page kiki-buddy-detail">
    <Link className="kiki-buddy-detail-back" href="/account/profile/buddies"><ArrowLeft size={17} /> My Buddies</Link>
    <header>
      <span>YOUR BUDDIES</span>
      <h1>Buddy details</h1>
      <p>Your location and trip details are shared only with permission.</p>
    </header>

    {error && <p className="kiki-buddy-detail-error" role="alert">{error}</p>}

    <section className="kiki-buddy-detail-identity">
      <CachedProfileImage
        src={data.buddy.avatarUrl}
        alt={`${data.buddy.name}'s profile`}
        fallback={<span aria-hidden="true">{data.buddy.name.charAt(0).toUpperCase() || <UserRound size={20} />}</span>}
      />
      <div><h2>{data.buddy.name}</h2><p>{data.buddy.kikiId}</p></div>
      {data.location && <span className="kiki-buddy-live-pill"><i /> Sharing live</span>}
    </section>

    <section aria-labelledby="buddy-location-title">
      <h2 id="buddy-location-title"><MapPin size={18} /> Location sharing</h2>
      <div className="kiki-buddy-share-control">
        <div>
          <strong>Allow {data.buddy.name} to see my location</strong>
          <p>Only while Live Location Sharing and device location permission are on. Your home and work privacy zones stay hidden.</p>
        </div>
        <button type="button" className="kiki-buddy-switch" role="switch" aria-checked={data.sharing.iShareWithThem} aria-label={`Allow ${data.buddy.name} to see my location`} disabled={saving} onClick={() => void setLocationAccess(!data.sharing.iShareWithThem)}>
          <span />
        </button>
      </div>
      <p className="kiki-buddy-sharing-status" role="status">
        {data.sharing.theyShareWithMe
          ? data.location ? `They shared their live location · updated ${formatTime(data.location.recordedAt)}.` : data.sharing.theyHaveLiveLocationEnabled ? "They’ve granted access, but no fresh location is available." : "They’ve granted access, but their Live Location Sharing is off."
          : "They have not shared their location with you."}
      </p>
      {!data.sharing.theyHaveLiveLocationEnabled && data.sharing.iShareWithThem && <p className="kiki-buddy-detail-note">Your grant is saved. Turn on Live Location Sharing in <Link href="/account/profile/smart-safety">Profile privacy settings</Link> before your location is sent.</p>}
      {locationUrl && <a className="kiki-buddy-directions" href={locationUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={16} /> Directions to their shared location</a>}
    </section>

    <section aria-labelledby="buddy-trips-title">
      <h2 id="buddy-trips-title"><Clock3 size={18} /> Shared trip history <span className="kiki-buddy-history-count">{data.trips.length}</span></h2>
      <p>Trips you shared together, or where one of you accepted the other as a Route Watch guardian.</p>
      {data.trips.length ? <ul className="kiki-buddy-trip-history">
        {data.trips.map((trip) => <li key={`${trip.relation}-${trip.id}`}>
          <span className="kiki-buddy-trip-icon"><RouteIcon mode={trip.mode} /></span>
          <span className="kiki-buddy-trip-copy"><strong>{trip.destination}</strong><small>{trip.relation} · {trip.mode} · {trip.status.replaceAll("_", " ")}</small></span>
          <time dateTime={trip.endedAt ?? trip.startedAt ?? trip.createdAt}>{formatTime(trip.endedAt ?? trip.startedAt ?? trip.createdAt)}</time>
        </li>)}
      </ul> : <div className="kiki-buddy-history-empty"><ShieldCheck size={18} /><span>No shared trips yet. Accepted Route Watch shares and Travel Together walks will appear here.</span></div>}
    </section>
  </div>;
}

function RouteIcon({ mode }: { mode: string }) {
  return mode === "walk" ? <UserRound size={18} aria-hidden="true" /> : <MapPin size={18} aria-hidden="true" />;
}

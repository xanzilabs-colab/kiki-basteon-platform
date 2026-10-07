"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Flower2, LockKeyhole, MapPin, Plus, UsersRound, X } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { createClient } from "@/lib/supabase/client";
import styles from "@/app/games/games.module.css";

type NearbyBuddy = {
  userId: string;
  avatar: string;
  label: string;
  lat: number;
  lng: number;
  distanceKm: number;
  angleDeg: number;
  radialPct: number;
};

const buddyEmojis = ["🐰", "🦊", "🐼", "🐻", "🐝", "🌼", "🦋", "🐧", "🌙", "🌿"];

export function GameLobby() {
  const router = useRouter();
  const { position, error: locationError } = useGeolocation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [buddies, setBuddies] = useState<NearbyBuddy[]>([]);
  const [selected, setSelected] = useState<NearbyBuddy | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    if (!position) return;

    const currentPosition = position;
    let ignore = false;

    async function loadNearbyBuddies() {
      const db = createClient();
      const { data: { user } } = await db.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const { data, error } = await db.rpc("game_nearby", {
        p_lat: currentPosition.lat,
        p_lng: currentPosition.lng,
        p_radius_km: 3,
      });

      if (error || !data) {
        if (!ignore) setBuddies([]);
        return;
      }

      const rows = data as Array<{ user_id: string; lat: number; lng: number }>;
      const nextBuddies = rows
        .filter((row) => row.user_id !== user.id)
        .map((row, index) => {
          const latDelta = row.lat - currentPosition.lat;
          const lngDelta = row.lng - currentPosition.lng;
          const distanceKm = Math.hypot(latDelta * 111, lngDelta * 111);
          const angleDeg = ((Math.atan2(latDelta, lngDelta) * 180) / Math.PI + 360 + 90) % 360;

          return {
            userId: row.user_id,
            avatar: buddyEmojis[index % buddyEmojis.length],
            label: `Buddy ${index + 1}`,
            lat: row.lat,
            lng: row.lng,
            distanceKm,
            angleDeg,
            radialPct: 0.2 + (index % 5) * 0.12,
          } satisfies NearbyBuddy;
        })
        .filter((buddy) => buddy.distanceKm <= 3)
        .slice(0, 6);

      if (!ignore) {
        setBuddies(nextBuddies);
        setSelected((current) => current && nextBuddies.some((buddy) => buddy.userId === current.userId) ? current : nextBuddies[0] ?? null);
      }
    }

    void loadNearbyBuddies();
    return () => {
      ignore = true;
    };
  }, [position?.lat, position?.lng, router]);

  async function createRoom(selectedBuddy?: NearbyBuddy) {
    setBusy(true);
    setMessage("");
    const db = createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) {
      router.push("/login");
      setBusy(false);
      return;
    }

    const { data: existingRoom } = await db.from("game_rooms").select("id")
      .or(`host_id.eq.${user.id},guest_id.eq.${user.id}`)
      .neq("status", "ended")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRoom) {
      router.push(`/games/play/${existingRoom.id}`);
      setBusy(false);
      return;
    }

    const { data, error } = await db.rpc("game_create_room", { p_guest_id: selectedBuddy?.userId ?? null });
    if (error) {
      setMessage(
        error.message.includes("room_already_open") || error.message.includes("duplicate key")
          ? "You already have an open game room. Use its invite link to continue."
          : selectedBuddy
            ? "This buddy is not open for a game right now. Try another nearby match."
            : "A game room could not be created. Please try again."
      );
      setBusy(false);
      return;
    }

    router.push(`/games/play/${(data as { id: string }).id}`);
  }

  return (
    <main className={styles.gardenPage}>
      <div className={styles.gardenShell}>
        <header className={styles.gardenHeader}>
          <Link href="/games" className={styles.gardenIconButton} aria-label="Back to games"><ArrowLeft size={19} /></Link>
          <div className={styles.gardenHeading}>
            <h1>Morabaraba Garden</h1>
            <span><i />{locationError ? "Location access needed" : position ? "Broad location rings active" : "Finding your garden…"}</span>
          </div>
          <button type="button" className={styles.gardenIconButton} aria-label="Location privacy information" onClick={() => setPrivacyOpen(true)}><LockKeyhole size={18} /></button>
        </header>

        <section className={styles.gardenMain}>
          <div className={styles.gardenIntro}>
            <p>Nearby play</p>
            <h2>Find your circle.</h2>
          </div>

          <div className={styles.gardenPond} role="group" aria-label="Nearby game players, shown as broad location rings">
            <div className={styles.pondWash} />
            <div className={`${styles.pondRipple} ${styles.rippleOne}`} />
            <div className={`${styles.pondRipple} ${styles.rippleTwo}`} />
            <div className={`${styles.pondRipple} ${styles.rippleThree}`} />
            <div className={styles.pondGuide} />
            <div className={styles.pondGuideInner} />

            {buddies.map((buddy, index) => {
              const radius = 24 + buddy.radialPct * 43;
              const radians = (buddy.angleDeg * Math.PI) / 180;
              const left = 50 + Math.sin(radians) * radius;
              const top = 50 - Math.cos(radians) * radius;
              return (
                <button
                  key={buddy.userId}
                  type="button"
                  className={`${styles.gardenBuddy} ${styles[`gardenBuddyTone${index % 4}`]}`}
                  aria-pressed={selected?.userId === buddy.userId}
                  onClick={() => setSelected(buddy)}
                  style={{ left: `${left}%`, top: `${top}%` }}
                  aria-label={`Select ${buddy.label}, approximately ${buddy.distanceKm.toFixed(1)} kilometres away`}
                >
                  <span className={styles.gardenBuddyMark}>{buddy.avatar}</span>
                  <span className={styles.gardenBuddyLabel}><strong>{buddy.label}</strong><small>{buddy.distanceKm.toFixed(1)} km</small></span>
                </button>
              );
            })}

            <button type="button" className={styles.gardenYou} onClick={() => setPrivacyOpen(true)} aria-label="Your location is represented by the broad center ring">
              <span className={styles.gardenYouMark}><Flower2 size={34} /></span>
              <span className={styles.gardenYouLabel}>YOU</span>
            </button>
          </div>

          <div className={styles.gardenSelection} aria-live="polite">
            <span className={styles.selectionMark}>{selected ? selected.avatar : <UsersRound size={20} />}</span>
            <span className={styles.selectionCopy}>
              <strong>{selected ? selected.label : buddies.length ? "Choose a nearby Buddy" : "Your garden is quiet"}</strong>
              <small>{locationError ? "Enable location to see nearby players." : selected ? `${selected.distanceKm.toFixed(1)} km away · broad location only` : buddies.length ? "Tap a Buddy to invite them to play." : position ? "You can still create an open room." : "Nearby players appear when location is available."}</small>
            </span>
            {selected && <button type="button" className={styles.clearSelection} aria-label="Clear selected Buddy" onClick={() => setSelected(null)}><X size={18} /></button>}
          </div>
        </section>

        <footer className={styles.gardenFooter}>
          <button type="button" className={styles.createGardenRoom} onClick={() => void createRoom(selected ?? undefined)} disabled={busy}>
            {selected ? <UsersRound size={19} /> : <Plus size={20} />}
            <span>{busy ? "Opening room…" : selected ? `Invite ${selected.label}` : "Create a Morabaraba Room"}</span>
          </button>
          <p className={styles.gardenPrivacyNote}><LockKeyhole size={13} /> Only broad distance rings are shown here.</p>
          {message && <p role="status" className={styles.gardenMessage}>{message}</p>}
        </footer>

        {privacyOpen && (
          <div className={styles.gardenPrivacyBackdrop} role="presentation" onClick={() => setPrivacyOpen(false)}>
            <section className={styles.gardenPrivacyDialog} role="dialog" aria-modal="true" aria-labelledby="garden-privacy-title" onClick={(event) => event.stopPropagation()}>
              <button type="button" className={styles.gardenPrivacyClose} aria-label="Close privacy details" onClick={() => setPrivacyOpen(false)}><X size={18} /></button>
              <LockKeyhole size={22} />
              <h2 id="garden-privacy-title">Your location stays broad.</h2>
              <p>The garden shows nearby players as distance rings, not precise map pins. Choose a Buddy only when you’re ready to open a private game room.</p>
              <button type="button" className={styles.gardenPrivacyOkay} onClick={() => setPrivacyOpen(false)}>Got it</button>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
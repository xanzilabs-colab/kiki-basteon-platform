"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

  async function openBuddyRoom(buddy: NearbyBuddy) {
    setSelected(buddy);
    await createRoom(buddy);
  }

  return (
    <main className={styles.page}>
      <div className={styles.routePage}>
        <div className={styles.backBar}>
          <Link href="/games" className={styles.backLink}>← Back</Link>
        </div>

        <section className={styles.routeCard}>
          <p className={styles.eyebrow}>Play with a buddy</p>
          <h1>Nearby players.</h1>
          <p>
            Tap a buddy on the map and jump straight into a Morabaraba room. Your map uses broad location rings only, and a room opens when you choose a friend.
          </p>

          <div className="buddies-panel" style={{ marginTop: 18 }}>
            <div className="buddies-map" aria-label="Nearby game players map">
              {[0, 1, 2].map((ring) => (
                <i key={ring} className={`buddies-ring ring-${ring}`} />
              ))}
              <span className="buddies-me">YOU</span>
              {buddies.map((buddy) => {
                const radius = 26 + buddy.radialPct * 56;
                const radians = (buddy.angleDeg * Math.PI) / 180;
                const left = 50 + Math.sin(radians) * radius;
                const top = 50 - Math.cos(radians) * radius;

                return (
                  <button
                    key={buddy.userId}
                    type="button"
                    className="buddies-avatar"
                    aria-pressed={selected?.userId === buddy.userId}
                    onClick={() => void openBuddyRoom(buddy)}
                    style={{ left: `${left}%`, top: `${top}%` }}
                    title={`${buddy.label} • ${buddy.distanceKm.toFixed(1)} km away`}
                    aria-label={`Open Morabaraba with ${buddy.label}`}
                  >
                    <span>{buddy.avatar}</span>
                  </button>
                );
              })}
            </div>

            <p className={styles.muted} style={{ marginTop: 12 }}>
              {locationError
                ? "Enable location to see nearby players."
                : buddies.length > 0
                  ? selected
                    ? `${selected.label} is ${selected.distanceKm.toFixed(1)} km nearby.`
                    : "Pick a nearby buddy to start a room."
                  : "No nearby buddies are currently visible on the map."}
            </p>
          </div>

          <div className={styles.list}>
            <button type="button" className={styles.link} onClick={() => void createRoom()} disabled={busy}>
              {busy ? "Opening room…" : "Create a Morabaraba room"}
            </button>
            {message && <p role="status" className={styles.muted}>{message}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
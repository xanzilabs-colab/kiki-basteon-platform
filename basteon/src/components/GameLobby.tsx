"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Flower2, LockKeyhole, Plus, UsersRound, X } from "lucide-react";
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
type IncomingInvite = { id: string; host_id: string; invite_expires_at: string | null };
type OutgoingInvite = { id: string; buddy: string; expiresAt: string | null };
type ActiveRoom = {
  id: string;
  status: "waiting" | "ready_check" | "playing" | "paused";
  invite_status: "pending" | "accepted" | "declined" | "expired";
  host_id: string;
  guest_id: string | null;
  invite_expires_at: string | null;
};

const buddyEmojis = ["🐰", "🦊", "🐼", "🐻", "🐝", "🌼", "🦋", "🐧", "🌙", "🌿"];

export function GameLobby() {
  const router = useRouter();
  const { position, error: locationError } = useGeolocation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [presenceError, setPresenceError] = useState("");
  const [buddies, setBuddies] = useState<NearbyBuddy[]>([]);
  const [selected, setSelected] = useState<NearbyBuddy | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [incomingInvite, setIncomingInvite] = useState<IncomingInvite | null>(null);
  const [outgoingInvite, setOutgoingInvite] = useState<OutgoingInvite | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [leavingRoomId, setLeavingRoomId] = useState<string | null>(null);
  const positionRef = useRef(position);
  positionRef.current = position;

  useEffect(() => {
    if (!position) return;
    let ignore = false;
    let userIdPromise: Promise<string> | null = null;
    let loadingNearby = false;
    const db = createClient();

    function getUserId() {
      userIdPromise ??= (async () => {
        const { data: { user } } = await db.auth.getUser();
        if (!user) {
          router.replace("/login");
          return "";
        }
        return user.id;
      })();
      return userIdPromise;
    }

    async function publishPresence() {
      const currentPosition = positionRef.current;
      if (!currentPosition || !(await getUserId())) return;
      const { error } = await db.rpc("game_set_presence", {
        p_lat: currentPosition.lat,
        p_lng: currentPosition.lng,
      });
      if (!ignore) setPresenceError(error ? "Your garden presence could not be updated." : "");
    }

    async function loadNearbyBuddies() {
      const currentPosition = positionRef.current;
      if (!currentPosition || loadingNearby) return;
      const currentUserId = await getUserId();
      if (!currentUserId) return;
      loadingNearby = true;

      try {
        const [{ data, error }, { data: invites }, { data: rooms, error: roomsError }] = await Promise.all([
          db.rpc("game_nearby", {
            p_lat: currentPosition.lat,
            p_lng: currentPosition.lng,
            p_radius_km: 3,
          }),
          db.from("game_rooms")
            .select("id,host_id,invite_expires_at")
            .eq("guest_id", currentUserId)
            .eq("status", "ready_check")
            .eq("invite_status", "pending")
            .gt("invite_expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
            .limit(1),
          db.from("game_rooms")
            .select("id,status,invite_status,host_id,guest_id,invite_expires_at")
            .or(`host_id.eq.${currentUserId},guest_id.eq.${currentUserId}`)
            .in("status", ["waiting", "ready_check", "playing", "paused"] )
            .order("updated_at", { ascending: false })
            .limit(8),
        ]);

        const rows = (!error && data ? data : []) as Array<{ user_id: string; lat: number; lng: number }>;
        const nextBuddies = rows
          .filter((row) => row.user_id !== currentUserId)
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

        const pendingInvites = (invites ?? []) as IncomingInvite[];
        const openRooms = (!roomsError && rooms ? rooms : []) as ActiveRoom[];
        if (!ignore) {
          setBuddies(nextBuddies);
          setSelected((current) => current && nextBuddies.some((buddy) => buddy.userId === current.userId) ? current : null);
          setIncomingInvite(pendingInvites[0] ?? null);
          setActiveRooms(openRooms);
        }
      } finally {
        loadingNearby = false;
      }
    }

    void publishPresence();
    void loadNearbyBuddies();
    const nearbyTimer = window.setInterval(() => { void loadNearbyBuddies(); }, 3_000);
    const presenceTimer = window.setInterval(() => { void publishPresence(); }, 60_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      void publishPresence();
      void loadNearbyBuddies();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      ignore = true;
      window.clearInterval(nearbyTimer);
      window.clearInterval(presenceTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void db.rpc("game_clear_presence");
    };
  }, [Boolean(position), router]);

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

    if (incomingInvite) {
      setMessage("Accept or decline your pending Buddy invite first.");
      setBusy(false);
      return;
    }

    const { data: existingRoom, error: roomLookupError } = await db.from("game_rooms").select("id,status,invite_status,guest_id,invite_expires_at")
      .or(`host_id.eq.${user.id},guest_id.eq.${user.id}`)
      .in("status", ["waiting", "ready_check", "playing", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (roomLookupError) {
      setMessage("Your existing game rooms could not be checked. Please try again.");
      setBusy(false);
      return;
    }

    if (existingRoom) {
      const inviteStillPending = existingRoom.invite_status === "pending"
        && existingRoom.status === "ready_check"
        && existingRoom.invite_expires_at
        && new Date(existingRoom.invite_expires_at).getTime() > Date.now();

      if (selectedBuddy && inviteStillPending && existingRoom.guest_id === selectedBuddy.userId) {
        setOutgoingInvite({ id: existingRoom.id, buddy: selectedBuddy.label, expiresAt: existingRoom.invite_expires_at });
        setBusy(false);
        return;
      }

      if (selectedBuddy) {
        setMessage("You already have an open game room. Open it or leave it from My active rooms, then invite again.");
        setBusy(false);
        return;
      }
      router.push(`/games/play/${existingRoom.id}`);
      setBusy(false);
      return;
    }

    if (selectedBuddy && positionRef.current) {
      const { error: presenceRefreshError } = await db.rpc("game_set_presence", {
        p_lat: positionRef.current.lat,
        p_lng: positionRef.current.lng,
      });
      if (presenceRefreshError) {
        setMessage("Your garden presence could not be refreshed. Please try inviting again.");
        setBusy(false);
        return;
      }
    }

    const { data, error } = await db.rpc("game_create_room", { p_guest_id: selectedBuddy?.userId ?? null });
    if (error) {
      setMessage(
        error.message.includes("room_already_open") || error.message.includes("duplicate key")
          ? "You already have an open game room. Open or leave it from My active rooms below."
          : error.message.includes("buddy_has_open_room")
            ? "That Buddy is already in an open game room. Try inviting them again when they're free."
          : error.message.includes("buddy_unavailable")
            ? "That Buddy is no longer available nearby. Choose someone else or create an open room."
          : selectedBuddy
            ? "This buddy is not open for a game right now. Try another nearby match."
            : "A game room could not be created. Please try again."
      );
      setBusy(false);
      return;
    }

    const room = data as { id: string; invite_expires_at: string | null };
    if (selectedBuddy) {
      setOutgoingInvite({ id: room.id, buddy: selectedBuddy.label, expiresAt: room.invite_expires_at });
      setBusy(false);
      return;
    }
    router.push(`/games/play/${room.id}`);
  }

  useEffect(() => {
    if (!outgoingInvite) return;
    let active = true;
    const db = createClient();
    async function checkInvite() {
      const { data, error } = await db.from("game_rooms")
        .select("status,invite_status,guest_id,invite_expires_at")
        .eq("id", outgoingInvite!.id)
        .maybeSingle();
      if (!active || error || !data) return;
      if (data.invite_status === "accepted" && data.guest_id && data.status !== "ended") {
        setOutgoingInvite(null);
        router.push(`/games/play/${outgoingInvite!.id}`);
      } else if (data.invite_status === "declined" || data.invite_status === "expired" || data.status === "ended") {
        setOutgoingInvite(null);
        setMessage(`${outgoingInvite!.buddy} couldn't join this time. You can invite another Buddy or create an open room.`);
      } else if (data.invite_expires_at && Date.parse(data.invite_expires_at) <= Date.now()) {
        setOutgoingInvite(null);
        setMessage(`The invite to ${outgoingInvite!.buddy} expired. Try again when they're in the Garden.`);
      }
    }
    void checkInvite();
    const timer = window.setInterval(() => { void checkInvite(); }, 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [outgoingInvite, router]);


  async function leaveOpenRoom(roomId: string) {
    if (leavingRoomId) return;
    setLeavingRoomId(roomId);
    setMessage("");
    const { error } = await createClient().rpc("game_leave_room", { p_room_id: roomId });
    if (error) {
      setMessage("This room could not be left right now. Please try again.");
      setLeavingRoomId(null);
      return;
    }
    setActiveRooms((current) => current.filter((room) => room.id !== roomId));
    if (outgoingInvite?.id === roomId) setOutgoingInvite(null);
    if (incomingInvite?.id === roomId) setIncomingInvite(null);
    setMessage("Room closed. You can invite a Buddy now.");
    setLeavingRoomId(null);
  }

  function roomStatusLabel(room: ActiveRoom) {
    if (room.invite_status === "pending") return "Invite pending";
    if (room.status === "playing") return "Playing";
    if (room.status === "paused") return "Paused";
    if (room.status === "ready_check") return "Ready check";
    return "Waiting";
  }

  async function respondToInvite(accept: boolean) {
    if (!incomingInvite || inviteBusy) return;
    setInviteBusy(true);
    setMessage("");
    const { data, error } = await createClient().rpc("game_respond_invite", {
      p_room_id: incomingInvite.id,
      p_accept: accept,
    });
    setInviteBusy(false);
    if (error) {
      setMessage(error.message.includes("invite_unavailable") ? "This invite has expired or is no longer available." : "Your response could not be sent. Please try again.");
      setIncomingInvite(null);
      return;
    }
    const room = data as { invite_status: string };
    setIncomingInvite(null);
    if (accept && room.invite_status === "accepted") router.push(`/games/play/${incomingInvite.id}`);
    else setMessage(room.invite_status === "expired" ? "This invite expired before you could accept it." : "Invite declined.");
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
                  disabled={busy || Boolean(outgoingInvite) || Boolean(incomingInvite)}
                  onClick={() => setSelected(buddy)}
                  style={{ left: `${left}%`, top: `${top}%` }}
                  aria-label={`Invite ${buddy.label}, approximately ${buddy.distanceKm.toFixed(1)} kilometres away to play Morabaraba`}
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
              <small>{presenceError || (locationError ? "Enable location to see nearby players." : selected ? `${selected.distanceKm.toFixed(1)} km away · broad location only` : buddies.length ? "Tap a Buddy to invite them to play." : position ? "You can still create an open room." : "Nearby players appear when location is available.")}</small>
            </span>
            {selected && <button type="button" className={styles.clearSelection} aria-label="Clear selected Buddy" onClick={() => setSelected(null)}><X size={18} /></button>}
          </div>
        </section>

        <footer className={styles.gardenFooter}>
          <Link href="/games/play/solo" className={styles.createGardenRoom}>
            <Flower2 size={19} />
            <span>Play solo against Kiki AI</span>
          </Link>
          {activeRooms.length > 0 && (
            <section className={styles.gardenOpenRooms} aria-label="Your active Morabaraba rooms">
              <h3>My active rooms</h3>
              <ul>
                {activeRooms.map((room) => {
                  return (
                    <li key={room.id} className={styles.gardenOpenRoomItem}>
                      <div>
                        <strong>Room {room.id.slice(0, 6)}</strong>
                        <small>{roomStatusLabel(room)} · {room.status.replace("_", " ")}</small>
                      </div>
                      <span className={styles.gardenOpenRoomActions}>
                        <button type="button" onClick={() => router.push(`/games/play/${room.id}`)}>Open</button>
                        <button type="button" onClick={() => void leaveOpenRoom(room.id)} disabled={leavingRoomId === room.id}>
                          {leavingRoomId === room.id ? "Leaving…" : "Leave"}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <button type="button" className={styles.createGardenRoom} onClick={() => void createRoom(selected ?? undefined)} disabled={busy || Boolean(outgoingInvite) || Boolean(incomingInvite)}>
            {selected ? <UsersRound size={19} /> : <Plus size={20} />}
            <span>{busy ? "Sending invite…" : outgoingInvite ? `Waiting for ${outgoingInvite.buddy}…` : selected ? `Invite ${selected.label}` : "Create a Morabaraba Room"}</span>
          </button>
          {outgoingInvite && <p className={styles.gardenInviteWaiting} role="status">Invite sent. The room opens for both of you when {outgoingInvite.buddy} accepts.</p>}
          <p className={styles.gardenPrivacyNote}><LockKeyhole size={13} /> Only broad distance rings are shown here.</p>
          {message && <p role="status" className={styles.gardenMessage}>{message}</p>}
        </footer>

        {incomingInvite && (
          <div className={styles.gardenInviteBackdrop} role="presentation">
            <section className={styles.gardenInviteDialog} role="dialog" aria-modal="true" aria-labelledby="garden-invite-title">
              <span className={styles.gardenInviteIcon}><Flower2 size={26} /></span>
              <p>Morabaraba invitation</p>
              <h2 id="garden-invite-title">A nearby Buddy wants to play.</h2>
              <small>Accept to join their private room. You can decline without sharing your exact location.</small>
              <div className={styles.gardenInviteActions}>
                <button type="button" onClick={() => void respondToInvite(false)} disabled={inviteBusy}>Decline</button>
                <button type="button" onClick={() => void respondToInvite(true)} disabled={inviteBusy}>{inviteBusy ? "One moment…" : "Accept & join"}</button>
              </div>
            </section>
          </div>
        )}

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





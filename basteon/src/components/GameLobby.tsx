"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "@/app/games/games.module.css";

export function GameLobby() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function createRoom() {
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
    const { data, error } = await db.rpc("game_create_room", { p_guest_id: null });
    if (error) {
      setMessage(error.message.includes("game_one_active_room") || error.message.includes("duplicate key")
        ? "You already have an open game room. Use its invite link to continue."
        : "A game room could not be created. Please try again.");
      setBusy(false);
      return;
    }
    router.push(`/games/play/${(data as { id: string }).id}`);
  }

  return (
    <main className={styles.page}>
      <div className={styles.routePage}>
        <section className={styles.routeCard}>
          <p className={styles.eyebrow}>Play with a buddy</p>
          <h1>Make a room, then invite them in.</h1>
          <p>Morabaraba is a two-player game. Your board and score are saved to the room and kept in sync while you play. The invite link is the only way into your private room.</p>
          <div className={styles.list}>
            <button type="button" className={styles.link} onClick={() => void createRoom()} disabled={busy}>{busy ? "Opening room…" : "Create a Morabaraba room"}</button>
            {message && <p role="status" className={styles.muted}>{message}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
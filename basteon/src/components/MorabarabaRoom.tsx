"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MorabarabaBoard } from "./MorabarabaBoard";
import styles from "./games.module.css";

type Player = 1 | 2;
type Snapshot = {
  board: Array<Player | 0>;
  turn: Player;
  phase: "place" | "move";
  placed: Record<"1" | "2", number>;
  pendingRemoval: Player | null;
  winner: Player | null;
};
type GameRoom = {
  id: string;
  host_id: string;
  guest_id: string | null;
  status: "waiting" | "playing" | "post_game" | "ended";
  state: Snapshot;
  version: number;
  round_no: number;
  host_wins: number;
  guest_wins: number;
  rematch_host: boolean;
  rematch_guest: boolean;
};
type GameMessage = { id: string; author_id: string; body: string; created_at: string };

export function MorabarabaRoom({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [userId, setUserId] = useState("");
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const db = createClient();
    let channel: ReturnType<typeof db.channel> | null = null;
    void (async () => {
      const { data: { user } } = await db.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      if (!active) return;
      setUserId(user.id);
      const { data, error } = await db.rpc("game_join_room", { p_host_id: roomId });
      if (error) {
        if (active) setMessage("This invite is unavailable or the room has already ended.");
        return;
      }
      const joined = data as GameRoom;
      if (!active) return;
      setRoom(joined);
      const { data: initialMessages } = await db.from("game_messages").select("id,author_id,body,created_at").eq("room_id", roomId).order("created_at");
      if (active) setMessages((initialMessages ?? []) as GameMessage[]);
      channel = db.channel(`morabaraba-${roomId}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` }, (payload) => {
          if (active) setRoom(payload.new as GameRoom);
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_messages", filter: `room_id=eq.${roomId}` }, (payload) => {
          if (active) setMessages((current) => current.some((item) => item.id === (payload.new as GameMessage).id) ? current : [...current, payload.new as GameMessage]);
        })
        .subscribe();
    })().catch(() => { if (active) setMessage("Could not connect to this game room."); }).finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      if (channel) void db.removeChannel(channel);
    };
  }, [roomId, router]);

  const act = useCallback(async (action: "place" | "move" | "remove", from?: number, to?: number) => {
    if (!room || busy) return;
    setBusy(true);
    setMessage("");
    const { data, error } = await createClient().rpc("game_apply_move", {
      p_room_id: room.id,
      p_action: action,
      p_from: from ?? null,
      p_to: to ?? null,
    });
    if (error) {
      const details: Record<string, string> = {
        not_your_turn: "It is your buddy’s turn.",
        not_adjacent: "Choose a connected point, or fly when you have three cows.",
        cannot_remove_mill: "Choose a cow outside a mill when one is available.",
      };
      setMessage(details[error.message] ?? "That move was not accepted. The board has not changed.");
    } else {
      setRoom(data as GameRoom);
    }
    setBusy(false);
  }, [room, busy]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!room || !draft.trim() || busy) return;
    setBusy(true);
    const body = draft.trim();
    const { data, error } = await createClient().rpc("game_send_message", { p_room_id: room.id, p_body: body });
    if (error) setMessage("Message could not be sent.");
    else {
      setDraft("");
      setMessages((current) => current.some((item) => item.id === (data as GameMessage).id) ? current : [...current, data as GameMessage]);
    }
    setBusy(false);
  }

  async function rematch() {
    if (!room || busy) return;
    setBusy(true);
    const { data, error } = await createClient().rpc("game_rematch", { p_room_id: room.id });
    if (error) setMessage("A new round could not be started.");
    else {
      const nextRoom = data as GameRoom;
      setRoom(nextRoom);
      if (nextRoom.status === "post_game") setMessage("Waiting for your buddy to agree to another round.");
    }
    setBusy(false);
  }

  async function reportBuddy() {
    if (!room || !window.confirm("Send a private safety report about this game to the Kiki team?")) return;
    const { error } = await createClient().rpc("game_report_room", {
      p_room_id: room.id,
      p_reason: "other",
      p_note: "Reported from a Morabaraba room.",
    });
    setMessage(error ? "The report could not be sent." : "Your report was sent privately.");
  }

  async function leave() {
    if (room) await createClient().rpc("game_leave_room", { p_room_id: room.id });
    router.push("/games/play");
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(window.location.href);
    setMessage("Invite link copied. Share it privately with your buddy.");
  }

  if (loading) return <main className={styles.page}><p className={styles.gameNote}>Opening your game…</p></main>;
  if (!room) return <main className={styles.page}><section className={styles.gameCard}><p className={styles.noticeBox}>{message || "This room could not be opened."}</p><button className={styles.softButton} onClick={() => router.push("/games/play")}>Back to games</button></section></main>;

  const player: Player = userId === room.host_id ? 1 : 2;
  const state = room.state;
  const turnLabel = state.pendingRemoval === player ? "Choose a buddy cow to remove" : state.turn === player ? "Your turn" : "Your buddy’s turn";
  const placed = state.placed ?? { "1": 0, "2": 0 };

  return (
    <main className={styles.page}>
      <div className={styles.roomLayout}>
        <section className={styles.gameCard}>
          <div className={styles.gameHeader}>
            <div><p className={styles.eyebrow}>Morabaraba · Round {room.round_no}</p><h1>Make a little space.</h1></div>
            <div className={styles.actionRow}>
              {room.status === "waiting" && <button className={styles.softButton} onClick={copyInvite}>Copy invite</button>}
              {room.guest_id && room.status !== "ended" && <button className={styles.softButton} onClick={reportBuddy}>Report</button>}
              <button className={styles.softButton} onClick={leave}>Leave</button>
            </div>
          </div>

          {room.status === "ended" ? (
            <div className={styles.noticeBox}>This game room has ended. You can return to the games hub.</div>
          ) : room.status === "waiting" ? (
            <div className={styles.noticeBox}>Waiting for your buddy. Send them this private room link to join.</div>
          ) : (
            <>
              <div className={styles.scoreRow}>
                <span className={styles.turnPill}>{turnLabel}</span>
                <span className={styles.turnPill}>You {player === 1 ? room.host_wins : room.guest_wins} · Buddy {player === 1 ? room.guest_wins : room.host_wins}</span>
                <span className={styles.turnPill}>Cows {placed[String(player) as "1" | "2"]}/12</span>
              </div>
              <MorabarabaBoard snapshot={state} player={player} busy={busy} onAction={(action, from, to) => void act(action, from, to)} />
              {state.pendingRemoval !== null && <div className={styles.noticeBox}>A mill! Remove one of your buddy’s cows.</div>}
              {state.winner && <div className={styles.noticeBox}>{state.winner === player ? "You won this round." : "Your buddy won this round."} <button className={styles.inlineButton} onClick={() => void rematch()}>{(player === 1 ? room.rematch_host : room.rematch_guest) ? "Waiting for buddy" : "Play again"}</button></div>}
              {!state.winner && <p className={styles.gameNote}>{state.phase === "place" ? "Place 12 cows each. Make three in a row to form a mill." : "Move along a line. With three cows left, you may fly to any open point."}</p>}
            </>
          )}
          {message && <p className={styles.gameNote} role="status">{message}</p>}
        </section>

        {room.status !== "waiting" && room.status !== "ended" && (
          <section className={styles.chatPanel} aria-label="Game chat">
            <div className={styles.chatHeading}><h2>Room chat</h2><span>Only you two</span></div>
            <div className={styles.chatMessages} aria-live="polite">
              {messages.map((item) => <p key={item.id} className={item.author_id === userId ? styles.ownMessage : styles.buddyMessage}><small>{item.author_id === userId ? "You" : "Buddy"}</small>{item.body}</p>)}
              {messages.length === 0 && <p className={styles.gameNote}>A quiet hello fits here.</p>}
            </div>
            <form className={styles.chatForm} onSubmit={sendMessage}>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} placeholder="Write a message" aria-label="Write a message" />
              <button className={styles.primaryButton} disabled={busy || !draft.trim()}>Send</button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
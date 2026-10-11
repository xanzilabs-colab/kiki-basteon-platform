"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bomb, BookOpen, Check, Flame, Link2, Sparkles, Trees } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Difficulty } from "@/lib/games/linkup/bot";
import type { Mode } from "@/lib/games/linkup/engine";
import styles from "./LinkupLobby.module.css";

const MODES: { id: Mode; name: string; icon: typeof Link2; rule: string; length: string; steps: [string, string, string] }[] = [
  { id: "classic", name: "Classic", icon: Link2, rule: "Race to make a word between two letters.", length: "10 rounds · ~3 min", steps: ["Pick the start and end letters.", "Find a word that fits both.", "Score points for speed and streaks."] },
  { id: "minefield", name: "Minefield", icon: Bomb, rule: "Avoid the two hidden mine letters.", length: "10 rounds · ~3 min", steps: ["Reveal the two mine letters.", "Watch the hint while you type.", "A mine in your word means no points."] },
  { id: "chain", name: "Chain", icon: Link2, rule: "Each valid word starts the next round.", length: "10 rounds · ~3 min", steps: ["Round one starts like Classic.", "The fastest valid word carries its last letter.", "No valid word? The chain breaks and resets."] },
  { id: "wildcard", name: "Wildcard", icon: Sparkles, rule: "A surprise modifier changes every round.", length: "10 rounds · ~3 min", steps: ["Watch the reel land on a modifier.", "Follow the rule shown above the board.", "Steal points by answering in under a second."] },
  { id: "bomb", name: "Hot Potato", icon: Flame, rule: "Pass the bomb before its shared fuse runs out.", length: "Until it explodes · ~1 min", steps: ["The holder answers between the letters.", "Correct words pass the bomb and add time.", "Wrong words cost time; let it hit zero and you lose."] },
];

type Room = {
  id: string;
  game: string;
  host_id: string;
  guest_id: string | null;
  status: string;
  host_ready: boolean;
  guest_ready: boolean;
  state: Record<string, unknown>;
};

export function LinkupLobby({ roomId, solo = false }: { roomId?: string; solo?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("classic");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [room, setRoom] = useState<Room | null>(null);
  const [userId, setUserId] = useState("");
  const [matchId, setMatchId] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const redirectingRef = useRef(false);

  const openRoomMatch = useCallback(async () => {
    if (!roomId || redirectingRef.current) return;
    const { data, error: matchError } = await createClient()
      .from("linkup_matches")
      .select("id")
      .eq("room_id", roomId)
      .maybeSingle();
    if (matchError) {
      setError("The match is ready, but its game room could not be opened. Please retry.");
      return;
    }
    if (!data) {
      return;
    }
    redirectingRef.current = true;
    router.replace(`/games/linkup/match/${data.id}`);
  }, [roomId, router]);

  const loadRoom = useCallback(async () => {
    if (!roomId) return;
    const db = createClient();
    const [{ data: { user } }, { data, error: roomError }] = await Promise.all([
      db.auth.getUser(),
      db.from("game_rooms").select("id,game,host_id,guest_id,status,host_ready,guest_ready,state").eq("id", roomId).maybeSingle(),
    ]);
    if (user) setUserId(user.id);
    if (roomError) setError("The game room could not be loaded. Please return to the Garden and try again.");
    else if (!data || data.game !== "linkup") setError("This Kiki Links room is no longer available.");
    else {
      const nextRoom = data as Room;
      setRoom(nextRoom);
      const liveMode = nextRoom.state?.linkupMode;
      if (typeof liveMode === "string" && MODES.some((item) => item.id === liveMode)) setMode(liveMode as Mode);
      if (nextRoom.status === "playing") await openRoomMatch();
    }
  }, [openRoomMatch, roomId]);

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    const db = createClient();
    void loadRoom();
    const poll = window.setInterval(() => void loadRoom(), 1500);
    const channel = db.channel(`linkup-lobby-${roomId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` }, ({ new: next }) => {
        if (active) {
          const nextRoom = next as Room;
          setRoom(nextRoom);
          const liveMode = nextRoom.state?.linkupMode;
          if (typeof liveMode === "string" && MODES.some((item) => item.id === liveMode)) setMode(liveMode as Mode);
          if (nextRoom.status === "playing") void openRoomMatch();
        }
      })
      .subscribe();
    return () => {
      active = false;
      window.clearInterval(poll);
      void db.removeChannel(channel);
    };
  }, [loadRoom, openRoomMatch, roomId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const db = createClient();
      const { data: { user } } = await db.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);
      const { data } = await db.from("linkup_preferences").select("mode").eq("user_id", user.id).maybeSingle();
      if (active && data && MODES.some((item) => item.id === data.mode)) setMode(data.mode as Mode);
    })();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!userId || !roomId) return;
    let active = true;
    void (async () => {
      const { error: preferenceError } = await createClient().from("linkup_preferences").upsert({ user_id: userId, mode });
      if (active && preferenceError) setError("Your last-used mode could not be saved.");
    })();
    return () => { active = false; };
  }, [mode, roomId, userId]);

  async function saveMode(next: Mode) {
    setMode(next);
    setError("");
    if (roomId && room && userId === room.host_id) {
      const { error: saveError } = await createClient().rpc("linkup_set_mode", { p_room_id: roomId, p_mode: next });
      if (saveError) setError(saveError.message === "mode_locked" ? "Mode is locked once either player is ready." : "Mode could not be saved.");
    } else if (!roomId && userId) {
      const { error: saveError } = await createClient().from("linkup_preferences").upsert({ user_id: userId, mode: next });
      if (saveError) setError("Your last-used mode could not be saved.");
    }
  }

  async function startBotMatch() {
    if (busy) return;
    setBusy(true);
    setError("");
    const { data, error: startError } = await createClient().rpc("linkup_create_bot_match", {
      p_mode: mode,
      p_difficulty: difficulty,
    });
    setBusy(false);
    if (startError) setError("Kiki could not start this match. Please try again.");
    else router.push(`/games/linkup/match/${(data as { id: string }).id}`);
  }

  async function setReady(ready: boolean) {
    if (!roomId || busy) return;
    setBusy(true);
    setError("");
    const { data, error: readyError } = await createClient().rpc("linkup_set_ready", {
      p_room_id: roomId,
      p_ready: ready,
    });
    setBusy(false);
    if (readyError) setError(readyError.message === "waiting_for_buddy" ? "Waiting for your Buddy to join the room." : "Ready status could not be saved.");
    else if (data) {
      redirectingRef.current = true;
      router.replace(`/games/linkup/match/${data as string}`);
    }
    await loadRoom();
  }

  const chosen = MODES.find((item) => item.id === mode) ?? MODES[0];
  const isHost = Boolean(room && room.host_id === userId);
  const myReady = room ? (isHost ? room.host_ready : room.guest_ready) : false;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href={solo ? "/games" : "/games/linkup"} aria-label="Back"><ArrowLeft size={18} /></Link>
          <div><small>KIKI LINKS</small><h1>{solo ? "Play with Kiki" : "Choose your mode"}</h1></div>
          <button type="button" onClick={() => setHelpOpen(true)} aria-label="How to play"><BookOpen size={19} /></button>
        </header>

        <p className={styles.intro}>{solo ? "Choose a way to play, then challenge Kiki." : "Pick the rules for your room. Your Buddy sees the mode live."}</p>

        <section className={styles.modeGrid} aria-label="Choose a game mode">
          {MODES.map(({ id, name, icon: Icon, rule, length }) => (
            <button
              key={id}
              type="button"
              className={`${styles.modeCard} ${mode === id ? styles.selected : ""}`}
              onClick={() => void saveMode(id)}
              disabled={Boolean(room && (!isHost || room.host_ready || room.guest_ready))}
              aria-pressed={mode === id}
            >
              <span className={styles.modeIcon}><Icon size={20} /></span>
              <span className={styles.modeTitle}>{name}</span>
              <span className={styles.modeRule}>{rule}</span>
              <span className={styles.modeLength}>{length}</span>
              {mode === id && <Check className={styles.check} size={16} />}
            </button>
          ))}
        </section>

        {solo && (
          <fieldset className={styles.difficulty}>
            <legend>Kiki's difficulty</legend>
            {(["easy", "medium", "hard"] as const).map((level) => (
              <button key={level} type="button" aria-pressed={difficulty === level} onClick={() => setDifficulty(level)}>
                {level[0].toUpperCase() + level.slice(1)}
              </button>
            ))}
          </fieldset>
        )}

        {roomId && room && (
          <section className={styles.readyPanel}>
            <h2>{room.guest_id ? "Both players are here" : "Waiting for your Buddy"}</h2>
            <p>{room.host_ready ? "Host is ready" : "Host is choosing the mode"} · {room.guest_ready ? "Buddy is ready" : "Buddy is choosing the mode"}</p>
            <button type="button" onClick={() => void setReady(!myReady)} disabled={busy || !room.guest_id}>
              {busy ? "Saving…" : myReady ? "Not ready" : "Ready"}
            </button>
          </section>
        )}

        {solo && !matchId && (
          <button className={styles.primary} type="button" onClick={() => void startBotMatch()} disabled={busy}>
            {busy ? "Starting…" : `Play ${chosen.name} with Kiki`}
          </button>
        )}

        {matchId && (
          <div className={styles.status} role="status">
            <Sparkles size={20} />
            <div><strong>Match created</strong><p>Preparing your first round…</p></div>
          </div>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}

        {helpOpen && (
          <div className={styles.backdrop} onClick={() => setHelpOpen(false)}>
            <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="linkup-help-title" onClick={(event) => event.stopPropagation()}>
              <div className={styles.sheetHandle} />
              <p className={styles.eyebrow}>HOW TO PLAY · {chosen.name.toUpperCase()}</p>
              <h2 id="linkup-help-title">{chosen.rule}</h2>
              <ol>{chosen.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
              <div className={styles.example} aria-label="Example word: S to T, smart">
                <span>S</span><i>m</i><i>a</i><i>r</i><span>T</span>
              </div>
              <button type="button" onClick={() => setHelpOpen(false)}>Got it</button>
            </section>
          </div>
        )}
      </div>
      <Trees className={styles.decoration} aria-hidden="true" />
    </main>
  );
}

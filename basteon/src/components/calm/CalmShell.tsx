"use client";

import Link from "next/link";
import { ArrowLeft, Flower2, Volume2, VolumeX, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "./calm.module.css";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function CalmShell({
  title,
  running = false,
  onStop,
  muted,
  onMuteChange,
  children,
}: {
  title: string;
  running?: boolean;
  onStop: () => void;
  muted: boolean;
  onMuteChange: (muted: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.brand} href={title === "Calm" ? "/account" : "/account/calm"} onClick={(event) => { if (running) { event.preventDefault(); onStop(); } }} aria-label={title === "Calm" ? "Back to account" : "Back to Calm"}><ArrowLeft size={20} /></Link>
          <div className={styles.headerTitle}>{title === "Calm" && <Flower2 size={22} />}{title}</div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.iconButton} onClick={() => onMuteChange(!muted)} aria-pressed={muted} aria-label={muted ? "Turn sound on" : "Mute sound"} title={muted ? "Turn sound on" : "Mute sound"}>
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <Link className={styles.iconButton} href="/account/calm/settings" aria-label="Calm settings" title="Calm settings"><Settings2 size={18} /></Link>
            {running && <button className={styles.stopButton} type="button" onClick={onStop} aria-label="Stop Calm session" title="Stop Calm session">Stop</button>}
          </div>
        </header>
        <main className={styles.content}>{children}</main>
        <p className={styles.disclaimer}>These are calming exercises, not medical advice.</p>
      </div>
    </div>
  );
}

export function usePersistentMute() {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    setMuted(localStorage.getItem("basteon-sound") === "off");
  }, []);
  function update(value: boolean) {
    setMuted(value);
    localStorage.setItem("basteon-sound", value ? "off" : "on");
  }
  return [muted, update] as const;
}

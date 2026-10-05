"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./games.module.css";

type Boat = {
  id: number;
  text: string;
  left: number;
  bottom: number;
  width: number;
  drift: number;
};

export function WorryBoatsGame() {
  const [draft, setDraft] = useState("");
  const [boats, setBoats] = useState<Boat[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBoats((current) => {
        const next = current
          .map((boat) => ({
            ...boat,
            left: boat.left + boat.drift,
            bottom: boat.bottom + 0.18,
          }))
          .filter((boat) => boat.left > -20 && boat.bottom < 110);

        return next;
      });
    }, 32);

    return () => window.clearInterval(timer);
  }, []);

  const launchBoat = (textOverride?: string) => {
    const value = (textOverride ?? draft).trim();
    const boatText = value || "Quiet worry";
    const width = Math.min(180, Math.max(110, boatText.length * 6.8));
    setBoats((current) => [
      ...current,
      {
        id: nextId.current++,
        text: boatText,
        left: -12,
        bottom: 30 + Math.random() * 24,
        width,
        drift: 0.7 + Math.random() * 0.5,
      },
    ]);
    setDraft("");
  };

  const helperText = useMemo(
    () => "Nothing you write here is saved or sent. When the boat leaves, so does the text.",
    [],
  );

  return (
    <section className={styles.gameCard}>
      <div className={styles.gameHeader}>
        <div>
          <p className={styles.eyebrow}>Worry Boats</p>
          <h2>Send the worry down the river.</h2>
        </div>
      </div>

      <div className={styles.boatRiver} aria-label="Worry river">
        <div className={styles.riverBank} />
        <div className={styles.riverBankRight} />
        {boats.map((boat) => (
          <div
            key={boat.id}
            className={styles.boat}
            style={{ left: `${boat.left}%`, bottom: `${boat.bottom}px`, width: `${boat.width}px` }}
          >
            <span>{boat.text}</span>
          </div>
        ))}
      </div>

      <div className={styles.boatForm}>
        <textarea
          value={draft}
          maxLength={200}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          data-lpignore="true"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a worry here, or launch without words."
        />
        <div className={styles.actionRow}>
          <button className={styles.primaryButton} onClick={() => launchBoat()}>Launch boat</button>
          <button className={styles.softButton} onClick={() => launchBoat("")}>Launch without words</button>
        </div>
        <p className={styles.gameNote}>{helperText}</p>
      </div>
    </section>
  );
}

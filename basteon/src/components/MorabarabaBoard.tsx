"use client";

import { useState } from "react";
import styles from "./games.module.css";

type Player = 1 | 2;
type Action = "place" | "move" | "remove";
type Snapshot = {
  board: Array<Player | 0>;
  turn: Player;
  phase: "place" | "move";
  placed: Record<"1" | "2", number>;
  pendingRemoval: Player | null;
  winner: Player | null;
};

const POINTS = [
  [10, 10], [50, 10], [90, 10], [90, 50], [90, 90], [50, 90], [10, 90], [10, 50],
  [25, 25], [50, 25], [75, 25], [75, 50], [75, 75], [50, 75], [25, 75], [25, 50],
  [40, 40], [50, 40], [60, 40], [60, 50], [60, 60], [50, 60], [40, 60], [40, 50],
] as const;

export function MorabarabaBoard({
  snapshot,
  player,
  busy,
  onAction,
}: {
  snapshot: Snapshot;
  player: Player;
  busy: boolean;
  onAction: (action: Action, from?: number, to?: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const canPlay = player === snapshot.turn && !snapshot.winner && !busy;

  function choosePoint(index: number) {
    if (!canPlay) return;
    if (snapshot.pendingRemoval === player) {
      onAction("remove", undefined, index);
      setSelected(null);
      return;
    }
    if (snapshot.phase === "place") {
      onAction("place", undefined, index);
      return;
    }
    if (snapshot.board[index] === player) {
      setSelected(index);
      return;
    }
    if (selected !== null && snapshot.board[index] === 0) {
      onAction("move", selected, index);
      setSelected(null);
    }
  }

  return (
    <div className={styles.boardWrap}>
      <svg viewBox="0 0 100 100" className={styles.board} role="group" aria-label="Morabaraba board">
        <rect x="10" y="10" width="80" height="80" />
        <rect x="25" y="25" width="50" height="50" />
        <rect x="40" y="40" width="20" height="20" />
        <path d="M50 10V40 M90 50H60 M50 90V60 M10 50H40" />
        {POINTS.map(([x, y], index) => {
          const piece = snapshot.board[index];
          return (
            <g key={index}>
              <circle
                cx={x}
                cy={y}
                r="6.5"
                fill="transparent"
                stroke="transparent"
                onClick={() => choosePoint(index)}
                style={{ cursor: canPlay ? "pointer" : "default" }}
                aria-label={`Point ${index + 1}${piece ? `, player ${piece}` : ", empty"}`}
              />
              <circle
                cx={x}
                cy={y}
                r={piece ? 3.4 : 1.8}
                className={piece === 1 ? styles.playerOneDot : piece === 2 ? styles.playerTwoDot : styles.boardDot}
                stroke={selected === index ? "#2d173a" : undefined}
                strokeWidth={selected === index ? 1.2 : undefined}
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
"use client";

import { useMemo, useState } from "react";
import styles from "./games.module.css";

type Player = 1 | 2;
type Board = Array<Player | 0>;

type Point = { x: number; y: number };

const POINTS: Point[] = [
  { x: 20, y: 20 }, { x: 50, y: 20 }, { x: 80, y: 20 },
  { x: 20, y: 50 }, { x: 50, y: 50 }, { x: 80, y: 50 },
  { x: 20, y: 80 }, { x: 50, y: 80 }, { x: 80, y: 80 },
  { x: 35, y: 35 }, { x: 50, y: 35 }, { x: 65, y: 35 },
  { x: 35, y: 50 }, { x: 65, y: 50 },
  { x: 35, y: 65 }, { x: 50, y: 65 }, { x: 65, y: 65 },
  { x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 },
  { x: 50, y: 20 }, { x: 50, y: 80 }, { x: 20, y: 50 }, { x: 80, y: 50 },
];

const ADJACENCY: Record<number, number[]> = {
  0: [1, 3, 9], 1: [0, 2, 10], 2: [1, 5, 11],
  3: [0, 4, 12], 4: [3, 5, 13], 5: [2, 4, 14],
  6: [7, 8, 15], 7: [6, 8, 16], 8: [5, 7, 17],
  9: [0, 10, 18], 10: [1, 9, 11, 19], 11: [2, 10, 20],
  12: [3, 13, 18], 13: [4, 12, 14, 19], 14: [5, 13, 20],
  15: [6, 16, 21], 16: [7, 15, 17, 19], 17: [8, 16, 22],
  18: [9, 12, 21], 19: [10, 13, 16, 23], 20: [11, 14, 22],
  21: [15, 18, 22], 22: [17, 20, 23], 23: [19, 22, 21],
};

const MILLS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [9, 10, 11], [12, 13, 14], [15, 16, 17],
  [18, 19, 20], [21, 22, 23],
  [0, 9, 18], [1, 10, 19], [2, 11, 20],
  [3, 12, 21], [4, 13, 22], [5, 14, 23],
  [6, 15, 21], [7, 16, 22], [8, 17, 23],
  [9, 12, 15], [10, 13, 16], [11, 14, 17],
  [18, 19, 20],
];

function hasMill(board: Board, player: Player, index: number) {
  return MILLS.some((line) => line.includes(index) && line.every((point) => board[point] === player));
}

function countPieces(board: Board, player: Player) {
  return board.filter((cell) => cell === player).length;
}

function getAvailableLegalMoves(board: Board, player: Player) {
  const occupied = board.map((cell, index) => (cell === player ? index : -1)).filter((value) => value >= 0);
  const moves: number[] = [];
  for (const start of occupied) {
    for (const candidate of ADJACENCY[start] ?? []) {
      if (board[candidate] === 0) moves.push(start * 100 + candidate);
    }
  }
  return moves;
}

export function MorabarabaGame() {
  const [board, setBoard] = useState<Board>(new Array(24).fill(0));
  const [turn, setTurn] = useState<Player>(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [phase, setPhase] = useState<"place" | "move">("place");
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const [winner, setWinner] = useState<string | null>(null);

  const pieces = useMemo(() => ({ 1: countPieces(board, 1), 2: countPieces(board, 2) }), [board]);

  const triggerRemoval = (nextBoard: Board, nextTurn: Player) => {
    const madeMill = nextBoard.some((cell, index) => cell === nextTurn && hasMill(nextBoard, nextTurn, index));
    if (madeMill) {
      setPendingRemoval(nextTurn);
      return true;
    }
    return false;
  };

  const handlePointClick = (index: number) => {
    if (winner) return;

    if (pendingRemoval !== null) {
      const opponent = pendingRemoval === 1 ? 2 : 1;
      if (board[index] !== opponent) return;
      const nextBoard = [...board];
      nextBoard[index] = 0;
      setBoard(nextBoard);
      setPendingRemoval(null);
      setTurn(opponent);
      setSelected(null);
      return;
    }

    if (board[index] === 0 && phase === "place") {
      const nextBoard = [...board];
      nextBoard[index] = turn;
      if (triggerRemoval(nextBoard, turn)) {
        setBoard(nextBoard);
        return;
      }
      setBoard(nextBoard);
      setTurn((turn === 1 ? 2 : 1) as Player);
      if (countPieces(nextBoard, 1) >= 3 && countPieces(nextBoard, 2) >= 3) {
        setPhase("move");
      }
      return;
    }

    if (phase === "move" && board[index] === turn) {
      setSelected(index);
      return;
    }

    if (phase === "move" && selected !== null && board[index] === 0 && ADJACENCY[selected]?.includes(index)) {
      const nextBoard = [...board];
      nextBoard[selected] = 0;
      nextBoard[index] = turn;
      if (triggerRemoval(nextBoard, turn)) {
        setBoard(nextBoard);
        setSelected(null);
        return;
      }
      setBoard(nextBoard);
      setSelected(null);
      setTurn((turn === 1 ? 2 : 1) as Player);
    }
  };

  const reset = () => {
    setBoard(new Array(24).fill(0));
    setTurn(1);
    setSelected(null);
    setPhase("place");
    setPendingRemoval(null);
    setWinner(null);
  };

  const canMove = useMemo(() => getAvailableLegalMoves(board, turn).length > 0, [board, turn]);
  if (pieces[1] <= 2 || pieces[2] <= 2 || !canMove) {
    if (!winner) setWinner(`${turn === 1 ? "Player 2" : "Player 1"} wins this round.`);
  }

  return (
    <section className={styles.gameCard}>
      <div className={styles.gameHeader}>
        <div>
          <p className={styles.eyebrow}>Morabaraba</p>
          <h2>Two-player quiet play.</h2>
        </div>
        <button className={styles.softButton} onClick={reset}>Reset</button>
      </div>

      <div className={styles.scoreRow}>
        <span className={styles.turnPill}>Turn: Player {turn}</span>
        <span className={styles.turnPill}>{pieces[1]} / {pieces[2]} cows</span>
      </div>

      <div className={styles.boardWrap}>
        <svg viewBox="0 0 100 100" className={styles.board} role="img" aria-label="Morabaraba board">
          <path d="M20 20 L80 20 L80 80 L20 80 Z" />
          <path d="M35 35 L65 35 L65 65 L35 65 Z" />
          <path d="M20 50 L80 50" />
          <path d="M50 20 L50 80" />
          <path d="M35 35 L65 65" />
          <path d="M65 35 L35 65" />
          <path d="M20 20 L35 35" />
          <path d="M80 20 L65 35" />
          <path d="M20 80 L35 65" />
          <path d="M80 80 L65 65" />
          {POINTS.map((point, index) => {
            const value = board[index];
            const isSelected = selected === index;
            return (
              <g key={index} onClick={() => handlePointClick(index)} style={{ cursor: "pointer" }}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={value === 0 ? 3.2 : 5.4}
                  className={value === 0 ? styles.boardDot : value === 1 ? styles.playerOneDot : styles.playerTwoDot}
                  fill={isSelected ? "#efe5de" : undefined}
                  stroke={isSelected ? "#2d173a" : "rgba(45,23,58,0.5)"}
                  strokeWidth={1.2}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {pendingRemoval !== null && (
        <div className={styles.noticeBox}>
          Remove one opponent cow by tapping it.
        </div>
      )}

      {winner && <div className={styles.noticeBox}>{winner}</div>}
    </section>
  );
}

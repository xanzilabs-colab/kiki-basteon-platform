"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import styles from "./games.module.css";
import { MorabarabaBoard } from "./MorabarabaBoard";

type Player = 1 | 2;
type Difficulty = "easy" | "medium" | "hard";
type Board = Array<Player | 0>;
type Phase = "place" | "move";
type Action = { type: "place"; to: number } | { type: "move"; from: number; to: number } | { type: "remove"; at: number };
type GameState = {
  board: Board;
  turn: Player;
  phase: Phase;
  placed: Record<"1" | "2", number>;
  pendingRemoval: Player | null;
  winner: Player | null;
};

const HUMAN: Player = 1;
const AI: Player = 2;
const MAX_COWS = 12;

const MILLS: number[][] = [
  [0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 7, 0],
  [8, 9, 10], [10, 11, 12], [12, 13, 14], [14, 15, 8],
  [16, 17, 18], [18, 19, 20], [20, 21, 22], [22, 23, 16],
  [1, 9, 17], [3, 11, 19], [5, 13, 21], [7, 15, 23],
];

const EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0],
  [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 8],
  [16, 17], [17, 18], [18, 19], [19, 20], [20, 21], [21, 22], [22, 23], [23, 16],
  [1, 9], [9, 17], [3, 11], [11, 19], [5, 13], [13, 21], [7, 15], [15, 23],
];

const ADJACENCY = Array.from({ length: 24 }, () => new Set<number>());
for (const [from, to] of EDGES) {
  ADJACENCY[from].add(to);
  ADJACENCY[to].add(from);
}

function other(player: Player): Player {
  return player === 1 ? 2 : 1;
}

function emptyState(): GameState {
  return {
    board: new Array(24).fill(0),
    turn: HUMAN,
    phase: "place",
    placed: { "1": 0, "2": 0 },
    pendingRemoval: null,
    winner: null,
  };
}

function pieceCount(board: Board, player: Player) {
  return board.filter((slot) => slot === player).length;
}

function inMill(board: Board, player: Player, index: number) {
  return MILLS.some((mill) => mill.includes(index) && mill.every((point) => board[point] === player));
}

function legalRemovals(board: Board, player: Player) {
  const rival = other(player);
  const rivalPoints = board.map((slot, index) => (slot === rival ? index : -1)).filter((index) => index >= 0);
  const outsideMills = rivalPoints.filter((index) => !inMill(board, rival, index));
  return outsideMills.length ? outsideMills : rivalPoints;
}

function canFly(board: Board, player: Player) {
  return pieceCount(board, player) === 3;
}

function legalMoveTargets(board: Board, player: Player, from: number) {
  if (canFly(board, player)) return board.map((slot, index) => slot === 0 ? index : -1).filter((index) => index >= 0);
  return Array.from(ADJACENCY[from]).filter((index) => board[index] === 0);
}

function legalActions(state: GameState, player: Player): Action[] {
  if (state.winner !== null) return [];
  if (state.pendingRemoval !== null) {
    if (state.pendingRemoval !== player) return [];
    return legalRemovals(state.board, player).map((at) => ({ type: "remove", at }));
  }

  if (state.turn !== player) return [];

  if (state.phase === "place" && state.placed[String(player) as "1" | "2"] < MAX_COWS) {
    return state.board.map((slot, index) => slot === 0 ? ({ type: "place", to: index } as Action) : null).filter(Boolean) as Action[];
  }

  const actions: Action[] = [];
  state.board.forEach((slot, from) => {
    if (slot !== player) return;
    legalMoveTargets(state.board, player, from).forEach((to) => actions.push({ type: "move", from, to }));
  });
  return actions;
}

function formsMillFromLanding(board: Board, player: Player, landing: number) {
  return MILLS.some((mill) => mill.includes(landing) && mill.every((point) => board[point] === player));
}

function evaluateWinner(state: GameState): Player | null {
  if (state.phase !== "move") return null;
  const p1 = pieceCount(state.board, 1);
  const p2 = pieceCount(state.board, 2);
  if (p1 < 3) return 2;
  if (p2 < 3) return 1;
  if (state.pendingRemoval === null && legalActions(state, state.turn).length === 0) return other(state.turn);
  return null;
}

function applyAction(state: GameState, player: Player, action: Action): GameState {
  const next: GameState = {
    board: [...state.board],
    turn: state.turn,
    phase: state.phase,
    placed: { ...state.placed },
    pendingRemoval: state.pendingRemoval,
    winner: state.winner,
  };

  if (next.winner !== null) return next;

  if (action.type === "remove") {
    next.board[action.at] = 0;
    next.pendingRemoval = null;
    next.turn = other(player);
  } else if (action.type === "place") {
    next.board[action.to] = player;
    next.placed[String(player) as "1" | "2"] += 1;
    const allPlaced = next.placed["1"] >= MAX_COWS && next.placed["2"] >= MAX_COWS;
    if (allPlaced) next.phase = "move";
    if (formsMillFromLanding(next.board, player, action.to)) {
      next.pendingRemoval = player;
      next.turn = player;
    } else {
      next.turn = other(player);
    }
  } else {
    next.board[action.from] = 0;
    next.board[action.to] = player;
    if (formsMillFromLanding(next.board, player, action.to)) {
      next.pendingRemoval = player;
      next.turn = player;
    } else {
      next.turn = other(player);
    }
  }

  next.winner = evaluateWinner(next);
  return next;
}

function randomPick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function countPotentialMills(board: Board, player: Player) {
  return MILLS.filter((mill) => {
    const mine = mill.filter((index) => board[index] === player).length;
    const empty = mill.filter((index) => board[index] === 0).length;
    return mine === 2 && empty === 1;
  }).length;
}

function scoreState(state: GameState, ai: Player) {
  const me = ai;
  const them = other(ai);
  const mePieces = pieceCount(state.board, me);
  const themPieces = pieceCount(state.board, them);
  const meMoves = legalActions({ ...state, turn: me, pendingRemoval: null }, me).filter((action) => action.type !== "remove").length;
  const themMoves = legalActions({ ...state, turn: them, pendingRemoval: null }, them).filter((action) => action.type !== "remove").length;
  const meThreats = countPotentialMills(state.board, me);
  const themThreats = countPotentialMills(state.board, them);
  const placedDelta = state.placed[String(me) as "1" | "2"] - state.placed[String(them) as "1" | "2"];
  return (mePieces - themPieces) * 160 + (meMoves - themMoves) * 18 + (meThreats - themThreats) * 14 + placedDelta * 4;
}

function minimax(state: GameState, depth: number, current: Player, ai: Player, alpha: number, beta: number): number {
  if (state.winner !== null) return state.winner === ai ? 10000 + depth : -10000 - depth;
  if (depth === 0) return scoreState(state, ai);

  const options = legalActions(state, current);
  if (options.length === 0) return scoreState(state, ai);

  if (current === ai) {
    let best = -Infinity;
    for (const action of options) {
      const score = minimax(applyAction(state, current, action), depth - 1, other(current), ai, alpha, beta);
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const action of options) {
    const score = minimax(applyAction(state, current, action), depth - 1, other(current), ai, alpha, beta);
    best = Math.min(best, score);
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function chooseAiAction(state: GameState, difficulty: Difficulty): Action | null {
  const options = legalActions(state, AI);
  if (options.length === 0) return null;

  if (difficulty === "easy") return randomPick(options);

  const immediateMill = options.filter((action) => {
    if (action.type === "remove") return false;
    const next = applyAction(state, AI, action);
    return next.pendingRemoval === AI;
  });
  if (immediateMill.length) {
    if (difficulty === "medium") return randomPick(immediateMill);
  }

  if (difficulty === "medium") {
    if (state.pendingRemoval === AI) {
      const ranked = options
        .filter((action): action is Extract<Action, { type: "remove" }> => action.type === "remove")
        .sort((a, b) => {
          const aScore = countPotentialMills(state.board.map((slot, index) => index === a.at ? 0 : slot) as Board, HUMAN);
          const bScore = countPotentialMills(state.board.map((slot, index) => index === b.at ? 0 : slot) as Board, HUMAN);
          return aScore - bScore;
        });
      return ranked[0] ?? randomPick(options);
    }
    return immediateMill[0] ?? randomPick(options);
  }

  const depth = state.phase === "place" ? 2 : 3;
  let bestAction: Action | null = null;
  let bestScore = -Infinity;
  for (const action of options) {
    const next = applyAction(state, AI, action);
    const score = minimax(next, depth, other(AI), AI, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }
  return bestAction ?? randomPick(options);
}

export function MorabarabaGame() {
  const [state, setState] = useState<GameState>(() => emptyState());
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [thinking, setThinking] = useState(false);

  const pieces = useMemo(() => ({ 1: pieceCount(state.board, 1), 2: pieceCount(state.board, 2) }), [state.board]);

  useEffect(() => {
    if (state.winner !== null) return;
    const aiTurn = state.pendingRemoval === AI || (state.pendingRemoval === null && state.turn === AI);
    if (!aiTurn) return;
    setThinking(true);
    const timer = window.setTimeout(() => {
      const action = chooseAiAction(state, difficulty);
      if (!action) {
        setState((current) => ({ ...current, winner: HUMAN }));
      } else {
        setState((current) => applyAction(current, AI, action));
      }
      setThinking(false);
    }, difficulty === "hard" ? 480 : 260);
    return () => window.clearTimeout(timer);
  }, [difficulty, state]);

  function performHuman(action: Action) {
    if (state.winner !== null || thinking) return;
    const humanTurn = state.pendingRemoval === HUMAN || (state.pendingRemoval === null && state.turn === HUMAN);
    if (!humanTurn) return;
    const allowed = legalActions(state, HUMAN).some((candidate) => JSON.stringify(candidate) === JSON.stringify(action));
    if (!allowed) return;
    setState((current) => applyAction(current, HUMAN, action));
  }

  function reset() {
    setState(emptyState());
    setThinking(false);
  }

  const turnLabel = state.winner
    ? (state.winner === HUMAN ? "You won this round." : "Kiki AI won this round.")
    : state.pendingRemoval === HUMAN
      ? "Mill! Remove one Kiki cow."
      : state.pendingRemoval === AI
        ? "Kiki made a mill and is capturing."
        : state.turn === HUMAN
          ? "Your turn"
          : thinking
            ? "Kiki is thinking…"
            : "Kiki's turn";

  return (
    <main className={`${styles.page} ${styles.morabarabaPage}`}>
      <div className={styles.morabarabaAmbient} aria-hidden="true">
        <span className={styles.ambientBloomOne} />
        <span className={styles.ambientBloomTwo} />
        <span className={styles.ambientBloomThree} />
      </div>
      <div className={styles.roomLayout}>
        <section className={`${styles.gameCard} ${styles.morabarabaCard}`}>
          <div className={styles.gameHeader}>
            <div>
              <p className={styles.eyebrow}>Morabaraba · Solo mode</p>
              <h1>Play Kiki AI</h1>
            </div>
            <div className={styles.actionRow}>
              <Link className={styles.softButton} href="/games/play"><ArrowLeft size={14} />Back to Buddy lobby</Link>
              <button className={styles.softButton} onClick={reset}>Reset</button>
            </div>
          </div>

          <div className={styles.scoreRow}>
            <span className={styles.turnPill}>{turnLabel}</span>
            <span className={styles.turnPill}>Cows · You {pieces[1]} · Kiki {pieces[2]}</span>
          </div>

          <div className={styles.scoreRow}>
            <span className={styles.turnPill}>AI Difficulty</span>
            <select className="input h-9 w-[180px]" value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)} disabled={thinking}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <MorabarabaBoard
            snapshot={state}
            player={HUMAN}
            busy={thinking}
            onAction={(action, from, to) => {
              if (action === "place" && typeof to === "number") performHuman({ type: "place", to });
              if (action === "move" && typeof from === "number" && typeof to === "number") performHuman({ type: "move", from, to });
              if (action === "remove" && typeof to === "number") performHuman({ type: "remove", at: to });
            }}
          />

          {!state.winner && state.pendingRemoval === null && (
            <p className={styles.gameNote}>
              {state.phase === "place"
                ? "Place 12 cows each. Making three in a row creates a mill and lets you remove one opponent cow."
                : "Move along connected lines. When you have three cows left, you may fly to any open point."}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

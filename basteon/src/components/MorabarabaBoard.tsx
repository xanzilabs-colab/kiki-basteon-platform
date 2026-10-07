"use client";

import { useEffect, useId, useRef, useState } from "react";
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
const EMPTY_BOARD: Snapshot["board"] = new Array(24).fill(0);
type BoardMotion =
  | { kind: "move"; player: Player; from: number; to: number; id: number }
  | { kind: "capture"; player: Player; at: number; id: number }
  | { kind: "place"; player: Player; at: number; id: number };

const POINTS = [
  [10, 10], [50, 10], [90, 10], [90, 50], [90, 90], [50, 90], [10, 90], [10, 50],
  [25, 25], [50, 25], [75, 25], [75, 50], [75, 75], [50, 75], [25, 75], [25, 50],
  [40, 40], [50, 40], [60, 40], [60, 50], [60, 60], [50, 60], [40, 60], [40, 50],
] as const;

const MILLS = [
  [0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 7, 0],
  [8, 9, 10], [10, 11, 12], [12, 13, 14], [14, 15, 8],
  [16, 17, 18], [18, 19, 20], [20, 21, 22], [22, 23, 16],
  [1, 9, 17], [3, 11, 19], [5, 13, 21], [7, 15, 23],
];

const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0],
  [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 8],
  [16, 17], [17, 18], [18, 19], [19, 20], [20, 21], [21, 22], [22, 23], [23, 16],
  [1, 9], [9, 17], [3, 11], [11, 19], [5, 13], [13, 21], [7, 15], [15, 23],
] as const;
const ADJACENCY = Array.from({ length: 24 }, () => new Set<number>());
for (const [from, to] of EDGES) {
  ADJACENCY[from].add(to);
  ADJACENCY[to].add(from);
}

function inMill(board: Snapshot["board"], player: Player, index: number) {
  return MILLS.some((mill) => mill.includes(index) && mill.every((point) => board[point] === player));
}

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
  const [motion, setMotion] = useState<BoardMotion | null>(null);
  const board = Array.isArray(snapshot?.board) && snapshot.board.length === 24 ? snapshot.board : EMPTY_BOARD;
  const previousBoard = useRef([...board]);
  const motionId = useRef(0);
  const idPrefix = useId().replace(/:/g, "");
  const canPlay = player === snapshot.turn && !snapshot.winner && !busy && (snapshot.pendingRemoval === null || snapshot.pendingRemoval === player);
  const opponent = player === 1 ? 2 : 1;
  const opponentPieces = board.map((piece, index) => piece === opponent ? index : -1).filter((index) => index >= 0);
  const canRemoveAnyCow = opponentPieces.some((index) => !inMill(board, opponent, index));
  const ownPieces = board.filter((piece) => piece === player).length;
  const canFly = ownPieces === 3;

  useEffect(() => {
    const before = previousBoard.current;
    const after = board;
    const removed = before.map((piece, index) => piece !== 0 && after[index] === 0 ? index : -1).filter((index) => index >= 0);
    const added = after.map((piece, index) => piece !== 0 && before[index] === 0 ? index : -1).filter((index) => index >= 0);
    let nextMotion: BoardMotion | null = null;
    if (removed.length === 1 && added.length === 1 && before[removed[0]] === after[added[0]]) {
      nextMotion = { kind: "move", player: after[added[0]] as Player, from: removed[0], to: added[0], id: ++motionId.current };
    } else if (removed.length === 1 && added.length === 0) {
      nextMotion = { kind: "capture", player: before[removed[0]] as Player, at: removed[0], id: ++motionId.current };
    } else if (removed.length === 0 && added.length === 1) {
      nextMotion = { kind: "place", player: after[added[0]] as Player, at: added[0], id: ++motionId.current };
    }
    previousBoard.current = [...after];
    if (!nextMotion) return;
    setMotion(nextMotion);
    const timer = window.setTimeout(() => setMotion((current) => current?.id === nextMotion?.id ? null : current), nextMotion.kind === "move" ? 420 : 360);
    return () => window.clearTimeout(timer);
  }, [board]);

  useEffect(() => { setSelected(null); }, [snapshot.turn, snapshot.phase, snapshot.pendingRemoval]);

  function choosePoint(index: number) {
    if (!canPlay) return;
    if (snapshot.pendingRemoval === player) {
      if (board[index] !== opponent || (canRemoveAnyCow && inMill(board, opponent, index))) return;
      onAction("remove", undefined, index);
      setSelected(null);
      return;
    }
    if (snapshot.phase === "place") {
      if (board[index] !== 0) return;
      onAction("place", undefined, index);
      return;
    }
    if (board[index] === player) {
      setSelected((current) => current === index ? null : index);
      return;
    }
    if (selected !== null && board[index] === 0 && (canFly || ADJACENCY[selected].has(index))) {
      onAction("move", selected, index);
      setSelected(null);
    }
  }

  const canRemove = (index: number) => snapshot.pendingRemoval === player
    && board[index] === opponent
    && (!canRemoveAnyCow || !inMill(board, opponent, index));
  const isMoveTarget = (index: number) => canPlay && snapshot.phase === "move" && selected !== null
    && board[index] === 0 && (canFly || ADJACENCY[selected].has(index));
  const renderToken = (piece: Player, index: number, isSelected = false, isRemovable = false) => {
    const spots = [
      [[-1.1, -1, 1.2, 0.8, -25], [1.25, 1.1, 0.85, 0.65, 20]],
      [[0.9, -1.1, 1.1, 0.78, 25], [-1.35, 0.9, 0.9, 0.65, -18]],
      [[-0.1, -0.25, 0.85, 1.35, 0], [1.55, -1.5, 0.55, 0.5, 0]],
    ][index % 3];
    const clipId = `${idPrefix}-cow-${piece}-clip`;
    const isPlayerOne = piece === 1;
    return (
      <g className={`${styles.tokenFace} ${isSelected ? styles.tokenSelected : ""} ${isRemovable ? styles.tokenRemovable : ""}`}>
        <circle cy="0.6" r="3.45" className={styles.tokenRim} />
        <circle r="3.15" fill={isPlayerOne ? `url(#${idPrefix}-cow-one)` : `url(#${idPrefix}-cow-two)`} />
        <g clipPath={`url(#${clipId})`}>
          {spots.map(([cx, cy, rx, ry, angle], spotIndex) => (
            <ellipse
              key={spotIndex}
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              transform={`rotate(${angle} ${cx} ${cy})`}
              fill={isPlayerOne ? (spotIndex ? "#5a301b" : "#f6dfb6") : (spotIndex ? "#8a705a" : "#29201d")}
            />
          ))}
        </g>
        <circle r="3.15" fill={`url(#${idPrefix}-cow-shade)`} />
        <ellipse cx="-0.95" cy="-1.55" rx="1.4" ry="0.72" transform="rotate(-28 -0.95 -1.55)" fill={`url(#${idPrefix}-cow-gloss)`} />
        {isSelected && <circle r="3.8" className={styles.tokenSelectionRing} />}
        {isRemovable && <circle r="4.15" className={styles.tokenRemovalRing} />}
      </g>
    );
  };

  return (
    <div className={`${styles.boardWrap} ${styles.morabarabaBoardWrap}`}>
      <svg viewBox="0 0 100 100" className={`${styles.board} ${styles.roomBoard}`} role="group" aria-label="Morabaraba board">
        <defs>
          <linearGradient id={`${idPrefix}-wood`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#dfa86a" />
            <stop offset=".52" stopColor="#b9763c" />
            <stop offset="1" stopColor="#874a2c" />
          </linearGradient>
          <linearGradient id={`${idPrefix}-cow-one`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f4d5a6" />
            <stop offset=".48" stopColor="#bd8050" />
            <stop offset="1" stopColor="#754027" />
          </linearGradient>
          <linearGradient id={`${idPrefix}-cow-two`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff6df" />
            <stop offset=".5" stopColor="#d8c6a8" />
            <stop offset="1" stopColor="#a89881" />
          </linearGradient>
          <radialGradient id={`${idPrefix}-cow-shade`}>
            <stop offset=".65" stopColor="#21150e" stopOpacity="0" />
            <stop offset="1" stopColor="#21150e" stopOpacity=".45" />
          </radialGradient>
          <linearGradient id={`${idPrefix}-cow-gloss`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".72" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${idPrefix}-socket`} cx=".32" cy=".25" r=".8">
            <stop offset="0" stopColor="#70472b" />
            <stop offset="1" stopColor="#28170f" />
          </radialGradient>
          <clipPath id={`${idPrefix}-cow-1-clip`}><circle r="3.15" /></clipPath>
          <clipPath id={`${idPrefix}-cow-2-clip`}><circle r="3.15" /></clipPath>
          <linearGradient id={`${idPrefix}-brass`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff0b8" />
            <stop offset=".55" stopColor="#cf9b40" />
            <stop offset="1" stopColor="#704716" />
          </linearGradient>
          <pattern id={`${idPrefix}-grain`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <path d="M0 0V8 M4 0V8" stroke="#ffe2b4" strokeOpacity=".09" strokeWidth=".6" />
            <path d="M2 0V8" stroke="#35190f" strokeOpacity=".1" strokeWidth=".7" />
          </pattern>
          <radialGradient id={`${idPrefix}-vignette`}>
            <stop offset=".55" stopColor="#281307" stopOpacity="0" />
            <stop offset="1" stopColor="#281307" stopOpacity=".36" />
          </radialGradient>
          <filter id={`${idPrefix}-board-shadow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation=".7" />
          </filter>
          <filter id={`${idPrefix}-token-shadow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation=".7" />
          </filter>
          <radialGradient id={`${idPrefix}-point`} cx=".3" cy=".25" r=".8">
            <stop offset="0" stopColor="#ffe9bd" />
            <stop offset="1" stopColor="#9d612f" />
          </radialGradient>
        </defs>
        <rect x="1" y="1" width="98" height="98" rx="7" className={styles.boardOuterRim} />
        <rect x="3" y="3" width="94" height="94" rx="6" fill={`url(#${idPrefix}-wood)`} />
        <rect x="3" y="3" width="94" height="94" rx="6" fill={`url(#${idPrefix}-grain)`} />
        <rect x="4" y="4" width="92" height="92" rx="5.5" className={styles.boardInnerRim} />
        <rect x="5.5" y="5.5" width="89" height="89" rx="4" className={styles.beadShadow} />
        <g className={styles.beadwork}>
          <rect x="5.5" y="5.5" width="89" height="89" rx="4" stroke="#d9452f" />
          <rect x="5.5" y="5.5" width="89" height="89" rx="4" stroke="#f3b53f" strokeDashoffset="-1.15" />
          <rect x="5.5" y="5.5" width="89" height="89" rx="4" stroke="#2a9d8f" strokeDashoffset="-2.3" />
        </g>
        <rect x="3" y="3" width="94" height="94" rx="6" fill={`url(#${idPrefix}-vignette)`} pointerEvents="none" />
        {[[7, 7], [93, 7], [7, 93], [93, 93]].map(([x, y], index) => (
          <g key={`stud-${index}`} pointerEvents="none">
            <circle cx={x} cy={y} r="1.65" className={styles.boardStudShadow} />
            <circle cx={x} cy={y} r="1.3" fill={`url(#${idPrefix}-brass)`} className={styles.boardStud} />
            <path d={`M${x - 0.7} ${y}h1.4 M${x} ${y - 0.7}v1.4`} className={styles.boardStudMark} />
          </g>
        ))}
        <g className={styles.boardLines}>
          <rect x="10" y="10" width="80" height="80" />
          <rect x="25" y="25" width="50" height="50" />
          <rect x="40" y="40" width="20" height="20" />
          <path d="M50 10V40 M90 50H60 M50 90V60 M10 50H40" />
          <circle cx="50" cy="50" r="6.5" className={styles.boardRosette} />
          <circle cx="50" cy="50" r="1.4" className={styles.boardRosetteCenter} />
          {Array.from({ length: 12 }, (_, index) => {
            const angle = (index * Math.PI) / 6;
            return <line key={index} x1={50 + Math.cos(angle) * 2.8} y1={50 + Math.sin(angle) * 2.8} x2={50 + Math.cos(angle) * 5.5} y2={50 + Math.sin(angle) * 5.5} className={styles.boardRosetteRay} />;
          })}
        </g>
        {snapshot.pendingRemoval !== null && MILLS
          .filter((mill) => mill.every((index) => board[index] === snapshot.pendingRemoval))
          .map((mill) => (
            <path
              key={`mill-${mill[0]}-${mill[1]}-${mill[2]}`}
              d={`M${POINTS[mill[0]][0]} ${POINTS[mill[0]][1]}L${POINTS[mill[1]][0]} ${POINTS[mill[1]][1]}L${POINTS[mill[2]][0]} ${POINTS[mill[2]][1]}`}
              className={styles.millFlash}
              pointerEvents="none"
            />
          ))}
        {POINTS.map(([x, y], index) => (
          <g key={`socket-${index}`} pointerEvents="none">
            <circle cx={x + 0.25} cy={y + 0.35} r="2.75" fill="#31180e" opacity=".45" filter={`url(#${idPrefix}-board-shadow)`} />
            <circle cx={x} cy={y} r="2.65" fill={`url(#${idPrefix}-socket)`} className={styles.boardSocket} />
            <circle cx={x - 0.25} cy={y - 0.32} r="1.6" className={styles.boardSocketInner} />
          </g>
        ))}
        {POINTS.map(([x, y], index) => {
          const piece = board[index];
          const showPiece = piece !== 0 && !(motion?.kind === "move" && motion.to === index);
          const target = isMoveTarget(index);
          const removable = canRemove(index);
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
                role="button"
                tabIndex={canPlay ? 0 : -1}
                aria-pressed={selected === index}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choosePoint(index); } }}
                aria-label={`Point ${index + 1}${removable ? ", remove this buddy cow" : target ? ", legal move target" : piece ? `, player ${piece}` : ", empty"}`}
              />
              {target && <circle cx={x} cy={y} r="4.8" className={styles.legalTarget} pointerEvents="none" />}
              {showPiece && (
                <g transform={`translate(${x} ${y})`} pointerEvents="none">
                  <g className={motion?.kind === "place" && motion.at === index ? styles.tokenDrop : ""}>
                    {renderToken(piece as Player, index, selected === index, removable)}
                  </g>
                </g>
              )}
              {removable && !showPiece && <circle cx={x} cy={y} r="4.8" className={styles.removalTarget} pointerEvents="none" />}
            </g>
          );
        })}
        {motion?.kind === "move" && (
          <g className={styles.movingPiece} pointerEvents="none">
            <animateTransform
              attributeName="transform"
              type="translate"
              from={`${POINTS[motion.from][0]} ${POINTS[motion.from][1]}`}
              to={`${POINTS[motion.to][0]} ${POINTS[motion.to][1]}`}
              dur=".36s"
              calcMode="spline"
              keyTimes="0;1"
              keySplines=".2 .8 .25 1"
              fill="freeze"
            />
            {renderToken(motion.player, motion.to)}
          </g>
        )}
        {motion?.kind === "capture" && (
          <g transform={`translate(${POINTS[motion.at][0]} ${POINTS[motion.at][1]})`} pointerEvents="none">
            <g className={styles.capturedPiece}>
              <animateTransform attributeName="transform" type="scale" values="1;1.25;0" dur=".34s" fill="freeze" />
              {renderToken(motion.player, motion.at)}
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { gestureReducer, HOLD_MS, type Point, type SosType, type SosVia, typeSourceFor } from "@/lib/sos/sosGesture";

type Selection = (type: SosType, source: ReturnType<typeof typeSourceFor>) => void;

export function useSosGesture(onSelect: Selection) {
  const [state, dispatch] = useReducer(gestureReducer, { phase: "idle" });
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const previousHolding = useRef(false);
  const previousArmed = useRef(false);
  const handledDone = useRef(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  const bubbleCenter = useCallback((): Point | null => {
    const rect = bubbleRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (state.phase !== "idle") return;
    event.preventDefault();
    pointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setAnchor(event.currentTarget.getBoundingClientRect());
    dispatch({ kind: "down", pos: { x: event.clientX, y: event.clientY }, at: Date.now() });
    timer.current = window.setTimeout(() => dispatch({ kind: "holdTimer" }), HOLD_MS);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerId.current !== event.pointerId) return;
    dispatch({ kind: "move", pos: { x: event.clientX, y: event.clientY }, bubble: bubbleCenter() });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    clearTimer();
    dispatch({ kind: "up", pos: { x: event.clientX, y: event.clientY }, bubble: bubbleCenter() });
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    clearTimer();
    dispatch({ kind: "cancel" });
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    clearTimer();
    dispatch({ kind: "cancel" });
  };

  useEffect(() => () => clearTimer(), [clearTimer]);

  useEffect(() => {
    const holding = state.phase === "holding";
    const armed = holding && state.armed;
    if (holding && !previousHolding.current) navigator.vibrate?.(10);
    if (armed && !previousArmed.current) navigator.vibrate?.(15);
    previousHolding.current = holding;
    previousArmed.current = armed;

    if (state.phase !== "done" || handledDone.current) return;
    handledDone.current = true;
    navigator.vibrate?.([30, 40, 30]);
    selectRef.current(state.type, typeSourceFor(state.via));
    dispatch({ kind: "reset" });
    pointerId.current = null;
    clearTimer();
    setAnchor(null);
    handledDone.current = false;
  }, [state, clearTimer]);

  useEffect(() => {
    if (state.phase === "idle") {
      previousHolding.current = false;
      previousArmed.current = false;
    }
  }, [state.phase]);

  return {
    state,
    anchor,
    bubbleRef,
    buttonProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture },
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
  };
}
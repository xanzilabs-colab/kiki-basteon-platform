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

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (pointerId.current !== event.pointerId) return;
      dispatch({ kind: "move", pos: { x: event.clientX, y: event.clientY }, bubble: bubbleCenter() });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pointerId.current !== event.pointerId) return;
      pointerId.current = null;
      clearTimer();
      dispatch({ kind: "up", pos: { x: event.clientX, y: event.clientY }, bubble: bubbleCenter() });
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (pointerId.current !== event.pointerId) return;
      pointerId.current = null;
      clearTimer();
      dispatch({ kind: "cancel" });
    };
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    return () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
    };
  }, [bubbleCenter, clearTimer]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (state.phase !== "idle") return;
    event.preventDefault();
    pointerId.current = event.pointerId;
    setAnchor(event.currentTarget.getBoundingClientRect());
    dispatch({ kind: "down", pos: { x: event.clientX, y: event.clientY }, at: Date.now() });
    timer.current = window.setTimeout(() => dispatch({ kind: "holdTimer" }), HOLD_MS);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window-level pointer listeners keep the gesture working if capture is unavailable.
    }
  };

  useEffect(() => () => clearTimer(), [clearTimer]);

  useEffect(() => {
    if (state.phase !== "done" || handledDone.current) return;
    handledDone.current = true;
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([30, 40, 30]);
    } catch {
      // Haptics are best-effort.
    }
    selectRef.current(state.type, typeSourceFor(state.via));
    dispatch({ kind: "reset" });
    pointerId.current = null;
    clearTimer();
    setAnchor(null);
    handledDone.current = false;
  }, [state, clearTimer]);

  return {
    state,
    anchor,
    bubbleRef,
    buttonProps: { onPointerDown },
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
  };
}
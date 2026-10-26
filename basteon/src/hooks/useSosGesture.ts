"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from "react";
import { gestureReducer, HOLD_MS, type Point, type SosType, type SosVia, typeSourceFor } from "@/lib/sos/sosGesture";

type Selection = (type: SosType, source: ReturnType<typeof typeSourceFor>) => void;

export function useSosGesture(onSelect: Selection) {
  const [state, dispatch] = useReducer(gestureReducer, { phase: "idle" });
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const touchId = useRef<number | null>(null);
  const lastPointerActivationAt = useRef(0);
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

  const begin = useCallback((pos: Point, rect: DOMRect) => {
    lastPointerActivationAt.current = Date.now();
    setAnchor(rect);
    dispatch({ kind: "down", pos, at: Date.now() });
    clearTimer();
    timer.current = window.setTimeout(() => dispatch({ kind: "holdTimer" }), HOLD_MS);
  }, [clearTimer]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (pointerId.current !== event.pointerId) return;
      dispatch({ kind: "move", pos: { x: event.clientX, y: event.clientY }, bubble: bubbleCenter() });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pointerId.current !== event.pointerId) return;
      pointerId.current = null;
      touchId.current = null;
      clearTimer();
      dispatch({ kind: "up", pos: { x: event.clientX, y: event.clientY }, bubble: bubbleCenter() });
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (pointerId.current !== event.pointerId) return;
      pointerId.current = null;
      if (touchId.current !== null) return;
      clearTimer();
      dispatch({ kind: "cancel" });
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = Array.from(event.touches).find((item) => item.identifier === touchId.current);
      if (!touch || pointerId.current !== null) return;
      event.preventDefault();
      dispatch({
        kind: "move",
        pos: { x: touch.clientX, y: touch.clientY },
        bubble: bubbleCenter(),
      });
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = Array.from(event.changedTouches).find((item) => item.identifier === touchId.current);
      if (!touch) return;
      touchId.current = null;
      if (pointerId.current !== null) return;
      clearTimer();
      dispatch({
        kind: "up",
        pos: { x: touch.clientX, y: touch.clientY },
        bubble: bubbleCenter(),
      });
    };
    const onTouchCancel = (event: TouchEvent) => {
      if (!Array.from(event.changedTouches).some((item) => item.identifier === touchId.current)) return;
      touchId.current = null;
      if (pointerId.current !== null) return;
      clearTimer();
      dispatch({ kind: "cancel" });
    };
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    window.addEventListener("touchend", onTouchEnd, true);
    window.addEventListener("touchcancel", onTouchCancel, true);
    return () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("touchmove", onTouchMove, true);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("touchcancel", onTouchCancel, true);
    };
  }, [bubbleCenter, clearTimer]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (state.phase !== "idle") return;
    event.preventDefault();
    pointerId.current = event.pointerId;
    begin({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect());
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Window-level pointer listeners keep the gesture working if capture is unavailable.
    }
  };

  const onTouchStart = (event: ReactTouchEvent<HTMLButtonElement>) => {
    if (!event.changedTouches.length) return;
    const touch = event.changedTouches[0];
    if (pointerId.current !== null) {
      touchId.current = touch.identifier;
      return;
    }
    if (state.phase !== "idle") return;
    event.preventDefault();
    touchId.current = touch.identifier;
    begin({ x: touch.clientX, y: touch.clientY }, event.currentTarget.getBoundingClientRect());
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
    touchId.current = null;
    clearTimer();
    setAnchor(null);
    handledDone.current = false;
  }, [state, clearTimer]);

  return {
    state,
    anchor,
    bubbleRef,
    isPointerActivationRecent: () => Date.now() - lastPointerActivationAt.current < 1_000,
    buttonProps: { onPointerDown, onTouchStart },
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
  };
}
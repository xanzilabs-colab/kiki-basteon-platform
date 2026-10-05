"use client";

import { useEffect } from "react";
import { playTouchSound, unlockAlertSound } from "@/lib/alertSound";

const interactiveSelector = "button:not(:disabled), a[href], [role='button']";

export function TouchSound() {
  useEffect(() => {
    let lastPlayed = 0;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest(interactiveSelector) : null;
      if (!target || target.matches(".btn-danger, .account-mobile-sos, [data-no-touch-sound]")) return;
      const now = performance.now();
      if (now - lastPlayed < 90) return;
      lastPlayed = now;
      void unlockAlertSound().then(playTouchSound).catch(() => undefined);
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, []);

  return null;
}
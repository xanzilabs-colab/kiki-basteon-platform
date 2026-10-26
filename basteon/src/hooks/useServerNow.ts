"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

const RESYNC_MS = 5 * 60_000;
const REFRESH_MS = 30_000;
let clockOffsetMs = 0;
let lastSyncAt = 0;
let syncRequest: Promise<number> | null = null;
let syncErrorShown = false;

async function syncClock(): Promise<number> {
  if (lastSyncAt && Date.now() - lastSyncAt < RESYNC_MS) return clockOffsetMs;
  if (syncRequest) return syncRequest;

  syncRequest = (async () => {
    const requestStartedAt = Date.now();
    const response = await fetch("/api/time", { cache: "no-store" });
    if (!response.ok) throw new Error("Server time could not be loaded.");
    const result = await response.json() as { now?: unknown };
    const serverTime = typeof result.now === "string" ? Date.parse(result.now) : Number.NaN;
    if (!Number.isFinite(serverTime)) throw new Error("Server returned an invalid time.");
    const responseReceivedAt = Date.now();
    clockOffsetMs = serverTime - (requestStartedAt + responseReceivedAt) / 2;
    lastSyncAt = responseReceivedAt;
    return clockOffsetMs;
  })();

  try {
    return await syncRequest;
  } finally {
    syncRequest = null;
  }
}

export function useServerNow() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        const offset = await syncClock();
        if (active) setNow(new Date(Date.now() + offset));
        syncErrorShown = false;
      } catch (error) {
        console.error("Relative-time clock synchronization failed", error);
        if (!syncErrorShown) {
          toast.error("Could not sync the device clock. Relative times may be inaccurate.");
          syncErrorShown = true;
        }
      }
    };
    void update();
    const refreshTimer = window.setInterval(() => setNow(new Date(Date.now() + clockOffsetMs)), REFRESH_MS);
    const syncTimer = window.setInterval(() => void update(), RESYNC_MS);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(syncTimer);
    };
  }, []);

  return now;
}

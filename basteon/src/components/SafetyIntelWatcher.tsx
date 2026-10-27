"use client";

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { useEffect, useRef } from "react";
import { distanceM } from "@/lib/hamba/geometry";
import { watchLocation } from "@/lib/platform/location";
import { useLocationEligibility } from "@/hooks/useLocationEligibility";

const MIN_INTERVAL_MS = 5 * 60_000;
const MIN_MOVE_M = 150;
const MOVE_EVALUATION_COOLDOWN_MS = 30_000;

/** Rechecks the last permitted position periodically so new reports can reach a stationary user. */
export function SafetyIntelWatcher() {
  const { settings, allowed } = useLocationEligibility();
  const enabled = allowed && Boolean(settings?.safetyIntelAlerts);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let evaluating = false;
    let latest: { lat: number; lng: number } | null = null;
    let lastEvaluated: { lat: number; lng: number } | null = null;
    let lastEvaluatedAt = 0;

    const evaluate = async (point: { lat: number; lng: number }) => {
      if (!active || evaluating) return;
      evaluating = true;
      lastEvaluatedAt = Date.now();
      lastEvaluated = point;
      try {
        const response = await fetch("/api/safety-intel/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(point),
        });
        const result = await response.json().catch(() => null) as {
          sent?: number;
          error?: string;
          notifications?: Array<{ title?: string; body?: string; recordId?: string }>;
        } | null;
        if (!response.ok) {
          console.error("Safety intelligence evaluation failed", { status: response.status, error: result?.error });
          return;
        }
        if (result?.sent && result.notifications?.length && Capacitor.isNativePlatform()) {
          const permission = await LocalNotifications.checkPermissions();
          if (permission.display === "granted") {
            await LocalNotifications.schedule({
              notifications: result.notifications.flatMap((notification, index) =>
                notification.title && notification.body
                  ? [{
                      id: Math.floor((Date.now() + index) % 2_147_483_647),
                      title: notification.title,
                      body: notification.body,
                      schedule: { at: new Date(Date.now() + 1_000) },
                      extra: { href: "/account/buddies", recordId: notification.recordId },
                    }]
                  : [],
              ),
            });
          }
        }
      } catch (error) {
        console.error("Safety intelligence evaluation or notification failed", error);
      } finally {
        evaluating = false;
      }
    };

    const stopWatching = watchLocation((position) => {
      latest = { lat: position.lat, lng: position.lng };
      const now = Date.now();
      const moved = !lastEvaluated || distanceM(lastEvaluated, latest) >= MIN_MOVE_M;
      const intervalPassed = now - lastEvaluatedAt >= MIN_INTERVAL_MS;
      const movementCooldownPassed = now - lastEvaluatedAt >= MOVE_EVALUATION_COOLDOWN_MS;
      if (intervalPassed || (moved && movementCooldownPassed)) void evaluate(latest);
    }, (error) => {
      console.error("Safety intelligence location watch failed", error);
    }, { enableHighAccuracy: false, maximumAge: 60_000 });

    const interval = window.setInterval(() => {
      if (latest && Date.now() - lastEvaluatedAt >= MIN_INTERVAL_MS) void evaluate(latest);
    }, 15_000);

    return () => {
      active = false;
      window.clearInterval(interval);
      stopWatching();
    };
  }, [enabled]);

  return null;
}

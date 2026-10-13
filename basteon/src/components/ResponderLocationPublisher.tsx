"use client";

import { useEffect, useRef, useState } from "react";
import { isFreshPosition, type Position } from "@/lib/geo";
import { getCurrentLocation } from "@/lib/platform/location";
import { createClient } from "@/lib/supabase/client";

export function ResponderLocationPublisher({
  position,
  organisationId,
}: {
  position: Position | null;
  organisationId: string;
}) {
  const positionRef = useRef(position);
  const [error, setError] = useState("");

  useEffect(() => { positionRef.current = position; }, [position]);

  useEffect(() => {
    if (!organisationId) return;
    let active = true;
    let running = false;
    const client = createClient();
    const readCurrentPosition = () => getCurrentLocation({
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 8_000,
    }).catch(() => null);
    const publish = async () => {
      if (!active || running) return;
      running = true;
      try {
        const sampledPosition = await readCurrentPosition();
        if (!active) return;
        const current = sampledPosition ?? positionRef.current;
        const freshPosition = isFreshPosition(current) ? current : null;
        const heartbeat = await fetch("/api/organisation/responders/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(freshPosition
            ? { organisationId, lat: freshPosition.lat, lng: freshPosition.lng }
            : { organisationId }),
        });
        if (!heartbeat.ok) throw new Error("Responder presence heartbeat failed.");
        if (!freshPosition) {
          if (active) setError("");
          return;
        }
        const { data: { user } } = await client.auth.getUser();
        if (!user) return;
        const { data: assignments, error: assignmentError } = await client
          .from("alert_assignments")
          .select("alert_id")
          .eq("responder_user_id", user.id)
          .in("status", ["acknowledged", "en_route", "on_scene"]);
        if (assignmentError) throw assignmentError;
        const alertIds = [...new Set((assignments ?? []).map((assignment) => assignment.alert_id))];
        const results = await Promise.all(alertIds.map((alertId) => fetch("/api/alerts/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alertId,
            action: "location",
            lat: freshPosition.lat,
            lng: freshPosition.lng,
          }),
        })));
        if (results.some((response) => !response.ok)) throw new Error("Location sharing update failed.");
        setError("");
      } catch {
        if (active) setError("Live responder location is delayed; updates will retry.");
      } finally {
        running = false;
      }
    };
    void publish();
    const timer = window.setInterval(() => void publish(), 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [organisationId]);

  return error ? (
    <div className="absolute bottom-3 left-3 z-[1300] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow">
      {error}
    </div>
  ) : null;
}

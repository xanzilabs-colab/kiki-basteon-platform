"use client";

import { useEffect, useRef, useState } from "react";
import type { Position } from "@/lib/geo";
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
    const publish = async () => {
      const current = positionRef.current;
      if (!active || running || !current) return;
      running = true;
      try {
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
            lat: current.lat,
            lng: current.lng,
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

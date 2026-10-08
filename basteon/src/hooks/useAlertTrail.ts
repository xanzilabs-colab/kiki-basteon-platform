"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AlertLocation } from "@/lib/types";

export function useAlertTrail(alertId: string | null) {
  const [trail, setTrail] = useState<AlertLocation[]>([]);

  useEffect(() => {
    if (!alertId) {
      setTrail([]);
      return;
    }

    const supabase = createClient();
    let active = true;
    const sync = async () => {
      const { data } = await supabase.from("alert_locations").select("*").eq("alert_id", alertId).order("recorded_at", { ascending: false }).limit(200);
      if (!active || !data) return;
      const ordered = [...(data as AlertLocation[])].reverse().sort((a, b) => {
        const timeDelta = new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
        if (timeDelta !== 0) return timeDelta;
        return (a.ctr ?? 0) - (b.ctr ?? 0);
      });
      setTrail(ordered);
    };

    void sync();
    const channel = supabase
      .channel(`alert-trail-${alertId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alert_locations", filter: `alert_id=eq.${alertId}` }, (payload) => {
        const point = payload.new as AlertLocation;
        setTrail((current) => {
          if (current.some((item) => item.ctr === point.ctr)) return current;
          const merged = [...current, point].sort((a, b) => {
            const timeDelta = new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
            if (timeDelta !== 0) return timeDelta;
            return (a.ctr ?? 0) - (b.ctr ?? 0);
          });
          return merged.slice(-200);
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void sync();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") void sync();
      });
    const syncTimer = window.setInterval(() => void sync(), 5_000);

    return () => {
      active = false;
      window.clearInterval(syncTimer);
      void supabase.removeChannel(channel);
    };
  }, [alertId]);

  return trail;
}
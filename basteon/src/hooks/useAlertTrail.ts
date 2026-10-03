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
      const { data } = await supabase.from("alert_locations").select("*").eq("alert_id", alertId).order("recorded_at", { ascending: false }).limit(500);
      if (active && data) setTrail((data as AlertLocation[]).reverse());
    };

    void sync();
    const channel = supabase
      .channel(`alert-trail-${alertId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alert_locations", filter: `alert_id=eq.${alertId}` }, (payload) => {
        const point = payload.new as AlertLocation;
        setTrail((current) => current.some((item) => item.ctr === point.ctr) ? current : [...current, point].slice(-500));
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") void sync(); });
    const syncTimer = window.setInterval(() => void sync(), 15_000);

    return () => {
      active = false;
      window.clearInterval(syncTimer);
      void supabase.removeChannel(channel);
    };
  }, [alertId]);

  return trail;
}
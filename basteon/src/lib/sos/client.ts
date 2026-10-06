import { createClient } from "@/lib/supabase/client";
import type { SosType } from "@/lib/sos/sosGesture";

export async function alertSetType(alertId: string, type: SosType) {
  const { data, error } = await createClient().rpc("alert_set_type", { p_alert: alertId, p_type: type });
  return { type: data as SosType | null, error };
}
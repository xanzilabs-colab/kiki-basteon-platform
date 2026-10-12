import "server-only";

import { routeAlertAndNotify } from "@/lib/alertRouting";
import { createAdminClient } from "@/lib/supabase/admin";

export async function processTriggerWork(pruneDiagnostics = false) {
  const db = createAdminClient();
  const promotion = await db.rpc("trigger_promote_due");
  if (promotion.error) throw new Error("trigger_promotion_failed");

  let pruned = 0;
  if (pruneDiagnostics) {
    const result = await db.rpc("trigger_prune_diagnostics");
    if (result.error) throw new Error("trigger_diagnostics_prune_failed");
    pruned = result.data?.diagnostics_pruned ?? 0;
  }

  const { data: unrouted, error } = await db
    .from("alerts")
    .select("id")
    .in("trigger_source", ["webhook", "watch", "safe_point", "guardian", "soft", "bt_media", "bt_ble"])
    .eq("routing_status", "pending")
    .order("triggered_at", { ascending: true })
    .limit(100);
  if (error) throw new Error("trigger_routing_lookup_failed");

  for (const alert of unrouted ?? []) {
    await routeAlertAndNotify(alert.id);
  }

  return {
    promoted: promotion.data?.count ?? 0,
    routed: unrouted?.length ?? 0,
    pruned,
  };
}

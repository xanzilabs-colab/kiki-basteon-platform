import "server-only";

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

type PushPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
  actions?: Array<{ action: string; title: string }>;
  tripId?: string;
  data?: Record<string, string>;
};

export interface PushDispatchResult {
  status: "not_configured" | "unavailable" | "no_subscriptions" | "accepted" | "partial" | "failed";
  attempted: number;
  accepted: number;
  failed: number;
}

function configured() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails("mailto:alerts@basteon.local", publicKey, privateKey);
  return true;
}

export async function sendPushNotificationsToUser(userId: string, payload: PushPayload): Promise<PushDispatchResult> {
  if (!configured()) return { status: "not_configured", attempted: 0, accepted: 0, failed: 0 };

  const admin = createAdminClient();
  const { data: subscriptions, error: lookupError } = await admin
    .from("push_subscriptions")
    .select("endpoint, subscription")
    .eq("user_id", userId);
  if (lookupError) {
    console.error("Could not look up trigger push subscriptions.", lookupError);
    return { status: "unavailable", attempted: 0, accepted: 0, failed: 0 };
  }

  let accepted = 0;
  let failed = 0;
  const targets = subscriptions ?? [];
  await Promise.all(targets.map(async ({ endpoint, subscription }) => {
    try {
      await webpush.sendNotification(subscription as webpush.PushSubscription, JSON.stringify(payload));
      accepted += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      failed += 1;
      console.error("Trigger push gateway rejected a notification.", { statusCode });
      if (statusCode === 404 || statusCode === 410) {
        const { error: deleteError } = await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
        if (deleteError) console.error("Could not remove an expired push subscription.", deleteError);
      }
    }
  }));

  const status = targets.length === 0
    ? "no_subscriptions"
    : accepted === targets.length
      ? "accepted"
      : accepted > 0
        ? "partial"
        : "failed";
  return { status, attempted: targets.length, accepted, failed };
}
import "server-only";

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

type PushPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
};

function configured() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails("mailto:alerts@basteon.local", publicKey, privateKey);
  return true;
}

export async function sendPushNotifications(payload: PushPayload) {
  if (!configured()) return;

  const admin = createAdminClient();
  const { data: subscriptions } = await admin.from("push_subscriptions").select("endpoint, subscription");

  await Promise.all((subscriptions ?? []).map(async ({ endpoint, subscription }) => {
    try {
      await webpush.sendNotification(subscription as webpush.PushSubscription, JSON.stringify(payload));
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
      }
    }
  }));
}
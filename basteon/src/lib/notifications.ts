import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotificationsToUser } from "@/lib/push";

export type NotificationType = "buddy_bubble" | "system";

export type NewNotification = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
  payload?: Record<string, string | number | boolean | null>;
};

export type NotificationView = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
};

type NotificationRow = { id: string; type: NotificationType; title: string; body: string; href: string | null; payload: Record<string, unknown> | null; read_at: string | null; created_at: string };

// Only same-site, path-relative links may be stored (blocks "//host" and scheme URLs).
export function safeHref(href: string | null | undefined) {
  return href && /^\/[A-Za-z0-9]/.test(href) ? href : null;
}

export function toNotificationView(row: NotificationRow): NotificationView {
  return { id: row.id, type: row.type, title: row.title, body: row.body, href: safeHref(row.href), payload: row.payload ?? {}, read: Boolean(row.read_at), createdAt: row.created_at };
}

export async function createNotifications(items: NewNotification[], db = createAdminClient()) {
  if (items.length === 0) return [];
  const { data, error } = await db.from("notifications").insert(items.map((item) => ({
    user_id: item.userId, type: item.type, title: item.title.slice(0, 120), body: item.body.slice(0, 500), href: safeHref(item.href), payload: item.payload ?? {},
  }))).select("id,user_id,href,title,body");
  if (error || !data) {
    console.error("Notification insert failed", error);
    return [];
  }
  await Promise.all(data.map((row) => sendPushNotificationsToUser(row.user_id, {
    title: row.title, body: row.body, tag: `kiki-notification-${row.id}`, url: row.href ?? "/account",
  }).catch((pushError) => console.error("Notification push failed", pushError))));
  return data.map((row) => row.id as string);
}

export function createNotification(item: NewNotification, db = createAdminClient()) {
  return createNotifications([item], db);
}

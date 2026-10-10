import { createNotifications } from "@/lib/notifications";
import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

export const smsConfigured = (env: Record<string, string | undefined> = process.env) => Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);

async function sendSms(to: string, body: string, env: Record<string, string | undefined> = process.env) {
  if (!smsConfigured(env)) return false;
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM!, Body: body }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

/**
 * Tells the owner's trusted people that a trip needs attention. Only runs when the owner enabled guardian notifications.
 * Kiki-user buddies get an in-app notification; phone-only guardians get an SMS when a provider is configured.
 * No location is included in the message.
 */
export async function notifyGuardians(db: Db, ownerId: string, reason: string) {
  const { data: settings } = await db.from("user_intelligence_settings").select("guardian_notify_enabled").eq("user_id", ownerId).maybeSingle();
  if (!settings?.guardian_notify_enabled) return { buddies: 0, sms: 0 };
  const { data: owner } = await db.from("profiles").select("full_name").eq("id", ownerId).maybeSingle();
  const name = (owner as { full_name?: string } | null)?.full_name?.trim() || "Someone you look out for";
  const message = `${name}'s Kiki trip needs attention: ${reason}`;

  const { data: buddies } = await db.from("buddy_contacts").select("contact_user_id").eq("user_id", ownerId);
  const items = (buddies ?? []).map((row) => ({ userId: row.contact_user_id as string, type: "trip_checkpoint" as const, title: "A trip needs attention", body: message, href: "/account/buddies" }));
  if (items.length) await createNotifications(items, db);

  let sms = 0;
  if (smsConfigured()) {
    const { data: guardians } = await db.from("guardians").select("phone").eq("owner_id", ownerId).not("phone", "is", null);
    for (const guardian of guardians ?? []) if (guardian.phone && await sendSms(guardian.phone, `${message} Please check in with them.`)) sms += 1;
  }
  return { buddies: items.length, sms };
}

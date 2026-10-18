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

export async function notifyTripGuardians(db: Db, tripId: string, ownerId: string, title: string, detail: string) {
  const { data: owner, error: ownerError } = await db.from("profiles").select("full_name").eq("id", ownerId).maybeSingle();
  const { data: shares, error: sharesError } = await db.from("trip_guardians")
    .select("guardian_id").eq("trip_id", tripId).eq("owner_id", ownerId).eq("status", "accepted");
  if (ownerError || sharesError) {
    console.error("Trip guardian alert recipients could not be loaded", { ownerError, sharesError });
    throw ownerError ?? sharesError;
  }
  const guardianIds = [...new Set((shares ?? []).map((share) => share.guardian_id as string))];
  if (guardianIds.length === 0) return 0;
  const [{ data: ownerContacts, error: ownerContactsError }, { data: guardianContacts, error: guardianContactsError }, { data: ownerBlocks, error: ownerBlocksError }, { data: guardianBlocks, error: guardianBlocksError }] = await Promise.all([
    db.from("buddy_contacts").select("contact_user_id").eq("user_id", ownerId).in("contact_user_id", guardianIds),
    db.from("buddy_contacts").select("user_id").eq("contact_user_id", ownerId).in("user_id", guardianIds),
    db.from("buddy_blocks").select("blocked_user_id").eq("user_id", ownerId).in("blocked_user_id", guardianIds),
    db.from("buddy_blocks").select("user_id").eq("blocked_user_id", ownerId).in("user_id", guardianIds),
  ]);
  if (ownerContactsError || guardianContactsError || ownerBlocksError || guardianBlocksError) {
    console.error("Trip guardian alert permissions could not be checked", { ownerContactsError, guardianContactsError, ownerBlocksError, guardianBlocksError });
    throw ownerContactsError ?? guardianContactsError ?? ownerBlocksError ?? guardianBlocksError;
  }
  const mutual = new Set((ownerContacts ?? []).map((row) => row.contact_user_id as string));
  const reciprocal = new Set((guardianContacts ?? []).map((row) => row.user_id as string));
  const blocked = new Set([
    ...(ownerBlocks ?? []).map((row) => row.blocked_user_id as string),
    ...(guardianBlocks ?? []).map((row) => row.user_id as string),
  ]);
  const name = (owner as { full_name?: string | null } | null)?.full_name?.trim() || "Your buddy";
  const items = guardianIds.filter((id) => mutual.has(id) && reciprocal.has(id) && !blocked.has(id)).map((userId) => ({
    userId,
    type: "walk_alert" as const,
    title,
    body: `${name} ${detail}`,
    href: `/account/guardian-walks?trip=${encodeURIComponent(tripId)}`,
    payload: { tripId },
  }));
  if (items.length) await createNotifications(items, db);
  return items.length;
}

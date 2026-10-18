import { NextResponse } from "next/server";
import { buddyAccount, publicBuddyProfile } from "./_shared";

export async function GET() {
  const account = await buddyAccount();
  if ("response" in account) return account.response;

  const [{ data: ownProfile, error: ownError }, { data: contacts, error: contactsError }, { data: requests, error: requestsError }, { data: blocks, error: blocksError }] = await Promise.all([
    account.db.from("profiles").select("kiki_id").eq("id", account.user.id).single(),
    account.db.from("buddy_contacts").select("contact_user_id").eq("user_id", account.user.id),
    account.db.from("buddy_connection_requests")
      .select("id,user_low_id,user_high_id,requested_by,status,created_at")
      .or(`user_low_id.eq.${account.user.id},user_high_id.eq.${account.user.id}`)
      .eq("status", "pending"),
    account.db.from("buddy_blocks").select("blocked_user_id").eq("user_id", account.user.id),
  ]);
  if (ownError || contactsError || requestsError || blocksError || !ownProfile) {
    console.error("Buddy list load failed", { ownError, contactsError, requestsError, blocksError });
    return NextResponse.json({ error: "buddies_unavailable" }, { status: 500 });
  }

  const contactIds = (contacts ?? []).map((row) => row.contact_user_id as string);
  const incoming = (requests ?? []).filter((row) => row.requested_by !== account.user.id);
  const outgoing = (requests ?? []).filter((row) => row.requested_by === account.user.id);
  const otherId = (row: { user_low_id: string; user_high_id: string }) =>
    row.user_low_id === account.user.id ? row.user_high_id : row.user_low_id;
  const blockedIds = (blocks ?? []).map((row) => row.blocked_user_id as string);
  const allIds = [...new Set([
    ...contactIds,
    ...incoming.map((row) => row.requested_by as string),
    ...outgoing.map((row) => otherId(row)),
    ...blockedIds,
  ])];
  const profiles = await Promise.all(allIds.map((id) => publicBuddyProfile(account.db, id)));
  const byId = new Map(profiles.filter((profile) => profile !== null).map((profile) => [profile.id, profile]));

  return NextResponse.json({
    kikiId: ownProfile.kiki_id,
    buddies: contactIds.map((id) => byId.get(id)).filter((profile) => profile !== undefined),
    incoming: incoming.map((row) => ({
      requestId: row.id,
      createdAt: row.created_at,
      buddy: byId.get(row.requested_by as string) ?? null,
    })),
    outgoing: outgoing.map((row) => ({
      requestId: row.id,
      createdAt: row.created_at,
      buddy: byId.get(otherId(row)) ?? null,
    })),
    blocked: blockedIds.map((id) => byId.get(id)).filter((profile) => profile !== undefined),
  });
}

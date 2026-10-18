import { NextResponse } from "next/server";
import { normalizeKikiId } from "@/lib/buddyIds";
import { buddyAccount, publicBuddyProfile } from "../_shared";

export async function POST(request: Request) {
  const account = await buddyAccount(request);
  if ("response" in account) return account.response;

  const body: unknown = await request.json().catch(() => null);
  const kikiId = body && typeof body === "object" && "kikiId" in body
    ? normalizeKikiId(body.kikiId)
    : null;
  if (!kikiId) return NextResponse.json({ error: "invalid_kiki_id" }, { status: 400 });

  const { data: profile, error } = await account.db.from("profiles")
    .select("id")
    .eq("kiki_id", kikiId)
    .eq("role", "user")
    .neq("verification_status", "suspended")
    .maybeSingle();
  if (error) {
    console.error("Buddy ID lookup failed", error);
    return NextResponse.json({ error: "lookup_unavailable" }, { status: 500 });
  }
  if (!profile || profile.id === account.user.id) {
    return NextResponse.json({ error: profile ? "cannot_add_self" : "buddy_not_found" }, { status: 404 });
  }

  const { data: block } = await account.db.from("buddy_blocks")
    .select("user_id")
    .or(`and(user_id.eq.${account.user.id},blocked_user_id.eq.${profile.id}),and(user_id.eq.${profile.id},blocked_user_id.eq.${account.user.id})`)
    .maybeSingle();
  if (block) return NextResponse.json({ error: "buddy_not_found" }, { status: 404 });

  const { data: connection } = await account.db.from("buddy_contacts")
    .select("user_id")
    .or(`and(user_id.eq.${account.user.id},contact_user_id.eq.${profile.id}),and(user_id.eq.${profile.id},contact_user_id.eq.${account.user.id})`)
    .maybeSingle();
  const buddy = await publicBuddyProfile(account.db, profile.id);
  if (!buddy) return NextResponse.json({ error: "buddy_not_found" }, { status: 404 });
  return NextResponse.json({ buddy, connected: Boolean(connection) });
}

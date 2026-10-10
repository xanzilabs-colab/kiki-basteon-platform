import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";

const schema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid(),
  action: z.enum(["revoke", "block", "unblock"]),
});

export async function PATCH(request: Request) {
  const { userId: actorId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!actorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { organisationId, userId, action } = parsed.data;
  if (!memberships.some((m: any) => m.organisation_id === organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (userId === actorId) return NextResponse.json({ error: "You cannot change your own access." }, { status: 400 });

  const db = createAdminClient();
  const { data: member } = await db.from("organisation_memberships").select("id,role,roster_entry_id").eq("organisation_id", organisationId).eq("user_id", userId).maybeSingle();
  if (!member) return NextResponse.json({ error: "Member not found for organisation" }, { status: 404 });
  if (member.role === "owner") return NextResponse.json({ error: "The owner's access cannot be changed." }, { status: 400 });

  if (action === "revoke") {
    await db.from("organisation_user_links").delete().eq("organisation_id", organisationId).eq("user_id", userId);
    await db.from("organisation_memberships").delete().eq("id", member.id);
    if (member.roster_entry_id) {
      await db.from("org_roster_entries").update({ claimed_by_user_id: null, claimed_at: null }).eq("id", member.roster_entry_id).eq("org_id", organisationId);
    }
  } else {
    const blocked = action === "block";
    await db.from("organisation_memberships").update({ status: blocked ? "suspended" : "active" }).eq("id", member.id);
    await db.from("organisation_user_links").update({ status: blocked ? "link_ended" : "active" }).eq("organisation_id", organisationId).eq("user_id", userId);
    if (member.roster_entry_id) {
      await db.from("org_roster_entries").update({ status: blocked ? "suspended" : "active" }).eq("id", member.roster_entry_id).eq("org_id", organisationId);
    }
  }

  await db.from("org_roster_audit_log").insert({
    org_id: organisationId,
    actor_id: actorId,
    action: `member_${action}`,
    entry_id: member.roster_entry_id ?? null,
    details: { memberUserId: userId },
  });
  return NextResponse.json({ ok: true });
}

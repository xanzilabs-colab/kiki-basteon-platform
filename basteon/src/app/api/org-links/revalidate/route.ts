import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function cronAuthorized(request: Request) {
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return Boolean(process.env.CRON_SECRET && bearer && bearer === process.env.CRON_SECRET);
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const nowIso = new Date().toISOString();

  const { error: expireError } = await db
    .from("org_roster_entries")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("valid_until", nowIso);
  if (expireError) return NextResponse.json({ error: expireError.message }, { status: 500 });

  const { data: links, error: linksError } = await db
    .from("organisation_user_links")
    .select("id,user_id,organisation_id,roster_entry_id,status,org_roster_entries(id,status,valid_until,updated_at)")
    .not("roster_entry_id", "is", null)
    .in("status", ["active", "pending"]);
  if (linksError) return NextResponse.json({ error: linksError.message }, { status: 500 });

  const orgIds = [...new Set((links ?? []).map((link) => (link as any).organisation_id).filter(Boolean))];
  const { data: settingsRows } = orgIds.length
    ? await db.from("organisation_link_settings").select("organisation_id,roster_grace_days").in("organisation_id", orgIds)
    : { data: [] as Array<{ organisation_id: string; roster_grace_days: number }> };
  const graceDaysByOrg = new Map((settingsRows ?? []).map((row) => [row.organisation_id, Number(row.roster_grace_days ?? 14)]));

  let ended = 0;
  for (const link of links ?? []) {
    const entry = (link as any).org_roster_entries;
    if (!entry) continue;
    const rosterStatus = String(entry.status ?? "");
    const isInvalid = rosterStatus === "expired" || rosterStatus === "removed" || rosterStatus === "suspended";
    const validUntilMs = entry.valid_until ? new Date(entry.valid_until).getTime() : null;
    const updatedMs = entry.updated_at ? new Date(entry.updated_at).getTime() : Date.now();
    const boundaryMs = validUntilMs ?? updatedMs;
    const graceDays = graceDaysByOrg.get((link as any).organisation_id) ?? 14;
    const graceMs = graceDays * 24 * 60 * 60 * 1000;
    if (!isInvalid || Date.now() < boundaryMs + graceMs) continue;

    const [linkResult, membershipResult] = await Promise.all([
      db.from("organisation_user_links")
        .update({ status: "link_ended", verified_at: null })
        .eq("id", link.id),
      db.from("organisation_memberships")
        .update({ status: "link_ended", last_revalidated_at: nowIso })
        .eq("organisation_id", link.organisation_id)
        .eq("user_id", link.user_id)
        .eq("roster_entry_id", link.roster_entry_id),
    ]);
    if (linkResult.error || membershipResult.error) continue;
    await db.from("org_roster_audit_log").insert({
      org_id: link.organisation_id,
      actor_id: null,
      action: "link_ended_after_grace",
      entry_id: link.roster_entry_id,
      details: { userId: link.user_id, previousStatus: link.status, rosterStatus, graceDays },
    });
    ended += 1;
  }

  return NextResponse.json({ ok: true, endedLinks: ended });
}

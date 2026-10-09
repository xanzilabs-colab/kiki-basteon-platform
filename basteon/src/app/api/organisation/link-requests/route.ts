import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";

const actionSchema = z.object({
  organisationId: z.string().uuid(),
  linkId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

export async function GET(request: Request) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const organisationId = new URL(request.url).searchParams.get("organisationId");
  if (!organisationId || !memberships.some((membership: any) => membership.organisation_id === organisationId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = createAdminClient();
  const { data: links, error } = await db
    .from("organisation_user_links")
    .select("id,user_id,membership_type,created_at")
    .eq("organisation_id", organisationId)
    .eq("status", "pending")
    .not("roster_entry_id", "is", null)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = [...new Set((links ?? []).map((link) => link.user_id))];
  const { data: profiles, error: profileError } = userIds.length
    ? await db.from("profiles").select("id,full_name").in("id", userIds)
    : { data: [], error: null };
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));

  return NextResponse.json((links ?? []).map((link) => ({
    id: link.id,
    userId: link.user_id,
    name: names.get(link.user_id) || "Organisation member",
    membershipType: link.membership_type || "member",
    createdAt: link.created_at,
  })));
}

export async function POST(request: Request) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  if (!memberships.some((membership: any) => membership.organisation_id === input.organisationId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = createAdminClient();
  const { data: link, error: linkError } = await db
    .from("organisation_user_links")
    .select("id,user_id,roster_entry_id,status")
    .eq("id", input.linkId)
    .eq("organisation_id", input.organisationId)
    .eq("status", "pending")
    .not("roster_entry_id", "is", null)
    .maybeSingle();
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
  if (!link?.roster_entry_id) return NextResponse.json({ error: "This request is no longer pending." }, { status: 409 });

  const { data: membership, error: membershipReadError } = await db
    .from("organisation_memberships")
    .select("status")
    .eq("organisation_id", input.organisationId)
    .eq("user_id", link.user_id)
    .eq("roster_entry_id", link.roster_entry_id)
    .maybeSingle();
  if (membershipReadError) return NextResponse.json({ error: membershipReadError.message }, { status: 500 });
  if (membership?.status !== "pending") return NextResponse.json({ error: "This request is no longer pending." }, { status: 409 });

  const { data: rosterEntry, error: rosterError } = await db
    .from("org_roster_entries")
    .select("status,valid_from,valid_until,claimed_by_user_id,max_claims")
    .eq("id", link.roster_entry_id)
    .eq("org_id", input.organisationId)
    .maybeSingle();
  if (rosterError) return NextResponse.json({ error: rosterError.message }, { status: 500 });
  if (!rosterEntry) return NextResponse.json({ error: "The roster entry is no longer available." }, { status: 409 });

  if (input.action === "approve") {
    const now = Date.now();
    const validFrom = new Date(rosterEntry.valid_from).getTime();
    const validUntil = rosterEntry.valid_until ? new Date(rosterEntry.valid_until).getTime() : Infinity;
    const requiresSingleClaimOwner = (rosterEntry.max_claims ?? 1) === 1;
    if (rosterEntry.status !== "active" || validFrom > now || validUntil < now || (requiresSingleClaimOwner && rosterEntry.claimed_by_user_id !== link.user_id)) {
      return NextResponse.json({ error: "The roster entry is no longer eligible. Update the roster before approving this request." }, { status: 409 });
    }
    const { count: claimCount, error: claimCountError } = await db.from("organisation_user_links")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", input.organisationId)
      .eq("roster_entry_id", link.roster_entry_id)
      .in("status", ["active", "pending"]);
    if (claimCountError) return NextResponse.json({ error: claimCountError.message }, { status: 500 });
    if ((claimCount ?? 0) > (rosterEntry.max_claims ?? 1)) {
      return NextResponse.json({ error: "The roster entry has reached its claim limit." }, { status: 409 });
    }

    const approvedAt = new Date().toISOString();
    const { error: membershipUpdateError } = await db
      .from("organisation_memberships")
      .update({ status: "active", verified_at: approvedAt })
      .eq("organisation_id", input.organisationId)
      .eq("user_id", link.user_id)
      .eq("roster_entry_id", link.roster_entry_id)
      .eq("status", "pending");
    if (membershipUpdateError) return NextResponse.json({ error: membershipUpdateError.message }, { status: 500 });

    const { error: linkUpdateError } = await db
      .from("organisation_user_links")
      .update({ status: "active", verified_at: approvedAt })
      .eq("id", link.id)
      .eq("status", "pending");
    if (linkUpdateError) {
      const { error: rollbackError } = await db.from("organisation_memberships")
        .update({ status: "pending", verified_at: null })
        .eq("organisation_id", input.organisationId)
        .eq("user_id", link.user_id)
        .eq("roster_entry_id", link.roster_entry_id)
        .eq("status", "active");
      if (rollbackError) return NextResponse.json({ error: `Could not activate the link or roll back its membership: ${linkUpdateError.message}; ${rollbackError.message}` }, { status: 500 });
      return NextResponse.json({ error: linkUpdateError.message }, { status: 500 });
    }
  } else {
    const { error: linkUpdateError } = await db.from("organisation_user_links")
      .update({ status: "unlinked" })
      .eq("id", link.id)
      .eq("status", "pending");
    if (linkUpdateError) return NextResponse.json({ error: linkUpdateError.message }, { status: 500 });

    const { error: membershipUpdateError } = await db.from("organisation_memberships")
      .update({ status: "unlinked" })
      .eq("organisation_id", input.organisationId)
      .eq("user_id", link.user_id)
      .eq("roster_entry_id", link.roster_entry_id)
      .eq("status", "pending");
    if (membershipUpdateError) {
      const { error: rollbackError } = await db.from("organisation_user_links")
        .update({ status: "pending" })
        .eq("id", link.id)
        .eq("status", "unlinked");
      if (rollbackError) return NextResponse.json({ error: `Could not reject the request or roll back its link: ${membershipUpdateError.message}; ${rollbackError.message}` }, { status: 500 });
      return NextResponse.json({ error: membershipUpdateError.message }, { status: 500 });
    }

    const { count, error: remainingError } = await db.from("organisation_user_links")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", input.organisationId)
      .eq("roster_entry_id", link.roster_entry_id)
      .in("status", ["active", "pending"]);
    if (remainingError) return NextResponse.json({ error: remainingError.message }, { status: 500 });
    if ((count ?? 0) === 0 && rosterEntry.claimed_by_user_id === link.user_id) {
      const { error: releaseError } = await db.from("org_roster_entries")
        .update({ claimed_by_user_id: null, claimed_at: null })
        .eq("id", link.roster_entry_id)
        .eq("claimed_by_user_id", link.user_id);
      if (releaseError) return NextResponse.json({ error: releaseError.message }, { status: 500 });
    }
  }

  const action = input.action === "approve" ? "link_approved" : "link_rejected";
  const { error: auditError } = await db.from("org_roster_audit_log").insert({
    org_id: input.organisationId,
    actor_id: userId,
    action,
    entry_id: link.roster_entry_id,
    details: { userId: link.user_id },
  });
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

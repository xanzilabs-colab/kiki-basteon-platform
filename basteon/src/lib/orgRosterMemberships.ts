import { roleHintForMembershipType } from "@/lib/organisationCategories";
import { createAdminClient } from "@/lib/supabase/admin";

type ReconcileScope =
  | { organisationId: string; userId?: string }
  | { organisationId?: string; userId: string };

export async function reconcileRosterMemberships(
  db: ReturnType<typeof createAdminClient>,
  scope: ReconcileScope,
) {
  let linksQuery = db
    .from("organisation_user_links")
    .select("id,user_id,organisation_id,branch_id,identifier,membership_type,status,roster_entry_id,org_roster_entries(id,status,valid_from,valid_until,claimed_by_user_id,max_claims,membership_type)")
    .in("status", ["active", "link_ended"])
    .not("roster_entry_id", "is", null);
  if (scope.organisationId) linksQuery = linksQuery.eq("organisation_id", scope.organisationId);
  if (scope.userId) linksQuery = linksQuery.eq("user_id", scope.userId);
  const { data: links, error: linksError } = await linksQuery;
  if (linksError) throw new Error(`Could not reconcile organisation roster links: ${linksError.message}`);

  const now = new Date();
  const nowIso = now.toISOString();
  for (const link of links ?? []) {
    const joinedEntry = link.org_roster_entries;
    const entry = Array.isArray(joinedEntry) ? joinedEntry[0] : joinedEntry;
    if (!entry || entry.status !== "active") continue;
    const validFrom = new Date(entry.valid_from).getTime();
    const validUntil = entry.valid_until ? new Date(entry.valid_until).getTime() : Infinity;
    if (!Number.isFinite(validFrom) || validFrom > now.getTime() || validUntil < now.getTime()) continue;
    if ((entry.max_claims ?? 1) === 1 && entry.claimed_by_user_id !== link.user_id) continue;

    const membershipType = entry.membership_type || link.membership_type || "member";
    const { data: existingMembership, error: membershipReadError } = await db
      .from("organisation_memberships")
      .select("role")
      .eq("organisation_id", link.organisation_id)
      .eq("user_id", link.user_id)
      .maybeSingle();
    if (membershipReadError) throw new Error(`Could not read linked organisation membership: ${membershipReadError.message}`);

    const { error: membershipError } = await db.from("organisation_memberships").upsert({
      organisation_id: link.organisation_id,
      user_id: link.user_id,
      branch_id: link.branch_id,
      membership_type: membershipType,
      role: existingMembership?.role ?? (roleHintForMembershipType(membershipType) === "responder" ? "responder" : "member"),
      status: "active",
      source: "roster",
      linked_identifier: link.identifier,
      roster_entry_id: link.roster_entry_id,
      verified_at: nowIso,
      verification_method: "roster_only",
      last_revalidated_at: nowIso,
    }, { onConflict: "organisation_id,user_id" });
    if (membershipError) throw new Error(`Could not restore organisation membership from roster link: ${membershipError.message}`);

    if (link.status === "link_ended") {
      const { error: restoreError } = await db.from("organisation_user_links")
        .update({ status: "active", verified_at: nowIso })
        .eq("id", link.id)
        .eq("status", "link_ended");
      if (restoreError) throw new Error(`Could not restore organisation link: ${restoreError.message}`);
      const { error: auditError } = await db.from("org_roster_audit_log").insert({
        org_id: link.organisation_id,
        actor_id: null,
        action: "link_restored_from_active_roster",
        entry_id: link.roster_entry_id,
        details: { userId: link.user_id },
      });
      if (auditError) throw new Error(`Could not audit restored organisation link: ${auditError.message}`);
    }
  }
}

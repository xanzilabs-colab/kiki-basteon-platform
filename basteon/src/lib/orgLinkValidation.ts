import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { roleHintForMembershipType } from "@/lib/organisationCategories";
import { isRosterWindowActive, normalizeIdentifierInput, normalizeRosterIdentifier, type RosterIdentifierType } from "@/lib/orgRoster";

export type LinkValidationCode = "LINKED" | "PENDING_APPROVAL" | "NOT_ELIGIBLE" | "EXPIRED" | "ALREADY_CLAIMED" | "RATE_LIMITED";

export type ValidateOrgLinkInput = {
  userId: string;
  organisationId: string;
  branchId: string | null;
  identifierType: RosterIdentifierType;
  identifier: string;
  label: "work" | "school" | "home" | "other";
  placeAddress?: string | null;
  ipAddress: string | null;
};

type ValidateOrgLinkResult = {
  code: LinkValidationCode;
  message: string;
  action?: "contact_organisation" | "request_approval";
};

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_WINDOW = 6;
const MAX_ATTEMPTS_PER_WINDOW = 24;

function hashIp(ipAddress: string | null) {
  if (!ipAddress) return null;
  return createHash("sha256").update(ipAddress).digest("hex");
}

async function insertAudit(orgId: string, actorId: string | null, action: string, entryId: string | null, details: Record<string, unknown>) {
  const db = createAdminClient();
  const { error } = await db.from("org_roster_audit_log").insert({
    org_id: orgId,
    actor_id: actorId,
    action,
    entry_id: entryId,
    details,
  });
  if (error) throw new Error(`Could not write organisation roster audit event: ${error.message}`);
}

async function trackAttempt(userId: string, organisationId: string | null, ipHash: string | null, identifierType: RosterIdentifierType, success: boolean, reasonCode: LinkValidationCode) {
  const db = createAdminClient();
  const { error } = await db.from("org_link_validation_attempts").insert({
    user_id: userId,
    org_id: organisationId,
    ip_hash: ipHash,
    identifier_type: identifierType,
    success,
    reason_code: reasonCode,
  });
  if (error) throw new Error(`Could not record organisation-link attempt: ${error.message}`);
}

function result(code: LinkValidationCode, message: string, action?: "contact_organisation" | "request_approval"): ValidateOrgLinkResult {
  return { code, message, action };
}

export async function validateAndLinkOrganisation(input: ValidateOrgLinkInput): Promise<ValidateOrgLinkResult> {
  const db = createAdminClient();
  const ipHash = hashIp(input.ipAddress);
  const cutoffIso = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data: organisation, error: organisationError } = await db
    .from("organisations")
    .select("id,status,blocked_until,is_partner")
    .eq("id", input.organisationId)
    .maybeSingle();
  if (organisationError) throw new Error(organisationError.message);
  if (!organisation) {
    await trackAttempt(input.userId, null, ipHash, input.identifierType, false, "NOT_ELIGIBLE");
    return result("NOT_ELIGIBLE", "We could not confirm eligibility. Please contact your organisation.", "contact_organisation");
  }

  const [userAttempts, ipAttempts] = await Promise.all([
    db.from("org_link_validation_attempts").select("success", { count: "exact", head: true }).eq("user_id", input.userId).gte("created_at", cutoffIso),
    ipHash
      ? db.from("org_link_validation_attempts").select("success", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", cutoffIso)
      : Promise.resolve({ count: 0 } as any),
  ]);
  if (userAttempts.error || ipAttempts.error) throw new Error(userAttempts.error?.message ?? ipAttempts.error?.message ?? "Could not check organisation-link rate limit.");

  const tooManyAttempts = (userAttempts.count ?? 0) >= MAX_ATTEMPTS_PER_WINDOW || (ipAttempts.count ?? 0) >= MAX_ATTEMPTS_PER_WINDOW;
  if (tooManyAttempts) {
    await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "RATE_LIMITED");
    await insertAudit(input.organisationId, input.userId, "validate_rejected_rate_limited", null, { identifierType: input.identifierType });
    return result("RATE_LIMITED", "Too many attempts right now. Please try again later.", "contact_organisation");
  }

  const [userFailures, ipFailures] = await Promise.all([
    db.from("org_link_validation_attempts").select("id", { count: "exact", head: true }).eq("user_id", input.userId).eq("success", false).gte("created_at", cutoffIso),
    ipHash
      ? db.from("org_link_validation_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).eq("success", false).gte("created_at", cutoffIso)
      : Promise.resolve({ count: 0 } as any),
  ]);
  if (userFailures.error || ipFailures.error) throw new Error(userFailures.error?.message ?? ipFailures.error?.message ?? "Could not check organisation-link lockout.");

  if ((userFailures.count ?? 0) >= MAX_FAILURES_PER_WINDOW || (ipFailures.count ?? 0) >= MAX_FAILURES_PER_WINDOW) {
    await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "RATE_LIMITED");
    await insertAudit(input.organisationId, input.userId, "validate_rejected_rate_limited", null, { identifierType: input.identifierType });
    return result("RATE_LIMITED", "Too many failed attempts. Please wait and try again.", "contact_organisation");
  }

  const { data: settings, error: settingsError } = await db.from("organisation_link_settings")
    .select("require_invite,auto_approve_links,roster_id_case_mode")
    .eq("organisation_id", input.organisationId).maybeSingle();
  if (settingsError) throw new Error(settingsError.message);
  const orgBlocked = organisation?.status === "suspended" && (!organisation.blocked_until || new Date(organisation.blocked_until).getTime() > Date.now());
  if (!organisation || orgBlocked || organisation.is_partner) {
    await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "NOT_ELIGIBLE");
    await insertAudit(input.organisationId, input.userId, "validate_rejected_not_eligible", null, { identifierType: input.identifierType, orgBlocked: Boolean(orgBlocked) });
    return result("NOT_ELIGIBLE", "We could not confirm eligibility. Please contact your organisation.", "contact_organisation");
  }

  if (input.branchId) {
    const { data: branch, error: branchError } = await db.from("organisation_branches").select("id")
      .eq("id", input.branchId).eq("organisation_id", input.organisationId).eq("active", true).maybeSingle();
    if (branchError) throw new Error(branchError.message);
    if (!branch) {
      await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "NOT_ELIGIBLE");
      await insertAudit(input.organisationId, input.userId, "validate_rejected_not_eligible", null, { identifierType: input.identifierType });
      return result("NOT_ELIGIBLE", "We could not confirm eligibility. Please contact your organisation.", "contact_organisation");
    }
  }

  const identifierRaw = normalizeIdentifierInput(input.identifier);
  const identifierNormalized = normalizeRosterIdentifier(
    input.identifier,
    input.identifierType,
    (settings?.roster_id_case_mode as "upper" | "lower" | "as_is" | undefined) ?? "upper",
  );
  const { data: entry, error: entryError } = await db
    .from("org_roster_entries")
    .select("id,membership_type,status,valid_from,valid_until,max_claims,claimed_by_user_id,claimed_at")
    .eq("org_id", input.organisationId)
    .eq("identifier_type", input.identifierType)
    .eq("identifier_normalized", identifierNormalized)
    .maybeSingle();
  if (entryError) throw new Error(entryError.message);

  if (!entry) {
    await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "NOT_ELIGIBLE");
    await insertAudit(input.organisationId, input.userId, "validate_rejected_not_eligible", null, { identifierType: input.identifierType });
    return result("NOT_ELIGIBLE", "We could not confirm eligibility. Please contact your organisation.", "contact_organisation");
  }

  if (entry.status !== "active") {
    const code = entry.status === "expired" ? "EXPIRED" : "NOT_ELIGIBLE";
    await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, code);
    await insertAudit(input.organisationId, input.userId, "validate_rejected_status", entry.id, { entryStatus: entry.status });
    return code === "EXPIRED"
      ? result("EXPIRED", "This organisation access entry has expired.", "contact_organisation")
      : result("NOT_ELIGIBLE", "We could not confirm eligibility. Please contact your organisation.", "contact_organisation");
  }

  if (!isRosterWindowActive(entry.valid_from, entry.valid_until)) {
    await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "EXPIRED");
    await insertAudit(input.organisationId, input.userId, "validate_rejected_window", entry.id, {});
    return result("EXPIRED", "This organisation access entry has expired.", "contact_organisation");
  }

  if (entry.claimed_by_user_id && entry.claimed_by_user_id !== input.userId) {
    await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "ALREADY_CLAIMED");
    await insertAudit(input.organisationId, input.userId, "validate_rejected_claimed", entry.id, {});
    return result("ALREADY_CLAIMED", "This identifier has already been used.", "contact_organisation");
  }

  const { count: claimCount, error: claimCountError } = await db
    .from("organisation_user_links")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", input.organisationId)
    .eq("roster_entry_id", entry.id)
    .in("status", ["active", "pending"]);
  if (claimCountError) throw new Error(claimCountError.message);

  if ((claimCount ?? 0) >= (entry.max_claims ?? 1) && entry.claimed_by_user_id !== input.userId) {
    await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "ALREADY_CLAIMED");
    await insertAudit(input.organisationId, input.userId, "validate_rejected_max_claims", entry.id, { claimCount: claimCount ?? 0, maxClaims: entry.max_claims ?? 1 });
    return result("ALREADY_CLAIMED", "This identifier has already been used.", "contact_organisation");
  }

  const status = settings?.require_invite
    || settings?.auto_approve_links === false
    ? "pending"
    : "active";
  const membershipType = entry.membership_type || "member";
  const roleHint = roleHintForMembershipType(membershipType);
  const membershipRole = roleHint === "responder" ? "responder" : "member";
  const nowIso = new Date().toISOString();
  let claimedForRequest = false;

  if ((entry.max_claims ?? 1) === 1 && !entry.claimed_by_user_id) {
    const { data: claimedEntry, error: claimError } = await db
      .from("org_roster_entries")
      .update({ claimed_by_user_id: input.userId, claimed_at: nowIso })
      .eq("id", entry.id)
      .is("claimed_by_user_id", null)
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimedEntry) {
      await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "ALREADY_CLAIMED");
      await insertAudit(input.organisationId, input.userId, "validate_rejected_claimed", entry.id, {});
      return result("ALREADY_CLAIMED", "This identifier has already been used.", "contact_organisation");
    }
    claimedForRequest = true;
  }

  const releaseClaim = async () => {
    if (!claimedForRequest) return;
    const { error } = await db.from("org_roster_entries")
      .update({ claimed_by_user_id: null, claimed_at: null })
      .eq("id", entry.id)
      .eq("claimed_by_user_id", input.userId);
    if (error) throw new Error(`Could not release organisation roster claim: ${error.message}`);
  };

  const { error: userLinkError } = await db.from("organisation_user_links").upsert({
      user_id: input.userId,
      organisation_id: input.organisationId,
      branch_id: input.branchId,
      label: input.label,
      place_address: input.placeAddress?.trim() || null,
      method: "roster",
      identifier: identifierRaw,
      membership_type: membershipType,
      status,
      roster_entry_id: entry.id,
      verified_at: status === "active" ? nowIso : null,
      verification_method: "roster_only",
    }, { onConflict: "user_id,organisation_id,label" });

  if (userLinkError) {
    await releaseClaim();
    await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "NOT_ELIGIBLE");
    await insertAudit(input.organisationId, input.userId, "validate_rejected_write_failed", entry.id, {});
    return result("NOT_ELIGIBLE", "We could not complete linking right now. Please try again.", "contact_organisation");
  }

  const { error: membershipError } = await db.from("organisation_memberships").upsert({
      organisation_id: input.organisationId,
      user_id: input.userId,
      branch_id: input.branchId,
      membership_type: membershipType,
      role: membershipRole,
      status,
      source: "roster",
      linked_identifier: identifierRaw,
      roster_entry_id: entry.id,
      verified_at: status === "active" ? nowIso : null,
      verification_method: "roster_only",
      last_revalidated_at: nowIso,
    }, { onConflict: "organisation_id,user_id" });

  if (membershipError) {
    const { error: rollbackError } = await db.from("organisation_user_links")
      .update({ status: "link_failed" })
      .eq("user_id", input.userId)
      .eq("organisation_id", input.organisationId)
      .eq("roster_entry_id", entry.id);
    if (rollbackError) throw new Error(`Could not roll back partial organisation link: ${rollbackError.message}`);
    await releaseClaim();
    await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, false, "NOT_ELIGIBLE");
    await insertAudit(input.organisationId, input.userId, "validate_rejected_write_failed", entry.id, {});
    return result("NOT_ELIGIBLE", "We could not complete linking right now. Please try again.", "contact_organisation");
  }

  const code: LinkValidationCode = status === "pending" ? "PENDING_APPROVAL" : "LINKED";
  await trackAttempt(input.userId, input.organisationId, ipHash, input.identifierType, true, code);
  await insertAudit(input.organisationId, input.userId, status === "pending" ? "link_pending_approval" : "link_created", entry.id, { identifierType: input.identifierType });

  if (status === "pending") {
    return result("PENDING_APPROVAL", "Your request was submitted and is waiting for organisation approval.", "request_approval");
  }
  return result("LINKED", "Linked successfully. You are now covered by your organisation.");
}

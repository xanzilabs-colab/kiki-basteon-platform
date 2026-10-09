import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";

const settingsSchema = z.object({
  organisationId: z.string().uuid(),
  allowEmailDomain: z.boolean(),
  allowWorkId: z.boolean(),
  requireInvite: z.boolean(),
  autoApproveLinks: z.boolean(),
  rosterIdCaseMode: z.enum(["upper", "lower", "as_is"]).optional(),
  workIdRegex: z.string().optional().nullable().refine((value) => {
    if (!value?.trim()) return true;
    try { new RegExp(value); return true; } catch { return false; }
  }, "Work/student ID regex is invalid."),
});

export async function GET() {
  const { userId, memberships } = await requireOrganisationAccess();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (memberships.length === 0) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const organisationId = memberships[0].organisation_id as string;
  const db = createAdminClient();
  const [{ data: organisation }, { data: branches }, { data: members }, { data: settings }, { data: domains }, { data: coverage }, { data: onboarding }, { data: units }, { data: presence }, { data: policy }, { data: globalSupport }, { data: organisationSupport }] = await Promise.all([
    db.from("organisations").select("*").eq("id", organisationId).single(),
    db.from("organisation_branches").select("*").eq("organisation_id", organisationId).order("created_at", { ascending: true }),
    db.from("organisation_memberships").select("id,user_id,branch_id,membership_type,role,status,created_at,profiles(full_name,phone)").eq("organisation_id", organisationId).order("created_at"),
    db.from("organisation_link_settings").select("*").eq("organisation_id", organisationId).maybeSingle(),
    db.from("organisation_domains").select("*").eq("organisation_id", organisationId).order("priority", { ascending: true }),
    db.from("organisation_emergency_coverage").select("id,branch_id,emergency_type_code,priority,active").eq("organisation_id", organisationId).eq("active", true),
    db.from("organisation_onboarding").select("*").eq("organisation_id", organisationId).maybeSingle(),
    db.from("organisation_units").select("*").eq("organisation_id", organisationId).order("created_at"),
    db.from("responder_presence").select("user_id,branch_id,unit_id,availability,last_seen_at,profiles(full_name)").eq("organisation_id", organisationId).order("last_seen_at", { ascending: false }),
    db.from("organisation_dispatch_policies").select("*").eq("organisation_id", organisationId).maybeSingle(),
    db.from("support_contacts").select("*").eq("scope", "global").eq("active", true).order("purpose", { ascending: true }).order("contact_name", { ascending: true }),
    db.from("support_contacts").select("*").eq("scope", "organisation").eq("organisation_id", organisationId).eq("active", true).order("purpose", { ascending: true }).order("contact_name", { ascending: true }),
  ]);
  return NextResponse.json({
    organisation,
    memberships,
    branches: branches ?? [],
    members: members ?? [],
    settings,
    domains: domains ?? [],
    coverage: coverage ?? [],
    onboarding: onboarding ?? null,
    units: units ?? [],
    responderPresence: presence ?? [],
    dispatchPolicy: policy ?? null,
    supportContacts: {
      global: globalSupport ?? [],
      organisation: organisationSupport ?? [],
    },
    blocked: {
      isBlocked: Boolean(
        organisation?.status === "suspended"
        && (!organisation?.blocked_until || new Date(organisation.blocked_until).getTime() > Date.now()),
      ),
      until: organisation?.blocked_until ?? null,
      reason: organisation?.blocked_reason ?? null,
    },
  });
}

export async function PATCH(request: Request) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (memberships.length === 0) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const payload = settingsSchema.safeParse(await request.json());
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  const allowedOrganisationIds = new Set(memberships.map((m: any) => m.organisation_id));
  if (!allowedOrganisationIds.has(payload.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const { error } = await db.from("organisation_link_settings").upsert({
    organisation_id: payload.data.organisationId,
    allow_email_domain: payload.data.allowEmailDomain,
    allow_work_id: payload.data.allowWorkId,
    require_invite: payload.data.requireInvite,
    auto_approve_links: payload.data.autoApproveLinks,
    work_id_regex: payload.data.workIdRegex?.trim() || null,
    ...(payload.data.rosterIdCaseMode ? { roster_id_case_mode: payload.data.rosterIdCaseMode } : {}),
  }, { onConflict: "organisation_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

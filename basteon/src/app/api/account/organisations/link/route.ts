import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId, emailDomain } from "@/lib/organisation";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  organisationId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  label: z.enum(["work", "school", "home", "other"]).default("other"),
  method: z.enum(["email_domain", "work_id"]),
  identifier: z.string().min(2),
  placeAddress: z.string().optional().nullable(),
});

function membershipFromDomain(domain: string, rules: Array<{ domain: string; membership_type: string }>) {
  const match = rules
    .slice()
    .sort((a: any, b: any) => (a.priority ?? 100) - (b.priority ?? 100))
    .find((r) => domain === r.domain || domain.endsWith(`.${r.domain}`));
  return match?.membership_type ?? "general";
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { data, error } = await db
    .from("organisation_user_links")
    .select("id,label,method,identifier,membership_type,status,place_address,created_at,organisation_id,branch_id,organisations(id,name,slug,organisation_type),organisation_branches(id,name,city)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = schema.safeParse(await request.json());
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  const input = payload.data;
  const db = createAdminClient();
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  const [{ data: settings }, { data: domains }] = await Promise.all([
    db.from("organisation_link_settings").select("*").eq("organisation_id", input.organisationId).maybeSingle(),
    db.from("organisation_domains").select("domain,membership_type,priority").eq("organisation_id", input.organisationId),
  ]);
  if (!settings) return NextResponse.json({ error: "Organisation not configured for linking" }, { status: 400 });

  let membershipType = "general";
  if (input.method === "email_domain") {
    if (!settings.allow_email_domain) return NextResponse.json({ error: "This organisation does not accept email-domain linking." }, { status: 400 });
    const userEmail = authData.user?.email?.toLowerCase() ?? "";
    const domain = emailDomain(input.identifier.toLowerCase());
    if (!userEmail || emailDomain(userEmail) !== domain) return NextResponse.json({ error: "Identifier must match your signed-in email domain." }, { status: 400 });
    membershipType = membershipFromDomain(domain, domains ?? []);
  } else {
    if (!settings.allow_work_id) return NextResponse.json({ error: "This organisation does not accept work-ID linking." }, { status: 400 });
    if (settings.work_id_regex) {
      const regex = new RegExp(settings.work_id_regex);
      if (!regex.test(input.identifier.trim())) return NextResponse.json({ error: "Work ID format is not valid for this organisation." }, { status: 400 });
    }
  }

  const status = settings.require_invite ? "pending" : "active";
  const role = membershipType === "security" ? "responder" : "member";
  const source = input.method;
  const identifier = input.identifier.trim();

  const [{ error: linkError }, { error: memberError }] = await Promise.all([
    db.from("organisation_user_links").upsert({
      user_id: userId,
      organisation_id: input.organisationId,
      branch_id: input.branchId || null,
      label: input.label,
      place_address: input.placeAddress?.trim() || null,
      method: input.method,
      identifier,
      membership_type: membershipType,
      status,
    }, { onConflict: "user_id,organisation_id,label" }),
    db.from("organisation_memberships").upsert({
      organisation_id: input.organisationId,
      user_id: userId,
      branch_id: input.branchId || null,
      membership_type: membershipType,
      role,
      status,
      source,
      linked_identifier: identifier,
    }, { onConflict: "organisation_id,user_id" }),
  ]);
  if (linkError || memberError) return NextResponse.json({ error: linkError?.message ?? memberError?.message ?? "Could not link organisation" }, { status: 400 });
  return NextResponse.json({ ok: true, status, membershipType });
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organisationId = typeof body.organisationId === "string" ? body.organisationId : "";
  if (!organisationId) return NextResponse.json({ error: "organisationId required" }, { status: 400 });
  const db = createAdminClient();
  await Promise.all([
    db.from("organisation_user_links").delete().eq("user_id", userId).eq("organisation_id", organisationId),
    db.from("organisation_memberships").delete().eq("user_id", userId).eq("organisation_id", organisationId).eq("source", "email_domain"),
  ]);
  return NextResponse.json({ ok: true });
}

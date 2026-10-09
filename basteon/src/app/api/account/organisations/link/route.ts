import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId } from "@/lib/organisation";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/verification/http";
import { validateAndLinkOrganisation } from "@/lib/orgLinkValidation";

const schema = z.object({
  organisationId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  label: z.enum(["work", "school", "home", "other"]).default("other"),
  method: z.enum(["email_domain", "work_id"]).optional(),
  identifierType: z.enum(["email", "member_id", "access_code"]).optional(),
  identifier: z.string().min(2),
  placeAddress: z.string().optional().nullable(),
});
const patchSchema = z.object({
  organisationId: z.string().uuid(),
  label: z.enum(["work", "school", "home", "other"]).optional(),
  identifier: z.string().min(2).optional(),
  placeAddress: z.string().optional().nullable(),
});

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { data, error } = await db
    .from("organisation_user_links")
    .select("id,label,method,identifier,membership_type,status,place_address,created_at,organisation_id,branch_id,roster_entry_id,org_roster_entries(status,valid_until),organisations(id,name,slug,organisation_type,support_email,support_phone),organisation_branches(id,name,city)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = schema.safeParse(await request.json());
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  const input = payload.data;
  const identifierType = input.identifierType ?? (input.method === "email_domain" ? "email" : "member_id");
  const forwarded = request.headers.get("x-forwarded-for");
  const result = await validateAndLinkOrganisation({
    userId: user.id,
    organisationId: input.organisationId,
    branchId: input.branchId ?? null,
    identifierType,
    identifier: input.identifier,
    label: input.label,
    placeAddress: input.placeAddress ?? null,
    ipAddress: forwarded ? forwarded.split(",")[0]?.trim() ?? null : request.headers.get("x-real-ip"),
  });
  const status = result.code === "RATE_LIMITED" ? 429 : 200;
  return NextResponse.json(result, { status });
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organisationId = typeof body.organisationId === "string" ? body.organisationId : "";
  if (!organisationId) return NextResponse.json({ error: "organisationId required" }, { status: 400 });
  const db = createAdminClient();
  const { data: links } = await db.from("organisation_user_links")
    .select("id,roster_entry_id")
    .eq("user_id", userId)
    .eq("organisation_id", organisationId);
  const rosterLink = (links ?? []).find((link: any) => link.roster_entry_id);
  if (rosterLink) {
    await db.from("org_roster_audit_log").insert({
      org_id: organisationId,
      actor_id: userId,
      action: "user_unlinked",
      entry_id: rosterLink.roster_entry_id,
      details: {},
    });
    await Promise.all([
      db.from("organisation_user_links").update({ status: "unlinked" }).eq("user_id", userId).eq("organisation_id", organisationId),
      db.from("organisation_memberships").update({ status: "unlinked" }).eq("user_id", userId).eq("organisation_id", organisationId).eq("roster_entry_id", rosterLink.roster_entry_id),
    ]);
  } else {
    await Promise.all([
      db.from("organisation_user_links").delete().eq("user_id", userId).eq("organisation_id", organisationId),
      db.from("organisation_memberships").delete().eq("user_id", userId).eq("organisation_id", organisationId).in("source", ["email_domain", "work_id"]),
    ]);
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  const input = payload.data;
  const updates: Record<string, unknown> = {};
  if (input.label) updates.label = input.label;
  if (input.identifier) updates.identifier = input.identifier.trim();
  if (input.placeAddress !== undefined) updates.place_address = input.placeAddress?.trim() || null;
  if (!Object.keys(updates).length) return NextResponse.json({ error: "No updates provided." }, { status: 400 });
  const db = createAdminClient();
  const { error } = await db
    .from("organisation_user_links")
    .update(updates)
    .eq("user_id", userId)
    .eq("organisation_id", input.organisationId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

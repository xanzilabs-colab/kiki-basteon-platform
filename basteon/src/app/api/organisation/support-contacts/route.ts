import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";

const createSchema = z.object({
  organisationId: z.string().uuid(),
  contactName: z.string().min(2),
  contactType: z.enum(["email", "phone"]),
  contactValue: z.string().min(3),
  purpose: z.string().min(2),
});

const removeSchema = z.object({
  organisationId: z.string().uuid(),
  id: z.string().uuid(),
});

export async function GET(request: Request) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager", "dispatcher", "responder", "viewer"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!memberships.length) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const organisationId = (url.searchParams.get("organisationId") || memberships[0]?.organisation_id || "") as string;
  if (!memberships.some((m: any) => m.organisation_id === organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createAdminClient();
  const [global, organisation] = await Promise.all([
    db.from("support_contacts").select("*").eq("scope", "global").eq("active", true).order("purpose", { ascending: true }).order("contact_name", { ascending: true }),
    db.from("support_contacts").select("*").eq("scope", "organisation").eq("organisation_id", organisationId).eq("active", true).order("purpose", { ascending: true }).order("contact_name", { ascending: true }),
  ]);
  if (global.error) return NextResponse.json({ error: global.error.message }, { status: 400 });
  if (organisation.error) return NextResponse.json({ error: organisation.error.message }, { status: 400 });
  return NextResponse.json({ global: global.data ?? [], organisation: organisation.data ?? [] });
}

export async function POST(request: Request) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (!memberships.some((m: any) => m.organisation_id === parsed.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createAdminClient();
  const { error } = await db.from("support_contacts").insert({
    scope: "organisation",
    organisation_id: parsed.data.organisationId,
    contact_name: parsed.data.contactName,
    contact_type: parsed.data.contactType,
    contact_value: parsed.data.contactValue,
    purpose: parsed.data.purpose,
    created_by: userId,
    active: true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { userId, memberships } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = removeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (!memberships.some((m: any) => m.organisation_id === parsed.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createAdminClient();
  const { error } = await db.from("support_contacts")
    .delete()
    .eq("id", parsed.data.id)
    .eq("scope", "organisation")
    .eq("organisation_id", parsed.data.organisationId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

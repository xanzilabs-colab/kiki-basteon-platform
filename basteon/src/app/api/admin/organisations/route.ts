import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { randomPassword, slugifyOrganisation } from "@/lib/organisation";
import { renderSimpleCredentialPdf } from "@/lib/pdf";

async function allowed() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  const { data } = user ? await client.from("profiles").select("role").eq("id", user.id).single() : { data: null };
  return data?.role === "admin";
}

export async function GET() {
  if (!await allowed()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const db = createAdminClient();
  const { data, error } = await db
    .from("organisations")
    .select("id,name,slug,organisation_type,institution_kind,business_category,responder_category,status,created_at,organisation_branches(id,name),organisation_memberships(id)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

const createSchema = z.object({
  name: z.string().min(2),
  organisationType: z.enum(["institution", "business", "responder_partner"]),
  isPartner: z.boolean().optional().default(false),
  category: z.string().optional().nullable(),
  ownerFullName: z.string().min(2),
  ownerEmail: z.string().email(),
  ownerPhone: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  if (!await allowed()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  const effectiveType = input.isPartner ? "responder_partner" : input.organisationType;
  const db = createAdminClient();
  const password = randomPassword(16);
  const { data: authCreated, error: authError } = await db.auth.admin.createUser({
    email: input.ownerEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.ownerFullName, phone: input.ownerPhone ?? null },
  });
  if (authError || !authCreated.user) return NextResponse.json({ error: authError?.message ?? "Could not create owner account" }, { status: 400 });

  const baseSlug = slugifyOrganisation(input.name) || "organisation";
  let slug = baseSlug;
  for (let i = 0; i < 6; i++) {
    const { data: existing } = await db.from("organisations").select("id").eq("slug", slug).maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${Math.floor(100 + Math.random() * 899)}`;
  }

  const orgPayload: Record<string, unknown> = {
    name: input.name,
    slug,
    organisation_type: effectiveType,
    created_by: authCreated.user.id,
    support_email: input.ownerEmail,
    support_phone: input.ownerPhone ?? null,
  };
  if (effectiveType === "institution") orgPayload.institution_kind = input.category ?? null;
  if (effectiveType === "business") orgPayload.business_category = input.category ?? null;
  if (effectiveType === "responder_partner") orgPayload.responder_category = input.category ?? null;

  const { data: org, error: orgError } = await db.from("organisations").insert(orgPayload).select("id,name").single();
  if (orgError || !org) {
    await db.auth.admin.deleteUser(authCreated.user.id);
    return NextResponse.json({ error: orgError?.message ?? "Could not create organisation" }, { status: 400 });
  }

  const { data: branch } = await db.from("organisation_branches").insert({
    organisation_id: org.id,
    name: "Main Branch",
    is_hq: true,
  }).select("id").single();

  await Promise.all([
    db.from("profiles").update({ role: "responder", full_name: input.ownerFullName, phone: input.ownerPhone ?? null }).eq("id", authCreated.user.id),
    db.from("organisation_memberships").insert({
      organisation_id: org.id,
      user_id: authCreated.user.id,
      branch_id: branch?.id ?? null,
      membership_type: "staff",
      role: "owner",
      status: "active",
      source: "admin_create",
      created_by: authCreated.user.id,
    }),
    db.from("organisation_link_settings").insert({ organisation_id: org.id }),
    db.from("organisation_onboarding").insert({ organisation_id: org.id }),
  ]);

  return NextResponse.json({
    ok: true,
    organisation: org,
    credentials: { email: input.ownerEmail, password },
    credentialPdfBase64: renderSimpleCredentialPdf([
      "BASTEON Organisation Owner Credentials",
      `Organisation: ${org.name}`,
      `Name: ${input.ownerFullName}`,
      `Email: ${input.ownerEmail}`,
      `Password: ${password}`,
      `Generated: ${new Date().toISOString()}`,
      "Change the password after first sign in.",
    ]).toString("base64"),
  }, { status: 201 });
}

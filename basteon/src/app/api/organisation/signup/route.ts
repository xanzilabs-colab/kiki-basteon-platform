import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailDomain, randomPassword, slugifyOrganisation } from "@/lib/organisation";

const schema = z.object({
  organisationName: z.string().min(2),
  legalName: z.string().optional().nullable(),
  displayName: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  category: z.string().optional().nullable(),
  organisationType: z.enum(["institution", "business", "responder_partner"]),
  institutionKind: z.string().optional().nullable(),
  businessCategory: z.string().optional().nullable(),
  responderCategory: z.string().optional().nullable(),
  fullName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  password: z.string().min(8).optional(),
  branchName: z.string().min(2).default("Main Branch"),
  branchAddress: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  const payload = schema.safeParse(await request.json());
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  const data = payload.data;
  const admin = createAdminClient();
  const password = data.password || randomPassword(16);

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: data.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: data.fullName, phone: data.phone ?? null },
  });
  if (authError || !created.user) {
    return NextResponse.json({ error: authError?.message ?? "Could not create account" }, { status: 400 });
  }

  const baseSlug = slugifyOrganisation(data.organisationName) || "organisation";
  let slug = baseSlug;
  for (let i = 0; i < 6; i++) {
    const { data: existing } = await admin.from("organisations").select("id").eq("slug", slug).maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${Math.floor(100 + Math.random() * 899)}`;
  }

  const { data: organisation, error: organisationError } = await admin
    .from("organisations")
    .insert({
      name: data.organisationName.trim(),
      legal_name: data.legalName?.trim() || null,
      display_name: data.displayName?.trim() || null,
      description: data.description?.trim() || null,
      logo_url: data.logoUrl?.trim() || null,
      category: data.category?.trim() || null,
      slug,
      organisation_type: data.organisationType,
      institution_kind: data.institutionKind?.trim() || null,
      business_category: data.businessCategory?.trim() || null,
      responder_category: data.responderCategory?.trim() || null,
      support_email: data.email.toLowerCase(),
      support_phone: data.phone?.trim() || null,
      created_by: created.user.id,
    })
    .select("id,name,slug")
    .single();

  if (organisationError || !organisation) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: organisationError?.message ?? "Could not create organisation" }, { status: 400 });
  }

  const { data: branch } = await admin
    .from("organisation_branches")
    .insert({
      organisation_id: organisation.id,
      name: data.branchName.trim(),
      address: data.branchAddress?.trim() || null,
      is_hq: true,
    })
    .select("id")
    .single();

  await Promise.all([
    admin.from("organisation_memberships").insert({
      organisation_id: organisation.id,
      user_id: created.user.id,
      branch_id: branch?.id ?? null,
      membership_type: "staff",
      role: "owner",
      source: "signup",
      linked_identifier: data.email.toLowerCase(),
      created_by: created.user.id,
    }),
    admin.from("organisation_link_settings").insert({
      organisation_id: organisation.id,
      allow_email_domain: true,
      allow_work_id: true,
      auto_approve_links: true,
    }),
    admin.from("organisation_onboarding").insert({
      organisation_id: organisation.id,
      organisation_profile_done: true,
    }),
    admin.from("organisation_domains").insert({
      organisation_id: organisation.id,
      domain: emailDomain(data.email),
      membership_type: data.organisationType === "institution" ? "student" : "staff",
      role_hint: "member",
      priority: 100,
    }),
    admin.from("profiles").update({
      full_name: data.fullName,
      phone: data.phone?.trim() || null,
    }).eq("id", created.user.id),
  ]);

  return NextResponse.json({
    ok: true,
    organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
    credentials: data.password ? null : { email: data.email.toLowerCase(), password },
  }, { status: 201 });
}

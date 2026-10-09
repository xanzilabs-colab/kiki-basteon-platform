import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emailDomain, slugifyOrganisation } from "@/lib/organisation";
import { sameOrigin } from "@/lib/verification/http";

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
  email: z.string().email().transform((email) => email.trim().toLowerCase()),
  phone: z.string().optional().nullable(),
  password: z.string().min(8)
    .regex(/[A-Z]/, "Password must include an uppercase letter.")
    .regex(/[a-z]/, "Password must include a lowercase letter.")
    .regex(/\d/, "Password must include a number.")
    .regex(/[^A-Za-z0-9]/, "Password must include a symbol."),
  branchName: z.string().min(2).default("Main Branch"),
  branchAddress: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const payload = schema.safeParse(await request.json());
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  const data = payload.data;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "Email verification is required." }, { status: 401 });
  if (!user.email_confirmed_at || user.email?.trim().toLowerCase() !== data.email) {
    return NextResponse.json({ error: "Verify the administrator email address before creating the organisation." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, {
    password: data.password,
    user_metadata: { full_name: data.fullName, phone: data.phone ?? null },
  });
  if (passwordError) return NextResponse.json({ error: passwordError.message }, { status: 400 });

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
      created_by: user.id,
    })
    .select("id,name,slug")
    .single();

  if (organisationError || !organisation) {
    return NextResponse.json({ error: organisationError?.message ?? "Could not create organisation" }, { status: 400 });
  }

  const { data: branch, error: branchError } = await admin
    .from("organisation_branches")
    .insert({
      organisation_id: organisation.id,
      name: data.branchName.trim(),
      address: data.branchAddress?.trim() || null,
      is_hq: true,
    })
    .select("id")
    .single();
  if (branchError) return NextResponse.json({ error: branchError.message }, { status: 500 });

  const setupResults = await Promise.all([
    admin.from("organisation_memberships").insert({
      organisation_id: organisation.id,
      user_id: user.id,
      branch_id: branch?.id ?? null,
      membership_type: "staff",
      role: "owner",
      source: "signup",
      linked_identifier: data.email.toLowerCase(),
      created_by: user.id,
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
    }).eq("id", user.id),
  ]);
  const setupError = setupResults.find((result) => result.error)?.error;
  if (setupError) return NextResponse.json({ error: setupError.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    organisation: { id: organisation.id, name: organisation.name, slug: organisation.slug },
  }, { status: 201 });
}

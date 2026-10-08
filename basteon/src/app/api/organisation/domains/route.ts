import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";
import { roleHintForMembershipType } from "@/lib/organisationCategories";

const createSchema = z.object({
  organisationId: z.string().uuid(),
  domain: z.string().min(3),
  membershipType: z.string().min(2),
  roleHint: z.string().optional().nullable(),
  priority: z.number().int().min(1).max(1000).optional(),
});

const deleteSchema = z.object({
  organisationId: z.string().uuid(),
  id: z.string().uuid(),
});

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

export async function POST(request: Request) {
  const { memberships, userId } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = createSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  if (!memberships.some((membership: any) => membership.organisation_id === payload.data.organisationId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const domain = normalizeDomain(payload.data.domain);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return NextResponse.json({ error: "Domain format is invalid." }, { status: 400 });

  const db = createAdminClient();
  const { data, error } = await db.from("organisation_domains").insert({
    organisation_id: payload.data.organisationId,
    domain,
    membership_type: payload.data.membershipType,
    role_hint: payload.data.roleHint?.trim() || roleHintForMembershipType(payload.data.membershipType),
    priority: payload.data.priority ?? 100,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const { memberships, userId } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  if (!memberships.some((membership: any) => membership.organisation_id === payload.data.organisationId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = createAdminClient();
  const { error } = await db.from("organisation_domains").delete().eq("id", payload.data.id).eq("organisation_id", payload.data.organisationId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

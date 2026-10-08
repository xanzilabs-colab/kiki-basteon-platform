import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";

const createSchema = z.object({
  organisationId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  emergencyTypeCode: z.string().min(2),
  priority: z.number().int().min(1).max(1000).optional(),
});

const deleteSchema = z.object({
  organisationId: z.string().uuid(),
  id: z.string().uuid(),
});

export async function POST(request: Request) {
  const { memberships, userId } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = createSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  if (!memberships.some((membership: any) => membership.organisation_id === payload.data.organisationId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = createAdminClient();
  const { data, error } = await db.from("organisation_emergency_coverage").upsert({
    organisation_id: payload.data.organisationId,
    branch_id: payload.data.branchId ?? null,
    emergency_type_code: payload.data.emergencyTypeCode,
    priority: payload.data.priority ?? 100,
    active: true,
  }, { onConflict: "organisation_id,branch_id,emergency_type_code" }).select("*").single();
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
  const { error } = await db.from("organisation_emergency_coverage").delete().eq("id", payload.data.id).eq("organisation_id", payload.data.organisationId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}


import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";

const createSchema = z.object({
  organisationId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string().min(2),
  unitType: z.string().min(2).default("other"),
  capabilityCodes: z.array(z.string().min(2)).default([]),
});

const patchSchema = z.object({
  organisationId: z.string().uuid(),
  unitId: z.string().uuid(),
  active: z.boolean().optional(),
  name: z.string().min(2).optional(),
  unitType: z.string().min(2).optional(),
});

export async function GET(request: Request) {
  const organisationId = new URL(request.url).searchParams.get("organisationId");
  const { memberships, userId } = await requireOrganisationAccess();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!organisationId) return NextResponse.json({ error: "organisationId required" }, { status: 400 });
  if (!memberships.some((membership: any) => membership.organisation_id === organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const { data, error } = await db.from("organisation_units").select("*").eq("organisation_id", organisationId).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const { memberships, userId } = await requireOrganisationAccess(["owner", "admin", "manager", "dispatcher"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = createSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  if (!memberships.some((membership: any) => membership.organisation_id === payload.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const { data, error } = await db.from("organisation_units").insert({
    organisation_id: payload.data.organisationId,
    branch_id: payload.data.branchId,
    name: payload.data.name.trim(),
    unit_type: payload.data.unitType.trim().toLowerCase(),
    capability_codes: payload.data.capabilityCodes,
    active: true,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const { memberships, userId } = await requireOrganisationAccess(["owner", "admin", "manager", "dispatcher"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = patchSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  if (!memberships.some((membership: any) => membership.organisation_id === payload.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const patch: Record<string, unknown> = {};
  if (payload.data.active !== undefined) patch.active = payload.data.active;
  if (payload.data.name) patch.name = payload.data.name.trim();
  if (payload.data.unitType) patch.unit_type = payload.data.unitType.trim().toLowerCase();

  const db = createAdminClient();
  const { data, error } = await db.from("organisation_units")
    .update(patch)
    .eq("id", payload.data.unitId)
    .eq("organisation_id", payload.data.organisationId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}


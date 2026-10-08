import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId, requireOrganisationAccess } from "@/lib/organisation";

const schema = z.object({
  organisationId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  availability: z.enum(["available", "en_route", "on_scene", "busy", "off_duty", "unavailable"]),
  branchId: z.string().uuid().optional().nullable(),
  unitId: z.string().uuid().optional().nullable(),
  lastLat: z.number().min(-90).max(90).optional().nullable(),
  lastLng: z.number().min(-180).max(180).optional().nullable(),
});

export async function GET(request: Request) {
  const organisationId = new URL(request.url).searchParams.get("organisationId");
  const { memberships, userId } = await requireOrganisationAccess();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!organisationId) return NextResponse.json({ error: "organisationId required" }, { status: 400 });
  if (!memberships.some((membership: any) => membership.organisation_id === organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const { data, error } = await db
    .from("responder_presence")
    .select("user_id,branch_id,unit_id,availability,last_lat,last_lng,last_seen_at,profiles(full_name)")
    .eq("organisation_id", organisationId)
    .order("last_seen_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function PATCH(request: Request) {
  const actorId = await currentUserId();
  if (!actorId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = schema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });

  const { memberships } = await requireOrganisationAccess(["owner", "admin", "manager", "dispatcher", "responder"]);
  const ownMembership = memberships.find((membership: any) => membership.organisation_id === payload.data.organisationId);
  if (!ownMembership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const targetUserId = payload.data.userId ?? actorId;
  const privileged = ["owner", "admin", "manager", "dispatcher"].includes(ownMembership.role);
  if (!privileged && targetUserId !== actorId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const branchId = payload.data.branchId ?? ownMembership.branch_id ?? null;
  const { data, error } = await db.from("responder_presence").upsert({
    user_id: targetUserId,
    organisation_id: payload.data.organisationId,
    branch_id: branchId,
    unit_id: payload.data.unitId ?? null,
    availability: payload.data.availability,
    last_lat: payload.data.lastLat ?? null,
    last_lng: payload.data.lastLng ?? null,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "user_id" }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}


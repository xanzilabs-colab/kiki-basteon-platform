import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId, requireOrganisationAccess } from "@/lib/organisation";

const schema = z.object({
  organisationId: z.string().uuid(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
}).refine(({ lat, lng }) => (lat == null) === (lng == null));

/** Heartbeat for the responder's own position. Never changes availability and is ignored while off duty. */
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = schema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { memberships } = await requireOrganisationAccess(["owner", "admin", "manager", "dispatcher", "responder"]);
  if (!memberships.some((membership: any) => membership.organisation_id === payload.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const update: { last_seen_at: string; last_lat?: number; last_lng?: number } = {
    last_seen_at: new Date().toISOString(),
  };
  if (payload.data.lat != null && payload.data.lng != null) {
    update.last_lat = payload.data.lat;
    update.last_lng = payload.data.lng;
  }
  const { data, error } = await db.from("responder_presence")
    .update(update)
    .eq("user_id", userId)
    .eq("organisation_id", payload.data.organisationId)
    .not("availability", "in", "(off_duty,unavailable)")
    .select("availability");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ updated: (data ?? []).length > 0 });
}

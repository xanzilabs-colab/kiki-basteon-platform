import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganisationAccess } from "@/lib/organisation";

const schema = z.object({
  organisationId: z.string().uuid(),
  name: z.string().min(2),
  code: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  geofenceGeojson: z.any().optional().nullable(),
  isHq: z.boolean().optional(),
});

function validGeofence(geojson: unknown) {
  if (geojson == null) return true;
  if (typeof geojson !== "object") return false;
  const value = geojson as { type?: string; coordinates?: unknown };
  if (value.type !== "Polygon" || !Array.isArray(value.coordinates) || value.coordinates.length === 0) return false;
  const ring = value.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  return ring.every((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
}

export async function POST(request: Request) {
  const { memberships, userId } = await requireOrganisationAccess(["owner", "admin", "manager"]);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (memberships.length === 0) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const payload = schema.safeParse(await request.json());
  if (!payload.success) return NextResponse.json({ error: payload.error.flatten() }, { status: 400 });
  if (!validGeofence(payload.data.geofenceGeojson)) return NextResponse.json({ error: "Invalid geofence polygon." }, { status: 400 });
  const allowed = new Set(memberships.map((m: any) => m.organisation_id));
  if (!allowed.has(payload.data.organisationId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const db = createAdminClient();
  const { data, error } = await db.from("organisation_branches").insert({
    organisation_id: payload.data.organisationId,
    name: payload.data.name.trim(),
    code: payload.data.code?.trim() || null,
    address: payload.data.address?.trim() || null,
    city: payload.data.city?.trim() || null,
    lat: payload.data.lat ?? null,
    lng: payload.data.lng ?? null,
    geofence_geojson: payload.data.geofenceGeojson ?? null,
    is_hq: payload.data.isHq ?? false,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

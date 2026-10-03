import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTripUser } from "../_shared";

const querySchema = z.object({ query: z.string().trim().min(3).max(160) });

export async function POST(request: Request) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = querySchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });

  const base = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
  const response = await fetch(`${base}/search?format=jsonv2&limit=5&countrycodes=za&q=${encodeURIComponent(input.data.query)}`, {
    headers: { "User-Agent": "KikiConnect-Hamba/1.0" },
    next: { revalidate: 300 },
  });
  if (!response.ok) return NextResponse.json({ error: "geocoding_unavailable" }, { status: 502 });
  const results = await response.json() as Array<{ display_name: string; lat: string; lon: string }>;
  return NextResponse.json(results.map((result) => ({ label: result.display_name, lat: Number(result.lat), lng: Number(result.lon) })));
}
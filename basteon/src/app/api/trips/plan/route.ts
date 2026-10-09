import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTripUser } from "../_shared";

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const inputSchema = z.object({ origin: point, destination: point, mode: z.enum(["taxi", "walk", "ehail", "bus", "train"]) });

export async function POST(request: Request) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = inputSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_route_request" }, { status: 400 });
  const { origin, destination, mode } = input.data;
  const profile = mode === "walk" ? "foot" : "driving";
  const base = process.env.OSRM_URL ?? process.env.NEXT_PUBLIC_OSRM_URL ?? "https://router.project-osrm.org";
  const response = await fetch(`${base}/route/v1/${profile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&alternatives=true`, { cache: "no-store" });
  if (!response.ok && mode === "walk") {
    const latitudeScale = 111_320;
    const longitudeScale = Math.cos(origin.lat * Math.PI / 180) * 111_320;
    const distanceM = Math.round(Math.hypot((destination.lat - origin.lat) * latitudeScale, (destination.lng - origin.lng) * longitudeScale));
    return NextResponse.json({ routes: [{ distanceM, durationS: Math.max(60, Math.round(distanceM / 1.35)), points: [origin, destination] }] });
  }
  if (!response.ok) return NextResponse.json({ error: "routing_unavailable" }, { status: 502 });
  const data = await response.json() as { routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }> };
  if (!data.routes?.length) return NextResponse.json({ error: "route_not_found" }, { status: 404 });
  const routes = data.routes.slice(0, 3).map((route) => ({
    distanceM: Math.round(route.distance),
    durationS: Math.round(route.duration),
    points: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
  }));
  return NextResponse.json({ routes });
}
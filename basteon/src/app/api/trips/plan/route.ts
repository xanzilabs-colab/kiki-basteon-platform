import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTripUser } from "../_shared";

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const inputSchema = z.object({ origin: point, destination: point, mode: z.enum(["taxi", "walk", "ehail", "bus", "train", "cycling"]), waypoints: z.array(point).max(10).optional() });

export async function POST(request: Request) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = inputSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_route_request" }, { status: 400 });
  const { origin, destination, mode } = input.data;
  const via = (input.data.waypoints ?? []).map((p) => `${p.lng},${p.lat}`);
  const coordinates = [`${origin.lng},${origin.lat}`, ...via, `${destination.lng},${destination.lat}`].join(";");
  const profile = mode === "walk" ? "foot" : "driving";
  const defaultBase = mode === "cycling" ? "https://routing.openstreetmap.de/routed-bike" : "https://router.project-osrm.org";
  const base = mode === "cycling" ? (process.env.OSRM_BIKE_URL ?? defaultBase) : (process.env.OSRM_URL ?? process.env.NEXT_PUBLIC_OSRM_URL ?? defaultBase);
  const response = await fetch(`${base}/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&alternatives=${via.length === 0}`, { cache: "no-store" }).catch(() => null);
  if ((!response || !response.ok) && (mode === "walk" || mode === "cycling")) {
    const latitudeScale = 111_320;
    const longitudeScale = Math.cos(origin.lat * Math.PI / 180) * 111_320;
    const line = [origin, ...(input.data.waypoints ?? []), destination];
    const distanceM = Math.round(line.slice(1).reduce((sum, p, i) => sum + Math.hypot((p.lat - line[i].lat) * latitudeScale, (p.lng - line[i].lng) * longitudeScale), 0));
    const speed = mode === "cycling" ? 4.2 : 1.35;
    return NextResponse.json({ estimated: true, routes: [{ distanceM, durationS: Math.max(60, Math.round(distanceM / speed)), points: line }] });
  }
  if (!response?.ok) return NextResponse.json({ error: "routing_unavailable" }, { status: 502 });
  const data = await response.json() as { routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }> };
  if (!data.routes?.length) return NextResponse.json({ error: "route_not_found" }, { status: 404 });
  const routes = data.routes.slice(0, 3).map((route) => ({
    distanceM: Math.round(route.distance),
    durationS: Math.round(route.duration),
    points: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
  }));
  return NextResponse.json({ routes });
}
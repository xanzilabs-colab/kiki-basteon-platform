// lib/buddies/meeting/overpass.ts
// Live landmark lookup from OpenStreetMap (Overpass API). SERVER ONLY.
// Fails soft: any error returns [] and the engine falls back to curated spots.
import type { LatLng, MeetCategory, RawCandidate } from "./types";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: RawCandidate[] }>();

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function buildLandmarkQuery(center: LatLng, radiusM: number): string {
  const a = `around:${Math.round(radiusM)},${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
  return `[out:json][timeout:12];
(
  nwr(${a})["name"]["amenity"~"^(police|hospital|fuel|cafe|restaurant|school|place_of_worship|bus_station|taxi)$"];
  nwr(${a})["name"]["shop"~"^(mall|supermarket)$"];
  node(${a})["name"]["highway"="bus_stop"];
  nwr(${a})["name"]["public_transport"="station"];
);
out center tags 150;`;
}

export function categoryFromTags(t: Record<string, string>): MeetCategory | null {
  switch (t.amenity) {
    case "police":
      return "police_station";
    case "hospital":
      return "hospital";
    case "fuel":
      return "petrol_station";
    case "cafe":
    case "restaurant":
      return "cafe_restaurant";
    case "school":
      return "school";
    case "place_of_worship":
      return "place_of_worship";
    case "bus_station":
      return "transit_hub";
    case "taxi":
      return "taxi_rank";
    default:
      break;
  }
  if (t.shop === "mall") return "mall";
  if (t.shop === "supermarket") return "supermarket";
  if (t.highway === "bus_stop") return "bus_stop";
  if (t.public_transport === "station") return "transit_hub";
  return null;
}

export function cleanName(raw: string): string | null {
  const s = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/(https?:\/\/|www\.)\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return s.length >= 2 ? s : null;
}

export function parseElements(elements: unknown): RawCandidate[] {
  if (!Array.isArray(elements)) return [];
  const out: RawCandidate[] = [];
  for (const e of elements as OverpassElement[]) {
    if (!e || typeof e !== "object" || !e.tags) continue;
    if (e.tags.access === "private" || e.tags.access === "no") continue;
    const category = categoryFromTags(e.tags);
    const name = typeof e.tags.name === "string" ? cleanName(e.tags.name) : null;
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (!category || !name || typeof lat !== "number" || typeof lng !== "number") continue;
    if (!["node", "way", "relation"].includes(e.type) || !Number.isInteger(e.id)) continue;
    const street = e.tags["addr:street"];
    const num = e.tags["addr:housenumber"];
    const address = street ? `${num ? `${num} ` : ""}${street}`.slice(0, 160) : null;
    out.push({
      source: "landmark",
      spotId: null,
      osmRef: `${e.type}/${e.id}`,
      name,
      category,
      lat,
      lng,
      address,
      openNow: null,
      open24h: false,
      quality: 3,
    });
  }
  return out;
}

export async function fetchLandmarks(center: LatLng, radiusM: number, userAgent: string): Promise<RawCandidate[]> {
  const key = `${center.lat.toFixed(2)},${center.lng.toFixed(2)},${Math.round(radiusM / 500)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const body = new URLSearchParams({ data: buildLandmarkQuery(center, radiusM) });
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent },
        body,
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const json: unknown = await res.json();
      const elements = typeof json === "object" && json !== null ? (json as { elements?: unknown }).elements : undefined;
      const data = parseElements(elements);
      cache.set(key, { at: Date.now(), data });
      return data;
    } catch {
      // try the next mirror
    }
  }
  return [];
}

export type GeocodedAddress = { label: string; lat: number; lng: number };

type NominatimResult = { display_name?: unknown; lat?: unknown; lon?: unknown };

export async function searchAddresses(query: string, limit = 5): Promise<GeocodedAddress[]> {
  const base = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
  const url = new URL("/search", base);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("countrycodes", "za");
  url.searchParams.set("q", query);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "KikiConnect-Hamba/1.0" },
      next: { revalidate: 300 },
    });
  } catch {
    throw new Error("geocoding_unavailable");
  }
  if (!response.ok) throw new Error("geocoding_unavailable");

  let results: NominatimResult[];
  try {
    results = await response.json() as NominatimResult[];
  } catch {
    throw new Error("geocoding_unavailable");
  }
  if (!Array.isArray(results)) throw new Error("geocoding_unavailable");

  return results.flatMap((result) => {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (typeof result.display_name !== "string" || !Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180) return [];
    return [{ label: result.display_name, lat, lng }];
  });
}

export async function geocodeAddress(query: string): Promise<GeocodedAddress> {
  const [result] = await searchAddresses(query, 1);
  if (!result) throw new Error("address_not_found");
  return result;
}

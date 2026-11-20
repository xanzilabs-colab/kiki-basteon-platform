export type GeoPoint = { lat: number; lng: number };
export type PrivacyZone = GeoPoint & { radius_m: number };

export const BUDDY_LOCATION_MAX_AGE_MS = 90_000;
const MAX_FUTURE_SKEW_MS = 15_000;

export function isFreshBuddyLocation(recordedAt: string, now = Date.now()) {
  const timestamp = Date.parse(recordedAt);
  return Number.isFinite(timestamp)
    && timestamp <= now + MAX_FUTURE_SKEW_MS
    && now - timestamp <= BUDDY_LOCATION_MAX_AGE_MS;
}

export function isInsidePrivacyZone(point: GeoPoint, zones: PrivacyZone[]) {
  const radians = (value: number) => value * Math.PI / 180;
  return zones.some((zone) => {
    const latDelta = radians(zone.lat - point.lat);
    const lngDelta = radians(zone.lng - point.lng);
    const a = Math.sin(latDelta / 2) ** 2
      + Math.cos(radians(point.lat)) * Math.cos(radians(zone.lat)) * Math.sin(lngDelta / 2) ** 2;
    const distance = 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return distance <= zone.radius_m;
  });
}

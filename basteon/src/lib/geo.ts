export interface Position { lat: number; lng: number; accuracy?: number; }
export const haversineKm = (a: Position, b: Position) => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat), dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
export const formatDistance = (km: number | null | undefined) => km == null ? "Distance unavailable" : km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`;
export const hasLocation = (value: { lat: number | null; lng: number | null }) => value.lat !== null && value.lng !== null;
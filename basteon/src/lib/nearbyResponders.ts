export const NEARBY_RADIUS_KM = Number(process.env.NEXT_PUBLIC_NEARBY_RESPONDER_RADIUS_KM) > 0
  ? Number(process.env.NEXT_PUBLIC_NEARBY_RESPONDER_RADIUS_KM)
  : 10;
export const PRESENCE_MAX_AGE_MS = 15 * 60 * 1000;
export const RESPONDER_ROLES = ["responder", "dispatcher"] as const;

export type PresenceRow = {
  user_id: string;
  organisation_id: string;
  availability: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_seen_at: string | null;
};
export type MembershipRow = { user_id: string; organisation_id: string; role: string; status?: string | null };
export type OrgRow = { id: string; name?: string | null; is_partner?: boolean; status?: string | null; blocked_until?: string | null };

export type NearbyResponder = {
  userId: string;
  organisationId: string;
  role: string;
  distanceKm: number;
};

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isOrganisationEligible(org: OrgRow, now = Date.now()) {
  if (org.status && org.status !== "active") return false;
  return !org.blocked_until || new Date(org.blocked_until).getTime() <= now;
}

/** Linked organisations take priority; partners are only used when the user has no eligible linked organisation. */
export function selectDiscoveryOrganisations(linkedIds: string[], orgs: OrgRow[], now = Date.now()) {
  const eligible = orgs.filter((org) => isOrganisationEligible(org, now));
  const linked = eligible.filter((org) => linkedIds.includes(org.id));
  if (linked.length) return { scope: "linked" as const, organisations: linked };
  return { scope: "partners" as const, organisations: eligible.filter((org) => org.is_partner === true) };
}

export function filterNearbyResponders(input: {
  origin: { lat: number; lng: number };
  organisationIds: string[];
  presence: PresenceRow[];
  memberships: MembershipRow[];
  excludeUserId?: string;
  radiusKm?: number;
  now?: number;
}): NearbyResponder[] {
  const radius = input.radiusKm ?? NEARBY_RADIUS_KM;
  const now = input.now ?? Date.now();
  const orgSet = new Set(input.organisationIds);
  const roles = new Map<string, string>();
  for (const member of input.memberships) {
    if (member.status && member.status !== "active") continue;
    if (!orgSet.has(member.organisation_id) || !(RESPONDER_ROLES as readonly string[]).includes(member.role)) continue;
    roles.set(`${member.organisation_id}:${member.user_id}`, member.role);
  }

  const best = new Map<string, NearbyResponder>();
  for (const row of input.presence) {
    if (row.availability !== "available" || row.user_id === input.excludeUserId) continue;
    if (!orgSet.has(row.organisation_id)) continue;
    const role = roles.get(`${row.organisation_id}:${row.user_id}`);
    if (!role) continue;
    const lat = row.last_lat == null ? NaN : Number(row.last_lat);
    const lng = row.last_lng == null ? NaN : Number(row.last_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : NaN;
    if (!Number.isFinite(seen) || now - seen > PRESENCE_MAX_AGE_MS) continue;
    const km = distanceKm(input.origin.lat, input.origin.lng, lat, lng);
    if (km > radius) continue;
    const existing = best.get(row.user_id);
    if (!existing || km < existing.distanceKm) {
      best.set(row.user_id, { userId: row.user_id, organisationId: row.organisation_id, role, distanceKm: km });
    }
  }
  return [...best.values()].sort((a, b) => a.distanceKm - b.distanceKm);
}

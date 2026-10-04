// INTERNAL types hold exact data and must NEVER be serialised to a client.
// Only NearbyAvatar (bottom of file) may leave the server.

export type LatLng = { lat: number; lng: number };
export type Mode = "walk" | "taxi" | "ehail" | "bus" | "train";
export type Audience = "all_verified" | "contacts_only";

export interface PrivacyZone {
  center: LatLng;
  radiusM: number; // home / work zone
}

/** One user's active trip as stored server-side. Map your DB rows to this. */
export interface BuddyPresence {
  userId: string;
  tripId: string;
  nickname: string;
  avatar: string; // emoji or avatar key
  position: LatLng; // exact, server only
  route: LatLng[]; // planned polyline, server only
  destination: LatLng; // exact, server only
  mode: Mode;
  leaveFrom: number; // epoch ms
  leaveTo: number; // epoch ms (leaveFrom + max wait)
  audience: Audience;
  contactIds: string[]; // saved trusted contacts
  blockedIds: string[]; // users blocked either direction
  privacyZones: PrivacyZone[];
  visible: boolean;
  verified: boolean;
  suspended: boolean;
  tripActive: boolean;
}

export interface AreaInfo {
  id: string; // stable id for the general area
  label: string | null; // suburb / ward name, or null if unknown
}
export type AreaResolver = (p: LatLng) => AreaInfo;

export type Badge =
  | "same_destination_area"
  | "going_your_way"
  | "leaving_soon"
  | "closest";

/** The ONLY shape a client ever receives about another user. */
export interface NearbyAvatar {
  ref: string; // opaque, per viewer + per trip; not the userId
  nickname: string;
  avatar: string;
  ring: number; // 0 = closest band
  angleDeg: number; // cosmetic only, NOT a real bearing
  radialPct: number; // cosmetic position inside the ring, 0..1
  badges: Badge[];
  destinationArea: string | null; // general area label only
  mode: Mode;
}

export interface PairBandState {
  band: number;
  pending: number | null;
  pendingCount: number;
  changedAt: number;
}

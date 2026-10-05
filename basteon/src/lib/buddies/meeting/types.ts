// lib/buddies/meeting/types.ts
// Shared types for the meeting-spot engine. Pure TypeScript, no browser/server APIs.

export type LatLng = { lat: number; lng: number };

export const MEET_CATEGORIES = [
  "petrol_station",
  "mall",
  "police_station",
  "hospital",
  "cafe_restaurant",
  "transit_hub",
  "other_public",
  "supermarket",
  "school",
  "place_of_worship",
  "bus_stop",
  "taxi_rank",
] as const;

export type MeetCategory = (typeof MEET_CATEGORIES)[number];

export function isMeetCategory(v: unknown): v is MeetCategory {
  return typeof v === "string" && (MEET_CATEGORIES as readonly string[]).includes(v);
}

export type MemberInput = {
  userId: string;
  location: LatLng;
  destination: LatLng | null;
};

export type RawCandidate = {
  source: "curated" | "landmark";
  spotId: string | null; // curated only
  osmRef: string | null; // landmark only, e.g. "node/123"
  name: string;
  category: MeetCategory;
  lat: number;
  lng: number;
  address: string | null;
  openNow: boolean | null; // null = unknown
  open24h: boolean;
  quality: number; // 1..5 (admin rating); landmarks use 3
};

export type ScoredCandidate = RawCandidate & {
  score: number; // 0..100
  distM: Record<string, number>; // userId -> estimated road distance in metres
  maxDistM: number;
  avgDistM: number;
  balanced: boolean; // fair for everyone
  nearbyAlerts: number;
};

export type MeetingZone = {
  center: LatLng;
  radiusM: number; // search radius around the centre
  idealMaxM: number; // best-case worst-case trip (road estimate)
};

export type RankInput = {
  members: MemberInput[];
  zone: MeetingZone;
  raw: RawCandidate[];
  alertPoints: LatLng[];
  excludeSpotIds: string[];
  excludeOsmRefs: string[];
  now: Date;
};

export type RankOptions = {
  minScore: number;
  minResults: number;
  maxResults: number;
  minSeparationM: number;
  maxPerCategory: number;
  nightStartHour: number; // local hour when "night" starts (inclusive)
  nightEndHour: number; // local hour when "night" ends (exclusive)
  alertRadiusM: number;
  timeZone: string;
};

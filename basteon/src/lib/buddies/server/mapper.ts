import "server-only";

import type { BuddyPresence, LatLng, PrivacyZone } from "@/lib/buddies";

type TripRow = {
  id: string; user_id: string; alias: string; avatar: string; start_lat: number; start_lng: number;
  destination_lat: number; destination_lng: number; route: unknown; mode: BuddyPresence["mode"];
  leave_from: string; leave_to: string; audience: BuddyPresence["audience"]; visible: boolean;
  active: boolean; expires_at: string;
};

type RoutePoint = { lat: number; lng: number };

function routePoints(value: unknown): RoutePoint[] {
  if (!Array.isArray(value)) return [];
  return value.filter((point): point is RoutePoint => Boolean(
    point && typeof point === "object" && typeof (point as RoutePoint).lat === "number" && typeof (point as RoutePoint).lng === "number",
  ));
}

export function toBuddyPresence(
  trip: TripRow,
  options: {
    position: LatLng;
    verified: boolean;
    suspended: boolean;
    contactIds: string[];
    blockedIds: string[];
    privacyZones: PrivacyZone[];
  },
): BuddyPresence {
  return {
    userId: trip.user_id,
    tripId: trip.id,
    nickname: trip.alias,
    avatar: trip.avatar,
    position: options.position,
    route: routePoints(trip.route),
    destination: { lat: trip.destination_lat, lng: trip.destination_lng },
    mode: trip.mode,
    leaveFrom: new Date(trip.leave_from).getTime(),
    leaveTo: new Date(trip.leave_to).getTime(),
    audience: trip.audience,
    contactIds: options.contactIds,
    blockedIds: options.blockedIds,
    privacyZones: options.privacyZones,
    visible: trip.visible,
    verified: options.verified,
    suspended: options.suspended,
    tripActive: trip.active && new Date(trip.expires_at).getTime() > Date.now(),
  };
}
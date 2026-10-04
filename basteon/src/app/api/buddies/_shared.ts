import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buddyHmacSecret, requireBuddiesEnabled, BuddiesUnavailableError } from "@/lib/buddies/server/runtime";
import { toBuddyPresence } from "@/lib/buddies/server/mapper";
import { buildNearbyView, type BuddyPresence, type PrivacyZone } from "@/lib/buddies";
import { safeJson } from "@/lib/verification/http";

type TripRow = Record<string, unknown> & { id: string; user_id: string; last_lat: number | null; last_lng: number | null; start_lat: number; start_lng: number };

export async function requireBuddyUser() {
  try { requireBuddiesEnabled(); } catch (error) {
    if (error instanceof BuddiesUnavailableError) return { error: safeJson({ error: error.code }, { status: 503 }) } as const;
    throw error;
  }
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: safeJson({ error: "unauthenticated" }, { status: 401 }) } as const;
  const db = createAdminClient();
  const { data: profile } = await db.from("profiles").select("role,verification_status").eq("id", user.id).single();
  if (profile?.role !== "user") return { error: safeJson({ error: "forbidden" }, { status: 403 }) } as const;
  if (profile.verification_status === "suspended") return { error: safeJson({ error: "suspended" }, { status: 403 }) } as const;
  return { user, db, verified: profile.verification_status === "verified" } as const;
}

export async function activeBuddyTrip(db: ReturnType<typeof createAdminClient>, userId: string) {
  const { data } = await db.from("buddy_trips").select("*").eq("user_id", userId).eq("active", true).gt("expires_at", new Date().toISOString()).maybeSingle();
  return data as TripRow | null;
}

export async function presenceForTrip(db: ReturnType<typeof createAdminClient>, trip: TripRow): Promise<BuddyPresence | null> {
  const [{ data: profile }, { data: contacts }, { data: blocks }, { data: zones }] = await Promise.all([
    db.from("profiles").select("verification_status").eq("id", trip.user_id).single(),
    db.from("buddy_contacts").select("contact_user_id").eq("user_id", trip.user_id),
    db.from("buddy_blocks").select("blocked_user_id").eq("user_id", trip.user_id),
    db.from("buddy_privacy_zones").select("lat,lng,radius_m").eq("user_id", trip.user_id),
  ]);
  if (trip.last_lat === null || trip.last_lng === null) return null;
  return toBuddyPresence(trip as never, {
    position: { lat: trip.last_lat, lng: trip.last_lng },
    verified: profile?.verification_status === "verified",
    suspended: profile?.verification_status === "suspended",
    contactIds: (contacts ?? []).map((row) => row.contact_user_id),
    blockedIds: (blocks ?? []).map((row) => row.blocked_user_id),
    privacyZones: (zones ?? []).map((zone) => ({ center: { lat: zone.lat, lng: zone.lng }, radiusM: zone.radius_m })) as PrivacyZone[],
  });
}

export async function currentBuddyView(db: ReturnType<typeof createAdminClient>, userId: string) {
  const trip = await activeBuddyTrip(db, userId);
  if (!trip) return null;
  const viewer = await presenceForTrip(db, trip);
  if (!viewer) return null;
  const { data: rows } = await db.from("buddy_trips").select("*").eq("active", true).eq("visible", true).gt("expires_at", new Date().toISOString()).limit(100);
  const candidates = (await Promise.all((rows ?? []).map((row) => presenceForTrip(db, row as TripRow)))).filter((presence): presence is BuddyPresence => Boolean(presence));
  const { data: states } = await db.from("buddy_pair_states").select("target_trip_id,state").eq("viewer_trip_id", trip.id);
  const pairStates = Object.fromEntries((states ?? []).map((state) => [`${trip.id}|${state.target_trip_id}`, state.state]));
  return { trip, viewer, candidates, result: buildNearbyView({ viewer, now: Date.now(), secret: buddyHmacSecret(), pairStates }, candidates) };
}

export { buddyHmacSecret };
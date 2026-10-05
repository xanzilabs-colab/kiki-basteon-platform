// lib/buddies/meeting/server.ts
// SERVER ONLY orchestrator: reads inputs -> runs the engine -> saves candidates.
// Called from POST /api/buddies/bubble/[id]/spot-options { action: "generate" }.
//
// Two clients on purpose:
//   userClient    authenticated (cookie session). Used for curated spots and alerts.
//   serviceClient service role. Used ONLY for get_bubble_meeting_inputs and save_bubble_spot_candidates,
//                 because those expose / accept data a browser must never touch directly.
import type { SupabaseClient } from "@supabase/supabase-js";
import { bboxAround } from "./geo";
import { computeMeetingZone, rankCandidates } from "./engine";
import { fetchLandmarks } from "./overpass";
import { isMeetCategory } from "./types";
import type { LatLng, MemberInput, RawCandidate } from "./types";

export type EngineResult =
  | { status: "ok"; round: number; count: number }
  | { status: "waiting_for_locations"; ready: number; total: number }
  | { status: "no_candidates" };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

type Inputs = {
  total: number;
  ready: number;
  members: MemberInput[];
  allowLandmarks: boolean;
  excludeSpotIds: string[];
  excludeOsmRefs: string[];
};

function parseInputs(raw: unknown): Inputs | null {
  if (!isRec(raw)) return null;
  const total = num(raw.total);
  const ready = num(raw.ready);
  if (total === null || ready === null || !Array.isArray(raw.locations)) return null;
  const members: MemberInput[] = [];
  for (const l of raw.locations) {
    if (!isRec(l)) continue;
    const userId = str(l.userId);
    const lat = num(l.lat);
    const lng = num(l.lng);
    if (!userId || lat === null || lng === null) continue;
    const dLat = num(l.destLat);
    const dLng = num(l.destLng);
    members.push({ userId, location: { lat, lng }, destination: dLat !== null && dLng !== null ? { lat: dLat, lng: dLng } : null });
  }
  return {
    total,
    ready,
    members,
    allowLandmarks: raw.allowLandmarks === true,
    excludeSpotIds: strArr(raw.excludeSpotIds),
    excludeOsmRefs: strArr(raw.excludeOsmRefs),
  };
}

function parseCurated(rows: unknown): RawCandidate[] {
  if (!Array.isArray(rows)) return [];
  const out: RawCandidate[] = [];
  for (const r of rows) {
    if (!isRec(r)) continue;
    const id = str(r.id);
    const name = str(r.name);
    const lat = num(r.lat);
    const lng = num(r.lng);
    if (!id || !name || lat === null || lng === null || !isMeetCategory(r.category)) continue;
    out.push({
      source: "curated",
      spotId: id,
      osmRef: null,
      name,
      category: r.category,
      lat,
      lng,
      address: str(r.address) ?? str(r.suburb),
      openNow: typeof r.open_now === "boolean" ? r.open_now : null,
      open24h: r.open_24h === true,
      quality: num(r.quality) ?? 3,
    });
  }
  return out;
}

function parseAlertPoints(rows: unknown): LatLng[] {
  if (!Array.isArray(rows)) return [];
  const out: LatLng[] = [];
  for (const r of rows) {
    if (!isRec(r)) continue;
    const lat = num(r.lat);
    const lng = num(r.lng);
    if (lat !== null && lng !== null) out.push({ lat, lng });
  }
  return out;
}

export async function runMeetingEngine(args: {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  bubbleId: string;
  regenerate: boolean;
  now?: Date;
}): Promise<EngineResult> {
  const { userClient, serviceClient, userId, bubbleId } = args;
  const now = args.now ?? new Date();

  const inputsRes = await serviceClient.rpc("get_bubble_meeting_inputs", { p_user_id: userId, p_bubble_id: bubbleId });
  if (inputsRes.error) throw new Error(inputsRes.error.message);
  const inputs = parseInputs(inputsRes.data);
  if (!inputs) throw new Error("unavailable");
  if (inputs.members.length < 2 || inputs.ready < inputs.total) {
    return { status: "waiting_for_locations", ready: inputs.ready, total: inputs.total };
  }

  const zone = computeMeetingZone(inputs.members);

  const curatedRes = await userClient.rpc("list_meetup_candidates_near", {
    p_lat: zone.center.lat,
    p_lng: zone.center.lng,
    p_radius_m: Math.round(zone.radiusM),
  });
  if (curatedRes.error) throw new Error(curatedRes.error.message);
  const curated = parseCurated(curatedRes.data);

  const box = bboxAround(zone.center, zone.radiusM + 500);
  const alertsRes = await userClient.rpc("list_community_alerts", {
    p_min_lat: box.minLat,
    p_min_lng: box.minLng,
    p_max_lat: box.maxLat,
    p_max_lng: box.maxLng,
  });
  if (alertsRes.error) throw new Error(alertsRes.error.message);
  const alertPoints = parseAlertPoints(alertsRes.data);

  const ua = process.env.KIKI_HTTP_UA ?? "KikiBuddies/1.0 (set KIKI_HTTP_UA with a contact email)";
  const landmarks = inputs.allowLandmarks ? await fetchLandmarks(zone.center, zone.radiusM, ua) : [];

  const ranked = rankCandidates({
    members: inputs.members,
    zone,
    raw: [...curated, ...landmarks],
    alertPoints,
    excludeSpotIds: inputs.excludeSpotIds,
    excludeOsmRefs: inputs.excludeOsmRefs,
    now,
  });
  if (ranked.length === 0) return { status: "no_candidates" };

  const payload = ranked.map((c) => ({
    source: c.source,
    spotId: c.spotId,
    osmRef: c.osmRef,
    name: c.name,
    category: c.category,
    lat: c.lat,
    lng: c.lng,
    address: c.address,
    score: c.score,
    distM: c.distM,
    maxDistM: c.maxDistM,
    balanced: c.balanced,
  }));

  const saved = await serviceClient.rpc("save_bubble_spot_candidates", {
    p_user_id: userId,
    p_bubble_id: bubbleId,
    p_candidates: payload,
    p_regenerate: args.regenerate,
  });
  if (saved.error) throw new Error(saved.error.message);
  return { status: "ok", round: typeof saved.data === "number" ? saved.data : 0, count: payload.length };
}

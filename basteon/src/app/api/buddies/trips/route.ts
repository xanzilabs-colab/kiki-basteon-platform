import { z } from "zod";
import { sameOrigin, safeJson } from "@/lib/verification/http";
import { requireBuddyUser } from "../_shared";

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const schema = z.object({ start: point, destination: point, route: z.array(point).min(2).max(5_000), mode: z.enum(["walk", "taxi", "ehail", "bus", "train"]), leaveFrom: z.string().datetime(), maxWaitMinutes: z.number().int().min(5).max(120), maxWalkM: z.number().int().min(50).max(5000), groupSize: z.number().int().min(2).max(4), audience: z.enum(["all_verified", "contacts_only"]) });
const adjectives = ["Amber", "Bright", "Calm", "Cedar", "Kind", "Quiet", "Swift", "Willow"];
const nouns = ["Comet", "Clover", "Dawn", "Harbor", "Lily", "Meadow", "River", "Sky"];
const avatars = ["🌻", "🌿", "🌸", "🪻", "🍀", "🌙", "🫧", "⭐"];
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

export async function POST(request: Request) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const access = await requireBuddyUser();
  if ("error" in access) return access.error;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return safeJson({ error: "invalid_trip" }, { status: 400 });
  const leaveFrom = new Date(input.data.leaveFrom);
  const leaveTo = new Date(leaveFrom.getTime() + input.data.maxWaitMinutes * 60_000);
  const expiresAt = new Date(leaveTo.getTime() + 4 * 60 * 60_000);
  await access.db.from("buddy_trips").update({ active: false, visible: false }).eq("user_id", access.user.id).eq("active", true);
  const { data, error } = await access.db.from("buddy_trips").insert({
    user_id: access.user.id, alias: `${pick(adjectives)} ${pick(nouns)}`, avatar: pick(avatars), start_lat: input.data.start.lat, start_lng: input.data.start.lng,
    destination_lat: input.data.destination.lat, destination_lng: input.data.destination.lng, last_lat: input.data.start.lat, last_lng: input.data.start.lng, last_position_at: new Date().toISOString(),
    route: input.data.route, mode: input.data.mode, leave_from: leaveFrom.toISOString(), leave_to: leaveTo.toISOString(), max_walk_m: input.data.maxWalkM, max_group_size: input.data.groupSize, audience: input.data.audience, expires_at: expiresAt.toISOString(),
  }).select("alias,avatar,expires_at").single();
  if (error || !data) return safeJson({ error: "trip_unavailable" }, { status: 500 });
  return safeJson({ active: true, visible: false, alias: data.alias, avatar: data.avatar, expiresAt: data.expires_at }, { status: 201 });
}
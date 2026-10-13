import { z } from "zod";
import { admin, authenticated, fail, rateLimited, reportDatabaseFailure } from "../_shared";

const rating = z.number().int().min(1).max(5).nullable().optional();
const common = {
  durationSeconds: z.number().int().min(0).max(3600),
  completed: z.boolean(),
  ratingBefore: rating,
  ratingAfter: rating,
};
const payloads = {
  winds: z.object({ pattern: z.enum(["box", "sigh", "slow"]), factCount: z.number().int().min(0).max(100) }).strict(),
  baseline: z.object({ level: z.number().int().min(1).max(3), correct: z.number().int().min(0).max(10), total: z.number().int().min(0).max(10) }).strict(),
  body: z.object({
    zones: z.record(z.enum(["jaw", "neck", "shoulders", "chest", "stomach", "back", "hands", "legs", "feet"]), z.number().int().min(0).max(3)),
  }).strict(),
};
const schema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("winds"), mode: z.enum(["wind", "quiet"]), ...common, payload: payloads.winds }).strict(),
  z.object({ tool: z.literal("baseline"), mode: z.literal("attention"), ...common, payload: payloads.baseline }).strict(),
  z.object({ tool: z.literal("body"), mode: z.literal("check"), ...common, payload: payloads.body }).strict(),
]);

export async function POST(request: Request) {
  const auth = await authenticated();
  if (auth.response) return auth.response;
  const limit = await rateLimited(auth.userId, "session-write", 20);
  if (limit.unavailable) return fail("rate_limit_unavailable", 503);
  if (!limit.allowed) return fail("rate_limited", 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("invalid_session", 400);
  const { data: settings, error: settingsError } = await admin().from("calm_settings").select("save_history").eq("user_id", auth.userId).maybeSingle();
  if (settingsError) {
    reportDatabaseFailure("session_settings_read", settingsError);
    return fail("session_unavailable", 500);
  }
  if (!settings?.save_history) return Response.json({ saved: false }, { headers: { "Cache-Control": "no-store" } });
  const input = parsed.data;
  const { error } = await admin().from("calm_sessions").insert({
    user_id: auth.userId,
    tool: input.tool,
    mode: input.mode,
    duration_s: input.durationSeconds,
    completed: input.completed,
    rating_before: input.ratingBefore ?? null,
    rating_after: input.ratingAfter ?? null,
    payload: input.payload,
  });
  if (error) {
    reportDatabaseFailure("session_write", error);
    return fail("session_unavailable", 500);
  }
  return Response.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
}

import { z } from "zod";
import { admin, authenticated, fail, rateLimited, reportDatabaseFailure } from "../_shared";

const schema = z.object({
  saveHistory: z.boolean(),
  haptics: z.boolean(),
  sound: z.boolean(),
  breathPace: z.enum(["gentle", "standard"]),
  breathHolds: z.boolean(),
  baselineLevel: z.number().int().min(1).max(3),
}).strict();

const defaults = {
  saveHistory: false,
  haptics: true,
  sound: true,
  breathPace: "gentle" as const,
  breathHolds: false,
  baselineLevel: 1,
};

export async function GET() {
  const auth = await authenticated();
  if (auth.response) return auth.response;
  const limit = await rateLimited(auth.userId, "settings-read", 60);
  if (limit.unavailable) return fail("rate_limit_unavailable", 503);
  if (!limit.allowed) return fail("rate_limited", 429);
  const { data, error } = await admin().from("calm_settings").select("save_history,haptics,sound,breath_pace,breath_holds,baseline_level").eq("user_id", auth.userId).maybeSingle();
  if (error) {
    reportDatabaseFailure("settings_read", error);
    return fail("settings_unavailable", 500);
  }
  return Response.json(data ? {
    saveHistory: data.save_history,
    haptics: data.haptics,
    sound: data.sound,
    breathPace: data.breath_pace,
    breathHolds: data.breath_holds,
    baselineLevel: data.baseline_level,
  } : defaults, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const auth = await authenticated();
  if (auth.response) return auth.response;
  const limit = await rateLimited(auth.userId, "settings-write", 20);
  if (limit.unavailable) return fail("rate_limit_unavailable", 503);
  if (!limit.allowed) return fail("rate_limited", 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("invalid_settings", 400);
  const input = parsed.data;
  const { error } = await admin().from("calm_settings").upsert({
    user_id: auth.userId,
    save_history: input.saveHistory,
    haptics: input.haptics,
    sound: input.sound,
    breath_pace: input.breathPace,
    breath_holds: input.breathHolds,
    baseline_level: input.baselineLevel,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) {
    reportDatabaseFailure("settings_write", error);
    return fail("settings_unavailable", 500);
  }
  return Response.json(input, { headers: { "Cache-Control": "no-store" } });
}

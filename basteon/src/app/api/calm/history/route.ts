import { admin, authenticated, fail, rateLimited, reportDatabaseFailure } from "../_shared";

export async function GET() {
  const auth = await authenticated();
  if (auth.response) return auth.response;
  const limit = await rateLimited(auth.userId, "history-read", 30);
  if (limit.unavailable) return fail("rate_limit_unavailable", 503);
  if (!limit.allowed) return fail("rate_limited", 429);
  const { data: settings, error: settingsError } = await admin().from("calm_settings").select("save_history").eq("user_id", auth.userId).maybeSingle();
  if (settingsError) {
    reportDatabaseFailure("history_settings_read", settingsError);
    return fail("history_unavailable", 500);
  }
  if (!settings?.save_history) return Response.json([], { headers: { "Cache-Control": "no-store" } });
  const { data, error } = await admin().from("calm_sessions")
    .select("id,tool,mode,started_at,duration_s,completed,rating_before,rating_after,payload")
    .eq("user_id", auth.userId)
    .order("started_at", { ascending: false })
    .limit(100);
  if (error) {
    reportDatabaseFailure("history_read", error);
    return fail("history_unavailable", 500);
  }
  return Response.json(data ?? [], { headers: { "Cache-Control": "no-store" } });
}

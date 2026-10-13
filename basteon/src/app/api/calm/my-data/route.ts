import { admin, authenticated, fail, rateLimited, reportDatabaseFailure } from "../_shared";

export async function DELETE() {
  const auth = await authenticated();
  if (auth.response) return auth.response;
  const limit = await rateLimited(auth.userId, "delete-data", 5);
  if (limit.unavailable) return fail("rate_limit_unavailable", 503);
  if (!limit.allowed) return fail("rate_limited", 429);
  const { error } = await admin().rpc("calm_delete_user_data", { p_user_id: auth.userId });
  if (error) {
    reportDatabaseFailure("delete_user_data", error);
    return fail("deletion_failed", 500);
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const admin = createAdminClient;
export function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function authenticated() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.error("calm_auth_failure", { message: error.message });
    return { userId: null, response: fail("authentication_failed", 401) } as const;
  }
  if (!user) return { userId: null, response: fail("unauthorized", 401) } as const;
  return { userId: user.id, response: null } as const;
}

export async function rateLimited(userId: string, action: string, limit = 30) {
  const { data, error } = await admin().rpc("consume_intelligence_limit", {
    p_user_id: userId,
    p_action_key: `calm:${action}`,
    p_limit: limit,
    p_window_seconds: 60,
  });
  if (error) {
    console.error("calm_rate_limit_failure", { action, message: error.message });
    return { allowed: false, unavailable: true };
  }
  return { allowed: data === true, unavailable: false };
}

export function reportDatabaseFailure(operation: string, error: { code?: string; message?: string; details?: string; hint?: string } | null) {
  if (!error) return;
  console.error("calm_database_failure", {
    operation,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

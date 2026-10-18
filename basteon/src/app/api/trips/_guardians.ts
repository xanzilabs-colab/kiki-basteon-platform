import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

export async function areCurrentBuddies(db: Db, userA: string, userB: string) {
  const [{ data: aToB, error: aToBError }, { data: bToA, error: bToAError }, { data: blocksA, error: blocksAError }, { data: blocksB, error: blocksBError }] = await Promise.all([
    db.from("buddy_contacts").select("contact_user_id").eq("user_id", userA).eq("contact_user_id", userB).maybeSingle(),
    db.from("buddy_contacts").select("contact_user_id").eq("user_id", userB).eq("contact_user_id", userA).maybeSingle(),
    db.from("buddy_blocks").select("blocked_user_id").eq("user_id", userA).eq("blocked_user_id", userB).maybeSingle(),
    db.from("buddy_blocks").select("blocked_user_id").eq("user_id", userB).eq("blocked_user_id", userA).maybeSingle(),
  ]);
  const error = aToBError || bToAError || blocksAError || blocksBError;
  if (error) return { allowed: false, error };
  return { allowed: Boolean(aToB && bToA && !blocksA && !blocksB), error: null };
}

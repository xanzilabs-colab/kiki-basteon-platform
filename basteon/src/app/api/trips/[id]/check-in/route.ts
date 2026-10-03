import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTripUser } from "../../_shared";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const { id } = await params;
  const now = new Date();
  const { error } = await createAdminClient().from("trips").update({ last_check_in_at: now.toISOString(), next_check_in_at: new Date(now.getTime() + 15 * 60_000).toISOString(), risk_score: 0, route_watch_state: "normal" }).eq("id", id).eq("owner_id", access.user.id).in("status", ["active", "concern", "alert"]);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}
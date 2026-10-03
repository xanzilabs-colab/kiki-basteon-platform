import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTripUser } from "../../_shared";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const { id } = await params;
  const { error } = await createAdminClient().from("trips").update({ status: "arrived", ended_at: new Date().toISOString() }).eq("id", id).eq("owner_id", access.user.id).in("status", ["active", "concern", "alert"]);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}
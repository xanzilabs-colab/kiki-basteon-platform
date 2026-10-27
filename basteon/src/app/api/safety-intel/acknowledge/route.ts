import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId } from "@/lib/organisation";
import { sameOrigin } from "@/lib/verification/http";

export const dynamic = "force-dynamic";

const schema = z.object({ recordId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = createAdminClient();
  const { data: alert, error: alertError } = await db.from("safety_intel_alert_log")
    .select("id")
    .eq("user_id", userId)
    .eq("record_id", input.data.recordId)
    .limit(1)
    .maybeSingle();
  if (alertError) {
    console.error("Safety intelligence acknowledgement authorization failed", alertError);
    return NextResponse.json({ error: "acknowledgement_unavailable" }, { status: 503 });
  }
  if (!alert) return NextResponse.json({ error: "alert_not_found" }, { status: 404 });

  const { error } = await db.from("safety_intel_alert_acknowledgements").upsert({
    user_id: userId,
    record_id: input.data.recordId,
    acknowledged_at: new Date().toISOString(),
  }, { onConflict: "user_id,record_id" });
  if (error) {
    console.error("Safety intelligence acknowledgement save failed", error);
    return NextResponse.json({ error: "acknowledgement_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, recordId: input.data.recordId });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUserId } from "@/lib/organisation";

export const dynamic = "force-dynamic";

const schema = z.object({ liveLocationSharing: z.boolean().optional(), safetyIntelAlerts: z.boolean().optional() }).refine((v) => Object.keys(v).length > 0);

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await createAdminClient().from("user_privacy_settings").select("live_location_sharing,safety_intel_alerts").eq("user_id", userId).maybeSingle();
  return NextResponse.json({ liveLocationSharing: data?.live_location_sharing ?? false, safetyIntelAlerts: data?.safety_intel_alerts ?? false });
}

export async function PATCH(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_settings" }, { status: 400 });
  const db = createAdminClient();
  const { data: current } = await db.from("user_privacy_settings").select("live_location_sharing,safety_intel_alerts").eq("user_id", userId).maybeSingle();
  const live = input.data.liveLocationSharing ?? current?.live_location_sharing ?? false;
  // Intelligence alerts need location, so they cannot stay on without Live Location Sharing.
  const intel = live && (input.data.safetyIntelAlerts ?? current?.safety_intel_alerts ?? false);
  const { error } = await db.from("user_privacy_settings").upsert({ user_id: userId, live_location_sharing: live, safety_intel_alerts: intel, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ liveLocationSharing: live, safetyIntelAlerts: intel });
}

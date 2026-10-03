import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotificationsToUser } from "@/lib/push";
import { requireTripUser } from "../../_shared";

const inputSchema = z.object({
  score: z.number().int().min(0).max(100),
  state: z.enum(["normal", "watch", "concern", "alert"]),
  reasons: z.array(z.object({ signal: z.string().max(80), score: z.number().min(0).max(100), reason: z.string().max(300) })).max(12),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireTripUser();
  if ("error" in access) return access.error;
  const input = inputSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "invalid_watch_result" }, { status: 400 });
  const { id } = await params;
  const db = createAdminClient();
  const { data: trip } = await db.from("trips").select("id,route_watch_state,status").eq("id", id).eq("owner_id", access.user.id).in("status", ["active", "concern", "alert"]).maybeSingle();
  if (!trip) return NextResponse.json({ error: "trip_not_found" }, { status: 404 });
  const changed = trip.route_watch_state !== input.data.state;
  const status = input.data.state === "alert" ? "alert" : input.data.state === "concern" ? "concern" : "active";
  await db.from("trips").update({ risk_score: input.data.score, route_watch_state: input.data.state, status }).eq("id", id);
  if (changed) {
    await db.from("trip_events").insert({ trip_id: id, event_type: "route_watch_state", state: input.data.state, risk_score: input.data.score, reasons: input.data.reasons });
    if (input.data.state === "concern" || input.data.state === "alert") {
      await sendPushNotificationsToUser(access.user.id, {
        title: "Kiki",
        body: "Check in when you can.",
        tag: `hamba-check-in-${id}`,
        url: "/account/trips",
        tripId: id,
        actions: [{ action: "check-in", title: "I'm OK" }],
      });
    }
  }
  return NextResponse.json({ ok: true });
}
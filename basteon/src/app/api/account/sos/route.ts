import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotifications } from "@/lib/push";

const inputSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).refine((value) => (value.lat === undefined) === (value.lng === undefined), {
  message: "Latitude and longitude must be supplied together.",
});

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [{ data: profile }, payload] = await Promise.all([
    client.from("profiles").select("role,full_name").eq("id", user.id).single(),
    request.json().catch(() => null),
  ]);
  if (profile?.role !== "user") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const input = inputSchema.safeParse(payload ?? {});
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });

  const db = createAdminClient();
  const { data: device } = await db
    .from("devices")
    .select("device_id,device_name")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("linked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!device) return NextResponse.json({ error: "no_active_device" }, { status: 409 });

  // Phone-generated SOS events must not advance the band-owned replay counter.
  // Negative values keep the identifier unique without colliding with device counters.
  const ctr = -Date.now();
  const { data: alert, error } = await db
    .from("alerts")
    .insert({
      device_id: device.device_id,
      ctr,
      lat: input.data.lat ?? null,
      lng: input.data.lng ?? null,
      loc_source: input.data.lat === undefined ? null : "gps",
    })
    .select("id")
    .single();
  if (error || !alert) return NextResponse.json({ error: error?.message ?? "Could not create SOS alert." }, { status: 400 });

  const recipientName = profile.full_name?.trim() || device.device_name?.trim() || device.device_id;
  await sendPushNotifications({ title: "New panic alert", body: `${recipientName} needs assistance.`, tag: `basteon-alert-${alert.id}`, url: "/responder" });

  return NextResponse.json({ ok: true, id: alert.id }, { status: 201 });
}
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushNotifications } from "@/lib/push";

const inputSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  type: z.string().nullable().optional(),
  type_code: z.string().nullable().optional(),
  type_source: z.string().optional(),
  request_id: z.string().uuid().optional(),
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

  const { data: resolvedType } = await db.rpc("resolve_emergency_type", { p_type: input.data.type ?? input.data.type_code ?? "sos" });
  const typeCode = typeof resolvedType === "string" ? resolvedType : "sos";
  const typeSource = input.data.type_source === "hold_slide" ? "hold_slide" : "tap";

  // Phone-generated SOS events must not advance the band-owned replay counter.
  // Negative values keep the identifier unique without colliding with device counters.
  const ctr = input.data.request_id
    ? -BigInt(`0x${input.data.request_id.replaceAll("-", "").slice(0, 15)}`).toString()
    : -Date.now();
  let wasCreated = true;
  let { data: alert, error } = await db
    .from("alerts")
    .insert({
      device_id: device.device_id,
      ctr,
      lat: input.data.lat ?? null,
      lng: input.data.lng ?? null,
      loc_source: input.data.lat === undefined ? null : "gps",
      type_code: typeCode,
      type_source: typeSource,
      type_updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error?.code === "23505" && input.data.request_id) {
    const existing = await db.from("alerts").select("id").eq("device_id", device.device_id).eq("ctr", ctr).maybeSingle();
    alert = existing.data;
    error = existing.error;
    wasCreated = false;
  }
  if (error || !alert) return NextResponse.json({ error: error?.message ?? "Could not create SOS alert." }, { status: 400 });

  const recipientName = profile.full_name?.trim() || device.device_name?.trim() || device.device_id;
  const title = typeCode === "medical" ? "Medical alert" : "SOS alert";
  if (wasCreated) await sendPushNotifications({ title, body: `${title} from ${recipientName}.`, tag: `basteon-alert-${alert.id}`, url: "/responder" });

  return NextResponse.json({ ok: true, id: alert.id, type_code: typeCode }, { status: 201 });
}
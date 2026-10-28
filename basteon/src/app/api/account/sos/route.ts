import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeAlertAndNotify } from "@/lib/alertRouting";

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

function requiresKikiLink() {
  return process.env.REQUIRE_KIKI_LINK?.trim().toLowerCase() === "true";
}

async function getOrCreatePhoneSosDevice(db: ReturnType<typeof createAdminClient>, userId: string) {
  const deviceId = `PHONE-SOS-${userId.replaceAll("-", "").toUpperCase()}`;
  const { data: existing, error: lookupError } = await db
    .from("devices")
    .select("device_id,device_name,user_id,active,is_virtual")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) {
    if (existing.user_id !== userId || !existing.is_virtual || !existing.active) {
      throw new Error("phone_sos_endpoint_unavailable");
    }
    return { device_id: existing.device_id, device_name: existing.device_name };
  }

  const { data: created, error: createError } = await db
    .from("devices")
    .insert({
      device_id: deviceId,
      user_id: userId,
      device_name: "Phone SOS",
      active: true,
      last_ctr: 0,
      is_virtual: true,
    })
    .select("device_id,device_name,user_id,active,is_virtual")
    .single();
  if (!createError && created) return { device_id: created.device_id, device_name: created.device_name };
  if (createError?.code !== "23505") throw createError ?? new Error("phone_sos_endpoint_unavailable");

  const { data: raced, error: raceLookupError } = await db
    .from("devices")
    .select("device_id,device_name,user_id,active,is_virtual")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (raceLookupError) throw raceLookupError;
  if (!raced || raced.user_id !== userId || !raced.is_virtual || !raced.active) {
    throw new Error("phone_sos_endpoint_unavailable");
  }
  return { device_id: raced.device_id, device_name: raced.device_name };
}

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [{ data: profile }, payload] = await Promise.all([
    client.from("profiles").select("role").eq("id", user.id).single(),
    request.json().catch(() => null),
  ]);
  if (profile?.role !== "user") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const input = inputSchema.safeParse(payload ?? {});
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });

  const db = createAdminClient();
  const { data: linkedDevice, error: deviceError } = await db
    .from("devices")
    .select("device_id,device_name")
    .eq("user_id", user.id)
    .eq("active", true)
    .eq("is_virtual", false)
    .order("linked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (deviceError) {
    console.error("Phone SOS linked-device lookup failed", deviceError);
    return NextResponse.json({ error: "device_lookup_unavailable" }, { status: 503 });
  }
  let device = linkedDevice;
  if (!device && requiresKikiLink()) return NextResponse.json({ error: "no_active_device" }, { status: 409 });
  if (!device) {
    try {
      device = await getOrCreatePhoneSosDevice(db, user.id);
    } catch (error) {
      console.error("Phone SOS endpoint provisioning failed", error);
      return NextResponse.json({ error: "phone_endpoint_unavailable" }, { status: 503 });
    }
  }

  const { data: resolvedType } = await db.rpc("resolve_emergency_type", { p_type: input.data.type ?? input.data.type_code ?? "general" });
  const typeCode = typeof resolvedType === "string" ? resolvedType : "general";
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

  if (wasCreated) await routeAlertAndNotify(alert.id);

  return NextResponse.json({ ok: true, id: alert.id, type_code: typeCode }, { status: 201 });
}
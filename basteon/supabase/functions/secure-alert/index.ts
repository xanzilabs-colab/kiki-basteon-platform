import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fromB64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const SOURCES = new Set(["gps", "stale", "cached", "dev"]);

type TrackingPayload = {
  status: "panic_activated" | "panic_update";
  ctr: number;
  ref?: number;
  lat: number | null;
  lng: number | null;
  src: string | null;
  age: number | null;
  battery: number | null;
};

type LinkPayload = { status: "link_device"; ctr: number; token: string };
type HeartbeatPayload = { status: "device_heartbeat"; ctr: number; battery: number | null; wifiRssi: number | null };

function parseLinkPayload(value: unknown): LinkPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.status !== "link_device" || typeof payload.ctr !== "number" || !Number.isSafeInteger(payload.ctr) || payload.ctr <= 0) return null;
  if (typeof payload.token !== "string" || !/^[a-fA-F0-9]{32}$/.test(payload.token)) return null;
  return { status: "link_device", ctr: payload.ctr, token: payload.token };
}

function parseHeartbeatPayload(value: unknown): HeartbeatPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (payload.status !== "device_heartbeat" || typeof payload.ctr !== "number" || !Number.isSafeInteger(payload.ctr) || payload.ctr <= 0) return null;
  const battery = payload.bat;
  const wifiRssi = payload.rssi;
  if (battery !== undefined && (!Number.isInteger(battery) || battery < 0 || battery > 100)) return null;
  if (wifiRssi !== undefined && (!Number.isInteger(wifiRssi) || wifiRssi < -127 || wifiRssi > 0)) return null;
  return { status: "device_heartbeat", ctr: payload.ctr, battery: typeof battery === "number" ? battery : null, wifiRssi: typeof wifiRssi === "number" ? wifiRssi : null };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseTrackingPayload(value: unknown): TrackingPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const status = payload.status;
  const ctr = payload.ctr;
  const hasLatitude = Object.hasOwn(payload, "lat");
  const hasLongitude = Object.hasOwn(payload, "lng");

  if ((status !== "panic_activated" && status !== "panic_update") || typeof ctr !== "number" || !Number.isSafeInteger(ctr) || ctr <= 0) return null;
  if (hasLatitude !== hasLongitude) return null;

  let lat: number | null = null;
  let lng: number | null = null;
  if (hasLatitude) {
    if (typeof payload.lat !== "number" || typeof payload.lng !== "number" || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) return null;
    if (payload.lat < -90 || payload.lat > 90 || payload.lng < -180 || payload.lng > 180) return null;
    lat = payload.lat;
    lng = payload.lng;
  }

  let ref: number | undefined;
  if (status === "panic_update") {
    if (typeof payload.ref !== "number" || !Number.isSafeInteger(payload.ref) || payload.ref <= 0) return null;
    ref = payload.ref;
  } else if (payload.ref !== undefined) return null;

  let src: string | null = null;
  if (payload.src !== undefined) {
    if (typeof payload.src !== "string" || !SOURCES.has(payload.src)) return null;
    src = payload.src;
  }

  let age: number | null = null;
  if (payload.age !== undefined) {
    if (typeof payload.age !== "number" || !Number.isInteger(payload.age) || payload.age < -1 || payload.age > 2_592_000) return null;
    age = payload.age === -1 ? null : payload.age;
  }

  let battery: number | null = null;
  if (payload.bat !== undefined) {
    if (typeof payload.bat !== "number" || !Number.isInteger(payload.bat) || payload.bat < 0 || payload.bat > 100) return null;
    battery = payload.bat;
  }

  return { status, ctr, ref, lat, lng, src, age, battery };
}

const dispatchPush = async (deviceId: string, deviceName: string | null, ownerName: string | null) => {
  const url = Deno.env.get("PUSH_DISPATCH_URL");
  const secret = Deno.env.get("PUSH_DISPATCH_SECRET");
  if (!url || !secret) return;

  const recipientName = ownerName?.trim() || deviceName?.trim() || deviceId;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-push-dispatch-secret": secret },
      body: JSON.stringify({
        title: "New panic alert",
        body: `${recipientName} needs assistance.`,
        tag: `basteon-alert-${deviceId}-${Date.now()}`,
        url: "/responder",
      }),
    });
  } catch (error) {
    console.error("push dispatch failed", error);
  }
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let envelope: Record<string, unknown>;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") return json({ error: "malformed" }, 400);
    envelope = body as Record<string, unknown>;
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const { device_id: deviceId, iv, tag, ciphertext } = envelope;
  if ([deviceId, iv, tag, ciphertext].some((value) => typeof value !== "string")) return json({ error: "malformed" }, 400);
  if (deviceId.length > 64 || iv.length > 32 || tag.length > 32 || ciphertext.length > 2048) return json({ error: "too_large" }, 413);

  const [{ data: device }, { data: secret }] = await Promise.all([
    supabase.from("devices").select("active,last_ctr,device_name,user_id").eq("device_id", deviceId).maybeSingle(),
    supabase.from("device_secrets").select("key_b64").eq("device_id", deviceId).maybeSingle(),
  ]);
  if (!device || !secret || !device.active) return json({ error: "unknown_device" }, 403);

  let payload: unknown;
  try {
    const key = await crypto.subtle.importKey("raw", fromB64(secret.key_b64), "AES-GCM", false, ["decrypt"]);
    const encrypted = fromB64(ciphertext);
    const authTag = fromB64(tag);
    const combined = new Uint8Array(encrypted.length + authTag.length);
    combined.set(encrypted);
    combined.set(authTag, encrypted.length);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv), additionalData: new TextEncoder().encode(deviceId), tagLength: 128 },
      key,
      combined,
    );
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return json({ error: "auth_failed" }, 401);
  }

  const isLinkMessage = Boolean(payload && typeof payload === "object" && (payload as Record<string, unknown>).status === "link_device");
  const linking = parseLinkPayload(payload);
  if (isLinkMessage) {
    if (!linking) return json({ linked: false, reason: "not_found" }, 200);
    const { data: result, error } = await supabase.rpc("claim_device_with_token", {
      p_device_id: deviceId,
      p_token_hash: await sha256Hex(linking.token),
      p_ctr: linking.ctr,
    });
    if (error) return json({ error: "db_error" }, 500);
    return json(result, 200);
  }

  const heartbeat = parseHeartbeatPayload(payload);
  if (heartbeat) {
    if (heartbeat.ctr <= Number(device.last_ctr)) return json({ error: "replayed_counter" }, 409);
    const now = new Date().toISOString();
    const { error } = await supabase.from("devices").update({
      last_ctr: heartbeat.ctr,
      last_seen_at: now,
      telemetry_at: now,
      battery: heartbeat.battery,
      wifi_rssi: heartbeat.wifiRssi,
    }).eq("device_id", deviceId).lt("last_ctr", heartbeat.ctr);
    return error ? json({ error: "db_error" }, 500) : json({ ok: true }, 200);
  }

  const tracking = parseTrackingPayload(payload);
  if (!tracking) return json({ error: "bad_payload" }, 400);

  if (tracking.status === "panic_activated") {
    const { data: existing } = await supabase.from("alerts").select("id").eq("device_id", deviceId).eq("ctr", tracking.ctr).maybeSingle();
    if (existing) return json({ ok: true, duplicate: true }, 200);
    if (tracking.ctr <= Number(device.last_ctr)) return json({ error: "replayed_counter" }, 409);

    const { error: insertError } = await supabase.from("alerts").insert({
      device_id: deviceId,
      ctr: tracking.ctr,
      lat: tracking.lat,
      lng: tracking.lng,
      loc_source: tracking.lat === null ? null : tracking.src,
      fix_age_s: tracking.lat === null ? null : tracking.age,
      battery: tracking.battery,
    });
    if (insertError) return json({ error: "db_error" }, 500);

    const { error: counterError } = await supabase.from("devices")
      .update({ last_ctr: tracking.ctr, last_seen_at: new Date().toISOString() })
      .eq("device_id", deviceId)
      .lt("last_ctr", tracking.ctr);
    if (counterError) return json({ error: "db_error" }, 500);

    const { data: owner } = device.user_id
      ? await supabase.from("profiles").select("full_name").eq("id", device.user_id).maybeSingle()
      : { data: null };
    void dispatchPush(deviceId, device.device_name, owner?.full_name ?? null);
    return json({ ok: true }, 201);
  }

  if (tracking.ctr <= Number(device.last_ctr)) return json({ error: "replayed_counter" }, 409);

  const { data: alert } = await supabase.from("alerts")
    .select("id,status")
    .eq("device_id", deviceId)
    .eq("ctr", tracking.ref!)
    .maybeSingle();
  if (!alert || alert.status === "resolved" || alert.status === "false_alarm") return json({ stop: true }, 200);

  const { data: result, error: locationError } = await supabase.rpc("record_panic_update", {
    p_alert_id: alert.id,
    p_device_id: deviceId,
    p_lat: tracking.lat,
    p_lng: tracking.lng,
    p_loc_source: tracking.src,
    p_fix_age_s: tracking.age,
    p_battery: tracking.battery,
    p_ctr: tracking.ctr,
  });
  if (locationError) return json({ error: "db_error" }, 500);
  if (result === "stop") return json({ stop: true }, 200);
  if (result === "replayed") return json({ error: "replayed_counter" }, 409);
  if (result !== "recorded") return json({ error: "db_error" }, 500);

  return json({ ok: true }, 200);
});

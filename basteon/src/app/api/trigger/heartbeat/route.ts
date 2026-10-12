import { NextResponse } from "next/server";
import { z } from "zod";
import { admin, isInvalidTokenError, noStore, readJson, readToken, sha256 } from "@/lib/triggerRoute";
import { EVERYDAY_DEVICE_KINDS } from "@/lib/everydayDevices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Diagnostic = z.object({
  at: z.string().datetime().optional(),
  pattern: z.string().max(20),
  origin: z.enum(["key", "session"]),
  keys: z.array(z.number().int().min(0).max(65535)).max(20),
  device_hint: z.string().max(60).optional(),
}).strict();

const Device = z.object({
  ref: z.string().min(8).max(40),
  kind: z.enum(EVERYDAY_DEVICE_KINDS),
  label: z.string().trim().min(1).max(40),
  status: z.enum(["connected", "disconnected", "untracked", "bluetooth_off", "permission_needed", "unpaired"]),
  battery: z.number().int().min(0).max(100).nullable().optional(),
  verified_at: z.string().datetime().nullable().optional(),
}).strict();

const Body = z.object({
  armed: z.boolean(),
  test: z.boolean().default(false),
  app_version: z.string().max(20).optional(),
  sdk: z.number().int().min(0).max(1000).optional(),
  model: z.string().max(40).optional(),
  battery_unrestricted: z.boolean().optional(),
  events: z.array(Diagnostic).max(20).default([]),
  devices: z.array(Device).max(10).optional(),
}).strict();

export async function POST(request: Request) {
  const token = readToken(request);
  if (!token) return NextResponse.json({ ok: false }, { status: 401, headers: noStore });

  const body = await readJson(request);
  const parsed = Body.safeParse(body.ok ? body.value : null);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400, headers: noStore });

  const { devices, ...heartbeat } = parsed.data;
  const tokenHash = sha256(token);
  const db = admin();
  const status = await db.rpc("trigger_heartbeat", { p_token_hash: tokenHash, p_payload: heartbeat });
  if (status.error) {
    return NextResponse.json(
      { ok: false },
      { status: isInvalidTokenError(status.error.message) ? 401 : 500, headers: noStore },
    );
  }

  if (devices !== undefined) {
    const synced = await db.rpc("trigger_devices_sync", { p_token_hash: tokenHash, p_devices: devices });
    if (synced.error) {
      return NextResponse.json(
        { ok: false },
        { status: isInvalidTokenError(synced.error.message) ? 401 : 500, headers: noStore },
      );
    }
  }
  return NextResponse.json({ ok: true }, { headers: noStore });
}

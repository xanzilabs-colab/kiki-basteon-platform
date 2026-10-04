import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_N = 1 << 17;
export const ACTIVE_ALERT_STATUSES = ["new", "acknowledged", "enroute", "on_scene"] as const;

function scrypt(pin: string, salt: Buffer, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(pin.normalize("NFKC"), salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Encodes as scrypt$N$r$p$salt$hash (base64). The PIN itself is never stored or logged. */
export async function hashDevicePin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(pin, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyDevicePinHash(pin: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isSafeInteger) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0 || r < 1 || r > 16 || p < 1 || p > 4) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length < 8 || expected.length < 16 || expected.length > 64) return false;
  try {
    const actual = await scrypt(pin, salt, expected.length, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export type PinCheck =
  | { ok: true }
  | { ok: false; error: "no_pin" }
  | { ok: false; error: "bad_pin"; attemptsLeft: number }
  | { ok: false; error: "pin_locked_out"; retryAfter: number }
  | { ok: false; error: "pin_unavailable" };

type AttemptRow = { result: "ok" | "no_pin" | "locked_out"; pin_hash: string | null; attempts_left: number | null; retry_after: number | null };

/**
 * Verifies a band PIN against the server hash. The attempt is reserved atomically in the database
 * (counted as a failure up front) before the hash is checked, so concurrent guesses share one budget.
 */
export async function checkDevicePin(db: SupabaseClient, deviceId: string, pin: string, actorId: string | null): Promise<PinCheck> {
  const { data, error } = await db.rpc("device_pin_begin_attempt", { p_device_id: deviceId });
  if (error) return { ok: false, error: "pin_unavailable" };
  const row = (Array.isArray(data) ? data[0] : data) as AttemptRow | undefined;
  if (!row || row.result === "no_pin") return { ok: false, error: "no_pin" };
  if (row.result === "locked_out") return { ok: false, error: "pin_locked_out", retryAfter: row.retry_after ?? 900 };
  if (!row.pin_hash) return { ok: false, error: "pin_unavailable" };

  if (await verifyDevicePinHash(pin, row.pin_hash)) {
    const { error: resetError } = await db.rpc("device_pin_attempt_succeeded", { p_device_id: deviceId });
    if (resetError) return { ok: false, error: "pin_unavailable" };
    return { ok: true };
  }

  const attemptsLeft = Math.max(0, row.attempts_left ?? 0);
  await logDeviceEvent(db, deviceId, actorId, attemptsLeft === 0 ? "pin_locked_out" : "pin_failed");
  return { ok: false, error: "bad_pin", attemptsLeft };
}

export function pinCheckResponse(check: Exclude<PinCheck, { ok: true }>) {
  switch (check.error) {
    case "bad_pin":
      return NextResponse.json({ error: "bad_pin", attempts_left: check.attemptsLeft }, { status: 403 });
    case "pin_locked_out":
      return NextResponse.json({ error: "pin_locked_out", retry_after: check.retryAfter }, { status: 429, headers: { "Retry-After": String(check.retryAfter) } });
    case "no_pin":
      return NextResponse.json({ error: "no_pin" }, { status: 409 });
    default:
      return NextResponse.json({ error: "pin_unavailable" }, { status: 503 });
  }
}

export async function hasActiveAlert(db: SupabaseClient, deviceId: string): Promise<boolean | null> {
  const { count, error } = await db
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("device_id", deviceId)
    .in("status", [...ACTIVE_ALERT_STATUSES]);
  if (error) return null;
  return (count ?? 0) > 0;
}

export type DeviceSecurityEvent =
  | "pin_set" | "pin_changed" | "pin_removed" | "pin_failed" | "pin_locked_out"
  | "unlinked" | "transfer_authorized" | "admin_pin_reset" | "admin_lockout_cleared" | "admin_owner_changed";

/** Best-effort audit log; never pass PINs, hashes or tokens in detail. */
export async function logDeviceEvent(db: SupabaseClient, deviceId: string, actorId: string | null, event: DeviceSecurityEvent, detail: Record<string, string | number | boolean | null> = {}) {
  try {
    await db.from("device_security_events").insert({ device_id: deviceId, actor_id: actorId, event, detail });
  } catch {
    // auditing must never block the security action itself
  }
}

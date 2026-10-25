import "server-only";

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

const HASH_BYTES = 64;

function isValidAccountPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,6}$/.test(pin);
}

function derivePinHash(pin: string, salt: string): Promise<Buffer> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return Promise.reject(new Error("The server PIN pepper is not configured."));
  const keyedPin = createHmac("sha256", serviceKey).update(pin).digest("hex");
  return new Promise((resolve, reject) => {
    scryptCallback(keyedPin, salt, HASH_BYTES, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashAccountPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await derivePinHash(pin, salt)).toString("hex");
  return { salt, hash };
}

export type AccountPinCheck =
  | { ok: true; configured: boolean }
  | { ok: false; status: number; error: string };

export async function checkAccountPin(
  db: AdminClient,
  userId: string,
  pin: unknown,
): Promise<AccountPinCheck> {
  const { data, error } = await db
    .from("account_security_pins")
    .select("pin_salt,pin_hash,locked_until")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("account_pin_lookup_failed", { code: error.code, message: error.message });
    return { ok: false, status: 503, error: "Security verification is temporarily unavailable." };
  }
  if (!data) return { ok: true, configured: false };

  if (data.locked_until && Date.parse(data.locked_until) > Date.now()) {
    const minutes = Math.max(1, Math.ceil((Date.parse(data.locked_until) - Date.now()) / 60_000));
    return { ok: false, status: 429, error: `Too many incorrect PIN attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }
  if (!isValidAccountPin(pin)) {
    return { ok: false, status: 428, error: "Enter your Kiki PIN to continue." };
  }

  const actual = await derivePinHash(pin, data.pin_salt);
  const expected = Buffer.from(data.pin_hash, "hex");
  const matches = actual.length === expected.length && timingSafeEqual(actual, expected);
  if (!matches) {
    const { data: lockedUntil, error: attemptError } = await db.rpc("record_account_pin_failure", { p_user_id: userId });
    if (attemptError) {
      console.error("account_pin_attempt_record_failed", { code: attemptError.code, message: attemptError.message });
      return { ok: false, status: 503, error: "Security verification is temporarily unavailable." };
    }
    if (typeof lockedUntil === "string" && Date.parse(lockedUntil) > Date.now()) {
      const minutes = Math.max(1, Math.ceil((Date.parse(lockedUntil) - Date.now()) / 60_000));
      return { ok: false, status: 429, error: `Too many incorrect PIN attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
    }
    return { ok: false, status: 403, error: "That PIN is not correct." };
  }

  const { error: resetError } = await db.rpc("reset_account_pin_failures", { p_user_id: userId });
  if (resetError) {
    console.error("account_pin_attempt_reset_failed", { code: resetError.code, message: resetError.message });
    return { ok: false, status: 503, error: "Security verification is temporarily unavailable." };
  }
  return { ok: true, configured: true };
}

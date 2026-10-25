import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticated, admin, fail } from "@/app/api/calm/_shared";
import { checkAccountPin, hashAccountPin } from "@/lib/account/securityPin.server";
import { sameOrigin } from "@/lib/verification/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  pin: z.string().regex(/^\d{4,6}$/),
  currentPin: z.string().optional(),
});

export async function GET() {
  const auth = await authenticated();
  if (auth.response) return auth.response;

  const { data, error } = await admin()
    .from("account_security_pins")
    .select("user_id")
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) {
    console.error("account_pin_status_lookup_failed", { code: error.code, message: error.message });
    return fail("Security settings could not be loaded.", 503);
  }

  return NextResponse.json(
    { configured: Boolean(data) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const auth = await authenticated();
  if (auth.response) return auth.response;

  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return fail("Choose a PIN with 4 to 6 digits.", 400);
  }

  const db = admin();
  const { data: current, error: lookupError } = await db
    .from("account_security_pins")
    .select("user_id")
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (lookupError) {
    console.error("account_pin_update_lookup_failed", { code: lookupError.code, message: lookupError.message });
    return fail("Security settings could not be updated.", 503);
  }

  if (current) {
    const check = await checkAccountPin(db, auth.userId, input.data.currentPin);
    if (!check.ok) return fail(check.error, check.status);
  }

  const { salt, hash } = await hashAccountPin(input.data.pin);
  const { error: saveError } = await db.from("account_security_pins").upsert({
    user_id: auth.userId,
    pin_salt: salt,
    pin_hash: hash,
    failed_attempts: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  });
  if (saveError) {
    console.error("account_pin_save_failed", { code: saveError.code, message: saveError.message });
    return fail("Your PIN could not be saved. Please try again.", 500);
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

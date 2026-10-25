import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticated, admin, fail } from "@/app/api/calm/_shared";
import { checkAccountPin } from "@/lib/account/securityPin.server";
import { sameOrigin } from "@/lib/verification/http";

const schema = z.object({
  full_name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40),
  home_address: z.string().trim().max(300),
  emergency_contact_name: z.string().trim().max(120),
  emergency_contact_phone: z.string().trim().max(40),
  pin: z.string().optional(),
});

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const auth = await authenticated();
  if (auth.response) return auth.response;

  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return fail("Check the profile details and try again.", 400);

  const db = admin();
  const pinCheck = await checkAccountPin(db, auth.userId, input.data.pin);
  if (!pinCheck.ok) return fail(pinCheck.error, pinCheck.status);

  const { pin: _pin, ...details } = input.data;
  const { error } = await db.from("profiles").update({
    ...details,
    phone: details.phone || null,
    home_address: details.home_address || null,
    emergency_contact_name: details.emergency_contact_name || null,
    emergency_contact_phone: details.emergency_contact_phone || null,
  }).eq("id", auth.userId);
  if (error) {
    console.error("account_profile_details_update_failed", { code: error.code, message: error.message });
    return fail("Profile details could not be saved.", 500);
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

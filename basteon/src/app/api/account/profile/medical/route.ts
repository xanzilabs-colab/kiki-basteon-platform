import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticated, admin, fail } from "@/app/api/calm/_shared";
import { checkAccountPin } from "@/lib/account/securityPin.server";
import { sameOrigin } from "@/lib/verification/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  allergies: z.string().max(2000),
  conditions: z.string().max(2000),
  medications: z.string().max(2000),
  blood_type: z.string().max(3).refine((value) => value === "" || /^(AB|A|B|O)[+-]$/.test(value)),
  notes: z.string().max(300),
  pin: z.string().optional(),
});

export async function GET() {
  const auth = await authenticated();
  if (auth.response) return auth.response;

  const { data, error } = await admin()
    .from("medical_profiles")
    .select("allergies,conditions,medications,blood_type,notes")
    .eq("owner_id", auth.userId)
    .maybeSingle();
  if (error) {
    console.error("account_medical_profile_load_failed", { code: error.code, message: error.message });
    return fail("Medical information could not be loaded.", 500);
  }

  return NextResponse.json(
    { medical: data ?? { allergies: "", conditions: "", medications: "", blood_type: "", notes: "" } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return fail("forbidden", 403);
  const auth = await authenticated();
  if (auth.response) return auth.response;

  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return fail("Check the medical information and try again.", 400);

  const db = admin();
  const pinCheck = await checkAccountPin(db, auth.userId, input.data.pin);
  if (!pinCheck.ok) return fail(pinCheck.error, pinCheck.status);

  const { pin: _pin, ...medical } = input.data;
  const { error } = await db.from("medical_profiles").upsert({
    owner_id: auth.userId,
    ...medical,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("account_medical_profile_save_failed", { code: error.code, message: error.message });
    return fail("Medical information could not be saved.", 500);
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

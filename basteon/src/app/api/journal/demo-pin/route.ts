import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const DEMO_EMAIL = "tumishopraise03@gmail.com";
const DEMO_NAME = "Tumisho Aphane";

function response(body: { pin: string | null }, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET() {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError) {
    console.error("Could not verify journal demo account.", authError);
    return response({ pin: null }, 503);
  }
  if (!user) return response({ pin: null }, 401);

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Could not verify journal demo profile.", profileError);
    return response({ pin: null }, 503);
  }

  const emailMatches = user.email?.trim().toLowerCase() === DEMO_EMAIL;
  const nameMatches = profile?.full_name?.trim().toLowerCase() === DEMO_NAME.toLowerCase();
  if (!emailMatches && !nameMatches) return response({ pin: null }, 404);

  const pin = process.env.KIKI_JOURNAL_DEMO_PIN;
  if (!pin || !/^\d{6,8}$/.test(pin)) return response({ pin: null });
  return response({ pin });
}

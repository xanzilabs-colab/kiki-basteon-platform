import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deviceCookieName, deviceCookieOptions, newDeviceToken } from "@/lib/verification/device";
import { invalidateFaceProof } from "@/lib/verification/service";
import { safeJson, sameOrigin } from "@/lib/verification/http";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return safeJson({ error: "unauthenticated" }, { status: 401 });
  await invalidateFaceProof(user.id);
  const response = safeJson({ ok: true });
  response.cookies.set(deviceCookieName, newDeviceToken(), deviceCookieOptions);
  return response;
}
import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { VERIFICATION_CONFIG } from "@/lib/verification/config";
import { deviceCookieName, deviceCookieOptions } from "@/lib/verification/device";
import { isFacePurpose, isSimulationOutcome, issueFaceSession } from "@/lib/verification/service";
import { safeJson, sameOrigin } from "@/lib/verification/http";

const bodySchema = z.object({ purpose: z.string(), simulationOutcome: z.string().optional() });

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return safeJson({ error: "unauthenticated" }, { status: 401 });
  const payload = bodySchema.safeParse(await request.json().catch(() => null));
  if (!payload.success || !isFacePurpose(payload.data.purpose)) return safeJson({ error: "invalid_request" }, { status: 400 });
  const simulationOutcome = process.env.NODE_ENV !== "production" && VERIFICATION_CONFIG.mode === "simulation" && isSimulationOutcome(payload.data.simulationOutcome)
    ? payload.data.simulationOutcome
    : undefined;
  const result = await issueFaceSession(user.id, payload.data.purpose, simulationOutcome);
  if ("error" in result) return safeJson({ error: result.error, ...(result.error === "locked" ? { lockedUntil: result.lockedUntil } : {}) }, { status: result.error === "not_verified" ? 403 : 429 });
  const response = safeJson({ sessionId: result.sessionId, clientConfig: result.clientConfig });
  response.cookies.set(deviceCookieName, result.token, deviceCookieOptions);
  return response;
}
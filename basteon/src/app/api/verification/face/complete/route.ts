import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { FaceCheckLockedError, FaceCheckRequiredError, completeFaceSession } from "@/lib/verification/service";
import { safeJson, sameOrigin } from "@/lib/verification/http";

const bodySchema = z.object({ sessionId: z.string().uuid() });

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return safeJson({ error: "forbidden" }, { status: 403 });
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return safeJson({ error: "unauthenticated" }, { status: 401 });
  const payload = bodySchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return safeJson({ error: "invalid_request" }, { status: 400 });
  try {
    return safeJson(await completeFaceSession(user.id, payload.data.sessionId));
  } catch (error) {
    if (error instanceof FaceCheckLockedError) return safeJson({ error: error.code }, { status: 429 });
    if (error instanceof FaceCheckRequiredError) return safeJson({ error: error.code }, { status: 401 });
    return safeJson({ error: "FACE_CHECK_UNAVAILABLE" }, { status: 503 });
  }
}
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { noStore, readJson } from "@/lib/triggerRoute";
import { sameOrigin } from "@/lib/verification/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ pendingId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers: noStore });
  }

  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401, headers: noStore });
  }

  const body = await readJson(request);
  const parsed = Body.safeParse(body.ok ? body.value : null);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400, headers: noStore });
  }

  const { data, error } = await createAdminClient().rpc("trigger_pending_cancel_user", {
    p_user_id: user.id,
    p_pending_id: parsed.data.pendingId,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: "cancel_unavailable" }, { status: 500, headers: noStore });
  }
  if (!data?.ok) {
    return NextResponse.json({ ok: false, error: "pending_not_cancellable" }, { status: 404, headers: noStore });
  }
  return NextResponse.json({ ok: true, cancelled: true }, { headers: noStore });
}
